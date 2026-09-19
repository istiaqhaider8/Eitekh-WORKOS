import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { workflowUpdateSchema, parseBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const workflow = await prisma.workflow.findUnique({
    where: { id },
    include: {
      statuses: {
        orderBy: { position: "asc" }
      },
      transitions: true
    }
  });

  if (!workflow) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await assertProjectAccess(workflow.projectId);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(workflow);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const existing = await prisma.workflow.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await assertProjectPermission(existing.projectId, "settings:workflows");

    const parsed = parseBody(workflowUpdateSchema, await request.json());
    if (!parsed.success) return parsed.error;
    const { name, isDefault } = parsed.data;

    if (isDefault) {
      await prisma.workflow.updateMany({
        where: { projectId: existing.projectId },
        data: { isDefault: false }
      });
    }

    const workflow = await prisma.workflow.update({
      where: { id },
      data: { name, isDefault }
    });

    return NextResponse.json(workflow);
  } catch (error: any) {
    return handleApiError(error, "workflows/[id]");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const workflow = await prisma.workflow.findUnique({
      where: { id },
      include: { statuses: { include: { issues: { select: { id: true } } } } }
    });

    if (!workflow) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await assertProjectPermission(workflow.projectId, "settings:workflows");

    if (workflow.isDefault) return NextResponse.json({ error: "Cannot delete default workflow" }, { status: 400 });

    const hasIssues = workflow.statuses.some(s => s.issues.length > 0);
    if (hasIssues) return NextResponse.json({ error: "Cannot delete workflow with issues assigned to its statuses" }, { status: 400 });

    await prisma.workflow.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error, "workflows/[id]");
  }
}
