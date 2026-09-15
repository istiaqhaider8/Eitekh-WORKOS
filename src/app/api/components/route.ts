import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { componentCreateSchema, parseBody } from "@/lib/validation";

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

    await assertProjectAccess(projectId);

    const components = await prisma.component.findMany({
      where: { projectId },
      include: {
        _count: {
          select: { issues: true },
        },
      },
    });

    return NextResponse.json(components);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(componentCreateSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { projectId, name, description, ownerId } = parsed.data;

    await assertProjectPermission(projectId, "projects:edit");

    const component = await prisma.component.create({
      data: {
        projectId,
        name,
        description: description || null,
        ownerId,
      },
    });

    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      await syncEngine.publishProjectEvent(projectId, {
        eventId: `evt_comp_created_${Date.now()}`,
        eventType: "COMPONENT_CREATED",
        projectId,
        entityId: component.id,
        entityType: "COMPONENT",
        data: component,
        actor: { id: user.id, email: user.email, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() },
        timestamp: new Date().toISOString(),
      });
    } catch (syncErr) {
      console.error("Sync dispatch failed:", syncErr);
    }

    return NextResponse.json(component, { status: 201 });
  } catch (error: any) {
    const status = error.message?.includes("Forbidden") || error.message?.includes("Unauthorized") ? 403 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
  }
}
