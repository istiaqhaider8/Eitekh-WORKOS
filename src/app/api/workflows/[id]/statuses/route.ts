import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectPermission } from "@/lib/tenant";
import { workflowStatusCreateSchema, workflowStatusUpdateSchema, workflowStatusDeleteSchema, parseBody } from "@/lib/validation";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

    await assertProjectPermission(workflow.projectId, "projects:edit");

    const parsed = parseBody(workflowStatusCreateSchema, await request.json());
    if (!parsed.success) return parsed.error;
    const { name, category, color, position, wipLimit } = parsed.data;

    const status = await prisma.workflowStatus.create({
      data: {
        workflowId: id,
        name,
        category,
        color,
        position,
        wipLimit: wipLimit != null ? Number(wipLimit) : null,
      },
    });

    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      await syncEngine.publishProjectEvent(workflow.projectId, {
        eventId: `evt_wf_status_created_${Date.now()}`,
        eventType: "WORKFLOW_UPDATED",
        projectId: workflow.projectId,
        entityId: workflow.id,
        entityType: "WORKFLOW",
        data: { workflowId: id, statusId: status.id },
        timestamp: new Date().toISOString(),
      });
    } catch (_) {}

    return NextResponse.json(status, { status: 201 });
  } catch (error: any) {
    const code = error.message?.includes("Forbidden") ? 403 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: code });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  
  try {
    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

    await assertProjectPermission(workflow.projectId, "projects:edit");

    const parsed2 = parseBody(workflowStatusUpdateSchema, await request.json());
    if (!parsed2.success) return parsed2.error;
    const { statusId, name, color, position, wipLimit } = parsed2.data;

    const status = await prisma.workflowStatus.update({
      where: { id: statusId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(color !== undefined && { color }),
        ...(position !== undefined && { position }),
        ...(wipLimit !== undefined && { wipLimit: wipLimit != null ? Number(wipLimit) : null }),
      },
    });

    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      await syncEngine.publishProjectEvent(workflow.projectId, {
        eventId: `evt_wf_status_updated_${Date.now()}`,
        eventType: "WORKFLOW_UPDATED",
        projectId: workflow.projectId,
        entityId: workflow.id,
        entityType: "WORKFLOW",
        data: { workflowId: id, statusId: status.id },
        timestamp: new Date().toISOString(),
      });
    } catch (_) {}

    return NextResponse.json(status);
  } catch (error: any) {
    const code = error.message?.includes("Forbidden") ? 403 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: code });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  
  try {
    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

    await assertProjectPermission(workflow.projectId, "projects:edit");

    const parsed3 = parseBody(workflowStatusDeleteSchema, await request.json());
    if (!parsed3.success) return parsed3.error;
    const { statusId } = parsed3.data;

    const status = await prisma.workflowStatus.findUnique({
      where: { id: statusId },
      include: { issues: { select: { id: true } } },
    });

    if (!status) return NextResponse.json({ error: "Status not found" }, { status: 404 });
    if (status.issues.length > 0) return NextResponse.json({ error: "Cannot delete status with assigned issues" }, { status: 400 });

    // Clean up any transitions linking to or from this status
    await prisma.workflowTransition.deleteMany({
      where: {
        OR: [{ fromStatusId: statusId }, { toStatusId: statusId }],
      },
    });

    await prisma.workflowStatus.delete({ where: { id: statusId } });

    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      await syncEngine.publishProjectEvent(workflow.projectId, {
        eventId: `evt_wf_status_deleted_${Date.now()}`,
        eventType: "WORKFLOW_UPDATED",
        projectId: workflow.projectId,
        entityId: workflow.id,
        entityType: "WORKFLOW",
        data: { workflowId: id, deletedStatusId: statusId },
        timestamp: new Date().toISOString(),
      });
    } catch (_) {}

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const code = error.message?.includes("Forbidden") ? 403 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: code });
  }
}
