import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { ticketAssignSchema, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import { syncEngine } from "@/lib/sync-engine";
import { notificationEngine } from "@/lib/notifications";
import { enqueueEmail } from "@/lib/email-outbox";
import { logAuditEvent } from "@/lib/audit-logger";

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
    if (user.userType === "CLIENT") {
      return NextResponse.json(
        { error: "Clients cannot assign ticket managers" },
        { status: 403 }
      );
    }

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

    const parsed = await parseJsonBody(req, ticketAssignSchema);
    if (!parsed.success) return parsed.error;
    const { assignedManagerId, version } = parsed.data;

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

    // If an assignee is given, verify user belongs to the project
    if (assignedManagerId) {
      const isMember = await prisma.projectMember.findFirst({
        where: { projectId, userId: assignedManagerId },
      });
      const isOwner = await prisma.project.findFirst({
        where: { id: projectId, ownerId: assignedManagerId },
      });
      if (!isMember && !isOwner) {
        return NextResponse.json(
          { error: "Assigned manager must be a member of this project" },
          { status: 400 }
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      let targetStatus = existing.status;
      // If status is NEW and a manager is assigned, auto-advance to UNDER_REVIEW
      if (existing.status === "NEW" && assignedManagerId) {
        targetStatus = "UNDER_REVIEW";
      }

      const updated = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          assignedManagerId,
          status: targetStatus,
          firstResponseAt: existing.firstResponseAt ?? (assignedManagerId ? new Date() : null),
          version: { increment: 1 },
        },
        include: {
          createdBy: publicUserRelation,
          assignedManager: publicUserRelation,
        },
      });

      await tx.ticketStatusHistory.create({
        data: {
          ticketId,
          actorId: user.id,
          fromStatus: existing.status,
          toStatus: targetStatus,
          note: assignedManagerId
            ? `Assigned ticket manager to ${updated.assignedManager?.firstName || updated.assignedManager?.email}`
            : "Unassigned ticket manager",
        },
      });

      return updated;
    });

    // Notify newly assigned manager via notification engine & durable email outbox
    if (assignedManagerId && assignedManagerId !== user.id) {
      try {
        await notificationEngine.dispatch({
          type: "ASSIGNMENT",
          title: `Assigned as Manager for Ticket ${existing.ticketKey}`,
          message: `${user.firstName || user.email} assigned you to review ticket "${existing.title}"`,
          linkUrl: `/projects/${projectId}?view=tickets&ticketId=${ticketId}`,
          projectId,
          recipientUserIds: [assignedManagerId],
          actorId: user.id,
        });

        const managerEmail = result.assignedManager?.email;
        if (managerEmail) {
          await enqueueEmail({
            to: managerEmail,
            customSubject: `[${existing.ticketKey}] Assigned as Ticket Manager: ${existing.title}`,
            customHtml: `<p>Hello ${result.assignedManager?.firstName || managerEmail},</p><p>You have been assigned to triage and review ticket <strong>${existing.ticketKey}</strong>: <em>${existing.title}</em>.</p><p><a href="/projects/${projectId}?view=tickets&ticketId=${ticketId}">View Ticket</a></p>`,
            idempotencyKey: `ticket-assigned-${ticketId}-${result.version}`,
          });
        }
      } catch (notifErr) {
        console.error("[tickets/assign] Failed to send notification:", notifErr);
      }
    }

    // Enterprise audit log
    await logAuditEvent({
      actorId: user.id,
      actorName: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      actorEmail: user.email,
      action: "TICKET_ASSIGNED",
      category: "PROJECT",
      projectId,
      targetResource: existing.ticketKey,
      previousState: { assignedManagerId: existing.assignedManagerId, status: existing.status },
      newState: { assignedManagerId: result.assignedManagerId, status: result.status },
      details: {
        ticketId,
        assignedManagerId: result.assignedManagerId,
        previousManagerId: existing.assignedManagerId,
        status: result.status,
      },
    });

    syncEngine.publishProjectEvent({
      projectId,
      eventType: "TICKET_UPDATED",
      entityId: result.id,
      entityType: "ISSUE",
      data: result,
      actor: { id: user.id, email: user.email, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() },
    });

    return NextResponse.json({ ticket: result });
  } catch (error: any) {
    return handleApiError(error, "tickets/assign");
  }
}

export const POST = PATCH;
