import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";
import { timeEntryCreateSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import { assertIssueHistoryAccess, parsePaging, paginate } from "@/lib/issue-history";

/**
 * Paginated time entries, newest first (A4 follow-up).
 *
 * The issue payload carries only the newest 50; this is how the rest is read.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: issueId } = await params;
    await assertIssueHistoryAccess(issueId);

    const { page, limit } = parsePaging(new URL(req.url).searchParams);
    const result = await paginate(
      () => prisma.timeEntry.count({ where: { issueId } }),
      (skip, take) =>
        prisma.timeEntry.findMany({
          where: { issueId },
          // Unique tiebreaker; see the note in the comments route.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip,
          take,
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
        }),
      page,
      limit
    );

    return NextResponse.json({ timeEntries: result.items, total: result.total, page: result.page, limit: result.limit, hasMore: result.hasMore });
  } catch (error) {
    return handleApiError(error, "issues/[id]/time-entries");
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: issueId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { id: true, projectId: true, timeSpentHours: true, estimateHours: true },
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    try {
      await assertProjectAccess(issue.projectId);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const parsed = await parseJsonBody(req, timeEntryCreateSchema);
    if (!parsed.success) return parsed.error;
    const { durationMinutes, description, workDate } = parsed.data;

    const timeEntry = await prisma.timeEntry.create({
      data: {
        issueId,
        userId: user.id,
        durationMinutes: Number(durationMinutes),
        description: description || null,
        workDate: workDate ? new Date(workDate) : new Date(),
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Update issue total timeSpentHours
    const hoursLogged = Number(durationMinutes) / 60;
    if (issue) {
      const newTimeSpent = (issue.timeSpentHours || 0) + hoursLogged;
      const newRemaining = issue.estimateHours ? Math.max(0, issue.estimateHours - newTimeSpent) : null;
      await prisma.issue.update({
        where: { id: issueId },
        data: {
          timeSpentHours: newTimeSpent,
          remainingHours: newRemaining,
        },
      });

      await prisma.activityLog.create({
        data: {
          issueId,
          actorId: user.id,
          actionType: "LOGGED_TIME",
          newValue: `${hoursLogged.toFixed(1)}h logged: "${description || "Work done"}"`,
        },
      });
    }

    return NextResponse.json({ timeEntry }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "issues/[id]/time-entries");
  }
}
