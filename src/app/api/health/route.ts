import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { counters, isTelemetryConfigured } from "@/lib/telemetry";
import { syncEngine } from "@/lib/sync-engine";

/**
 * Liveness AND the numbers the alerting rules are written against (PROD-7).
 *
 * A health endpoint on its own is liveness, not monitoring — that distinction
 * is why OPS-3 was wrongly closed once already. What makes this useful to an
 * alerting system is the counters: without them there is nothing to threshold
 * except "did it answer".
 *
 * Deliberately unauthenticated and deliberately free of tenant data. It
 * reports process-level totals only — counts of events by severity, open SSE
 * connections, database latency — so it can be polled by an uptime checker
 * without a credential and without leaking anything about who uses the system.
 *
 * See DEPLOYMENT.md for the five alerts these feed.
 */
export async function GET() {
  const startedAt = Date.now();

  let dbLatency: number | null = null;
  let dbOk = false;
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatency = Date.now() - dbStart;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  if (!dbOk) {
    // A process that cannot reach its database is not healthy, whatever else
    // is true of it.
    counters.increment("health.db_unreachable");
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        db: { reachable: false },
        telemetry: { configured: isTelemetryConfigured() },
      },
      { status: 503 },
    );
  }

  const snapshot = counters.snapshot();

  return NextResponse.json({
    status: dbLatency !== null && dbLatency < 200 ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    db: { reachable: true, latencyMs: dbLatency },
    // Whether anything is actually being shipped. An operator polling health
    // should be able to see that observability itself is switched off.
    telemetry: { configured: isTelemetryConfigured() },
    realtime: { openConnections: syncEngine.getActiveClientsCount() },
    counters: snapshot,
    checkDurationMs: Date.now() - startedAt,
  });
}
