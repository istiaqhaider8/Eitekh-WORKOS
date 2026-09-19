import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { getCurrentUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { issueUpdateSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { getBaseUrl } from "@/lib/config";
import { deliverIssueWebhook } from "@/lib/webhooks";
import { runAutomations } from "@/lib/automation-engine";
import { handleApiError } from "@/lib/api-error";
import { getIssueSubscribers } from "@/lib/issue-subscribers";
import { assertIssueRelationsBelongToProject, assertTransitionAllowed } from "@/lib/issue-relations";
import { applyVersionedUpdate, versionConflictResponse } from "@/lib/optimistic-lock";

/**
 * A4 — how much history a single issue fetch carries.
 *
 * These are deliberately small. The full history is available from the
 * paginated sub-resources; what the detail view needs on open is the recent
 * end of each list, and every row beyond that is latency nobody asked for.
 */
const HISTORY_PAGE_SIZE = 50;

/**
 * B1 shipped the version guard inline here. M4 moved it to
 * `src/lib/optimistic-lock.ts` unchanged, because extending it to the other
 * six things people edit meant either one rule or seven copies of it — and
 * the copies drift, which is how `issue-relations.ts` came to exist.
 *
 * The behaviour is identical: the same message, the same 409 shape, the same
 * abort-the-transaction sentinel so that activity-log rows written alongside
 * an update cannot survive an edit that did not happen. The eight tests in
 * `optimistic-locking.test.ts` are what say so.
 */

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const issue = await prisma.issue.findUnique({
      where: { id },
      include: {
        project: true,
        status: true,
        assignee: publicUserRelation,
        reporter: publicUserRelation,
        epic: true,
        sprint: true,
        component: true,
        team: {
          include: {
            members: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } }
              }
            }
          }
        },
        subtasks: {
          orderBy: { createdAt: "asc" },
          include: { assignee: publicUserRelation },
        },
        // Newest first, bounded. The previous ordering was ascending, which
        // combined with a limit would have returned the OLDEST comments —
        // the opposite of what a reader wants.
        comments: {
          // Same total ordering as /issues/[id]/comments, so page 1 there
          // agrees with what this returned.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: HISTORY_PAGE_SIZE,
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true },
            },
          },
        },
        timeEntries: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: HISTORY_PAGE_SIZE,
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        activityLogs: {
          orderBy: [{ timestamp: "desc" }, { id: "desc" }],
          take: HISTORY_PAGE_SIZE,
          include: {
            actor: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        labels: {
          include: { label: true },
        },
        outgoingDeps: {
          include: { targetIssue: true },
        },
        incomingDeps: {
          include: { sourceIssue: true },
        },
        watchers: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true } },
          },
        },
        customFieldValues: {
          include: { customField: true },
        },
        // METADATA ONLY. `fileUrl` holds a base64 data URI, so including it
        // meant every issue fetch carried every attachment's full bytes —
        // measured at 380 KB of a 689 KB payload for one unopened file.
        // Content is served by /api/attachments/[id]/content on demand.
        attachments: {
          orderBy: { createdAt: "desc" },
          take: HISTORY_PAGE_SIZE,
          select: {
            id: true,
            fileName: true,
            fileSize: true,
            mimeType: true,
            createdAt: true,
            uploader: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true } },
          },
        },
        // Totals, so a client can tell the bounded lists above are partial
        // and offer "show all" rather than silently presenting 50 of 374.
        _count: {
          select: { comments: true, timeEntries: true, activityLogs: true, attachments: true },
        },
        delegations: {
          orderBy: { createdAt: "desc" },
          include: {
            originalAssignee: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
            delegateUser: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
            history: {
              orderBy: { timestamp: "desc" },
              include: {
                actor: { select: { id: true, firstName: true, lastName: true, email: true } },
              },
            },
          },
        },
      },
    });

    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    try {
      const { assertProjectAccess } = await import("@/lib/tenant");
      await assertProjectAccess(issue.projectId);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ issue });
  } catch (error: any) {
    return handleApiError(error, "issues/[id]");
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const currentIssue = await prisma.issue.findUnique({
      where: { id },
      include: {
        status: true,
        assignee: publicUserRelation,
        team: true,
        sprint: true,
        epic: true,
      },
    });
    if (!currentIssue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    let access: any;
    try {
      const { assertProjectPermission } = await import("@/lib/tenant");
      access = await assertProjectPermission(currentIssue.projectId, "issues:edit");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const parsed = await parseJsonBody(req, issueUpdateSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    /**
     * Every foreign key in the body must belong to THIS project.
     *
     * The permission check above authorises the caller for this issue, and
     * nothing in it looks at the body — so `{"sprintId": "<another tenant's
     * sprint>"}` on your own issue was written straight through. Confirmed
     * against the running app for sprintId and epicId; statusId was already
     * checked below, and assigneeId already required organization membership.
     * The point of routing them all through one helper is that the next field
     * added cannot be forgotten, and that `issues/bulk` enforces the same
     * rule — it previously enforced none of it.
     */
    await assertIssueRelationsBelongToProject(currentIssue.projectId, body);

    if (body.statusId !== undefined && (!body.statusId || !String(body.statusId).trim())) {
      return NextResponse.json({ error: "Status is a mandatory field" }, { status: 400 });
    }

    if (body.priority !== undefined && (!body.priority || !String(body.priority).trim())) {
      return NextResponse.json({ error: "Priority is a mandatory field" }, { status: 400 });
    }

    // Dates are optional on updates — only validate format if provided
    if (body.startDate !== undefined && body.startDate !== null && body.startDate !== "") {
      const d = new Date(body.startDate);
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid Start Date format" }, { status: 400 });
      }
    }

    if (body.dueDate !== undefined && body.dueDate !== null && body.dueDate !== "") {
      const d = new Date(body.dueDate);
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid Due Date format" }, { status: 400 });
      }
    }

    const effectiveStartDate = body.startDate !== undefined ? (body.startDate ? new Date(body.startDate) : null) : (currentIssue.startDate ? new Date(currentIssue.startDate) : null);
    const effectiveDueDate = body.dueDate !== undefined ? (body.dueDate ? new Date(body.dueDate) : null) : (currentIssue.dueDate ? new Date(currentIssue.dueDate) : null);
    if (effectiveStartDate && effectiveDueDate && effectiveDueDate < effectiveStartDate) {
      return NextResponse.json({ error: "Due Date cannot be earlier than Start Date" }, { status: 400 });
    }

    const updateData: any = {};
    const activityLogs: any[] = [];

    if (body.title !== undefined && body.title !== currentIssue.title) {
      updateData.title = body.title;
      activityLogs.push({
        issueId: id,
        actorId: user.id,
        actionType: "UPDATED_TITLE",
        fieldChanged: "title",
        oldValue: currentIssue.title,
        newValue: body.title,
      });
    }

    if (body.description !== undefined && body.description !== currentIssue.description) {
      updateData.description = body.description;
      activityLogs.push({
        issueId: id,
        actorId: user.id,
        actionType: "UPDATED_DESCRIPTION",
        fieldChanged: "description",
        oldValue: currentIssue.description ? "Updated description" : "Added description",
        newValue: "Updated description",
      });
    }

    if (body.priority !== undefined && body.priority !== currentIssue.priority) {
      activityLogs.push({
        issueId: id,
        actorId: user.id,
        actionType: "UPDATED_PRIORITY",
        fieldChanged: "priority",
        oldValue: currentIssue.priority,
        newValue: body.priority,
      });
      updateData.priority = body.priority;
    }

    if (body.issueType !== undefined && body.issueType !== currentIssue.issueType) {
      if (!body.issueType || !String(body.issueType).trim()) {
        return NextResponse.json({ error: "Type is a mandatory field" }, { status: 400 });
      }
      activityLogs.push({
        issueId: id,
        actorId: user.id,
        actionType: "UPDATED_TYPE",
        fieldChanged: "issueType",
        oldValue: currentIssue.issueType,
        newValue: body.issueType,
      });
      updateData.issueType = body.issueType;
    }

    if (body.statusId !== undefined && body.statusId !== currentIssue.statusId) {
      const newStatus = await prisma.workflowStatus.findUnique({
        where: { id: body.statusId },
        include: { workflow: true },
      });
      if (!newStatus) {
        return NextResponse.json({ error: "Workflow status not found" }, { status: 400 });
      }
      if (newStatus.workflow?.projectId && newStatus.workflow.projectId !== currentIssue.projectId) {
        return NextResponse.json({ error: "Status does not belong to this project's workflow" }, { status: 400 });
      }
      
      // Shared with issues/bulk, which enforced no transitions at all. The
      // rejection is a 409 naming the statuses that ARE reachable from here —
      // the old "Invalid status transition" told the user nothing about how to
      // proceed and told a client author nothing about how to build a picker
      // that only offers legal moves.
      await assertTransitionAllowed(currentIssue.projectId, currentIssue.statusId, body.statusId);

      activityLogs.push({
        issueId: id,
        actorId: user.id,
        actionType: "UPDATED_STATUS",
        fieldChanged: "status",
        oldValue: currentIssue.status?.name || "Unknown",
        newValue: newStatus?.name || "Unknown",
      });
      updateData.statusId = body.statusId;
      if (newStatus?.category === "DONE" || newStatus?.name?.toLowerCase().includes("done")) {
        updateData.completedAt = new Date();
      } else {
        updateData.completedAt = null;
      }
    }

    if (body.assigneeId !== undefined && body.assigneeId !== currentIssue.assigneeId) {
      let newAssigneeName = "Unassigned";
      let assignedUser = null;
      if (body.assigneeId) {
        const projWithOrg = await prisma.project.findUnique({
          where: { id: currentIssue.projectId },
          select: { workspace: { select: { orgId: true } } },
        });
        if (projWithOrg?.workspace?.orgId) {
          const assigneeMember = await prisma.organizationMember.findFirst({
            where: { userId: body.assigneeId, orgId: projWithOrg.workspace.orgId },
          });
          if (!assigneeMember) {
            return NextResponse.json({ error: "Assignee is not a member of this organization" }, { status: 400 });
          }
        }
        assignedUser = await prisma.user.findUnique({ where: { id: body.assigneeId } });
        if (assignedUser) {
          newAssigneeName = `${assignedUser.firstName} ${assignedUser.lastName}`.trim() || assignedUser.email;
        }
      }

      const oldAssigneeName = currentIssue.assignee
        ? `${currentIssue.assignee.firstName} ${currentIssue.assignee.lastName}`.trim() || currentIssue.assignee.email
        : "Unassigned";

      activityLogs.push({
        issueId: id,
        actorId: user.id,
        actionType: "UPDATED_ASSIGNEE",
        fieldChanged: "assignee",
        oldValue: oldAssigneeName,
        newValue: newAssigneeName,
      });
      updateData.assigneeId = body.assigneeId || null;

      if (body.assigneeId && body.assigneeId !== user.id && assignedUser) {
        const { notificationEngine } = await import("@/lib/notifications");
        const project = await prisma.project.findUnique({ where: { id: currentIssue.projectId } });
        await notificationEngine.dispatch({
          recipientUserIds: [body.assigneeId],
          type: "ASSIGNMENT",
          title: "Issue assigned to you",
          message: `${user.fullName || user.firstName} assigned you ${currentIssue.issueKey}`,
          linkUrl: `/projects/${currentIssue.projectId}?issue=${currentIssue.id}`,
          projectId: currentIssue.projectId,
          issueId: currentIssue.id,
          actorId: user.id,
          actorName: user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
          actorEmail: user.email,
          emailTemplateKey: "ISSUE_ASSIGNED",
          emailVariables: {
            userName: `${assignedUser.firstName} ${assignedUser.lastName}`.trim(),
            assignerName: user.fullName || `${user.firstName} ${user.lastName}`.trim(),
            projectKey: project?.key || "PROJECT",
            projectName: project?.name || "Project Workspace",
            issueKey: currentIssue.issueKey,
            issueTitle: currentIssue.title,
            priority: body.priority || currentIssue.priority,
            issueType: currentIssue.issueType,
            actionUrl: `${getBaseUrl()}/projects/${currentIssue.projectId}?issue=${currentIssue.id}`,
          },
          sendEmailAsync: true,
        });
      }
    }

    if (body.teamId !== undefined && body.teamId !== currentIssue.teamId) {
      updateData.teamId = body.teamId || null;
      let newTeamName = "None";
      let assignedTeam = null;
      if (body.teamId) {
        assignedTeam = await prisma.team.findUnique({
          where: { id: body.teamId },
          include: {
            members: {
              include: { user: publicUserRelation },
            },
          },
        });
        if (assignedTeam) {
          newTeamName = assignedTeam.name;
        }
      }

      const oldTeamName = currentIssue.team ? currentIssue.team.name : "None";

      activityLogs.push({
        issueId: id,
        actorId: user.id,
        actionType: "UPDATED_TEAM",
        fieldChanged: "team",
        oldValue: oldTeamName,
        newValue: newTeamName,
      });

      // When assigned to a team, notify ALL team members!
      if (assignedTeam && assignedTeam.members.length > 0) {
        const { notificationEngine } = await import("@/lib/notifications");
        const project = await prisma.project.findUnique({ where: { id: currentIssue.projectId } });
        const targetMemberIds = assignedTeam.members.map((m) => m.userId);

        await notificationEngine.dispatch({
          recipientUserIds: targetMemberIds,
          type: "ASSIGNMENT",
          title: `Task assigned to ${assignedTeam.name}`,
          message: `${user.fullName || user.firstName} assigned ${currentIssue.issueKey} to your team "${assignedTeam.name}": "${currentIssue.title}"`,
          linkUrl: `/projects/${currentIssue.projectId}?issue=${currentIssue.id}`,
          projectId: currentIssue.projectId,
          issueId: currentIssue.id,
          actorId: user.id,
          actorName: user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
          actorEmail: user.email,
          emailTemplateKey: "ISSUE_ASSIGNED",
          emailVariables: {
            assignerName: user.fullName || `${user.firstName} ${user.lastName}`.trim(),
            projectKey: project?.key || "PROJECT",
            projectName: project?.name || "Project Workspace",
            issueKey: currentIssue.issueKey,
            issueTitle: currentIssue.title,
            priority: currentIssue.priority,
            issueType: currentIssue.issueType,
            actionUrl: `${getBaseUrl()}/projects/${currentIssue.projectId}?issue=${currentIssue.id}`,
          },
          sendEmailAsync: true,
        });
      }
    }

    if (body.sprintId !== undefined && body.sprintId !== currentIssue.sprintId) {
      let newSprintName = "Backlog";
      if (body.sprintId) {
        const newSprint = await prisma.sprint.findUnique({ where: { id: body.sprintId } });
        if (newSprint) newSprintName = newSprint.name;
      }
      activityLogs.push({
        issueId: id,
        actorId: user.id,
        actionType: "UPDATED_SPRINT",
        fieldChanged: "sprint",
        oldValue: currentIssue.sprint?.name || "Backlog",
        newValue: newSprintName,
      });
      updateData.sprintId = body.sprintId || null;
    }

    if (body.epicId !== undefined && body.epicId !== currentIssue.epicId) {
      let newEpicName = "None";
      if (body.epicId) {
        const newEpic = await prisma.epic.findUnique({ where: { id: body.epicId } });
        if (newEpic) newEpicName = newEpic.name;
      }
      activityLogs.push({
        issueId: id,
        actorId: user.id,
        actionType: "UPDATED_EPIC",
        fieldChanged: "epic",
        oldValue: currentIssue.epic?.name || "None",
        newValue: newEpicName,
      });
      updateData.epicId = body.epicId || null;
    }

    if (body.estimatePoints !== undefined && body.estimatePoints !== currentIssue.estimatePoints) {
      activityLogs.push({
        issueId: id,
        actorId: user.id,
        actionType: "UPDATED_POINTS",
        fieldChanged: "estimatePoints",
        oldValue: currentIssue.estimatePoints ? `${currentIssue.estimatePoints} pts` : "None",
        newValue: body.estimatePoints !== null ? `${body.estimatePoints} pts` : "None",
      });
      updateData.estimatePoints = body.estimatePoints !== null ? Number(body.estimatePoints) : null;
    }

    if (body.startDate !== undefined) {
      const newStartDate = body.startDate ? new Date(body.startDate) : null;
      activityLogs.push({
        issueId: id,
        actorId: user.id,
        actionType: "UPDATED_START_DATE",
        fieldChanged: "startDate",
        oldValue: currentIssue.startDate ? new Date(currentIssue.startDate).toISOString().split("T")[0] : "None",
        newValue: newStartDate ? newStartDate.toISOString().split("T")[0] : "None",
      });
      updateData.startDate = newStartDate;
    }

    if (body.dueDate !== undefined) {
      const newDueDate = body.dueDate ? new Date(body.dueDate) : null;
      activityLogs.push({
        issueId: id,
        actorId: user.id,
        actionType: "UPDATED_DUE_DATE",
        fieldChanged: "dueDate",
        oldValue: currentIssue.dueDate ? new Date(currentIssue.dueDate).toISOString().split("T")[0] : "None",
        newValue: newDueDate ? newDueDate.toISOString().split("T")[0] : "None",
      });
      updateData.dueDate = newDueDate;
    }

    if (body.position !== undefined) {
      updateData.position = Number(body.position);
    }

    if (body.parentIssueId !== undefined) {
      updateData.parentIssueId = body.parentIssueId || null;
    }

    if (body.componentId !== undefined) {
      updateData.componentId = body.componentId || null;
    }

    if (body.estimateHours !== undefined) {
      updateData.estimateHours = body.estimateHours !== null ? Number(body.estimateHours) : null;
    }

    if (body.remainingHours !== undefined) {
      updateData.remainingHours = body.remainingHours !== null ? Number(body.remainingHours) : null;
    }

    if (body.timeSpentHours !== undefined) {
      updateData.timeSpentHours = body.timeSpentHours !== null ? Number(body.timeSpentHours) : 0;
    }

    if (body.securityLevel !== undefined) {
      updateData.securityLevel = body.securityLevel || null;
    }

    /**
     * B1 — optimistic locking.
     *
     * Two people editing the same issue is the normal case on a busy team, and
     * until now the second write simply won. No error, no warning, no trace:
     * the first person's change was gone and neither of them knew. That is the
     * kind of defect users never report, because they cannot tell it happened.
     *
     * The guard is a version column compared inside the same statement that
     * writes. `updateMany` rather than `update` because it reports a COUNT
     * instead of throwing, and zero rows is exactly the signal we want:
     * somebody else wrote first.
     *
     * Doing the compare as a separate SELECT would reintroduce the race it
     * exists to close — two requests could both read version 3 and both
     * proceed. `where: { id, version }` is atomic.
     */
    // Coerced and validated by optimisticVersionField in the request schema.
    const expectedVersion = body.version;

    const updatedIssue = await prisma.$transaction(async (tx) => {
      await applyVersionedUpdate(tx.issue, {
        id,
        expectedVersion,
        data: updateData,
        entity: "issue",
      });

      const issue = await tx.issue.findUniqueOrThrow({
        where: { id },
        include: {
          status: true,
          assignee: {
            select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true },
          },
          reporter: {
            select: { id: true, firstName: true, lastName: true },
          },
          team: true,
          sprint: true,
          epic: true,
          component: true,
          labels: {
            include: { label: true },
          },
          subtasks: true,
          _count: {
            select: { comments: true, attachments: true, subtasks: true },
          },
        },
      });

      if (activityLogs.length > 0) {
        await tx.activityLog.createMany({
          data: activityLogs,
        });
      }

      return issue;
    });

    // REAL-TIME DATA SYNCHRONIZATION:
    // Broadcast project-scoped ISSUE_UPDATED event to all active project subscribers
    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      syncEngine.publishProjectEvent({
        projectId: currentIssue.projectId,
        eventType: "ISSUE_UPDATED",
        entityId: updatedIssue.id,
        entityType: "ISSUE",
        changedFields: Object.keys(updateData),
        data: updatedIssue,
        actor: {
          id: user.id,
          email: user.email,
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
        },
        sourceModule: "Projects",
        targetModules: [
          "Kanban",
          "List",
          "Scrum",
          "Backlog",
          "Sprint",
          "Calendar",
          "Gantt",
          "Workload",
          "Analytics",
          "Reports",
        ],
      });
    } catch (syncErr) {
      console.error("Real-time sync error:", syncErr);
    }

    await deliverIssueWebhook("issue.updated", currentIssue.projectId, updatedIssue);

    /**
     * C3 — the STATUS notification.
     *
     * The preferences page has always offered a status toggle, and nothing
     * ever sent this notification, so the switch did nothing whichever way it
     * was set. Moving an issue through the workflow is the single most common
     * event in a tracker and the one people most expect to hear about.
     *
     * Recipients are the watchers, assignee and reporter, minus whoever made
     * the change. See src/lib/issue-subscribers.ts for why it is not the whole
     * project.
     */
    if (body.statusId !== undefined && body.statusId !== currentIssue.statusId) {
      const subscribers = await getIssueSubscribers({ issueId: id, actorId: user.id });
      if (subscribers.length > 0) {
        const { notificationEngine } = await import("@/lib/notifications");
        const actorName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email;
        const fromName = currentIssue.status?.name || "its previous status";
        const toName = updatedIssue.status?.name || "a new status";

        await notificationEngine.dispatch({
          recipientUserIds: subscribers,
          type: "STATUS",
          title: `${updatedIssue.issueKey} moved to ${toName}`,
          message: `${actorName} moved ${updatedIssue.issueKey} from ${fromName} to ${toName}.`,
          linkUrl: `/projects/${currentIssue.projectId}?issue=${id}`,
          projectId: currentIssue.projectId,
          issueId: id,
          actorId: user.id,
          actorName,
          actorEmail: user.email,
          // Keyed on the resulting version, so a retried request cannot send
          // the same transition twice.
          idempotencyKey: `status:${id}:${updatedIssue.version}`,
        });
      }
    }

    // Fire the automation triggers that correspond to what actually changed,
    // so a rule listening for a status change is not run on an unrelated edit.
    if (body.statusId !== undefined && body.statusId !== currentIssue.statusId) {
      await runAutomations("STATUS_CHANGED", {
        projectId: currentIssue.projectId,
        issueId: id,
        actorId: user.id,
        previous: { statusId: currentIssue.statusId },
      });
    }
    if (body.assigneeId !== undefined && body.assigneeId !== currentIssue.assigneeId) {
      await runAutomations("ASSIGNEE_CHANGED", {
        projectId: currentIssue.projectId,
        issueId: id,
        actorId: user.id,
        previous: { assigneeId: currentIssue.assigneeId },
      });
    }

    const { logAuditEvent } = await import("@/lib/audit-logger");
    await logAuditEvent({
      actor: { id: user.id, name: `${user.firstName} ${user.lastName}`.trim(), email: user.email },
      action: body.statusId && body.statusId !== currentIssue.statusId ? "ISSUE_STATUS_TRANSITIONED" : "ISSUE_UPDATED",
      category: "ISSUE",
      severity: "INFO",
      targetResource: `Issue:${updatedIssue.issueKey} (${updatedIssue.title})`,
      projectId: updatedIssue.projectId,
      details: {
        issueKey: updatedIssue.issueKey,
        status: updatedIssue.status?.name,
        changes: updateData,
        activityCount: activityLogs.length,
      },
    });

    return NextResponse.json({ issue: updatedIssue });
  } catch (error: any) {
    /**
     * B1 — a conflict is answered with the CURRENT state, not just a refusal.
     *
     * "Someone else changed this" and nothing else leaves the user with a form
     * full of edits and no way to tell what they would be overwriting. The
     * body carries the server's version of the issue so the client can show
     * the difference and let them decide; the shape matches GET, so a client
     * can reuse whatever it already renders.
     */
    if (error?.code === "VERSION_CONFLICT") {
      const { id } = await params;
      const current = await prisma.issue.findUnique({
        where: { id },
        include: {
          status: true,
          assignee: publicUserRelation,
          reporter: publicUserRelation,
          team: true,
          sprint: true,
          epic: true,
          component: true,
        },
      });
      return versionConflictResponse(error.message, "issue", current);
    }
    console.error("Update issue error:", error);
    return handleApiError(error, "issues/[id]");
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const issue = await prisma.issue.findUnique({
      where: { id },
      select: { id: true, projectId: true, issueKey: true },
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    let access: any;
    try {
      const { assertProjectPermission } = await import("@/lib/tenant");
      access = await assertProjectPermission(issue.projectId, "issues:delete");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    await prisma.issue.delete({ where: { id } });

    const { logAuditEvent: logDeleteAudit } = await import("@/lib/audit-logger");
    await logDeleteAudit({
      actor: { id: user.id, name: `${user.firstName} ${user.lastName}`.trim(), email: user.email },
      action: "ISSUE_DELETED",
      category: "ISSUE",
      severity: "CRITICAL",
      targetResource: `Issue:${issue.issueKey}`,
      projectId: issue.projectId,
      details: { issueId: issue.id, issueKey: issue.issueKey },
    });

    // REAL-TIME DATA SYNCHRONIZATION:
    // Broadcast project-scoped ISSUE_DELETED event
    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      syncEngine.publishProjectEvent({
        projectId: issue.projectId,
        eventType: "ISSUE_DELETED",
        entityId: issue.id,
        entityType: "ISSUE",
        data: { id: issue.id, issueKey: issue.issueKey },
        actor: {
          id: user.id,
          email: user.email,
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
        },
        sourceModule: "Projects",
        targetModules: [
          "Kanban",
          "List",
          "Scrum",
          "Backlog",
          "Sprint",
          "Calendar",
          "Gantt",
          "Workload",
          "Analytics",
          "Reports",
        ],
      });
    } catch (syncErr) {
      console.error("Real-time sync error:", syncErr);
    }

    await deliverIssueWebhook("issue.deleted", issue.projectId, { id, issueKey: issue.issueKey });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error, "issues/[id]");
  }
}
