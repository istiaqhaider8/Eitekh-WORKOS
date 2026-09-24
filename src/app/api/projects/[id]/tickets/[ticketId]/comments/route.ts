import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { ticketCommentCreateSchema, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import { syncEngine } from "@/lib/sync-engine";
import { notificationEngine } from "@/lib/notifications";
import { enqueueEmail } from "@/lib/email-outbox";
import { logAuditEvent } from "@/lib/audit-logger";

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
      select: { id: true, projectId: true, createdById: true },
    });

    if (!ticket || ticket.projectId !== projectId) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    if (user.userType === "CLIENT" && ticket.createdById !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const where: any = { ticketId };
    if (user.userType === "CLIENT") {
      where.isInternal = false;
    }

    const comments = await prisma.ticketComment.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: {
        author: publicUserRelation,
      },
    });

    return NextResponse.json({ comments });
  } catch (error: any) {
    return handleApiError(error, "tickets/comments/list");
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; ticketId: string }> }
) {
  try {
    const { id: projectId, ticketId } = await params;
    let authContext: any;
    try {
      authContext = await assertProjectAccess(projectId);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const { user } = authContext;
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        createdBy: publicUserRelation,
        assignedManager: publicUserRelation,
      },
    });

    if (!ticket || ticket.projectId !== projectId) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    if (user.userType === "CLIENT" && ticket.createdById !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const parsed = await parseJsonBody(req, ticketCommentCreateSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    // Security guard: Clients can NEVER write internal comments
    if (user.userType === "CLIENT" && body.isInternal) {
      return NextResponse.json(
        { error: "Clients cannot create internal notes" },
        { status: 403 }
      );
    }
    const isInternal = Boolean(body.isInternal);

    /**
     * Two permissions, because they are two different acts.
     *
     * A public comment is a reply the requester will read. An internal note is
     * staff deliberation — "this is outside the contract", "we quoted this
     * wrong" — and a read-only stakeholder should not be able to write into
     * that conversation, or read it back on the GET above.
     *
     * The `userType` guard on the line above is a separate axis and stays:
     * it stops a CLIENT regardless of any role they might be granted. This
     * one stops an employee who has not been given the note-taking key.
     */
    await assertProjectPermission(projectId, "tickets:comment");
    if (isInternal) {
      await assertProjectPermission(projectId, "tickets:internal_notes");
    }

    const result = await prisma.$transaction(async (tx) => {
      const comment = await tx.ticketComment.create({
        data: {
          ticketId,
          authorId: user.id,
          content: body.content,
          isInternal,
        },
        include: {
          author: publicUserRelation,
        },
      });

      // If client responds to a PENDING_INFO ticket, auto-resume to UNDER_REVIEW
      if (ticket.status === "PENDING_INFO" && user.id === ticket.createdById) {
        await tx.ticket.update({
          where: { id: ticketId },
          data: {
            status: "UNDER_REVIEW",
            version: { increment: 1 },
          },
        });

        await tx.ticketStatusHistory.create({
          data: {
            ticketId,
            actorId: user.id,
            fromStatus: "PENDING_INFO",
            toStatus: "UNDER_REVIEW",
            note: "Client provided requested information via comment",
          },
        });
      } else if (user.id !== ticket.createdById && !isInternal && !ticket.firstResponseAt) {
        // First staff response timestamp recording for SLA
        await tx.ticket.update({
          where: { id: ticketId },
          data: {
            firstResponseAt: new Date(),
          },
        });
      }

      return comment;
    });

    // Notify appropriate counter-party (only if not an internal note viewed by client)
    try {
      let recipientId: string | null = null;
      let recipientEmail: string | null = null;
      let recipientName: string | null = null;

      if (user.id === ticket.createdById && ticket.assignedManagerId) {
        recipientId = ticket.assignedManagerId;
        recipientEmail = ticket.assignedManager?.email ?? null;
        recipientName = ticket.assignedManager?.firstName ?? recipientEmail;
      } else if (user.id !== ticket.createdById && !isInternal) {
        recipientId = ticket.createdById;
        recipientEmail = ticket.createdBy?.email ?? null;
        recipientName = ticket.createdBy?.firstName ?? recipientEmail;
      }

      if (recipientId) {
        await notificationEngine.dispatch({
          type: "COMMENT",
          title: `New Comment on Ticket ${ticket.ticketKey}`,
          message: `${user.firstName || user.email} commented: "${body.content.slice(0, 80)}..."`,
          linkUrl: `/projects/${projectId}?view=tickets&ticketId=${ticketId}`,
          projectId,
          recipientUserIds: [recipientId],
          actorId: user.id,
        });

        if (recipientEmail) {
          await enqueueEmail({
            to: recipientEmail,
            customSubject: `[${ticket.ticketKey}] New Reply: ${ticket.title}`,
            customHtml: `<p>Hello ${recipientName || ""},</p><p><strong>${user.firstName || user.email}</strong> replied to ticket <strong>${ticket.ticketKey}</strong> (<em>${ticket.title}</em>):</p><blockquote>${body.content}</blockquote><p><a href="/projects/${projectId}?view=tickets&ticketId=${ticketId}">View Ticket</a></p>`,
            idempotencyKey: `ticket-comment-${result.id}`,
          });
        }
      }
    } catch (notifErr) {
      console.error("[tickets/comments/create] Failed to send notification:", notifErr);
    }

    // Enterprise audit log
    await logAuditEvent({
      actorId: user.id,
      actorName: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      actorEmail: user.email,
      action: isInternal ? "TICKET_NOTE_ADDED" : "TICKET_COMMENT_ADDED",
      category: "PROJECT",
      projectId,
      targetResource: ticket.ticketKey,
      details: {
        ticketId,
        commentId: result.id,
        isInternal,
      },
    });

    syncEngine.publishProjectEvent({
      projectId,
      eventType: "TICKET_UPDATED",
      entityId: ticketId,
      entityType: "ISSUE",
      data: { comment: result, ticketId },
      actor: { id: user.id, email: user.email, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() },
    });

    return NextResponse.json({ comment: result }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "tickets/comments/create");
  }
}
