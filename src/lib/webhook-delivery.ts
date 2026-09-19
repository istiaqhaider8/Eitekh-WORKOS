/**
 * C1 — durable webhook delivery: enqueue, attempt, retry, dead-letter.
 *
 * WHAT WAS WRONG
 *
 * Delivery was one un-awaited `fetch` per webhook. That gave:
 *
 *   - no record that a delivery was ever attempted,
 *   - no retry, so a receiver's transient 500 lost the event permanently,
 *   - no way for the tenant or for support to see what happened,
 *   - and, on a short-lived process, a real chance the socket was torn down
 *     before it opened, because nothing was waiting on the promise.
 *
 * "Fire and forget" is accurate about the forgetting.
 *
 * THE SHAPE NOW
 *
 * `enqueueWebhookDeliveries` writes one row per matching endpoint and returns.
 * The caller's request is never blocked on a receiver — that part of the old
 * design was right and is kept. `runDueDeliveries` then attempts them, and is
 * driven both opportunistically (right after enqueue) and by an interval, so a
 * retry does not wait for the next event to arrive.
 *
 * AT-LEAST-ONCE, DELIBERATELY
 *
 * The row is written BEFORE the attempt, so an accepted event is never
 * silently dropped: the worst case is a PENDING row someone picks up. The
 * tradeoff is that a receiver can see a duplicate — a delivery that succeeded
 * while the response was lost. The delivery id is sent as a header precisely
 * so a receiver can dedupe on it. At-most-once would be the other choice, and
 * it is the wrong one: losing an event silently is much harder to notice than
 * seeing one twice.
 *
 * MULTI-INSTANCE
 *
 * Every instance runs the worker, so the claim has to be atomic or two of them
 * deliver the same event. `FOR UPDATE SKIP LOCKED` inside a single statement
 * does that — the same reasoning as the rate-limit store in PROD-2 and the
 * sync outbox in PROD-4.
 */

import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { decryptField } from "./encryption";
import { logger } from "./logger";
import { isWebhookTargetAllowed } from "./webhooks";
import {
  signWebhookPayload,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  EVENT_HEADER,
  DELIVERY_HEADER,
} from "./webhook-signature";

const DELIVERY_TIMEOUT_MS = 10_000;

/** Attempts before a delivery is dead-lettered. */
export const MAX_ATTEMPTS = 6;

/**
 * Backoff between attempts, in seconds: ~10s, 30s, 2m, 8m, 30m.
 *
 * Front-loaded because most delivery failures are a restart or a brief blip
 * and clear in seconds, then stretched so an endpoint that is genuinely down
 * is not hammered for hours. The last gap is capped rather than doubling
 * forever: an event delivered two days late is rarely more useful than one
 * that was dead-lettered and can be seen in the history.
 */
const BACKOFF_SECONDS = [10, 30, 120, 480, 1800];

/** Consecutive failures before an endpoint is suspended. */
export const CIRCUIT_THRESHOLD = 10;
/** How long a tripped circuit stays open. */
const CIRCUIT_OPEN_MS = 15 * 60 * 1000;

/** Response bodies are diagnostic; this is not storage. */
const MAX_RESPONSE_BODY = 2000;

/** Identifies this process in a claim, so a stuck row can be traced. */
const INSTANCE_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

/** A claim older than this is assumed abandoned (the instance died mid-flight). */
const CLAIM_STALE_MS = 2 * 60 * 1000;

function backoffMs(attempts: number): number {
  const idx = Math.min(attempts - 1, BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[Math.max(0, idx)] * 1000;
}

function parseEvents(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* not JSON; fall through to the comma form */
  }
  return raw.split(",").map((e) => e.trim()).filter(Boolean);
}

/**
 * Write a delivery row for every endpoint subscribed to this event.
 *
 * Returns the number enqueued. Never throws into the caller: a webhook problem
 * must not fail the user action that triggered it.
 */
export async function enqueueWebhookDeliveries(
  eventType: string,
  payload: unknown,
  projectId?: string,
  orgId?: string,
  /**
   * `deliverNow: false` writes the rows and leaves them for the interval.
   *
   * The default kicks the worker immediately so a healthy endpoint sees the
   * event in milliseconds. A caller that wants to control when delivery
   * happens — a test asserting on a specific attempt, or a caller inside a
   * transaction that has not committed yet — turns it off.
   */
  options: { deliverNow?: boolean } = {}
): Promise<number> {
  try {
    const or: any[] = [];
    if (projectId) or.push({ projectId });
    if (orgId) or.push({ orgId, projectId: null });
    if (or.length === 0) return 0;

    const webhooks = await prisma.webhook.findMany({ where: { isActive: true, OR: or } });
    if (webhooks.length === 0) return 0;

    // Serialised ONCE, here. The bytes stored are the bytes signed and sent,
    // so a retry re-sends exactly what the first attempt did — a regenerated
    // payload would carry a new timestamp and break any receiver that recorded
    // the first one.
    const body = JSON.stringify({
      event: eventType,
      timestamp: new Date().toISOString(),
      data: payload,
    });

    const rows: { webhookId: string; eventType: string; payload: string }[] = [];

    for (const webhook of webhooks) {
      if (!parseEvents(webhook.events).includes(eventType)) continue;

      // Checked at enqueue AND at attempt: the URL can be edited between the
      // two, and the attempt is the one that opens a socket.
      const allowed = isWebhookTargetAllowed(webhook.targetUrl);
      if (!allowed.ok) {
        logger.security(
          "WEBHOOK_TARGET_BLOCKED",
          `Refused to enqueue ${eventType} for webhook ${webhook.id}: ${allowed.reason}`,
          { webhookId: webhook.id, targetUrl: webhook.targetUrl, reason: allowed.reason }
        );
        continue;
      }

      rows.push({ webhookId: webhook.id, eventType, payload: body });
    }

    if (rows.length === 0) return 0;

    await prisma.webhookDelivery.createMany({ data: rows });

    // Opportunistic: try immediately rather than waiting for the interval, so
    // a healthy endpoint sees the event in milliseconds. Not awaited — the
    // point is that the caller's request does not wait on a receiver.
    if (options.deliverNow !== false) {
      void runDueDeliveries().catch(() => {});
    }

    return rows.length;
  } catch (err: any) {
    logger.error("WEBHOOK_ENQUEUE_FAILED", `Could not enqueue ${eventType}`, err, { eventType, projectId, orgId });
    return 0;
  }
}

/**
 * Claim up to `limit` due deliveries for this instance.
 *
 * One statement. `FOR UPDATE SKIP LOCKED` lets concurrent workers take
 * disjoint sets instead of blocking on each other or, worse, both reading the
 * same rows and delivering twice.
 *
 * The staleness clause reclaims rows whose holder died mid-flight. Without it
 * a deploy during a delivery would leave the row DELIVERING forever — the
 * classic way a queue quietly stops draining.
 */
async function claimDueDeliveries(limit: number) {
  /**
   * NOT `now()`. This cost an afternoon, so it is worth the paragraph.
   *
   * Prisma maps `DateTime` to `timestamp(3)` — WITHOUT time zone — and writes
   * the UTC instant into it. Postgres `now()` returns `timestamptz`. Comparing
   * the two makes Postgres interpret the naive column value as being in the
   * SESSION's time zone, so on a database whose session zone is not UTC the
   * stored instant is read back shifted by the offset.
   *
   * On this machine (Asia/Dhaka, +06) a row claimed a millisecond ago compared
   * as six hours old. Two consequences, both silent:
   *
   *   - every in-flight delivery looked abandoned the instant it was claimed,
   *     so a second worker could take it and deliver the same event again;
   *   - `nextAttemptAt <= now()` was true for anything scheduled less than six
   *     hours out, so the backoff did nothing and a dead endpoint was hammered
   *     at full rate.
   *
   * Neither would have appeared on a UTC machine, which is what most CI runs
   * on — so this would have shipped and misbehaved only in production, or only
   * for some customers.
   *
   * The fix is to compare in the naive-UTC space the column actually holds:
   * an ISO string cast to `timestamp`, which parses the instant and drops the
   * offset. The rule for this codebase: in raw SQL touching a Prisma
   * `DateTime` column, compare against `<iso>::timestamp`, never against
   * `now()` and never against a bare Date parameter. (The rate-limit store is
   * exempt: it both
   * writes and reads `resetAt` with `now()` and never mixes in an ORM write, so
   * it is internally consistent.)
   */
  const now = Date.now();
  // ISO strings cast to `timestamp`, which drops the offset and leaves the
  // naive UTC value the column actually holds. Passing a JS Date does NOT
  // work: the driver sends it as timestamptz and the coercion above happens
  // anyway — that was the first attempted fix, and it changed nothing.
  const nowUtc = new Date(now).toISOString();
  const staleBeforeUtc = new Date(now - CLAIM_STALE_MS).toISOString();

  return prisma.$queryRaw<
    Array<{ id: string; webhookId: string; eventType: string; payload: string; attempts: number }>
  >`
    UPDATE "WebhookDelivery" d
       SET status = 'DELIVERING',
           "claimedBy" = ${INSTANCE_ID},
           "claimedAt" = ${nowUtc}::timestamp
     WHERE d.id IN (
       SELECT c.id FROM "WebhookDelivery" c
        WHERE (
                (c.status IN ('PENDING', 'FAILED') AND c."nextAttemptAt" <= ${nowUtc}::timestamp)
                OR (c.status = 'DELIVERING' AND c."claimedAt" < ${staleBeforeUtc}::timestamp)
              )
        ORDER BY c."nextAttemptAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING d.id, d."webhookId", d."eventType", d.payload, d.attempts
  `;
}

/**
 * The run currently in flight on this instance, if any.
 *
 * Both the 15-second interval AND every enqueue can start a run, so without
 * this a busy period starts many concurrent runs that all contend on the same
 * claim statement. They would not deliver anything twice — SKIP LOCKED sees to
 * that — but they would burn connections competing for rows. A single run at a
 * time per instance is enough; the claim limit controls throughput.
 *
 * It also gives shutdown and tests something to await.
 */
let currentRun: Promise<{ attempted: number; delivered: number }> | null = null;

/** Attempt every due delivery this instance can claim. */
export function runDueDeliveries(limit = 25): Promise<{ attempted: number; delivered: number }> {
  if (currentRun) return currentRun;

  currentRun = (async () => {
    let attempted = 0;
    let delivered = 0;

    try {
      const claimed = await claimDueDeliveries(limit);

      for (const row of claimed) {
        attempted += 1;
        if (await attemptDelivery(row)) delivered += 1;
      }
    } catch (err: any) {
      logger.error("WEBHOOK_WORKER_FAILED", "The webhook delivery worker errored", err);
    }

    return { attempted, delivered };
  })().finally(() => {
    currentRun = null;
  });

  return currentRun;
}

/**
 * Resolve once no delivery run is in flight on this instance.
 *
 * For a graceful shutdown — killing the process mid-delivery leaves a row
 * DELIVERING until the staleness reclaim picks it up, which is survivable but
 * needlessly slow — and for tests that need to assert on a settled state.
 */
export async function whenWebhookWorkerIdle(): Promise<void> {
  while (currentRun) {
    await currentRun.catch(() => {});
  }
}

async function attemptDelivery(row: {
  id: string;
  webhookId: string;
  eventType: string;
  payload: string;
  attempts: number;
}): Promise<boolean> {
  const attemptNo = row.attempts + 1;

  const webhook = await prisma.webhook.findUnique({ where: { id: row.webhookId } });
  if (!webhook || !webhook.isActive) {
    await deadLetter(row.id, attemptNo, "the webhook was deleted or deactivated");
    return false;
  }

  // Circuit open: leave it retryable and come back later rather than burning
  // an attempt on an endpoint we already know is down.
  if (webhook.disabledUntil && webhook.disabledUntil > new Date()) {
    await prisma.webhookDelivery.update({
      where: { id: row.id },
      data: { status: "FAILED", nextAttemptAt: webhook.disabledUntil, claimedBy: null, claimedAt: null },
    });
    return false;
  }

  // Re-checked here, not only at enqueue: the URL may have been edited since,
  // and this is the call that opens a socket.
  const allowed = isWebhookTargetAllowed(webhook.targetUrl);
  if (!allowed.ok) {
    logger.security(
      "WEBHOOK_TARGET_BLOCKED",
      `Refused to deliver ${row.eventType} to webhook ${webhook.id}: ${allowed.reason}`,
      { webhookId: webhook.id, targetUrl: webhook.targetUrl, reason: allowed.reason }
    );
    await deadLetter(row.id, attemptNo, `target not permitted: ${allowed.reason}`);
    return false;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const secret = decryptField(webhook.secret);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const res = await fetch(webhook.targetUrl, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        [EVENT_HEADER]: row.eventType,
        [DELIVERY_HEADER]: row.id,
        [TIMESTAMP_HEADER]: String(timestamp),
        // The secret itself is NOT sent. See webhook-signature.ts.
        [SIGNATURE_HEADER]: signWebhookPayload(secret, timestamp, row.payload),
      },
      body: row.payload,
    });

    const text = await res.text().catch(() => "");
    const responseBody = text.slice(0, MAX_RESPONSE_BODY) || null;

    if (res.ok) {
      await prisma.$transaction([
        prisma.webhookDelivery.update({
          where: { id: row.id },
          data: {
            status: "DELIVERED",
            attempts: attemptNo,
            lastAttemptAt: new Date(),
            deliveredAt: new Date(),
            responseStatus: res.status,
            responseBody,
            error: null,
            claimedBy: null,
            claimedAt: null,
          },
        }),
        // One success closes the circuit. Anything else would leave an endpoint
        // that recovered permanently suspect.
        prisma.webhook.update({
          where: { id: webhook.id },
          data: { consecutiveFailures: 0, disabledUntil: null },
        }),
      ]);
      return true;
    }

    await recordFailure(row.id, webhook.id, attemptNo, `receiver responded ${res.status}`, res.status, responseBody);
    return false;
  } catch (err: any) {
    const reason = controller.signal.aborted
      ? `timed out after ${DELIVERY_TIMEOUT_MS}ms`
      : err?.message || "delivery failed";
    await recordFailure(row.id, webhook.id, attemptNo, reason, null, null);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function recordFailure(
  deliveryId: string,
  webhookId: string,
  attemptNo: number,
  error: string,
  responseStatus: number | null,
  responseBody: string | null
): Promise<void> {
  const exhausted = attemptNo >= MAX_ATTEMPTS;

  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: exhausted ? "DEAD" : "FAILED",
      attempts: attemptNo,
      lastAttemptAt: new Date(),
      nextAttemptAt: new Date(Date.now() + backoffMs(attemptNo)),
      responseStatus,
      responseBody,
      error,
      claimedBy: null,
      claimedAt: null,
    },
  });

  const updated = await prisma.webhook.update({
    where: { id: webhookId },
    data: { consecutiveFailures: { increment: 1 } },
    select: { consecutiveFailures: true, disabledUntil: true },
  });

  if (updated.consecutiveFailures >= CIRCUIT_THRESHOLD && !(updated.disabledUntil && updated.disabledUntil > new Date())) {
    const until = new Date(Date.now() + CIRCUIT_OPEN_MS);
    await prisma.webhook.update({ where: { id: webhookId }, data: { disabledUntil: until } });
    logger.warn(
      "WEBHOOK_CIRCUIT_OPEN",
      `Suspending webhook ${webhookId} until ${until.toISOString()} after ${updated.consecutiveFailures} consecutive failures`,
      { webhookId, consecutiveFailures: updated.consecutiveFailures, until: until.toISOString() }
    );
  }

  if (exhausted) {
    logger.error(
      "WEBHOOK_DELIVERY_DEAD",
      `Delivery ${deliveryId} to webhook ${webhookId} exhausted ${MAX_ATTEMPTS} attempts and was dead-lettered`,
      undefined,
      { deliveryId, webhookId, error }
    );
  }
}

async function deadLetter(deliveryId: string, attemptNo: number, error: string): Promise<void> {
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "DEAD",
      attempts: attemptNo,
      lastAttemptAt: new Date(),
      error,
      claimedBy: null,
      claimedAt: null,
    },
  });
}

/**
 * Re-queue a dead-lettered delivery. Used by the admin history view.
 *
 * Resets the attempt counter: an operator retrying by hand has usually fixed
 * something, and leaving the count at MAX would let the retry die on its first
 * failure.
 */
export async function replayDelivery(deliveryId: string): Promise<boolean> {
  const { count } = await prisma.webhookDelivery.updateMany({
    where: { id: deliveryId, status: { in: ["DEAD", "FAILED"] } },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), error: null, claimedBy: null, claimedAt: null },
  });
  if (count > 0) void runDueDeliveries().catch(() => {});
  return count > 0;
}

/**
 * Start the retry interval.
 *
 * Idempotent, and started lazily from the first enqueue rather than at module
 * load: importing this module during a build must not open a timer, and there
 * is nothing to retry until something has been sent.
 */
let workerTimer: ReturnType<typeof setInterval> | null = null;

export function startWebhookWorker(): void {
  if (workerTimer) return;
  if (typeof setInterval === "undefined") return;

  workerTimer = setInterval(() => {
    void runDueDeliveries().catch(() => {});
  }, 15_000);
  workerTimer.unref?.();
}
