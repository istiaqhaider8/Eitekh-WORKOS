import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertOrgAccess } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { syncEngine } from "@/lib/sync-engine";
import { notificationEngine } from "@/lib/notifications";
import { logger } from "@/lib/logger";
import { delegationUpdateSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const delegation = await prisma.taskDelegation.findUnique({
      where: { id },
      include: {
        issue: {
          select: {
            id: true,
            issueKey: true,
            title: true,
            projectId: true,
            project: {
              select: {
                workspace: {
                  select: { orgId: true },
                },
              },
            },
          },
        },
        originalAssignee: { select: { id: true, firstName: true, lastName: true, email: true } },
        delegateUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!delegation) {
      return NextResponse.json({ error: "Delegation record not found" }, { status: 404 });
    }

    // Verify tenant access
    await assertOrgAccess(delegation.issue.project.workspace.orgId);

    const parsed = await parseJsonBody(req, delegationUpdateSchema);
    if (!parsed.success) return parsed.error;
    const { status, action, details } = parsed.data;

    const updated = await prisma.taskDelegation.update({
      where: { id },
      data: {
        status: status || delegation.status,
        endedAt: status === "ENDED" || status === "CANCELLED" ? new Date() : delegation.endedAt,
        history: {
          create: {
            actorId: currentUser.id,
            action: action || status || "UPDATED",
            details: details || `Delegation updated by ${currentUser.firstName} ${currentUser.lastName}.`,
          },
        },
      },
      include: {
        history: {
          include: { actor: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { timestamp: "desc" },
        },
      },
    });

    return NextResponse.json({ delegation: updated });
  } catch (error: any) {
    logger.error("PATCH /api/users/delegations/[id] error", error);
    return handleApiError(error, "users/delegations/[id]");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const delegation = await prisma.taskDelegation.findUnique({
      where: { id },
      include: {
        issue: {
          select: {
            id: true,
            issueKey: true,
            title: true,
            projectId: true,
            project: {
              select: {
                workspace: {
                  select: { orgId: true },
                },
              },
            },
          },
        },
        originalAssignee: { select: { id: true, firstName: true, lastName: true, email: true } },
        delegateUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!delegation) {
      return NextResponse.json({ error: "Delegation record not found" }, { status: 404 });
    }

    await assertOrgAccess(delegation.issue.project.workspace.orgId);

    const now = new Date();

    // Mark status = 'CANCELLED' or 'ENDED' rather than deleting history
    const endedDelegation = await prisma.taskDelegation.update({
      where: { id },
      data: {
        status: "CANCELLED",
        endedAt: now,
        history: {
          create: {
            actorId: currentUser.id,
            action: "CANCELLED",
            details: `Delegation cancelled by ${currentUser.firstName} ${currentUser.lastName}. Task returned to ${delegation.originalAssignee.firstName} ${delegation.originalAssignee.lastName}.`,
          },
        },
      },
    });

    // Log ActivityLog
    await prisma.activityLog.create({
      data: {
        issueId: delegation.issueId,
        actorId: currentUser.id,
        actionType: "DELEGATION_CANCELLED",
        fieldChanged: "delegation",
        oldValue: `Delegated to: ${delegation.delegateUser.firstName} ${delegation.delegateUser.lastName}`,
        newValue: `Returned to: ${delegation.originalAssignee.firstName} ${delegation.originalAssignee.lastName}`,
      },
    });

    // Notify Original Assignee and Delegate
    await notificationEngine.dispatch({
      recipientUserIds: [delegation.originalAssigneeId, delegation.delegateUserId],
      actorId: currentUser.id,
      type: "INFO",
      title: `Delegation Ended for ${delegation.issue.issueKey}`,
      message: `Delegation of task "${delegation.issue.title}" (${delegation.issue.issueKey}) has ended and responsibility has returned to ${delegation.originalAssignee.firstName} ${delegation.originalAssignee.lastName}.`,
      linkUrl: `/projects/${delegation.issue.projectId}?issue=${delegation.issueId}`,
      projectId: delegation.issue.projectId,
      issueId: delegation.issueId,
    });

    // SSE Realtime Event
    syncEngine.publishProjectEvent({
      projectId: delegation.issue.projectId,
      eventType: "ISSUE_UPDATED",
      entityId: delegation.issueId,
      data: { id: delegation.issueId, issueId: delegation.issueId, delegationEnded: true },
    });

    return NextResponse.json({ success: true, message: "Delegation ended and task returned to original assignee." });
  } catch (error: any) {
    logger.error("DELETE /api/users/delegations/[id] error", error);
    return handleApiError(error, "users/delegations/[id]");
  }
}
