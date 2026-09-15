import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { projectUpdateSchema, parseBody } from "@/lib/validation";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertProjectAccess(id);
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        workflows: {
          include: {
            statuses: {
              orderBy: { position: "asc" }
            }
          }
        },
        _count: {
          select: { members: true, issues: true }
        }
      },
    });
    return NextResponse.json(project);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message.includes("Unauthorized") ? 401 : 403 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertProjectPermission(id, "projects:edit");
    
    const parsed = parseBody(projectUpdateSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const body = parsed.data;
    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.status !== undefined) data.status = body.status;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.startDate !== undefined) data.startDate = body.startDate ? new Date(body.startDate) : null;
    if (body.targetDate !== undefined) data.targetDate = body.targetDate ? new Date(body.targetDate) : null;

    const updated = await prisma.project.update({
      where: { id },
      data,
      include: {
        workspace: {
          include: {
            organization: true,
          },
        },
        members: {
          include: {
            user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } }
          }
        },
        _count: {
          select: { members: true, issues: true }
        }
      }
    });

    const { logAuditEvent } = await import('@/lib/audit-logger');
    await logAuditEvent({
      action: 'PROJECT_UPDATED',
      category: 'PROJECT',
      severity: 'NOTICE',
      targetResource: `Project:${updated.id} (${updated.name})`,
      projectId: updated.id,
      orgId: updated.workspace?.organization?.id,
      details: { changes: body, updatedFields: Object.keys(data) },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    const status = error.message?.includes("Unauthorized") ? 401 : (error.message?.includes("Forbidden") ? 403 : 400);
    return NextResponse.json({ error: error.message }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { role } = await assertProjectAccess(id);
    if (!["PROJECT_ADMIN", "SUPER_ADMIN"].includes(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const updated = await prisma.project.update({
      where: { id },
      data: { status: "ARCHIVED" }
    });

    const { logAuditEvent } = await import('@/lib/audit-logger');
    await logAuditEvent({
      action: 'PROJECT_ARCHIVED',
      category: 'PROJECT',
      severity: 'CRITICAL',
      targetResource: `Project:${updated.id} (${updated.name})`,
      projectId: updated.id,
      details: { status: 'ARCHIVED' },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
