import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const { project } = await assertProjectAccess(projectId);

    const { searchParams } = new URL(req.url);
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");

    // Extract all member user IDs assigned to this project
    const memberUserIds = project.members.map((m) => m.userId);
    if (!memberUserIds.includes(project.ownerId)) {
      memberUserIds.push(project.ownerId);
    }

    const orgId = project.workspace.orgId;

    const whereClause: any = {
      organizationId: orgId,
      userId: { in: memberUserIds },
      status: "ACTIVE",
    };

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
        delegations: {
          where: { status: "ACTIVE" },
          include: {
            delegateUser: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { startDate: "asc" },
    });

    return NextResponse.json({ projectId, leaves });
  } catch (error: any) {
    logger.error("GET /api/projects/[id]/availability error", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch project availability" },
      { status: error.message?.includes("Forbidden") ? 403 : 500 }
    );
  }
}
