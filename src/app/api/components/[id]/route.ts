import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { componentUpdateSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const component = await prisma.component.findUnique({
      where: { id },
      include: {
        issues: {
          include: { status: true, assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
        }
      },
    });

    if (!component) return NextResponse.json({ error: "Component not found" }, { status: 404 });

    await assertProjectAccess(component.projectId);

    return NextResponse.json(component);
  } catch (error: any) {
    return handleApiError(error, "components/[id]");
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
    const parsed = await parseJsonBody(req, componentUpdateSchema);
    if (!parsed.success) return parsed.error;
    const { name, description, ownerId } = parsed.data;

    const component = await prisma.component.findUnique({ where: { id } });
    if (!component) return NextResponse.json({ error: "Component not found" }, { status: 404 });

    await assertProjectPermission(component.projectId, "projects:edit");

    const updatedComponent = await prisma.component.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description }),
        ...(ownerId !== undefined && { ownerId }),
      },
    });

    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      await syncEngine.publishProjectEvent(component.projectId, {
        eventId: `evt_comp_updated_${Date.now()}`,
        eventType: "COMPONENT_UPDATED",
        projectId: component.projectId,
        entityId: updatedComponent.id,
        entityType: "COMPONENT",
        data: updatedComponent,
        actor: { id: user.id, email: user.email, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() },
        timestamp: new Date().toISOString(),
      });
    } catch (syncErr) {
      console.error("Sync dispatch failed:", syncErr);
    }

    return NextResponse.json(updatedComponent);
  } catch (error: any) {
    return handleApiError(error, "components/[id]");
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

    const component = await prisma.component.findUnique({ where: { id } });
    if (!component) return NextResponse.json({ error: "Component not found" }, { status: 404 });

    await assertProjectPermission(component.projectId, "projects:edit");

    // Unlink issues first
    await prisma.issue.updateMany({
      where: { componentId: id },
      data: { componentId: null },
    });

    await prisma.component.delete({ where: { id } });

    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      await syncEngine.publishProjectEvent(component.projectId, {
        eventId: `evt_comp_deleted_${Date.now()}`,
        eventType: "COMPONENT_DELETED",
        projectId: component.projectId,
        entityId: id,
        entityType: "COMPONENT",
        data: { id },
        actor: { id: user.id, email: user.email, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() },
        timestamp: new Date().toISOString(),
      });
    } catch (syncErr) {
      console.error("Sync dispatch failed:", syncErr);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error, "components/[id]");
  }
}
