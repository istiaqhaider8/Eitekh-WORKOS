import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    try {
      await assertProjectAccess(projectId);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const sprints = await prisma.sprint.findMany({
      where: { projectId },
      include: {
        issues: {
          include: {
            status: true,
            assignee: publicUserRelation,
          },
        },
      },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({ sprints });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { projectId, name, goal, startDate, endDate } = await req.json();
    if (!projectId || !name?.trim()) {
      return NextResponse.json({ error: "projectId and name are required" }, { status: 400 });
    }

    try {
      await assertProjectPermission(projectId, "sprints:create");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    // Determine max position for new sprint
    const lastSprint = await prisma.sprint.findFirst({
      where: { projectId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const nextPosition = (lastSprint?.position ?? 0) + 1;

    const sprint = await prisma.sprint.create({
      data: {
        projectId,
        name: name.trim(),
        goal: goal?.trim() || null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        status: "FUTURE",
        position: nextPosition,
      },
    });

    // REAL-TIME DATA SYNCHRONIZATION:
    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      syncEngine.publishProjectEvent({
        projectId,
        eventType: "SPRINT_CREATED",
        entityId: sprint.id,
        entityType: "SPRINT",
        data: sprint,
        actor: {
          id: user.id,
          email: user.email,
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
        },
        sourceModule: "Sprint",
        targetModules: ["Scrum", "Backlog", "Sprint", "Kanban", "Timeline", "Calendar", "Analytics"],
      });
    } catch (syncErr) {
      console.error("Real-time sync error in sprint create:", syncErr);
    }

    return NextResponse.json({ sprint }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/sprints -> Reorder Sprints Serial / Sequence
export async function PUT(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { projectId, sprintOrders } = body;

    if (!projectId || !Array.isArray(sprintOrders)) {
      return NextResponse.json(
        { error: "projectId and sprintOrders array are required" },
        { status: 400 }
      );
    }

    try {
      await assertProjectPermission(projectId, "sprints:create");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    // Execute positions update in a single transaction
    const updatePromises = sprintOrders.map((item: { id: string; position: number }) =>
      prisma.sprint.update({
        where: { id: item.id },
        data: { position: item.position },
      })
    );

    const updatedSprints = await prisma.$transaction(updatePromises);

    // Broadcast sync event
    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      syncEngine.publishProjectEvent({
        projectId,
        eventType: "SPRINT_REORDERED",
        entityId: projectId,
        entityType: "SPRINT",
        data: { sprintOrders },
        actor: {
          id: user.id,
          email: user.email,
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
        },
        sourceModule: "Sprint",
        targetModules: ["Scrum", "Backlog", "Sprint"],
      });
    } catch (syncErr) {
      console.error("Real-time sync error in sprint reorder:", syncErr);
    }

    return NextResponse.json({ success: true, sprints: updatedSprints });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { sprintId, status, rolloverToSprintId, name, goal, startDate, endDate, retrospectiveNotes, position } = body;
    if (!sprintId) {
      return NextResponse.json({ error: "sprintId is required" }, { status: 400 });
    }

    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      include: {
        issues: {
          include: { status: true },
        },
      },
    });

    if (!sprint) {
      return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
    }

    try {
      const requiredPerm = status === "ACTIVE" 
        ? "sprints:start" 
        : status === "COMPLETED" 
          ? "sprints:complete" 
          : "sprints:create";
      await assertProjectPermission(sprint.projectId, requiredPerm);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    if (status && !["FUTURE", "ACTIVE", "COMPLETED", "CANCELLED"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid sprint status. Must be FUTURE, ACTIVE, COMPLETED, or CANCELLED" },
        { status: 400 }
      );
    }

    // Ensure only one active sprint per project/team
    if (status === "ACTIVE" && sprint.status !== "ACTIVE") {
      const existingActive = await prisma.sprint.findFirst({
        where: {
          projectId: sprint.projectId,
          teamId: sprint.teamId || null,
          status: "ACTIVE",
          id: { not: sprintId },
        },
      });
      if (existingActive) {
        return NextResponse.json(
          { error: `Sprint "${existingActive.name}" is already active in this project. Complete it before starting a new sprint.` },
          { status: 400 }
        );
      }
    }

    const updateData: any = {};

    // When starting a sprint, snapshot initial planned points and timestamps
    if (status === "ACTIVE" && sprint.status !== "ACTIVE") {
      const primaryIssues = sprint.issues.filter((i) => i.parentIssueId === null);
      updateData.plannedPoints = primaryIssues.reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
      if (!sprint.startDate && !startDate) {
        updateData.startDate = new Date();
      }
    }

    // Snapshot velocity and rollover incomplete issues if completing a sprint
    if (status === "COMPLETED") {
      const primaryIssues = sprint.issues.filter((i) => i.parentIssueId === null);
      const currentPlannedPoints = primaryIssues.reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
      const completedIssues = primaryIssues.filter(
        (i) => i.status?.category === "DONE" && !i.status?.name?.toLowerCase().includes("cancel")
      );
      const completedPoints = completedIssues.reduce((sum, i) => sum + (i.estimatePoints || 0), 0);

      // Preserve existing plannedPoints if set at start, otherwise record current planned
      updateData.plannedPoints = sprint.plannedPoints ?? currentPlannedPoints;
      updateData.completedPoints = completedPoints;
      updateData.completedAt = new Date();
      if (!sprint.endDate && !endDate) {
        updateData.endDate = new Date();
      }
      if (retrospectiveNotes !== undefined) {
        updateData.retrospectiveNotes = retrospectiveNotes ? retrospectiveNotes.trim() : null;
      }

      const incompleteIssues = sprint.issues.filter((i) => i.status?.category !== "DONE");
      if (incompleteIssues.length > 0) {
        await prisma.issue.updateMany({
          where: { id: { in: incompleteIssues.map((i) => i.id) } },
          data: { sprintId: rolloverToSprintId || null },
        });
      }
    }

    // Handle reopening a completed or active sprint back to FUTURE
    if (status === "FUTURE" && sprint.status !== "FUTURE") {
      updateData.completedAt = null;
    }

    if (status) updateData.status = status;
    if (name !== undefined) updateData.name = name.trim();
    if (goal !== undefined) updateData.goal = goal ? goal.trim() : null;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (position !== undefined && typeof position === "number") updateData.position = position;
    if (retrospectiveNotes !== undefined && status !== "COMPLETED") {
      updateData.retrospectiveNotes = retrospectiveNotes ? retrospectiveNotes.trim() : null;
    }

    const updatedSprint = await prisma.sprint.update({
      where: { id: sprintId },
      data: updateData,
    });

    // REAL-TIME DATA SYNCHRONIZATION:
    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      syncEngine.publishProjectEvent({
        projectId: sprint.projectId,
        eventType: status === "COMPLETED" ? "SPRINT_COMPLETED" : "SPRINT_UPDATED",
        entityId: sprintId,
        entityType: "SPRINT",
        data: updatedSprint,
        actor: {
          id: user.id,
          email: user.email,
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
        },
        sourceModule: "Sprint",
        targetModules: ["Scrum", "Backlog", "Sprint", "Kanban", "Timeline", "Calendar", "Analytics"],
      });
    } catch (syncErr) {
      console.error("Real-time sync error in sprint update:", syncErr);
    }

    return NextResponse.json({ sprint: updatedSprint });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    let sprintId = searchParams.get("sprintId");

    if (!sprintId) {
      try {
        const body = await req.json();
        sprintId = body.sprintId;
      } catch (_) {}
    }

    if (!sprintId) {
      return NextResponse.json({ error: "sprintId is required" }, { status: 400 });
    }

    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      select: { id: true, projectId: true },
    });

    if (!sprint) {
      return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
    }

    try {
      await assertProjectPermission(sprint.projectId, "sprints:delete");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    // Unlink all issues in this sprint and delete sprint in atomic transaction
    await prisma.$transaction([
      prisma.issue.updateMany({
        where: { sprintId },
        data: { sprintId: null },
      }),
      prisma.sprint.delete({
        where: { id: sprintId },
      }),
    ]);

    // REAL-TIME DATA SYNCHRONIZATION:
    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      syncEngine.publishProjectEvent({
        projectId: sprint.projectId,
        eventType: "SPRINT_DELETED",
        entityId: sprintId,
        entityType: "SPRINT",
        data: { deletedSprintId: sprintId, id: sprintId },
        actor: {
          id: user.id,
          email: user.email,
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
        },
        sourceModule: "Sprint",
        targetModules: ["Scrum", "Backlog", "Sprint", "Kanban", "Timeline", "Calendar", "Analytics"],
      });
    } catch (syncErr) {
      console.error("Real-time sync error in sprint delete:", syncErr);
    }

    return NextResponse.json({ success: true, message: "Sprint deleted and issues moved to backlog" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
