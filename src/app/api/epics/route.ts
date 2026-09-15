import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { epicCreateSchema, parseBody } from "@/lib/validation";

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    await assertProjectAccess(projectId);

    const epics = await prisma.epic.findMany({
      where: { projectId },
      include: {
        _count: {
          select: { issues: true },
        },
        issues: {
          select: { status: { select: { category: true } } }
        }
      },
    });

    const epicsWithProgress = epics.map(epic => {
      const totalIssues = epic._count.issues;
      const completedIssues = epic.issues.filter(i => i.status?.category === "DONE").length;
      const progress = totalIssues > 0 ? Math.round((completedIssues / totalIssues) * 100) : 0;
      
      const { issues, ...epicData } = epic;
      return {
        ...epicData,
        completedIssues,
        progress
      };
    });

    return NextResponse.json(epicsWithProgress);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(epicCreateSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { projectId, name, summary, color, ownerId, startDate, targetDate } = parsed.data;

    await assertProjectPermission(projectId, "epics:create");

    const epic = await prisma.epic.create({
      data: {
        projectId,
        name: name.trim(),
        summary: summary || null,
        color: color || "#3b82f6",
        ownerId,
        startDate: startDate ? new Date(startDate) : null,
        targetDate: targetDate ? new Date(targetDate) : null,
      },
    });

    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      await syncEngine.publishProjectEvent(projectId, {
        eventId: `evt_epic_created_${Date.now()}`,
        eventType: "EPIC_CREATED",
        projectId,
        entityId: epic.id,
        entityType: "EPIC",
        data: epic,
        actor: { id: user.id, email: user.email, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() },
        timestamp: new Date().toISOString(),
      });
    } catch (syncErr) {
      console.error("Sync dispatch failed:", syncErr);
    }

    return NextResponse.json(epic, { status: 201 });
  } catch (error: any) {
    const status = error.message?.includes("Forbidden") || error.message?.includes("Unauthorized") ? 403 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
  }
}
