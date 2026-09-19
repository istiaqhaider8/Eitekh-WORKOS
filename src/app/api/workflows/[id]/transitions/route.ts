import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { workflowTransitionCreateSchema, workflowTransitionDeleteSchema, parseBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

    await assertProjectAccess(workflow.projectId);

    const transitions = await prisma.workflowTransition.findMany({
      where: { workflowId: id },
    });

    return NextResponse.json(transitions);
  } catch (error: any) {
    return handleApiError(error, "workflows/[id]/transitions");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const workflow = await prisma.workflow.findUnique({ where: { id } });
    if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

    await assertProjectPermission(workflow.projectId, "projects:edit");

    const parsed = parseBody(workflowTransitionCreateSchema, await request.json());
    if (!parsed.success) return parsed.error;
    const { fromStatusId, toStatusId, requiredRole } = parsed.data;

    const transition = await prisma.workflowTransition.create({
      data: {
        workflowId: id,
        fromStatusId,
        toStatusId,
        requiredRole: requiredRole || null,
      },
    });

    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      await syncEngine.publishProjectEvent(workflow.projectId, {
        eventId: `evt_wf_trans_created_${Date.now()}`,
        eventType: "WORKFLOW_UPDATED",
        projectId: workflow.projectId,
        entityId: workflow.id,
        entityType: "WORKFLOW",
        data: { workflowId: id, transitionId: transition.id },
        timestamp: new Date().toISOString(),
      });
    } catch (_) {}

    return NextResponse.json(transition, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "workflows/[id]/transitions");
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

    const parsedDel = parseBody(workflowTransitionDeleteSchema, await request.json());
    if (!parsedDel.success) return parsedDel.error;
    const { transitionId } = parsedDel.data;

    await prisma.workflowTransition.delete({ where: { id: transitionId } });

    try {
      const { syncEngine } = await import("@/lib/sync-engine");
      await syncEngine.publishProjectEvent(workflow.projectId, {
        eventId: `evt_wf_trans_deleted_${Date.now()}`,
        eventType: "WORKFLOW_UPDATED",
        projectId: workflow.projectId,
        entityId: workflow.id,
        entityType: "WORKFLOW",
        data: { workflowId: id, deletedTransitionId: transitionId },
        timestamp: new Date().toISOString(),
      });
    } catch (_) {}

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error, "workflows/[id]/transitions");
  }
}
