import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";

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
        subtasks: true,
        labels: {
          include: { label: true },
        },
        epic: true,
        sprint: true,
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
    return NextResponse.json({ error: error.message }, { status: 500 });
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

    const body = await req.json();
    const {
      title,
      description,
      issueType = "TASK",
      priority = "MEDIUM",
      statusId,
      assigneeId,
      teamId,
      epicId,
      sprintId,
      estimatePoints,
      estimateHours,
      startDate,
      dueDate,
      labels = [],
    } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    // Atomic update of project issueCounter to generate guaranteed sequential key (e.g. CP-1, CP-2)
    const maxIssue = await prisma.issue.findFirst({
      where: { projectId },
      orderBy: { keyNumber: "desc" },
      select: { keyNumber: true },
    });
    const maxExistingKey = maxIssue?.keyNumber || 0;

    let project = await prisma.project.update({
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

    let keyNumber = project.issueCounter;
    if (keyNumber <= maxExistingKey) {
      keyNumber = maxExistingKey + 1;
      await prisma.project.update({
        where: { id: projectId },
        data: { issueCounter: keyNumber },
      });
    }
    const issueKey = `${project.key}-${keyNumber}`;

    // Resolve target status: either provided statusId or first status in project workflow
    let finalStatusId = statusId;
    if (!finalStatusId) {
      const defaultWorkflow = project.workflows[0];
      if (defaultWorkflow && defaultWorkflow.statuses.length > 0) {
        finalStatusId = defaultWorkflow.statuses[0].id;
      } else {
        return NextResponse.json({ error: "No workflow statuses defined for this project" }, { status: 400 });
      }
    }

    if (startDate && dueDate && new Date(dueDate) < new Date(startDate)) {
      return NextResponse.json({ error: "Due Date cannot be earlier than Start Date" }, { status: 400 });
    }

    const finalStartDate = startDate ? new Date(startDate) : new Date();
    const finalDueDate = dueDate ? new Date(dueDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const issue = await prisma.issue.create({
      data: {
        projectId,
        keyNumber,
        issueKey,
        title: title.trim(),
        description: description || null,
        issueType,
        priority: priority || "MEDIUM",
        statusId: finalStatusId,
        reporterId: user.id,
        assigneeId: assigneeId || null,
        teamId: teamId || null,
        epicId: epicId || null,
        sprintId: sprintId || null,
        estimatePoints: estimatePoints ? Number(estimatePoints) : null,
        estimateHours: estimateHours ? Number(estimateHours) : null,
        remainingHours: estimateHours ? Number(estimateHours) : null,
        startDate: finalStartDate,
        dueDate: finalDueDate,
      },
      include: {
        status: true,
        assignee: true,
        team: {
          include: {
            members: {
              include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } }
            }
          }
        },
        reporter: true,
      },
    });

    // Create activity log
    await prisma.activityLog.create({
      data: {
        issueId: issue.id,
        actorId: user.id,
        actionType: "CREATED",
        newValue: `Created ${issue.issueKey}`,
      },
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
            include: { user: true }
          }
        }
      });

      if (assignedTeam && assignedTeam.members.length > 0) {
        const { notificationEngine } = await import("@/lib/notifications");
        const targetMemberIds = assignedTeam.members.map((m) => m.userId);
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
            actionUrl: `http://localhost:3000/projects/${projectId}?issue=${issue.id}`,
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
          actionUrl: `http://localhost:3000/projects/${projectId}?issue=${issue.id}`,
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

    // REAL-TIME DATA SYNCHRONIZATION:
    // Broadcast project-scoped event immediately upon database commit
    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      syncEngine.publishProjectEvent({
        projectId,
        eventType: "ISSUE_CREATED",
        entityId: issue.id,
        entityType: "ISSUE",
        data: issue,
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

    return NextResponse.json({ issue }, { status: 201 });
  } catch (error: any) {
    console.error("Create issue error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
