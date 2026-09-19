/**
 * C2 — durable email delivery.
 *
 * WHAT WAS WRONG
 *
 * Queued mail lived in `NotificationEngine.emailQueue`, a plain array on the
 * process, drained by a `setInterval`. Three consequences, none visible from
 * inside the running app:
 *
 *   - a restart or a deploy threw away everything not yet sent, silently;
 *   - the retry timer was per-instance, so with several instances each one
 *     retried only what it happened to enqueue;
 *   - nothing outside that process could see the queue, so "was the invitation
 *     sent?" had no answer, for anyone.
 *
 * The flows this affects are exactly the ones a locked-out user cannot work
 * around: password resets, OTP codes, invitations. A dropped send is a support
 * ticket at best and a lost customer at worst.
 *
 * SHAPE
 *
 * Deliberately the same as src/lib/webhook-delivery.ts — a row per message
 * written before the attempt, a claim with FOR UPDATE SKIP LOCKED so several
 * instances can run the worker, backoff, dead-letter. Two mechanisms that do
 * the same job in different ways is how one of them ends up with the bugs
 * fixed and the other without.
 *
 * TIMESTAMPS
 *
 * Every comparison uses `<iso>::timestamp`, never `now()` and never a bare
 * Date parameter. Prisma maps `DateTime` to `timestamp` WITHOUT time zone and
 * stores UTC; `now()` is a `timestamptz`, and comparing them makes Postgres
 * read the column as session-local. That bug made the webhook backoff inert
 * and reclaimed live rows instantly on any non-UTC database — see the note in
 * webhook-delivery.ts and __tests__/integration/timestamp-timezone.test.ts.
 */

import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { sendEmail } from "./email";

/** Attempts before a message is dead-lettered. */
export const MAX_EMAIL_ATTEMPTS = 5;

/**
 * Backoff in seconds: 30s, 2m, 10m, 1h.
 *
 * Slower than the webhook schedule on purpose. A webhook receiver that is down
 * is usually down for seconds; a mail provider that is rejecting is usually
 * rate-limiting or having an incident, and retrying hard makes both worse. An
 * invitation arriving an hour late is still useful; an invitation that made us
 * look like a spammer is not.
 */
const BACKOFF_SECONDS = [30, 120, 600, 3600];

const INSTANCE_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;
const CLAIM_STALE_MS = 5 * 60 * 1000;

function backoffMs(attempts: number): number {
  const idx = Math.min(attempts - 1, BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[Math.max(0, idx)] * 1000;
}

export interface OutboundEmail {
  to: string;
  templateKey?: string;
  variables?: Record<string, unknown>;
  customSubject?: string;
  customHtml?: string;
  /**
   * Makes the enqueue idempotent. A retried request carrying the same key
   * queues nothing the second time, rather than sending the user two
   * invitations.
   */
  idempotencyKey?: string;
}

/**
 * Queue a message. Returns the row id, or null if it was a duplicate.
 *
 * Never throws into the caller: failing to QUEUE an email must not fail the
 * action that triggered it. The failure is logged loudly instead, because a
 * queue that silently accepts nothing is the failure mode this module exists
 * to remove.
 */
export async function enqueueEmail(
  message: OutboundEmail,
  /**
   * `deliverNow: false` writes the row and leaves it for the interval.
   *
   * The default kicks the worker immediately, so mail a user is waiting on —
   * a reset link, an OTP — goes out in milliseconds rather than on the next
   * tick. A caller that needs to control when the send happens turns it off:
   * a test asserting on a specific attempt, or a caller inside a transaction
   * that has not committed the thing the email talks about yet.
   *
   * Mirrors enqueueWebhookDeliveries, deliberately. The two queues should not
   * need to be reasoned about separately.
   */
  options: { deliverNow?: boolean } = {}
): Promise<string | null> {
  try {
    const row = await prisma.emailOutbox.create({
      data: {
        to: message.to,
        templateKey: message.templateKey ?? null,
        variables: message.variables ? JSON.stringify(message.variables) : null,
        customSubject: message.customSubject ?? null,
        customHtml: message.customHtml ?? null,
        idempotencyKey: message.idempotencyKey ?? null,
      },
      select: { id: true },
    });

    if (options.deliverNow !== false) {
      startEmailWorker();
      void runDueEmails().catch(() => {});
    }
    return row.id;
  } catch (err: any) {
    // P2002 is the unique index on idempotencyKey: this message is already
    // queued, which is a success from the caller's point of view.
    if (err?.code === "P2002") return null;

    logger.error("EMAIL_ENQUEUE_FAILED", `Could not queue an email to ${message.to}`, err, {
      to: message.to,
      templateKey: message.templateKey,
    });
    return null;
  }
}

/**
 * Claim up to `limit` due messages for this instance.
 *
 * One statement, FOR UPDATE SKIP LOCKED, so concurrent workers take disjoint
 * sets rather than blocking on each other or both sending the same message.
 */
async function claimDueEmails(limit: number) {
  const now = Date.now();
  const nowUtc = new Date(now).toISOString();
  const staleBeforeUtc = new Date(now - CLAIM_STALE_MS).toISOString();

  return prisma.$queryRaw<
    Array<{
      id: string;
      to: string;
      templateKey: string | null;
      variables: string | null;
      customSubject: string | null;
      customHtml: string | null;
      attempts: number;
    }>
  >`
    UPDATE "EmailOutbox" e
       SET status = 'SENDING',
           "claimedBy" = ${INSTANCE_ID},
           "claimedAt" = ${nowUtc}::timestamp
     WHERE e.id IN (
       SELECT c.id FROM "EmailOutbox" c
        WHERE (
                (c.status IN ('PENDING', 'FAILED') AND c."nextAttemptAt" <= ${nowUtc}::timestamp)
                OR (c.status = 'SENDING' AND c."claimedAt" < ${staleBeforeUtc}::timestamp)
              )
        ORDER BY c."nextAttemptAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING e.id, e."to", e."templateKey", e.variables, e."customSubject", e."customHtml", e.attempts
  `;
}

/**
 * The run in flight on this instance.
 *
 * Both the interval and every enqueue can start one; without coalescing a
 * burst of notifications starts a run per message, all contending on the same
 * claim. The claim limit is what controls throughput.
 */
let currentRun: Promise<{ attempted: number; sent: number }> | null = null;

export function runDueEmails(limit = 20): Promise<{ attempted: number; sent: number }> {
  if (currentRun) return currentRun;

  currentRun = (async () => {
    let attempted = 0;
    let sent = 0;

    try {
      const claimed = await claimDueEmails(limit);
      for (const row of claimed) {
        attempted += 1;
        if (await attemptSend(row)) sent += 1;
      }
    } catch (err: any) {
      logger.error("EMAIL_WORKER_FAILED", "The email outbox worker errored", err);
    }

    return { attempted, sent };
  })().finally(() => {
    currentRun = null;
  });

  return currentRun;
}

/** Resolve once no run is in flight — for shutdown and for tests. */
export async function whenEmailWorkerIdle(): Promise<void> {
  while (currentRun) {
    await currentRun.catch(() => {});
  }
}

async function attemptSend(row: {
  id: string;
  to: string;
  templateKey: string | null;
  variables: string | null;
  customSubject: string | null;
  customHtml: string | null;
  attempts: number;
}): Promise<boolean> {
  const attemptNo = row.attempts + 1;

  let variables: Record<string, any> | undefined;
  if (row.variables) {
    try {
      variables = JSON.parse(row.variables);
    } catch {
      // Unparseable variables cannot be fixed by retrying.
      await deadLetter(row.id, attemptNo, "stored template variables are not valid JSON");
      return false;
    }
  }

  try {
    const result = await sendEmail({
      to: row.to,
      templateKey: row.templateKey ?? undefined,
      variables,
      customSubject: row.customSubject ?? undefined,
      customHtml: row.customHtml ?? undefined,
    });

    if (result.status === "SENT" || result.status === "MOCKED") {
      // MOCKED counts as done: it only happens outside production, where a
      // developer without SMTP must not accumulate an ever-growing outbox.
      await prisma.emailOutbox.update({
        where: { id: row.id },
        data: {
          status: "SENT",
          attempts: attemptNo,
          lastAttemptAt: new Date(),
          sentAt: new Date(),
          error: null,
          claimedBy: null,
          claimedAt: null,
        },
      });
      return true;
    }

    await recordFailure(row.id, attemptNo, result.error || `send reported ${result.status}`);
    return false;
  } catch (err: any) {
    await recordFailure(row.id, attemptNo, err?.message || "send threw");
    return false;
  }
}

async function recordFailure(id: string, attemptNo: number, error: string): Promise<void> {
  const exhausted = attemptNo >= MAX_EMAIL_ATTEMPTS;

  await prisma.emailOutbox.update({
    where: { id },
    data: {
      status: exhausted ? "DEAD" : "FAILED",
      attempts: attemptNo,
      lastAttemptAt: new Date(),
      nextAttemptAt: new Date(Date.now() + backoffMs(attemptNo)),
      error,
      claimedBy: null,
      claimedAt: null,
    },
  });

  if (exhausted) {
    logger.error(
      "EMAIL_DEAD_LETTERED",
      `An email to ${id} exhausted ${MAX_EMAIL_ATTEMPTS} attempts and will not be retried`,
      undefined,
      { outboxId: id, error }
    );
  }
}

async function deadLetter(id: string, attemptNo: number, error: string): Promise<void> {
  await prisma.emailOutbox.update({
    where: { id },
    data: { status: "DEAD", attempts: attemptNo, lastAttemptAt: new Date(), error, claimedBy: null, claimedAt: null },
  });
}

/** Re-queue a dead or failed message. Used by the admin view. */
export async function replayEmail(id: string): Promise<boolean> {
  const { count } = await prisma.emailOutbox.updateMany({
    where: { id, status: { in: ["DEAD", "FAILED"] } },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), error: null, claimedBy: null, claimedAt: null },
  });
  if (count > 0) void runDueEmails().catch(() => {});
  return count > 0;
}

let workerTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the retry interval. Idempotent, and started lazily from the first
 * enqueue rather than at module load — importing this during a build must not
 * open a timer, and there is nothing to retry until something is queued.
 */
export function startEmailWorker(): void {
  if (workerTimer) return;
  if (typeof setInterval === "undefined") return;

  workerTimer = setInterval(() => {
    void runDueEmails().catch(() => {});
  }, 20_000);
  workerTimer.unref?.();
}
