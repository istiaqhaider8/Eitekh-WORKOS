import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { ticketStatusTransitionSchema, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import { syncEngine } from "@/lib/sync-engine";
import { notificationEngine } from "@/lib/notifications";
import { enqueueEmail } from "@/lib/email-outbox";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  convertTicketToIssue,
  rejectionRefusal,
  statusAfter,
  transitionRefusal,
} from "@/lib/ticket-engine";

// The lifecycle, the visibility rules and the conversion all live in
// `src/lib/ticket-engine.ts`, where they can be tested without a server.
// This route does auth, parsing, status codes and the broadcast.

export async function PATCH(
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
    const existing = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        createdBy: publicUserRelation,
        assignedManager: publicUserRelation,
      },
    });

    if (!existing || existing.projectId !== projectId) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Clients cannot change status except when answering a PENDING_INFO ticket
    if (user.userType === "CLIENT") {
      return NextResponse.json(
        { error: "Clients cannot manually transition ticket approval status" },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(req, ticketStatusTransitionSchema);
    if (!parsed.success) return parsed.error;
    const { status: targetStatus, note, rejectionReason, version } = parsed.data;

    /**
     * The permission depends on WHICH transition is being asked for.
     *
     * Approving is not the same act as asking the requester for more detail:
     * approval converts the ticket into a task on the delivery board under the
     * project's own issue key, which commits the team to building it. So the
     * three outcomes carry three keys, and a role can hold triage without
     * holding the power to spend the team's time.
     *
     * Checked here rather than beside `assertProjectAccess` because it cannot
     * be known before the body is parsed. Everything above this line is a
     * read; nothing has been written yet.
     */
    const PERMISSION_FOR_TRANSITION: Record<string, string> = {
      APPROVED: "tickets:approve",
      CONVERTED: "tickets:approve",
      REJECTED: "tickets:reject",
    };
    await assertProjectPermission(
      projectId,
      PERMISSION_FOR_TRANSITION[targetStatus] ?? "tickets:manage"
    );

    // Optimistic locking check
    if (version !== undefined && version !== existing.version) {
      return NextResponse.json(
        {
          error: "Conflict: This ticket has been modified by another user. Please refresh and try again.",
          currentVersion: existing.version,
        },
        { status: 409 }
      );
    }

    const refusal = transitionRefusal(existing.status, targetStatus);
    if (refusal) return NextResponse.json({ error: refusal }, { status: 400 });

    const missingReason = rejectionRefusal(targetStatus, rejectionReason);
    if (missingReason) return NextResponse.json({ error: missingReason }, { status: 400 });

    let createdIssue: any = null;

    const result = await prisma.$transaction(async (tx) => {
      let finalStatus = targetStatus;
      let convertedIssueId: string | null = null;
      let convertedAt: Date | null = null;

      /**
       * Approving converts, in the same transaction.
       *
       * A ticket is therefore never durably APPROVED — `statusAfter` maps
       * the verb a caller sends to the state that is stored. Doing it here means
       * the issue, its activity log and the ticket status land together or
       * not at all; a ticket marked CONVERTED beside an issue that was never
       * created is a lie the dashboard would repeat for ever.
       */
      if (targetStatus === "APPROVED") {
        createdIssue = await convertTicketToIssue(tx, {
          projectId,
          ticket: existing,
          actorId: user.id,
          note,
        });
        finalStatus = statusAfter(targetStatus);
        convertedIssueId = createdIssue.id;
        convertedAt = new Date();
      }

      // Update the ticket
      const updatedTicket = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: finalStatus,
          resolutionNote: note ?? existing.resolutionNote,
          rejectionReason: rejectionReason ?? existing.rejectionReason,
          convertedIssueId: convertedIssueId ?? existing.convertedIssueId,
          // Denormalised alongside the foreign key. That key is SetNull, so
          // deleting the issue later empties it and the ticket would claim to
          // have produced work nobody can name. The text survives.
          convertedIssueKey: createdIssue?.issueKey ?? existing.convertedIssueKey,
          convertedAt: convertedAt ?? existing.convertedAt,
          closedAt: finalStatus === "CLOSED" || finalStatus === "REJECTED" ? new Date() : existing.closedAt,
          firstResponseAt: existing.firstResponseAt ?? new Date(),
          version: { increment: 1 },
        },
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
            },
          },
        },
      });

      // Record in TicketStatusHistory
      await tx.ticketStatusHistory.create({
        data: {
          ticketId,
          actorId: user.id,
          fromStatus: existing.status,
          toStatus: finalStatus,
          note: note || rejectionReason || `Status changed from ${existing.status} to ${finalStatus}`,
        },
      });

      return { ticket: updatedTicket, issue: createdIssue };
    });

    // Notify ticket creator via in-app notification & durable email outbox
    try {
      if (existing.createdById !== user.id) {
        let notifTitle = `Ticket ${existing.ticketKey} Updated`;
        let notifMessage = `Your ticket status is now ${result.ticket.status}`;

        if (result.ticket.status === "CONVERTED" && result.issue) {
          notifTitle = `Ticket ${existing.ticketKey} Approved`;
          notifMessage = `Your ticket was approved and converted into task ${result.issue.issueKey}`;
        } else if (result.ticket.status === "REJECTED") {
          notifTitle = `Ticket ${existing.ticketKey} Rejected`;
          notifMessage = `Your ticket was rejected: ${rejectionReason || "No reason specified"}`;
        }

        await notificationEngine.dispatch({
          type: "STATUS",
          title: notifTitle,
          message: notifMessage,
          linkUrl: result.issue
            ? `/projects/${projectId}?view=board&issueId=${result.issue.id}`
            : `/projects/${projectId}?view=tickets&ticketId=${ticketId}`,
          projectId,
          recipientUserIds: [existing.createdById],
          actorId: user.id,
        });

        // Durable email dispatch for client-facing transitions
        const creatorEmail = result.ticket.createdBy?.email;
        if (creatorEmail) {
          if (result.ticket.status === "CONVERTED") {
            await enqueueEmail({
              to: creatorEmail,
              customSubject: `[${existing.ticketKey}] Ticket Approved: Converted to ${result.ticket.convertedIssueKey || "Task"}`,
              customHtml: `<p>Hello ${result.ticket.createdBy.firstName || creatorEmail},</p><p>Your ticket <strong>${existing.ticketKey}</strong>: <em>${existing.title}</em> has been approved and converted to project task <strong>${result.ticket.convertedIssueKey || ""}</strong>.</p>${note ? `<p><strong>Resolution Note:</strong> ${note}</p>` : ""}`,
              idempotencyKey: `ticket-approved-${ticketId}-${result.ticket.version}`,
            });
          } else if (result.ticket.status === "REJECTED") {
            await enqueueEmail({
              to: creatorEmail,
              customSubject: `[${existing.ticketKey}] Ticket Rejected`,
              customHtml: `<p>Hello ${result.ticket.createdBy.firstName || creatorEmail},</p><p>Your ticket <strong>${existing.ticketKey}</strong>: <em>${existing.title}</em> has been rejected.</p><p><strong>Reason:</strong> ${rejectionReason || "No reason specified"}</p>`,
              idempotencyKey: `ticket-rejected-${ticketId}-${result.ticket.version}`,
            });
          } else if (result.ticket.status === "PENDING_INFO") {
            await enqueueEmail({
              to: creatorEmail,
              customSubject: `[${existing.ticketKey}] More Information Requested`,
              customHtml: `<p>Hello ${result.ticket.createdBy.firstName || creatorEmail},</p><p>Additional information is requested for your ticket <strong>${existing.ticketKey}</strong>: <em>${existing.title}</em>.</p>${note ? `<p><strong>Details:</strong> ${note}</p>` : ""}`,
              idempotencyKey: `ticket-pending-info-${ticketId}-${result.ticket.version}`,
            });
          } else if (result.ticket.status === "UNDER_REVIEW") {
            await enqueueEmail({
              to: creatorEmail,
              customSubject: `[${existing.ticketKey}] Ticket Under Review`,
              customHtml: `<p>Hello ${result.ticket.createdBy.firstName || creatorEmail},</p><p>Your ticket <strong>${existing.ticketKey}</strong>: <em>${existing.title}</em> is now under review by our team.</p>`,
              idempotencyKey: `ticket-under-review-${ticketId}-${result.ticket.version}`,
            });
          }
        }
      }
    } catch (notifErr) {
      console.error("[tickets/status] Failed to send notification:", notifErr);
    }

    // Log enterprise audit event
    await logAuditEvent({
      actorId: user.id,
      actorName: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      actorEmail: user.email,
      action: targetStatus === "APPROVED" ? "TICKET_APPROVED" : targetStatus === "REJECTED" ? "TICKET_REJECTED" : "TICKET_STATUS_CHANGED",
      category: "PROJECT",
      projectId,
      targetResource: existing.ticketKey,
      previousState: { status: existing.status },
      newState: { status: result.ticket.status, convertedIssueKey: result.ticket.convertedIssueKey },
      details: {
        ticketId,
        fromStatus: existing.status,
        toStatus: result.ticket.status,
        convertedIssueKey: result.ticket.convertedIssueKey,
        note: note || undefined,
        rejectionReason: rejectionReason || undefined,
      },
    });

    // Real-time SSE Broadcasts
    syncEngine.publishProjectEvent({
      projectId,
      eventType: "TICKET_UPDATED",
      entityId: result.ticket.id,
      entityType: "ISSUE",
      data: result.ticket,
      actor: { id: user.id, email: user.email, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() },
    });

    // If an issue was created, also broadcast ISSUE_CREATED to update Kanban board immediately!
    if (result.issue) {
      syncEngine.publishProjectEvent({
        projectId,
        eventType: "ISSUE_CREATED",
        entityId: result.issue.id,
        entityType: "ISSUE",
        data: result.issue,
        actor: { id: user.id, email: user.email, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() },
      });
    }

    return NextResponse.json({
      ticket: result.ticket,
      convertedIssue: result.issue,
    });
  } catch (error: any) {
    return handleApiError(error, "tickets/status");
  }
}

export const POST = PATCH;
