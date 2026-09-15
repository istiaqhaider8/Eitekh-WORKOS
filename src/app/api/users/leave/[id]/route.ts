import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertOrgAccess } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { syncEngine } from "@/lib/sync-engine";
import { notificationEngine } from "@/lib/notifications";
import { logger } from "@/lib/logger";
import { leaveUpdateSchema, parseBody } from "@/lib/validation";

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
    const leave = await prisma.leave.findUnique({
      where: { id },
      include: { organization: true },
    });

    if (!leave) {
      return NextResponse.json({ error: "Leave record not found" }, { status: 404 });
    }

    const { role } = await assertOrgAccess(leave.organizationId);

    const isOwnerOrAdmin = role === "OWNER" || role === "ADMIN" || currentUser.isSuperAdmin;
    if (leave.userId !== currentUser.id && !isOwnerOrAdmin) {
      return NextResponse.json(
        { error: "Forbidden: You cannot modify leave for another user" },
        { status: 403 }
      );
    }

    const parsed = parseBody(leaveUpdateSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { startDate, endDate, leaveType, note } = parsed.data;

    const updateData: any = {};
    if (leaveType) updateData.leaveType = leaveType;
    if (note !== undefined) updateData.note = note;

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      if (start > end) {
        return NextResponse.json(
          { error: "Start date cannot be after end date" },
          { status: 400 }
        );
      }

      // Check for overlap excluding current record
      const overlap = await prisma.leave.findFirst({
        where: {
          id: { not: id },
          userId: leave.userId,
          organizationId: leave.organizationId,
          AND: [
            { startDate: { lte: end } },
            { endDate: { gte: start } },
          ],
        },
      });

      if (overlap) {
        return NextResponse.json(
          { error: "Updated dates overlap with another existing leave record." },
          { status: 400 }
        );
      }

      updateData.startDate = start;
      updateData.endDate = end;
    }

    const updatedLeave = await prisma.leave.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    const userProjects = await prisma.projectMember.findMany({
      where: { userId: leave.userId },
      select: { projectId: true },
    });
    for (const pm of userProjects) {
      syncEngine.publishProjectEvent({
        projectId: pm.projectId,
        eventType: "LEAVE_UPDATED",
        entityId: id,
        data: { leaveId: id, userId: leave.userId, leave: updatedLeave },
      });
    }

    return NextResponse.json({ leave: updatedLeave });
  } catch (error: any) {
    logger.error("PATCH /api/users/leave/[id] error", error);
    return NextResponse.json(
      { error: error.message || "Failed to update leave" },
      { status: error.message?.includes("Forbidden") ? 403 : 500 }
    );
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
    const leave = await prisma.leave.findUnique({
      where: { id },
    });

    if (!leave) {
      return NextResponse.json({ error: "Leave record not found" }, { status: 404 });
    }

    const { role } = await assertOrgAccess(leave.organizationId);
    const isOwnerOrAdmin = role === "OWNER" || role === "ADMIN" || currentUser.isSuperAdmin;

    if (leave.userId !== currentUser.id && !isOwnerOrAdmin) {
      return NextResponse.json(
        { error: "Forbidden: You can only cancel your own leave records" },
        { status: 403 }
      );
    }

    const now = new Date();

    // 1. Find all active delegations linked to this leave or overlapping with leave dates
    const activeDelegations = await prisma.taskDelegation.findMany({
      where: {
        OR: [
          { leaveId: id },
          {
            originalAssigneeId: leave.userId,
            status: "ACTIVE",
            AND: [
              { startDate: { lte: leave.endDate } },
              { endDate: { gte: leave.startDate } },
            ],
          },
        ],
      },
      include: {
        issue: { select: { id: true, issueKey: true, title: true, projectId: true } },
        originalAssignee: { select: { id: true, firstName: true, lastName: true } },
        delegateUser: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // 2. Automatically transition linked delegations to CANCELLED and preserve full history ledger
    for (const del of activeDelegations) {
      if (del.status === "ACTIVE") {
        await prisma.taskDelegation.update({
          where: { id: del.id },
          data: {
            status: "CANCELLED",
            endedAt: now,
            history: {
              create: {
                actorId: currentUser.id,
                action: "CANCELLED",
                details: `Delegation automatically cancelled because leave record was cancelled by ${currentUser.firstName} ${currentUser.lastName}. Task returned to ${del.originalAssignee.firstName} ${del.originalAssignee.lastName}.`,
              },
            },
          },
        });

        await prisma.activityLog.create({
          data: {
            issueId: del.issueId,
            actorId: currentUser.id,
            actionType: "DELEGATION_CANCELLED",
            fieldChanged: "delegation",
            oldValue: `Delegated to: ${del.delegateUser.firstName} ${del.delegateUser.lastName}`,
            newValue: `Returned to: ${del.originalAssignee.firstName} ${del.originalAssignee.lastName} (Leave Cancelled)`,
          },
        });

        notificationEngine.dispatch({
          recipientUserIds: [del.originalAssigneeId, del.delegateUserId],
          actorId: currentUser.id,
          type: "INFO",
          title: `Delegation Cancelled for ${del.issue.issueKey}`,
          message: `Delegation of task "${del.issue.title}" (${del.issue.issueKey}) was automatically cancelled because the leave request was cancelled. Responsibility returned to ${del.originalAssignee.firstName} ${del.originalAssignee.lastName}.`,
          linkUrl: `/projects/${del.issue.projectId}?issue=${del.issueId}`,
          projectId: del.issue.projectId,
          issueId: del.issueId,
        }).catch(() => {});
      }
    }

    // 3. Update Leave record status = 'CANCELLED' so it is retained in Leave History
    await prisma.leave.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    const userProjects = await prisma.projectMember.findMany({
      where: { userId: leave.userId },
      select: { projectId: true },
    });
    for (const pm of userProjects) {
      syncEngine.publishProjectEvent({
        projectId: pm.projectId,
        eventType: "LEAVE_UPDATED",
        entityId: id,
        data: { leaveId: id, userId: leave.userId, status: "CANCELLED" },
      });
    }

    logger.info("LEAVE_CANCELLED", "Leave record & associated delegations cancelled with complete audit history", {
      leaveId: id,
      userId: leave.userId,
      cancelledDelegationsCount: activeDelegations.length,
    });

    return NextResponse.json({
      success: true,
      message: `Leave record and ${activeDelegations.length} linked task delegation(s) automatically cancelled and archived in history.`,
    });
  } catch (error: any) {
    logger.error("DELETE /api/users/leave/[id] error", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete leave" },
      { status: error.message?.includes("Forbidden") ? 403 : 500 }
    );
  }
}
