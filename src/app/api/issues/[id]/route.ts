import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { getCurrentUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

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
        comments: {
          orderBy: { createdAt: "asc" },
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true },
            },
          },
        },
        timeEntries: {
          orderBy: { createdAt: "desc" },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        activityLogs: {
          orderBy: { timestamp: "desc" },
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
        attachments: {
          orderBy: { createdAt: "desc" },
          include: {
            uploader: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true } },
          },
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
    return NextResponse.json({ error: error.message }, { status: 500 });
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

    const body = await req.json();

    if (body.statusId !== undefined && (!body.statusId || !String(body.statusId).trim())) {
      return NextResponse.json({ error: "Status is a mandatory field" }, { status: 400 });
    }

    if (body.priority !== undefined && (!body.priority || !String(body.priority).trim())) {
      return NextResponse.json({ error: "Priority is a mandatory field" }, { status: 400 });
    }

    if (body.startDate !== undefined && (body.startDate === null || body.startDate === "")) {
      return NextResponse.json({ error: "Start Date is a mandatory field" }, { status: 400 });
    }

    if (body.dueDate !== undefined && (body.dueDate === null || body.dueDate === "")) {
      return NextResponse.json({ error: "Due Date is a mandatory field" }, { status: 400 });
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
      
      const workflow = await prisma.workflow.findFirst({
        where: { projectId: currentIssue.projectId, statuses: { some: { id: currentIssue.statusId } } },
        include: { transitions: true }
      });
      
      if (workflow && workflow.transitions.length > 0) {
        const validTransition = workflow.transitions.find(t => t.fromStatusId === currentIssue.statusId && t.toStatusId === body.statusId);
        if (!validTransition) {
          return NextResponse.json({ error: "Invalid status transition" }, { status: 400 });
        }
      }

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
            actionUrl: `http://localhost:3000/projects/${currentIssue.projectId}?issue=${currentIssue.id}`,
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
              include: { user: true },
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
          emailTemplateKey: "ASSIGNMENT",
          emailVariables: {
            assignerName: user.fullName || `${user.firstName} ${user.lastName}`.trim(),
            issueKey: currentIssue.issueKey,
            issueTitle: currentIssue.title,
            projectName: project?.name || "Project Workspace",
            actionUrl: `http://localhost:3000/projects/${currentIssue.projectId}?issue=${currentIssue.id}`,
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

    const updatedIssue = await prisma.issue.update({
      where: { id },
      data: updateData,
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
      await prisma.activityLog.createMany({
        data: activityLogs,
      });
    }

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
    console.error("Update issue error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
