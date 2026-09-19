import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/api-error";
import { assertIssueHistoryAccess, parsePaging, paginate } from "@/lib/issue-history";

/**
 * Paginated activity log for an issue, newest first (A4 follow-up).
 *
 * This route did not exist at all. The issue payload included the full
 * activity log, so there was never a need — and when A4 bounded it to 50 rows,
 * everything older became unreachable. The audit trail of who changed what is
 * exactly the history someone goes looking for, so leaving it truncated was
 * the worst of the three regressions.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: issueId } = await params;
    await assertIssueHistoryAccess(issueId);

    const { page, limit } = parsePaging(new URL(req.url).searchParams);
    const result = await paginate(
      () => prisma.activityLog.count({ where: { issueId } }),
      (skip, take) =>
        prisma.activityLog.findMany({
          where: { issueId },
          // Unique tiebreaker; see the note in the comments route.
          orderBy: [{ timestamp: "desc" }, { id: "desc" }],
          skip,
          take,
          include: { actor: { select: { id: true, firstName: true, lastName: true } } },
        }),
      page,
      limit
    );

    return NextResponse.json({
      activityLogs: result.items,
      total: result.total,
      page: result.page,
      limit: result.limit,
      hasMore: result.hasMore,
    });
  } catch (error) {
    return handleApiError(error, "issues/[id]/activity");
  }
}
