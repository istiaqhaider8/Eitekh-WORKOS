import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { autoProcessExpiredDelegations } from "@/lib/delegation-engine";
import { handleApiError } from "@/lib/api-error";

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

    // Auto-process expired delegations
    await autoProcessExpiredDelegations();

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status") || "ALL";

    const whereClause: any = {
      issue: { projectId },
    };

    if (statusParam !== "ALL") {
      whereClause.status = statusParam;
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
        history: {
          include: {
            actor: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
          orderBy: { timestamp: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ projectId, delegations });
  } catch (error: any) {
    logger.error("GET /api/projects/[id]/delegations error", error);
    return handleApiError(error, "projects/[id]/delegations");
  }
}
