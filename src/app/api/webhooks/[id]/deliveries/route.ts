import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertOrgAccess, assertProjectAccess } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { webhookReplaySchema, parseJsonBody } from "@/lib/validation";
import { replayDelivery, MAX_ATTEMPTS } from "@/lib/webhook-delivery";

/**
 * C1 — delivery history for a webhook, and a way to replay a dead one.
 *
 * WHY THIS ENDPOINT IS PART OF THE FIX RATHER THAN A NICE EXTRA
 *
 * Retry and dead-lettering are only half of a delivery guarantee. The other
 * half is being able to answer "did you send it?" — which, before this, nobody
 * could, for anyone. A customer's integration stopped firing and there was no
 * record on either side: no attempt log, no response code, no error. The first
 * thing an integrator does when a webhook seems broken is look for exactly
 * this page, and its absence turns a five-minute question into a support
 * thread.
 *
 * Authorization mirrors the parent route deliberately: a project-scoped
 * webhook needs project access, an org-scoped one needs OWNER/ADMIN. Reading
 * delivery history is strictly less privileged than editing the endpoint, so
 * requireAdmin is false for GET — the same choice GET /api/webhooks/[id]
 * already makes.
 *
 * The response never contains the signature or the secret. It does contain the
 * payload, which is the tenant's own event data, and the receiver's response
 * body truncated — both are what makes the page useful for debugging.
 */

async function verifyWebhookAccess(
  webhook: { orgId: string; projectId: string | null },
  requireAdmin: boolean
) {
  if (webhook.projectId) {
    await assertProjectAccess(webhook.projectId);
  } else {
    await assertOrgAccess(webhook.orgId, requireAdmin ? ["OWNER", "ADMIN"] : ["OWNER", "ADMIN", "MEMBER"]);
  }
}

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const webhook = await prisma.webhook.findUnique({ where: { id } });
    if (!webhook) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });

    await verifyWebhookAccess(webhook, false);

    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number.parseInt(url.searchParams.get("limit") || String(PAGE_SIZE), 10) || PAGE_SIZE)
    );
    const status = url.searchParams.get("status");

    const where: any = { webhookId: id };
    if (status && ["PENDING", "DELIVERING", "DELIVERED", "FAILED", "DEAD"].includes(status)) {
      where.status = status;
    }

    const [total, deliveries, counts] = await Promise.all([
      prisma.webhookDelivery.count({ where }),
      prisma.webhookDelivery.findMany({
        where,
        // A unique tiebreaker, so paging over rows that share a createdAt is
        // stable — the same defect that made 1 of 374 comments unreachable.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          eventType: true,
          status: true,
          attempts: true,
          responseStatus: true,
          responseBody: true,
          error: true,
          nextAttemptAt: true,
          lastAttemptAt: true,
          deliveredAt: true,
          createdAt: true,
          payload: true,
        },
      }),
      prisma.webhookDelivery.groupBy({
        by: ["status"],
        where: { webhookId: id },
        _count: { _all: true },
      }),
    ]);

    return NextResponse.json({
      deliveries,
      total,
      page,
      limit,
      hasMore: page * limit < total,
      maxAttempts: MAX_ATTEMPTS,
      // The summary an operator actually wants first: how many are stuck.
      countsByStatus: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      endpoint: {
        consecutiveFailures: webhook.consecutiveFailures,
        disabledUntil: webhook.disabledUntil,
        isActive: webhook.isActive,
      },
    });
  } catch (error) {
    return handleApiError(error, "webhooks/[id]/deliveries");
  }
}

/**
 * Replay a failed or dead-lettered delivery.
 *
 * Requires admin, unlike GET: this causes an outbound request carrying the
 * tenant's data, which is a different thing from reading a log.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const webhook = await prisma.webhook.findUnique({ where: { id } });
    if (!webhook) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });

    await verifyWebhookAccess(webhook, true);

    const parsed = await parseJsonBody(request, webhookReplaySchema);
    if (!parsed.success) return parsed.error;
    const { deliveryId } = parsed.data;

    // Scoped to THIS webhook. Without it, an admin of one endpoint could
    // replay a delivery belonging to another — including one in another
    // tenant, since a delivery id is all the parameter carries.
    const delivery = await prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, webhookId: id },
      select: { id: true, status: true },
    });
    if (!delivery) {
      return NextResponse.json({ error: "Delivery not found for this webhook" }, { status: 404 });
    }

    const requeued = await replayDelivery(delivery.id);
    if (!requeued) {
      return NextResponse.json(
        { error: `Only FAILED or DEAD deliveries can be replayed; this one is ${delivery.status}.` },
        { status: 409 }
      );
    }

    return NextResponse.json({ requeued: true, deliveryId: delivery.id });
  } catch (error) {
    return handleApiError(error, "webhooks/[id]/deliveries");
  }
}
