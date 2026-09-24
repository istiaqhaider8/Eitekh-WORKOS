import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    let authContext: any;
    try {
      authContext = await assertProjectAccess(projectId);
      await assertProjectPermission(projectId, "tickets:dashboard");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const { user } = authContext;
    const where: any = { projectId };
    // Clients only see dashboard aggregated over their own tickets
    if (user.userType === "CLIENT") {
      where.createdById = user.id;
    }

    const [
      totalTickets,
      newTickets,
      underReviewTickets,
      pendingInfoTickets,
      approvedTickets,
      rejectedTickets,
      convertedTickets,
      closedTickets,
      allTickets,
      convertedIssues,
    ] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.count({ where: { ...where, status: "NEW" } }),
      prisma.ticket.count({ where: { ...where, status: "UNDER_REVIEW" } }),
      prisma.ticket.count({ where: { ...where, status: "PENDING_INFO" } }),
      prisma.ticket.count({ where: { ...where, status: "APPROVED" } }),
      prisma.ticket.count({ where: { ...where, status: "REJECTED" } }),
      prisma.ticket.count({ where: { ...where, status: "CONVERTED" } }),
      prisma.ticket.count({ where: { ...where, status: "CLOSED" } }),
      prisma.ticket.findMany({
        where,
        select: {
          id: true,
          category: true,
          priority: true,
          status: true,
          assignedManagerId: true,
          assignedManager: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          createdAt: true,
          closedAt: true,
          convertedAt: true,
        },
      }),
      prisma.ticket.findMany({
        where: {
          ...where,
          convertedIssueId: { not: null },
        },
        select: {
          convertedIssue: {
            select: {
              id: true,
              status: {
                select: {
                  category: true,
                },
              },
            },
          },
        },
      }),
    ]);

    // Active vs Completed tasks derived from tickets
    let activeConvertedTasks = 0;
    let completedConvertedTasks = 0;
    for (const t of convertedIssues) {
      if (t.convertedIssue) {
        if (t.convertedIssue.status?.category === "DONE") {
          completedConvertedTasks++;
        } else {
          activeConvertedTasks++;
        }
      }
    }

    // Category distribution
    const categoryMap: Record<string, number> = {};
    const priorityMap: Record<string, number> = {};
    for (const t of allTickets) {
      categoryMap[t.category] = (categoryMap[t.category] || 0) + 1;
      priorityMap[t.priority] = (priorityMap[t.priority] || 0) + 1;
    }

    // Manager workload & performance aggregation
    const managerMap: Record<
      string,
      {
        managerId: string;
        name: string;
        email: string;
        activeTickets: number;
        resolvedTickets: number;
        totalResolutionHours: number;
        resolvedCountForAvg: number;
      }
    > = {};

    for (const t of allTickets) {
      if (t.assignedManagerId && t.assignedManager) {
        const mId = t.assignedManagerId;
        if (!managerMap[mId]) {
          managerMap[mId] = {
            managerId: mId,
            name: `${t.assignedManager.firstName || ""} ${t.assignedManager.lastName || ""}`.trim() || t.assignedManager.email,
            email: t.assignedManager.email,
            activeTickets: 0,
            resolvedTickets: 0,
            totalResolutionHours: 0,
            resolvedCountForAvg: 0,
          };
        }

        const isResolved =
          t.status === "APPROVED" ||
          t.status === "CONVERTED" ||
          t.status === "REJECTED" ||
          t.status === "CLOSED";

        if (isResolved) {
          managerMap[mId].resolvedTickets++;
          const endDate = t.closedAt || t.convertedAt;
          if (endDate) {
            const diffHours = (new Date(endDate).getTime() - new Date(t.createdAt).getTime()) / (1000 * 60 * 60);
            if (diffHours >= 0) {
              managerMap[mId].totalResolutionHours += diffHours;
              managerMap[mId].resolvedCountForAvg++;
            }
          }
        } else {
          managerMap[mId].activeTickets++;
        }
      }
    }

    const managerStats = Object.values(managerMap).map((m) => ({
      managerId: m.managerId,
      name: m.name,
      email: m.email,
      activeTickets: m.activeTickets,
      resolvedTickets: m.resolvedTickets,
      avgResolutionHours:
        m.resolvedCountForAvg > 0
          ? Math.round((m.totalResolutionHours / m.resolvedCountForAvg) * 10) / 10
          : 0,
    }));

    return NextResponse.json({
      stats: {
        totalTickets,
        newTickets,
        underReviewTickets,
        pendingInfoTickets,
        approvedTickets: approvedTickets + convertedTickets,
        rejectedTickets,
        closedTickets,
        activeConvertedTasks,
        completedConvertedTasks,
        categoryDistribution: Object.entries(categoryMap).map(([category, count]) => ({ category, count })),
        priorityDistribution: Object.entries(priorityMap).map(([priority, count]) => ({ priority, count })),
        managerStats,
      },
    });
  } catch (error: any) {
    return handleApiError(error, "tickets/dashboard");
  }
}
