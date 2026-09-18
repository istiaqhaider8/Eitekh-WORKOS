import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { issueCreateSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { getBaseUrl } from "@/lib/config";
import { deliverIssueWebhook } from "@/lib/webhooks";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    try {
      await assertProjectAccess(projectId);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }
    const { searchParams } = new URL(req.url);
    const sprintId = searchParams.get("sprintId");
    const status = searchParams.get("status");
    const statusId = searchParams.get("statusId");
    const priority = searchParams.get("priority");
    const issueType = searchParams.get("issueType");
    const epicId = searchParams.get("epicId");
    const assigneeId = searchParams.get("assigneeId");
    const search = searchParams.get("search");
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");

    const where: any = { projectId };
    if (sprintId === "null") {
      where.sprintId = null;
    } else if (sprintId) {
      where.sprintId = sprintId;
    }
    if (priority) where.priority = priority;
    if (issueType) where.issueType = issueType;
    if (epicId) where.epicId = epicId;
    if (assigneeId) where.assigneeId = assigneeId;
    if (statusId) {
      where.statusId = statusId;
    } else if (status) {
      where.status = { name: status };
    }
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { issueKey: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const total = await prisma.issue.count({ where });

    let findOptions: any = {
      where,
      include: {
        status: true,
        assignee: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true },
        },
        reporter: {
          select: { id: true, firstName: true, lastName: true },
        },
        labels: {
          include: { label: true },
        },
        epic: { select: { id: true, name: true } },
        sprint: { select: { id: true, name: true, status: true } },
        team: {
          select: { id: true, name: true }
        },
        _count: {
          select: { comments: true, attachments: true, subtasks: true },
        },
      },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    };

    if (limitParam && limitParam !== "all") {
      const limit = Math.max(1, Math.min(500, parseInt(limitParam, 10) || 50));
      const page = Math.max(1, parseInt(pageParam || "1", 10));
      findOptions.take = limit;
      findOptions.skip = (page - 1) * limit;

      const issues = await prisma.issue.findMany(findOptions);
      const totalPages = Math.ceil(total / limit);

      return NextResponse.json({
        issues,
        total,
        page,
        limit,
        totalPages,
      });
    }

    const issues = await prisma.issue.findMany(findOptions);
    return NextResponse.json({ issues, total });
  } catch (error: any) {
    console.error("Fetch issues error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let access: any;
    try {
      access = await assertProjectPermission(projectId, "issues:create");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const parsed = await parseJsonBody(req, issueCreateSchema);
    if (!parsed.success) return parsed.error;
    const {
      title,
      description,
      issueType,
      priority,
      statusId,
      assigneeId,
      teamId,
      epicId,
      sprintId,
      parentIssueId,
      componentId,
      securityLevel,
      estimatePoints,
      estimateHours,
      timeSpentHours,
      startDate,
      dueDate,
      labels,
    } = parsed.data;

    if (startDate && dueDate && new Date(dueDate) < new Date(startDate)) {
      return NextResponse.json({ error: "Due Date cannot be earlier than Start Date" }, { status: 400 });
    }

    const finalStartDate = startDate ? new Date(startDate) : new Date();
    const finalDueDate = dueDate ? new Date(dueDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Atomic update of project issueCounter and issue creation in a single transaction
    const { issue, project } = await prisma.$transaction(async (tx) => {
      const maxIssue = await tx.issue.findFirst({
        where: { projectId },
        orderBy: { keyNumber: "desc" },
        select: { keyNumber: true },
      });
      const maxExistingKey = maxIssue?.keyNumber || 0;

      let prj = await tx.project.update({
        where: { id: projectId },
        data: {
          issueCounter: { increment: 1 },
        },
        include: {
          workflows: {
            include: { statuses: { orderBy: { position: "asc" } } },
          },
        },
      });

      let keyNumber = prj.issueCounter;
      if (keyNumber <= maxExistingKey) {
        keyNumber = maxExistingKey + 1;
        prj = await tx.project.update({
          where: { id: projectId },
          data: { issueCounter: keyNumber },
          include: {
            workflows: {
              include: { statuses: { orderBy: { position: "asc" } } },
            },
          },
        });
      }
      const issueKey = `${prj.key}-${keyNumber}`;

      let finalStatusId = statusId;
      if (!finalStatusId) {
        const defaultWorkflow = prj.workflows[0];
        if (defaultWorkflow && defaultWorkflow.statuses.length > 0) {
          finalStatusId = defaultWorkflow.statuses[0].id;
        } else {
          throw new Error("No workflow statuses defined for this project");
        }
      } else {
        const validStatus = await tx.workflowStatus.findFirst({
          where: {
            id: finalStatusId,
            workflow: { projectId },
          },
        });
        if (!validStatus) {
          throw new Error("Invalid status: does not belong to this project");
        }
      }

      const issueData: any = {
        project: { connect: { id: projectId } },
        keyNumber,
        issueKey,
        title: title.trim(),
        description: description || null,
        issueType,
        priority: priority || "MEDIUM",
        status: { connect: { id: finalStatusId } },
        reporter: { connect: { id: user.id } },
        securityLevel: securityLevel || "PUBLIC",
        estimatePoints: estimatePoints ? Number(estimatePoints) : null,
        estimateHours: estimateHours ? Number(estimateHours) : null,
        remainingHours: estimateHours ? Number(estimateHours) : null,
        timeSpentHours: timeSpentHours ? Number(timeSpentHours) : 0,
        startDate: finalStartDate,
        dueDate: finalDueDate,
      };

      if (assigneeId) {
        const projWithOrg = await tx.project.findUnique({
          where: { id: projectId },
          select: { workspace: { select: { orgId: true } } },
        });
        if (projWithOrg?.workspace?.orgId) {
          const assigneeMember = await tx.organizationMember.findFirst({
            where: { userId: assigneeId, orgId: projWithOrg.workspace.orgId },
          });
          if (!assigneeMember) {
            throw new Error("Assignee is not a member of this organization");
          }
        }
        issueData.assignee = { connect: { id: assigneeId } };
      }
      if (teamId) issueData.team = { connect: { id: teamId } };
      if (epicId) issueData.epic = { connect: { id: epicId } };
      if (sprintId) issueData.sprint = { connect: { id: sprintId } };
      if (parentIssueId) issueData.parentIssue = { connect: { id: parentIssueId } };
      if (componentId) issueData.component = { connect: { id: componentId } };

      const createdIssue = await tx.issue.create({
        data: issueData,
        include: {
          status: true,
          assignee: publicUserRelation,
          team: {
            include: {
              members: {
                include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } }
              }
            }
          },
          reporter: publicUserRelation,
        },
      });

      await tx.activityLog.create({
        data: {
          issueId: createdIssue.id,
          actorId: user.id,
          actionType: "CREATED",
          newValue: `Created ${createdIssue.issueKey}`,
        },
      });

      return { issue: createdIssue, project: prj };
    });

    // Enterprise Audit Log
    const { logAuditEvent } = await import("@/lib/audit-logger");
    await logAuditEvent({
      actor: { id: user.id, name: user.fullName || `${user.firstName} ${user.lastName}`.trim(), email: user.email },
      action: "ISSUE_CREATED",
      category: "ISSUE",
      severity: "NOTICE",
      targetResource: `Issue:${issue.issueKey} (${issue.title})`,
      projectId,
      details: {
        issueId: issue.id,
        issueKey: issue.issueKey,
        title: issue.title,
        priority: issue.priority,
        issueType: issue.issueType,
        status: issue.status?.name,
        assigneeId: issue.assigneeId,
      },
    });

    // If assigned to a team, notify ALL team members
    if (teamId) {
      const assignedTeam = await prisma.team.findUnique({
        where: { id: teamId },
        include: {
          members: {
            include: { user: publicUserRelation }
          }
        }
      });

      if (assignedTeam && assignedTeam.members.length > 0) {
        const { notificationEngine } = await import("@/lib/notifications");
        const targetMemberIds = assignedTeam.members
          .map((m) => m.userId)
          .filter((uid) => uid !== assigneeId);
        await notificationEngine.dispatch({
          recipientUserIds: targetMemberIds,
          type: "ASSIGNMENT",
          title: `Task assigned to ${assignedTeam.name}`,
          message: `${user.fullName || user.firstName} assigned ${issue.issueKey} to your team "${assignedTeam.name}": "${issue.title}"`,
          linkUrl: `/projects/${projectId}?issue=${issue.id}`,
          projectId,
          issueId: issue.id,
          actorId: user.id,
          actorName: user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
          actorEmail: user.email,
          emailTemplateKey: "ASSIGNMENT",
          emailVariables: {
            assignerName: user.fullName || `${user.firstName} ${user.lastName}`.trim(),
            issueKey: issue.issueKey,
            issueTitle: issue.title,
            projectName: project.name,
            actionUrl: `${getBaseUrl()}/projects/${projectId}?issue=${issue.id}`,
          },
          sendEmailAsync: true,
        });
      }
    }

    // If assigned to another individual user, send notification
    if (assigneeId && assigneeId !== user.id) {
      const { notificationEngine } = await import("@/lib/notifications");
      await notificationEngine.dispatch({
        recipientUserIds: [assigneeId],
        type: "ASSIGNMENT",
        title: "New issue assigned to you",
        message: `${user.fullName || user.firstName} assigned you ${issue.issueKey}: "${issue.title}"`,
        linkUrl: `/projects/${projectId}?issue=${issue.id}`,
        projectId,
        issueId: issue.id,
        actorId: user.id,
        actorName: user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
        actorEmail: user.email,
        emailTemplateKey: "ISSUE_ASSIGNED",
        emailVariables: {
          assignerName: user.fullName || `${user.firstName} ${user.lastName}`.trim(),
          projectKey: project.key,
          projectName: project.name,
          issueKey: issue.issueKey,
          issueTitle: issue.title,
          priority: issue.priority,
          issueType: issue.issueType,
          actionUrl: `${getBaseUrl()}/projects/${projectId}?issue=${issue.id}`,
        },
        sendEmailAsync: true,
      });
    }

    // Attach labels if provided
    if (Array.isArray(labels) && labels.length > 0) {
      for (const labelName of labels) {
        const label = await prisma.label.upsert({
          where: { projectId_name: { projectId, name: labelName.toLowerCase().trim() } },
          create: { projectId, name: labelName.toLowerCase().trim() },
          update: {},
        });
        await prisma.issueLabel.create({
          data: { issueId: issue.id, labelId: label.id },
        });
      }
    }

    // Fetch fully hydrated issue with all relations for complete client rendering
    const fullIssue = await prisma.issue.findUnique({
      where: { id: issue.id },
      include: {
        status: true,
        assignee: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true },
        },
        reporter: {
          select: { id: true, firstName: true, lastName: true },
        },
        subtasks: true,
        labels: {
          include: { label: true },
        },
        epic: true,
        sprint: true,
        team: {
          select: { id: true, name: true },
        },
        _count: {
          select: { comments: true, attachments: true, subtasks: true },
        },
      },
    });

    const issueToReturn = fullIssue || issue;

    // REAL-TIME DATA SYNCHRONIZATION:
    // Broadcast project-scoped event immediately upon database commit
    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      syncEngine.publishProjectEvent({
        projectId,
        eventType: "ISSUE_CREATED",
        entityId: issue.id,
        entityType: "ISSUE",
        data: issueToReturn,
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
      console.error("Real-time sync event error:", syncErr);
    }

    // Outbound webhook delivery. dispatchWebhook() existed but nothing ever
    // called it, so registered webhooks silently never fired.
    await deliverIssueWebhook("issue.created", projectId, issueToReturn);

    return NextResponse.json({ issue: issueToReturn }, { status: 201 });
  } catch (error: any) {
    console.error("Create issue error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
