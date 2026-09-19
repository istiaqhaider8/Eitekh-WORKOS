import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";
import { parseJsonBody, emailOutboxReplaySchema } from "@/lib/validation";
import { replayEmail, MAX_EMAIL_ATTEMPTS } from "@/lib/email-outbox";

/**
 * C2 — what is in the email outbox, and a way to retry a dead message.
 *
 * WHY THIS IS PART OF THE FIX
 *
 * "Visible delivery status" is one of C2's tasks, and it is not a reporting
 * nicety. Before the outbox existed, queued mail lived in an array on one
 * process: nothing outside that process could see it, so when a customer said
 * "I never got the invitation" there was no way to answer whether it had been
 * attempted, whether it had failed, or whether a deploy had thrown it away.
 * The answer was always a shrug.
 *
 * The flows involved — password reset, OTP, invitation — are the ones a
 * locked-out user cannot work around, so the shrug is expensive.
 *
 * Super-admin only. The rows contain recipient addresses and rendered subject
 * lines across every tenant, which is exactly the shape of data that should
 * not be reachable by an organization admin.
 */

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const STATUSES = ["PENDING", "SENDING", "SENT", "FAILED", "DEAD"];

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.isSuperAdmin && !user.isSupportAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number.parseInt(url.searchParams.get("limit") || String(PAGE_SIZE), 10) || PAGE_SIZE)
    );
    const status = url.searchParams.get("status");

    const where: any = {};
    if (status && STATUSES.includes(status)) where.status = status;

    const [total, messages, counts, oldestPending] = await Promise.all([
      prisma.emailOutbox.count({ where }),
      prisma.emailOutbox.findMany({
        where,
        // Unique tiebreaker: offset paging over a non-unique sort key drops
        // rows between pages.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          to: true,
          templateKey: true,
          customSubject: true,
          status: true,
          attempts: true,
          error: true,
          nextAttemptAt: true,
          lastAttemptAt: true,
          sentAt: true,
          createdAt: true,
          // customHtml and variables are deliberately omitted: a rendered body
          // can contain a reset link, and this list is not the place to put one
          // on screen.
        },
      }),
      prisma.emailOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.emailOutbox.findFirst({
        where: { status: { in: ["PENDING", "FAILED"] } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);

    const countsByStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));

    return NextResponse.json({
      messages,
      total,
      page,
      limit,
      hasMore: page * limit < total,
      maxAttempts: MAX_EMAIL_ATTEMPTS,
      countsByStatus,
      /**
       * The number worth alerting on. A growing backlog is normal for a
       * minute and a symptom after an hour, and "how long has the oldest
       * un-sent message been waiting" says that far more directly than a
       * count does.
       */
      oldestPendingAt: oldestPending?.createdAt ?? null,
    });
  } catch (error) {
    return handleApiError(error, "super-admin/email-outbox");
  }
}

/** Re-queue a dead or failed message, once whatever broke has been fixed. */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Support admins can LOOK; sending mail is a super-admin action.
    if (!user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const parsed = await parseJsonBody(request, emailOutboxReplaySchema);
    if (!parsed.success) return parsed.error;

    const requeued = await replayEmail(parsed.data.id);
    if (!requeued) {
      return NextResponse.json(
        { error: "Only FAILED or DEAD messages can be replayed." },
        { status: 409 }
      );
    }

    return NextResponse.json({ requeued: true, id: parsed.data.id });
  } catch (error) {
    return handleApiError(error, "super-admin/email-outbox");
  }
}
