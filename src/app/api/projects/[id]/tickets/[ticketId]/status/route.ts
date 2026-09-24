import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { assertProjectAccess } from "@/lib/tenant";
import { ticketStatusTransitionSchema, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import { syncEngine } from "@/lib/sync-engine";
import { notificationEngine } from "@/lib/notifications";
import { allocateIssueKey, defaultStatusIdFor } from "@/lib/issue-keys";

// Allowed status state machine transitions
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  NEW: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "PENDING_INFO"],
  PENDING_INFO: ["UNDER_REVIEW", "REJECTED"],
  APPROVED: ["CONVERTED"],
  REJECTED: ["CLOSED"],
  CONVERTED: [], // Terminal state
  CLOSED: [],    // Terminal state
};

// Map ticket category to standard project issue type
function mapCategoryToIssueType(category: string): string {
  switch (category) {
    case "BUG_REPORT":
      return "BUG";
    case "FEATURE_REQUEST":
      return "FEATURE";
    default:
      return "TASK";
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

    // State machine validation
    const allowed = ALLOWED_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(targetStatus)) {
      return NextResponse.json(
        {
          error: `Invalid transition: Cannot move ticket from ${existing.status} to ${targetStatus}. Allowed: ${allowed.join(", ") || "None (terminal state)"}`,
        },
        { status: 400 }
      );
    }

    // If rejecting, rejectionReason is required
    if (targetStatus === "REJECTED" && (!rejectionReason || !rejectionReason.trim())) {
      return NextResponse.json(
        { error: "A rejection reason is required when rejecting a ticket" },
        { status: 400 }
      );
    }

    let createdIssue: any = null;

    const result = await prisma.$transaction(async (tx) => {
      let finalStatus = targetStatus;
      let convertedIssueId: string | null = null;
      let convertedAt: Date | null = null;

      // Auto-conversion if APPROVED
      if (targetStatus === "APPROVED") {
        // 1. Allocate next issue key
        const allocated = await allocateIssueKey(tx, projectId);
        const initialStatusId = defaultStatusIdFor(allocated.project);

        // 2. Build description with ticket origin metadata
        const originHeader = `> 🎫 **Converted from Ticket [${existing.ticketKey}]:** ${existing.title}\n> **Category:** ${existing.category} | **Priority:** ${existing.priority}\n> **Client:** ${existing.createdBy.firstName || ""} ${existing.createdBy.lastName || ""} (${existing.createdBy.email})\n${note ? `> **Approval Note:** ${note}\n` : ""}\n---\n\n`;
        const fullDescription = `${originHeader}${existing.description || ""}`;

        // 3. Create the native Issue
        createdIssue = await tx.issue.create({
          data: {
            projectId,
            keyNumber: allocated.keyNumber,
            issueKey: allocated.issueKey,
            title: existing.title,
            description: fullDescription,
            issueType: mapCategoryToIssueType(existing.category),
            priority: existing.priority,
            statusId: initialStatusId,
            reporterId: existing.createdById,
            assigneeId: existing.assignedManagerId || user.id,
            dueDate: existing.dueDate,
          },
          include: {
            status: true,
            assignee: publicUserRelation,
            reporter: publicUserRelation,
          },
        });

        // 4. Initial activity log for created issue
        await tx.activityLog.create({
          data: {
            issueId: createdIssue.id,
            actorId: user.id,
            actionType: "CREATED",
            newValue: `Created from approved Ticket ${existing.ticketKey}`,
          },
        });

        finalStatus = "CONVERTED";
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

    // Notify ticket creator
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
      }
    } catch (notifErr) {
      console.error("[tickets/status] Failed to send notification:", notifErr);
    }

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
