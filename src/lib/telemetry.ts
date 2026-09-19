/**
 * PROD-7 — error tracking and structured log shipping.
 *
 * WHAT WAS WRONG
 *
 * `logger.ts` wrote to `console.*` and nowhere else. No sink, no aggregation,
 * no alerting. You would learn about production incidents from customers.
 * (OPS-3, "No monitoring or alerting", was previously marked COMPLETED with
 * the justification "health endpoint + logging" — a health endpoint is
 * liveness, not monitoring.)
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * This is the SEAM and the SCRUBBER, not a vendor integration. No error
 * tracker has been provisioned for this deployment, and installing an SDK that
 * cannot be pointed at anything would be ceremony: unverifiable, and it would
 * make the tracker look present in code review while shipping nothing.
 *
 * So what ships here is:
 *   - one place every error and structured log passes through,
 *   - PII and secret scrubbing that runs BEFORE anything leaves the process,
 *     which is the part that is hard to retrofit and the part with compliance
 *     consequences,
 *   - a transport interface with a working HTTP implementation, so pointing it
 *     at Sentry, Datadog, Axiom or an OTLP collector is a config change and an
 *     adapter, not a refactor,
 *   - counters the alerting rules in DEPLOYMENT.md are written against.
 *
 * Configure with TELEMETRY_ENDPOINT (and optionally TELEMETRY_API_KEY). With
 * neither set, events go to the console exactly as before, and the boot check
 * warns in production that nothing is being shipped.
 */

import { sanitizeLogData } from "./log-sanitize";

export type TelemetrySeverity = "info" | "warning" | "error" | "security" | "audit";

export interface TelemetryEvent {
  severity: TelemetrySeverity;
  action: string;
  message: string;
  meta?: Record<string, unknown>;
  error?: { name: string; message: string; stack?: string };
  timestamp: string;
  /** Set from the deploy so stack traces can be mapped to a build. */
  release?: string;
  environment: string;
}

/**
 * Patterns scrubbed from any string before it leaves the process.
 *
 * Key-based redaction (`sanitizeLogData`) is not enough on its own: the
 * dangerous values usually arrive inside a message or a stack frame, where
 * there is no key to match. A connection string in an exception message is the
 * classic example — it carries the database password.
 */
const VALUE_PATTERNS: Array<{ name: string; re: RegExp; replace: string }> = [
  // Postgres/MySQL URLs with inline credentials.
  { name: "db-url", re: /\b([a-z+]+:\/\/[^\s:@/]+):[^\s@/]+@/gi, replace: "$1:[REDACTED]@" },
  // JWTs — three base64url segments.
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, replace: "[REDACTED_JWT]" },
  { name: "bearer", re: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, replace: "$1[REDACTED]" },
  // Common provider key shapes.
  { name: "api-key", re: /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}\b/g, replace: "[REDACTED_KEY]" },
  { name: "gh-token", re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, replace: "[REDACTED_TOKEN]" },
  // 64-hex — the shape of FIELD_ENCRYPTION_KEY.
  { name: "hex-secret", re: /\b[a-f0-9]{64}\b/gi, replace: "[REDACTED_HEX]" },
  // Session cookie by name, whatever its value.
  { name: "session-cookie", re: /eitekh_session_token=[^;\s"']+/gi, replace: "eitekh_session_token=[REDACTED]" },
  // Email addresses. Tenant data in a third-party tracker is its own
  // compliance problem, and an address is the most common piece of it.
  {
    name: "email",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replace: "[REDACTED_EMAIL]",
  },
];

/** Scrub secrets and PII out of a single string. */
export function scrubString(input: string): string {
  let out = input;
  for (const p of VALUE_PATTERNS) out = out.replace(p.re, p.replace);
  return out;
}

/**
 * Scrub a whole value: key-based redaction first, then value-pattern scrubbing
 * on every remaining string, however deeply nested.
 */
export function scrub<T>(value: T): T {
  const keyed = sanitizeLogData(value);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return scrubString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(keyed) as T;
}

/** Where events go. Implement this to add a vendor. */
export interface TelemetryTransport {
  readonly name: string;
  send(event: TelemetryEvent): Promise<void>;
}

/**
 * Generic HTTP transport: POSTs newline-delimited JSON.
 *
 * Deliberately vendor-neutral. Sentry, Datadog, Axiom, Loki and an OTLP
 * collector all accept a JSON POST; the differences are the URL, the auth
 * header and the envelope, and an adapter is a small class implementing this
 * interface.
 */
class HttpTelemetryTransport implements TelemetryTransport {
  readonly name = "http";

  constructor(
    private readonly endpoint: string,
    private readonly apiKey?: string,
  ) {}

  async send(event: TelemetryEvent): Promise<void> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    // A telemetry call must never hang a request. If the sink is slow or
    // unreachable, the event is dropped rather than propagated.
    await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(3_000),
    });
  }
}

/**
 * Where the counter values actually live.
 *
 * WHY globalThis AND NOT A MODULE-LEVEL Map
 *
 * A `new Map()` in module scope is one map per MODULE INSTANCE, and Next
 * bundles middleware separately from route handlers. Both bundles import this
 * file, both get their own copy, and nothing in either one suggests that.
 *
 * The consequence was silent and specific: everything counted in middleware
 * was invisible to `/api/health`, and therefore to the alert evaluation that
 * reads it. `shared-store-unavailable` watches `RATE_LIMIT_UNAVAILABLE`, which
 * ONLY middleware emits — so the rule that fires when the rate limiter starts
 * failing closed, which is a user-visible outage, could never fire.
 *
 * Verified before the fix by logging `AUTH_RATE_LIMITED` four times from
 * middleware and watching `/api/health` report it absent.
 *
 * This is the same shape as PROD-2's per-process rate-limit Map: a singleton
 * that turns out not to be as singular as it looks. `prisma.ts` and
 * `sync-engine.ts` already pin their instances to globalThis for the same
 * reason, and this now follows that convention.
 */
const globalForCounters = globalThis as unknown as {
  __eitekhCounters?: { values: Map<string, number>; startedAt: number };
};

function counterStore(): { values: Map<string, number>; startedAt: number } {
  if (!globalForCounters.__eitekhCounters) {
    globalForCounters.__eitekhCounters = { values: new Map(), startedAt: Date.now() };
  }
  return globalForCounters.__eitekhCounters;
}

/** Counters the alerting rules are written against. */
class Counters {
  increment(name: string, by = 1): void {
    const store = counterStore();
    store.values.set(name, (store.values.get(name) ?? 0) + by);
  }

  snapshot(): Record<string, number> & { uptimeSeconds: number } {
    const store = counterStore();
    return {
      ...Object.fromEntries(store.values),
      // Shared too: a per-bundle startedAt would report a different uptime
      // depending on which bundle answered.
      uptimeSeconds: Math.round((Date.now() - store.startedAt) / 1000),
    };
  }
}

export const counters = new Counters();

let transport: TelemetryTransport | null | undefined;

function resolveTransport(): TelemetryTransport | null {
  if (transport !== undefined) return transport;
  const endpoint = process.env.TELEMETRY_ENDPOINT;
  transport = endpoint ? new HttpTelemetryTransport(endpoint, process.env.TELEMETRY_API_KEY) : null;
  return transport;
}

/** Test seam. Not used by application code. */
export function __setTelemetryTransportForTests(t: TelemetryTransport | null | undefined): void {
  transport = t;
}

export function isTelemetryConfigured(): boolean {
  return Boolean(process.env.TELEMETRY_ENDPOINT);
}

/**
 * Record an event.
 *
 * Never throws and never awaits the network on the caller's behalf: telemetry
 * that can fail a request is worse than no telemetry. A dropped event costs
 * visibility; a thrown one costs the user's work.
 */
export function capture(event: Omit<TelemetryEvent, "timestamp" | "environment" | "release">): void {
  counters.increment(`events.${event.severity}`);
  counters.increment(`action.${event.action}`);

  const t = resolveTransport();
  if (!t) return;

  const full: TelemetryEvent = scrub({
    ...event,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.RELEASE_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA,
  });

  void t.send(full).catch(() => {
    counters.increment("telemetry.send_failed");
  });
}

/**
 * Boot-time check, called from instrumentation.ts.
 *
 * A warning rather than a refusal: an operator running without a sink has made
 * a choice, and refusing to boot over observability would turn a monitoring
 * gap into an outage. It is loud because the failure mode is learning about
 * incidents from customers.
 */
export function telemetryStartupWarnings(): string[] {
  if (isTelemetryConfigured()) return [];
  return [
    "TELEMETRY_ENDPOINT is not set: errors and structured logs stay on this host's " +
      "stdout only. Nothing is aggregated and nothing can alert. See PROD-7.",
  ];
}
