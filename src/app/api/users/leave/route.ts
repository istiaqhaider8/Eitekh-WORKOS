import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertOrgAccess } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { syncEngine } from "@/lib/sync-engine";
import { logger } from "@/lib/logger";
import { leaveCreateSchema, parseBody, parseJsonBody } from "@/lib/validation";

export async function GET(req: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    let orgId = searchParams.get("orgId");
    const userId = searchParams.get("userId");
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");

    // If orgId is omitted, find first org the user belongs to
    if (!orgId) {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: currentUser.id },
      });
      if (!membership) {
        return NextResponse.json({ leaves: [] });
      }
      orgId = membership.orgId;
    }

    await assertOrgAccess(orgId);

    const whereClause: any = {
      organizationId: orgId,
    };

    if (userId) {
      whereClause.userId = userId;
    }

    if (startDateParam || endDateParam) {
      whereClause.AND = [];
      if (startDateParam) {
        whereClause.AND.push({
          endDate: { gte: new Date(startDateParam) },
        });
      }
      if (endDateParam) {
        whereClause.AND.push({
          startDate: { lte: new Date(endDateParam) },
        });
      }
    }

    const leaves = await prisma.leave.findMany({
      where: whereClause,
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
      orderBy: { startDate: "asc" },
    });

    return NextResponse.json({ leaves });
  } catch (error: any) {
    logger.error("GET /api/users/leave error", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch leaves" },
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

    const parsed = await parseJsonBody(req, leaveCreateSchema);
    if (!parsed.success) return parsed.error;
    const { orgId, userId, startDate, endDate, leaveType, note } = parsed.data;

    let targetOrgId = orgId;
    if (!targetOrgId) {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: currentUser.id },
      });
      if (!membership) {
        return NextResponse.json(
          { error: "No organization found for current user" },
          { status: 400 }
        );
      }
      targetOrgId = membership.orgId;
    }

    const { role } = await assertOrgAccess(targetOrgId);

    const targetUserId = userId || currentUser.id;
    // Users can create leave for themselves. Non-self creation requires ADMIN or OWNER role.
    if (targetUserId !== currentUser.id && role !== "ADMIN" && role !== "OWNER" && role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Only organization admins can set leave for other members" },
        { status: 403 }
      );
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json(
        { error: "Invalid start or end date format" },
        { status: 400 }
      );
    }

    if (start > end) {
      return NextResponse.json(
        { error: "Start date cannot be after end date" },
        { status: 400 }
      );
    }

    // Check for existing overlapping leave for this user
    const existingOverlap = await prisma.leave.findFirst({
      where: {
        userId: targetUserId,
        organizationId: targetOrgId,
        AND: [
          { startDate: { lte: end } },
          { endDate: { gte: start } },
        ],
      },
    });

    if (existingOverlap) {
      return NextResponse.json(
        { error: "You already have a leave scheduled that overlaps with these dates." },
        { status: 400 }
      );
    }

    const leave = await prisma.leave.create({
      data: {
        userId: targetUserId,
        organizationId: targetOrgId,
        startDate: start,
        endDate: end,
        leaveType: leaveType || "Annual Leave",
        note: note || null,
      },
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

    // Realtime notification sync event - broadcast to user's projects
    const userProjects = await prisma.projectMember.findMany({
      where: { userId: targetUserId },
      select: { projectId: true },
    });
    for (const pm of userProjects) {
      syncEngine.publishProjectEvent({
        projectId: pm.projectId,
        eventType: "LEAVE_CREATED",
        entityId: leave.id,
        data: { leaveId: leave.id, userId: targetUserId, leave },
      });
    }


    logger.info("LEAVE_CREATED", "Leave application created successfully", {
      leaveId: leave.id,
      userId: targetUserId,
      orgId: targetOrgId,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });

    return NextResponse.json({ leave }, { status: 201 });
  } catch (error: any) {
    logger.error("POST /api/users/leave error", error);
    return NextResponse.json(
      { error: error.message || "Failed to create leave" },
      { status: error.message?.includes("Forbidden") ? 403 : 500 }
    );
  }
}
