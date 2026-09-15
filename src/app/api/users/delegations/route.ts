import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertOrgAccess, assertProjectAccess } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { syncEngine } from "@/lib/sync-engine";
import { notificationEngine } from "@/lib/notifications";
import { logger } from "@/lib/logger";
import { autoProcessExpiredDelegations } from "@/lib/delegation-engine";
import { formatLeaveRange } from "@/lib/leave-engine";
import { delegationCreateSchema, parseBody } from "@/lib/validation";

export async function GET(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Auto-process any expired delegations first
    await autoProcessExpiredDelegations();

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type"); // 'sent', 'received', 'all'
    const issueId = searchParams.get("issueId");
    const status = searchParams.get("status"); // 'ACTIVE', 'ENDED', 'CANCELLED', 'ALL'
    const orgId = searchParams.get("orgId");

    let targetOrgId = orgId;
    if (!targetOrgId) {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: currentUser.id },
      });
      if (membership) targetOrgId = membership.orgId;
    }

    if (targetOrgId) {
      await assertOrgAccess(targetOrgId);
    }

    const whereClause: any = {};

    if (issueId) {
      whereClause.issueId = issueId;
    } else if (type === "sent") {
      whereClause.originalAssigneeId = currentUser.id;
    } else if (type === "received") {
      whereClause.delegateUserId = currentUser.id;
    } else if (!currentUser.isSuperAdmin) {
      whereClause.OR = [
        { originalAssigneeId: currentUser.id },
        { delegateUserId: currentUser.id },
      ];
    }

    if (status && status !== "ALL") {
      whereClause.status = status;
    }

    const delegations = await prisma.taskDelegation.findMany({
      where: whereClause,
      include: {
        originalAssignee: {
          select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true },
        },
        delegateUser: {
          select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true },
        },
        issue: {
          select: { id: true, issueKey: true, title: true, statusId: true, projectId: true },
        },
        history: {
          include: {
            actor: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
          orderBy: { timestamp: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ delegations });
  } catch (error: any) {
    logger.error("GET /api/users/delegations error", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch delegations" },
      { status: error.message?.includes("Forbidden") ? 403 : 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = parseBody(delegationCreateSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { leaveId, delegateUserId, scope, issueIds, startDate, endDate, reason } = parsed.data;

    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }

    if (start > end) {
      return NextResponse.json({ error: "Start date cannot be after end date" }, { status: 400 });
    }

    // Verify delegate user exists
    const delegateUser = await prisma.user.findUnique({
      where: { id: delegateUserId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    if (!delegateUser) {
      return NextResponse.json({ error: "Delegate user not found" }, { status: 404 });
    }

    // Determine target issues to delegate
    let targetIssues: any[] = [];

    if (scope === "SELECTED_TASKS" && Array.isArray(issueIds) && issueIds.length > 0) {
      targetIssues = await prisma.issue.findMany({
        where: { id: { in: issueIds } },
        include: { project: { include: { workspace: true } } },
      });
    } else {
      // ALL_ELIGIBLE: Find active (non-DONE) tasks currently assigned to currentUser
      targetIssues = await prisma.issue.findMany({
        where: {
          assigneeId: currentUser.id,
          status: { category: { not: "DONE" } },
        },
        include: { project: { include: { workspace: true } } },
      });
    }

    if (targetIssues.length === 0) {
      return NextResponse.json(
        { error: "No eligible tasks found to delegate" },
        { status: 400 }
      );
    }

    // Validate Tenant Isolation & PBAC Permissions for every target issue:
    // Delegate user MUST belong to the target project's organization and have access to the project
    for (const issue of targetIssues) {
      const targetOrgId = issue.project.workspace.orgId;
      await assertOrgAccess(targetOrgId);

      // Verify delegate user is member of the project's organization
      const delegateOrgMember = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId: targetOrgId, userId: delegateUserId } },
      });

      if (!delegateOrgMember) {
        return NextResponse.json(
          {
            error: `Cross-tenant violation: Delegate ${delegateUser.firstName} does not belong to organization for issue ${issue.issueKey}`,
          },
          { status: 403 }
        );
      }
    }

    const createdDelegations: any[] = [];

    for (const issue of targetIssues) {
      // Check for existing active delegation for this issue
      const existing = await prisma.taskDelegation.findFirst({
        where: {
          issueId: issue.id,
          status: "ACTIVE",
          AND: [{ startDate: { lte: end } }, { endDate: { gte: start } }],
        },
      });

      if (existing) {
        // Skip duplicate active delegation or update if needed
        continue;
      }

      const delegation = await prisma.taskDelegation.create({
        data: {
          leaveId: leaveId || null,
          issueId: issue.id,
          originalAssigneeId: currentUser.id,
          delegateUserId: delegateUserId,
          startDate: start,
          endDate: end,
          status: "ACTIVE",
          reason: reason || "Temporary Leave Delegation",
          createdBy: currentUser.id,
          history: {
            create: {
              actorId: currentUser.id,
              action: "DELEGATED",
              details: `${currentUser.firstName} ${currentUser.lastName} delegated ${issue.issueKey} to ${delegateUser.firstName} ${delegateUser.lastName} for period ${formatLeaveRange(start, end)}.`,
            },
          },
        },
        include: {
          originalAssignee: { select: { id: true, firstName: true, lastName: true, email: true } },
          delegateUser: { select: { id: true, firstName: true, lastName: true, email: true } },
          issue: { select: { id: true, issueKey: true, title: true, projectId: true } },
          history: true,
        },
      });

      createdDelegations.push(delegation);

      // Add Activity Log to the issue
      await prisma.activityLog.create({
        data: {
          issueId: issue.id,
          actorId: currentUser.id,
          actionType: "TASK_DELEGATED",
          fieldChanged: "delegation",
          oldValue: `Assignee: ${currentUser.firstName} ${currentUser.lastName}`,
          newValue: `Delegated to: ${delegateUser.firstName} ${delegateUser.lastName} (${formatLeaveRange(start, end)})`,
        },
      });

      // Dispatch 3-way notification to Delegate User B
      await notificationEngine.dispatch({
        recipientUserIds: delegateUserId,
        actorId: currentUser.id,
        actorName: `${currentUser.firstName} ${currentUser.lastName}`,
        type: "ASSIGNMENT",
        title: `Task ${issue.issueKey} Delegated to You`,
        message: `${currentUser.firstName} ${currentUser.lastName} delegated task "${issue.title}" (${issue.issueKey}) to you for period ${formatLeaveRange(start, end)}.`,
        linkUrl: `/projects/${issue.projectId}?issue=${issue.id}`,
        projectId: issue.projectId,
        issueId: issue.id,
      });

      // Publish SSE Realtime Event
      syncEngine.publishProjectEvent({
        projectId: issue.projectId,
        eventType: "ISSUE_UPDATED",
        entityId: issue.id,
        data: { id: issue.id, issueId: issue.id, delegationCreated: true },
      });
    }

    logger.info("DELEGATION_CREATED", "Tasks delegated successfully", {
      count: createdDelegations.length,
      originalAssigneeId: currentUser.id,
      delegateUserId,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });

    return NextResponse.json({
      success: true,
      delegations: createdDelegations,
      count: createdDelegations.length,
      message: `Successfully delegated ${createdDelegations.length} task(s) to ${delegateUser.firstName} ${delegateUser.lastName}.`,
    });
  } catch (error: any) {
    logger.error("POST /api/users/delegations error", error);
    return NextResponse.json(
      { error: error.message || "Failed to delegate tasks" },
      { status: error.message?.includes("Forbidden") ? 403 : 500 }
    );
  }
}
