import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { ticketUpdateSchema, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import { syncEngine } from "@/lib/sync-engine";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; ticketId: string }> }
) {
  try {
    const { id: projectId, ticketId } = await params;
    let authContext: any;
    try {
      authContext = await assertProjectAccess(projectId);
      await assertProjectPermission(projectId, "tickets:view");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const { user } = authContext;
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        createdBy: publicUserRelation,
        assignedManager: publicUserRelation,
        convertedIssue: {
          select: {
            id: true,
            issueKey: true,
            title: true,
            status: {
              select: {
                id: true,
                name: true,
                category: true,
                color: true,
              },
            },
            assignee: publicUserRelation,
          },
        },
        comments: {
          where: user.userType === "CLIENT" ? { isInternal: false } : undefined,
          orderBy: { createdAt: "asc" },
          include: {
            author: publicUserRelation,
          },
        },
        statusHistory: {
          orderBy: { timestamp: "desc" },
          include: {
            actor: publicUserRelation,
          },
        },
        attachments: {
          orderBy: { createdAt: "desc" },
          include: {
            uploader: publicUserRelation,
          },
        },
      },
    });

    if (!ticket || ticket.projectId !== projectId) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Client isolation check
    if (user.userType === "CLIENT" && ticket.createdById !== user.id) {
      return NextResponse.json({ error: "Access denied to this ticket" }, { status: 403 });
    }

    return NextResponse.json({ ticket });
  } catch (error: any) {
    return handleApiError(error, "tickets/get");
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; ticketId: string }> }
) {
  try {
    const { id: projectId, ticketId } = await params;
    let authContext: any;
    try {
      authContext = await assertProjectAccess(projectId);
      await assertProjectPermission(projectId, "tickets:manage");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const { user } = authContext;
    const existing = await prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!existing || existing.projectId !== projectId) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Client permissions check
    if (user.userType === "CLIENT") {
      if (existing.createdById !== user.id) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
      if (existing.status !== "NEW" && existing.status !== "PENDING_INFO") {
        return NextResponse.json(
          { error: "Cannot edit ticket while it is under review or resolved" },
          { status: 400 }
        );
      }
    }

    const parsed = await parseJsonBody(req, ticketUpdateSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    // Optimistic locking check (B1 finding)
    if (body.version !== undefined && body.version !== existing.version) {
      return NextResponse.json(
        {
          error: "Conflict: This ticket has been modified by another user. Please refresh and try again.",
          currentVersion: existing.version,
        },
        { status: 409 }
      );
    }

    const updateData: any = {
      version: { increment: 1 },
    };

    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.dueDate !== undefined) {
      updateData.dueDate = body.dueDate ? new Date(body.dueDate) : null;
    }
    // Only non-clients can reassign managers
    if (user.userType !== "CLIENT" && body.assignedManagerId !== undefined) {
      updateData.assignedManagerId = body.assignedManagerId;
    }

    const updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: updateData,
      include: {
        createdBy: publicUserRelation,
        assignedManager: publicUserRelation,
      },
    });

    syncEngine.publishProjectEvent({
      projectId,
      eventType: "TICKET_UPDATED",
      entityId: updated.id,
      entityType: "ISSUE",
      data: updated,
      actor: { id: user.id, email: user.email, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() },
    });

    return NextResponse.json({ ticket: updated });
  } catch (error: any) {
    return handleApiError(error, "tickets/update");
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; ticketId: string }> }
) {
  try {
    const { id: projectId, ticketId } = await params;
    let authContext: any;
    try {
      authContext = await assertProjectAccess(projectId);
      await assertProjectPermission(projectId, "tickets:manage");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const { user, role } = authContext;
    if (!user.isSuperAdmin && role !== "PROJECT_ADMIN") {
      return NextResponse.json(
        { error: "Only project administrators can delete tickets" },
        { status: 403 }
      );
    }

    const existing = await prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!existing || existing.projectId !== projectId) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    await prisma.ticket.delete({
      where: { id: ticketId },
    });

    syncEngine.publishProjectEvent({
      projectId,
      eventType: "TICKET_DELETED",
      entityId: ticketId,
      entityType: "ISSUE",
      data: { id: ticketId },
      actor: { id: user.id, email: user.email, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() },
    });

    return NextResponse.json({ success: true, deletedId: ticketId });
  } catch (error: any) {
    return handleApiError(error, "tickets/delete");
  }
}
