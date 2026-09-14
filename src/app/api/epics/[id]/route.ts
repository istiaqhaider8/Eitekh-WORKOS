import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const epic = await prisma.epic.findUnique({
      where: { id },
      include: {
        issues: {
          include: { status: true, assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
        }
      },
    });

    if (!epic) return NextResponse.json({ error: "Epic not found" }, { status: 404 });

    await assertProjectAccess(epic.projectId);

    return NextResponse.json(epic);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const { name, summary, color, status, ownerId, startDate, targetDate } = body;

    const epic = await prisma.epic.findUnique({ where: { id } });
    if (!epic) return NextResponse.json({ error: "Epic not found" }, { status: 404 });

    await assertProjectPermission(epic.projectId, "epics:edit");

    const updatedEpic = await prisma.epic.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(summary !== undefined && { summary }),
        ...(color !== undefined && { color }),
        ...(status !== undefined && { status }),
        ...(ownerId !== undefined && { ownerId }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(targetDate !== undefined && { targetDate: targetDate ? new Date(targetDate) : null }),
      },
    });

    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      await syncEngine.publishProjectEvent(epic.projectId, {
        eventId: `evt_epic_updated_${Date.now()}`,
        eventType: "EPIC_UPDATED",
        projectId: epic.projectId,
        entityId: updatedEpic.id,
        entityType: "EPIC",
        data: updatedEpic,
        actor: { id: user.id, email: user.email, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() },
        timestamp: new Date().toISOString(),
      });
    } catch (syncErr) {
      console.error("Sync dispatch failed:", syncErr);
    }

    return NextResponse.json(updatedEpic);
  } catch (error: any) {
    const status = error.message?.includes("Forbidden") || error.message?.includes("Unauthorized") ? 403 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const epic = await prisma.epic.findUnique({ where: { id } });
    if (!epic) return NextResponse.json({ error: "Epic not found" }, { status: 404 });

    await assertProjectPermission(epic.projectId, "epics:delete");

    // Unlink issues first
    await prisma.issue.updateMany({
      where: { epicId: id },
      data: { epicId: null },
    });

    await prisma.epic.delete({ where: { id } });

    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      await syncEngine.publishProjectEvent(epic.projectId, {
        eventId: `evt_epic_deleted_${Date.now()}`,
        eventType: "EPIC_DELETED",
        projectId: epic.projectId,
        entityId: id,
        entityType: "EPIC",
        data: { id },
        actor: { id: user.id, email: user.email, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() },
        timestamp: new Date().toISOString(),
      });
    } catch (syncErr) {
      console.error("Sync dispatch failed:", syncErr);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = error.message?.includes("Forbidden") || error.message?.includes("Unauthorized") ? 403 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
  }
}
