/**
 * PROD-7 — alert evaluation.
 *
 * DEPLOYMENT.md documented five alerts with thresholds. A documented threshold
 * is not an alert: something has to evaluate it and something has to be told.
 * Until then it is a note in a file, which is what "health endpoint + logging"
 * amounted to when OPS-3 was wrongly closed.
 *
 * This evaluates the five rules against the process counters and dispatches
 * firings to `ALERT_WEBHOOK_URL`. That URL is deliberately generic: Slack,
 * PagerDuty Events API, Opsgenie and a plain HTTP receiver all accept a JSON
 * POST.
 *
 * DESIGN NOTES
 *
 * - Rules are evaluated over a WINDOW, not since boot. A counter that only
 *   ever rises would fire once and then stay fired forever, so each rule
 *   compares against the previous sample.
 * - Each rule has a cooldown. An alert that repeats every evaluation is an
 *   alert people mute, and a muted alert is worse than none.
 * - Evaluation never throws. A failure here must not take down whatever
 *   triggered it.
 */

import { counters } from "./telemetry";
import { logger } from "./logger";

export type AlertSeverity = "warning" | "critical";

export interface AlertFiring {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  value: number;
  threshold: number;
  firedAt: string;
}

export interface AlertRule {
  id: string;
  severity: AlertSeverity;
  title: string;
  /** Counter keys summed to produce the observed value for this window. */
  keys: string[];
  /** Fires when the delta over the window is strictly greater than this. */
  threshold: number;
  detail: (value: number, threshold: number) => string;
}

/**
 * The five alerts from DEPLOYMENT.md, as code.
 *
 * Thresholds are deliberately conservative starting points: they have never
 * been tuned against production traffic because there is none yet. Revisit
 * after PROD-8 gives real baselines.
 */
export const ALERT_RULES: AlertRule[] = [
  {
    id: "error-rate",
    severity: "critical",
    title: "Server error rate",
    keys: ["events.error"],
    threshold: 10,
    detail: (v, t) => `${v} server errors in the last window (threshold ${t}).`,
  },
  {
    id: "auth-failure-spike",
    severity: "critical",
    title: "Authentication failure spike",
    /**
     * These names must match what the application ACTUALLY logs.
     *
     * They did not. This rule watched `LOGIN_FAILED`, `AUTH_FAILED` and
     * `RATE_LIMIT_EXCEEDED`; the login route emits `AUTH_LOGIN_FAILED` and
     * nothing emitted the other two at all. So the one rule guarding against
     * credential stuffing was structurally incapable of firing — it read as
     * configured, it evaluated on every cycle, and its value was always zero.
     *
     * There were TWO reasons it could not fire, and the first hid the second:
     *
     *   1. the key names matched nothing in the codebase
     *   2. the closest real event, AUTH_LOGIN_FAILED, was written by
     *      logAuditEvent — which persists a row to Postgres and does NOT
     *      touch the process counters these rules read. Audit and telemetry
     *      are different systems; the login route used only the first.
     *
     * The login route now emits both.
     *
     * A THIRD fault sat underneath both: counters incremented in MIDDLEWARE
     * did not reach this evaluation at all, because Next bundles middleware
     * separately and each bundle got its own counters Map. Rate-limit
     * refusals are listed here because that is now fixed — the store is
     * pinned to globalThis, the way prisma.ts and sync-engine.ts already pin
     * theirs. It also un-breaks `shared-store-unavailable`, which watches a
     * counter only middleware emits.
     *
     * And a FOURTH under that, found only because the counter finally worked:
     * the login route has its OWN limiter, tighter than the middleware's, and
     * both of its refusal paths called logAuditEvent and nothing else. So the
     * first and strictest line of defence — the one a real attack meets — was
     * still silent. 40 attempts produced 8 failures and 32 refusals, of which
     * 10 reached a counter; the other 22 were refused by the route.
     * AUTH_ACCOUNT_LOCKED is listed because it is the signal a DISTRIBUTED
     * attack produces: the per-IP ceiling is evaded by spreading the source,
     * the per-account one is not.
     *
     * Found by inducing 30 failed logins and watching nothing happen.
     * `alerts.test.ts` now asserts every key here is emitted somewhere in
     * `src/`, so a renamed action breaks a test instead of silently disarming
     * an alert.
     */
    keys: ["action.AUTH_LOGIN_FAILED", "action.AUTH_RATE_LIMITED", "action.AUTH_ACCOUNT_LOCKED"],
    threshold: 25,
    detail: (v, t) =>
      `${v} authentication failures or rate-limit refusals in the last window (threshold ${t}). ` +
      "Possible credential stuffing.",
  },
  {
    id: "database-unreachable",
    severity: "critical",
    title: "Database unreachable",
    keys: ["health.db_unreachable"],
    // Any occurrence at all. A database the app cannot reach is not a
    // threshold question.
    threshold: 0,
    detail: (v) => `${v} health checks could not reach the database.`,
  },
  {
    id: "shared-store-unavailable",
    severity: "critical",
    title: "Shared store unavailable",
    keys: ["action.RATE_LIMIT_UNAVAILABLE", "action.RATE_LIMIT_STORE_UNAVAILABLE", "action.PBAC_LOAD_FAILED"],
    threshold: 0,
    detail: (v) =>
      `${v} failures reaching a shared store. The rate limiter fails CLOSED, so this is ` +
      "user-visible: requests are being denied.",
  },
  {
    id: "realtime-degraded",
    severity: "warning",
    title: "Real-time fan-out degraded",
    keys: ["action.SYNC_BUS_LISTEN_FAILED", "action.SYNC_BUS_LISTENER_ERROR"],
    threshold: 0,
    detail: (v) =>
      `${v} sync-bus listener failures. Fan-out has fallen back to polling, so real-time ` +
      "still works but with added latency — and nothing looks wrong from outside. This is " +
      "the failure PROD-4 exists to prevent silently recurring.",
  },
];

const COOLDOWN_MS = 15 * 60_000;

let previous: Record<string, number> = {};
let lastFiredAt: Record<string, number> = {};

function sum(snapshot: Record<string, number>, keys: string[]): number {
  return keys.reduce((acc, k) => acc + (snapshot[k] ?? 0), 0);
}

/**
 * Evaluate every rule against the change since the last evaluation.
 *
 * Returns the firings rather than only dispatching them, so the caller — and
 * the tests — can see what happened.
 */
export function evaluateAlerts(now = Date.now()): AlertFiring[] {
  const snapshot = counters.snapshot() as unknown as Record<string, number>;
  const firings: AlertFiring[] = [];

  for (const rule of ALERT_RULES) {
    const current = sum(snapshot, rule.keys);
    const before = sum(previous, rule.keys);
    const delta = Math.max(0, current - before);

    if (delta > rule.threshold) {
      const cooling = (lastFiredAt[rule.id] ?? 0) + COOLDOWN_MS > now;
      if (!cooling) {
        lastFiredAt[rule.id] = now;
        firings.push({
          id: rule.id,
          severity: rule.severity,
          title: rule.title,
          detail: rule.detail(delta, rule.threshold),
          value: delta,
          threshold: rule.threshold,
          firedAt: new Date(now).toISOString(),
        });
      }
    }
  }

  previous = snapshot;
  return firings;
}

/**
 * Test seam. Not used by application code.
 *
 * `keepBaseline` clears the cooldowns but leaves the previous sample in place.
 * Without it a test must first call evaluateAlerts() to establish a baseline —
 * and that call, seeing every counter the process has accumulated so far as a
 * delta from zero, fires the rules and consumes their cooldown, so the test
 * that follows observes silence and appears to prove the opposite of what it
 * intended.
 */
export function __resetAlertStateForTests(opts?: { keepBaseline?: boolean }): void {
  if (!opts?.keepBaseline) previous = {};
  lastFiredAt = {};
}

export function isAlertingConfigured(): boolean {
  return Boolean(process.env.ALERT_WEBHOOK_URL);
}

/**
 * Send firings to the configured destination.
 *
 * Never throws: an alert that cannot be delivered must not become an incident
 * of its own. A delivery failure is logged and counted, which is itself
 * visible through the error-rate rule.
 */
export async function dispatchAlerts(firings: AlertFiring[]): Promise<void> {
  if (firings.length === 0) return;

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) {
    // Still recorded locally, so an operator without a webhook is not blind —
    // just slower.
    for (const f of firings) {
      logger.warn("ALERT_UNROUTED", `${f.title}: ${f.detail}`, { alertId: f.id, value: f.value });
    }
    return;
  }

  for (const f of firings) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // A flat, readable shape. `text` is what Slack renders; the
          // structured fields are what a machine consumes.
          text: `[${f.severity.toUpperCase()}] ${f.title} — ${f.detail}`,
          alert: f,
          environment: process.env.NODE_ENV ?? "development",
          release: process.env.RELEASE_SHA,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      counters.increment("alerts.dispatch_failed");
      logger.error("ALERT_DISPATCH_FAILED", `Could not deliver alert ${f.id}`, err);
    }
  }
}

/** Evaluate and dispatch in one call. Used by the alert-check route. */
export async function runAlertCycle(): Promise<AlertFiring[]> {
  try {
    const firings = evaluateAlerts();
    await dispatchAlerts(firings);
    return firings;
  } catch (err) {
    logger.error("ALERT_CYCLE_FAILED", "The alert evaluation cycle threw", err);
    return [];
  }
}
