import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { bulkIssueUpdateSchema, bulkIssueDeleteSchema, parseBody } from "@/lib/validation";

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(bulkIssueUpdateSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { issueIds, updates } = parsed.data;

    // Validate access to all issues
    const issues = await prisma.issue.findMany({
      where: { id: { in: issueIds } },
      select: {
        id: true,
        projectId: true,
        assigneeId: true,
        dueDate: true,
        assignee: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });

    if (issues.length !== issueIds.length) {
      return NextResponse.json({ error: "One or more issues not found" }, { status: 404 });
    }

    // Group by project to check access and PBAC permission strictly
    const projectIds = Array.from(new Set(issues.map((i) => i.projectId)));
    for (const projectId of projectIds) {
      try {
        await assertProjectPermission(projectId, "issues:bulk_edit");
      } catch (err: any) {
        return NextResponse.json({ error: err.message || "Forbidden: Cannot perform bulk edit on project" }, { status: 403 });
      }
    }

    // Build update data
    const updateData: any = {};
    if (updates.statusId !== undefined) updateData.statusId = updates.statusId;
    if (updates.priority !== undefined) updateData.priority = updates.priority;
    if (updates.assigneeId !== undefined) updateData.assigneeId = updates.assigneeId || null;
    if (updates.teamId !== undefined) updateData.teamId = updates.teamId || null;
    if (updates.sprintId !== undefined) updateData.sprintId = updates.sprintId || null;
    if (updates.epicId !== undefined) updateData.epicId = updates.epicId || null;
    if (updates.dueDate !== undefined) {
      updateData.dueDate = updates.dueDate ? new Date(updates.dueDate) : null;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    let newAssigneeName = "Unassigned";
    if (updates.assigneeId) {
      const assignedUser = await prisma.user.findUnique({
        where: { id: updates.assigneeId },
        select: { firstName: true, lastName: true, email: true },
      });
      if (assignedUser) {
        newAssigneeName = `${assignedUser.firstName || ""} ${assignedUser.lastName || ""}`.trim() || assignedUser.email;
      }
    }

    // Perform bulk update in an atomic transaction
    const tx: any[] = [
      prisma.issue.updateMany({
        where: { id: { in: issueIds } },
        data: updateData,
      }),
    ];

    // Create detailed activity logs for each issue
    const activityLogEntries = issues.map((issue) => {
      const oldAssigneeName = issue.assignee
        ? `${issue.assignee.firstName || ""} ${issue.assignee.lastName || ""}`.trim() || issue.assignee.email
        : "Unassigned";

      let actionType = "BULK_UPDATE";
      let fieldChanged: string | undefined = undefined;
      let oldValue: string | undefined = undefined;
      let newValue: string | undefined = JSON.stringify(updateData);

      if (updates.assigneeId !== undefined) {
        actionType = "UPDATED_ASSIGNEE";
        fieldChanged = "assignee";
        oldValue = oldAssigneeName;
        newValue = newAssigneeName;
      } else if (updates.dueDate !== undefined) {
        actionType = "UPDATED_DUE_DATE";
        fieldChanged = "dueDate";
        oldValue = issue.dueDate ? new Date(issue.dueDate).toISOString().split("T")[0] : "None";
        newValue = updates.dueDate ? String(updates.dueDate).split("T")[0] : "Removed";
      } else if (updates.statusId !== undefined) {
        actionType = "UPDATED_STATUS";
        fieldChanged = "status";
        newValue = updates.statusId;
      } else if (updates.priority !== undefined) {
        actionType = "UPDATED_PRIORITY";
        fieldChanged = "priority";
        newValue = updates.priority;
      }

      return {
        issueId: issue.id,
        actorId: user.id,
        actionType,
        fieldChanged,
        oldValue,
        newValue,
      };
    });

    tx.push(prisma.activityLog.createMany({ data: activityLogEntries }));

    const results = await prisma.$transaction(tx);

    // REAL-TIME DATA SYNCHRONIZATION:
    // Broadcast project-scoped bulk update event to each affected project
    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      for (const pId of projectIds) {
        const projectIssueIds = issues.filter(i => i.projectId === pId).map(i => i.id);
        syncEngine.publishProjectEvent({
          projectId: pId,
          eventType: "BULK_ISSUES_UPDATED",
          changedFields: Object.keys(updateData),
          data: { issueIds: projectIssueIds, updates: updateData },
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
      }
    } catch (syncErr) {
      console.error("Real-time sync error in bulk update:", syncErr);
    }

    return NextResponse.json({ updatedCount: results[0].count, updated: results[0].count });
  } catch (error: any) {
    if (error.message?.includes("Forbidden")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error.message?.includes("Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Bulk update error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(bulkIssueDeleteSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { issueIds } = parsed.data;

    // Query all target issues to verify existence and check project access
    const issues = await prisma.issue.findMany({
      where: { id: { in: issueIds } },
      select: { id: true, projectId: true },
    });

    if (issues.length !== issueIds.length) {
      return NextResponse.json({ error: "One or more issues not found" }, { status: 404 });
    }

    // Strict project authorization and PBAC permission check
    const projectIds = Array.from(new Set(issues.map((i) => i.projectId)));
    for (const projectId of projectIds) {
      await assertProjectPermission(projectId, "issues:delete");
    }

    // Atomic cascade deletion inside a database transaction
    const [
      _delLabels,
      _delDeps,
      _delSubtasks,
      _delComments,
      _delTime,
      _delLogs,
      delIssues,
    ] = await prisma.$transaction([
      prisma.issueLabel.deleteMany({ where: { issueId: { in: issueIds } } }),
      prisma.issueDependency.deleteMany({
        where: {
          OR: [
            { sourceIssueId: { in: issueIds } },
            { targetIssueId: { in: issueIds } },
          ],
        },
      }),
      prisma.subtask.deleteMany({ where: { parentIssueId: { in: issueIds } } }),
      prisma.comment.deleteMany({ where: { issueId: { in: issueIds } } }),
      prisma.timeEntry.deleteMany({ where: { issueId: { in: issueIds } } }),
      prisma.activityLog.deleteMany({ where: { issueId: { in: issueIds } } }),
      prisma.issue.deleteMany({ where: { id: { in: issueIds } } }),
    ]);

    return NextResponse.json({ deletedCount: delIssues.count });
  } catch (error: any) {
    if (error.message?.includes("Forbidden")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error.message?.includes("Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Bulk delete error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
