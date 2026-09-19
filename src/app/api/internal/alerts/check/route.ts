import { NextRequest, NextResponse } from "next/server";
import { runAlertCycle, isAlertingConfigured, ALERT_RULES } from "@/lib/alerts";
import { handleApiError } from "@/lib/api-error";
import { logger } from "@/lib/logger";

/**
 * PROD-7 — the thing that makes the alerts actually fire.
 *
 * Call this on a schedule (platform cron, an external uptime checker, or a
 * Kubernetes CronJob); see DEPLOYMENT.md. Each call evaluates the five rules
 * against the change since the previous call and dispatches any firings.
 *
 * WHY A PROTECTED ENDPOINT RATHER THAN A TIMER
 *
 * A `setInterval` in module scope is the pattern PROD-2 and PROD-3 removed: it
 * runs once per instance, so N instances means N times the evaluations and N
 * times the pages, and on a serverless host it may never fire at all. A
 * scheduler calling an endpoint is explicit about who runs it and how often.
 *
 * WHY IT IS AUTHENTICATED BY SECRET
 *
 * Evaluation is cheap, but dispatch reaches an external webhook. Leaving that
 * open would let anyone drive traffic at your incident channel. The cooldown
 * bounds the damage; the secret removes it. `ALERT_CHECK_SECRET` must be set
 * for this route to do anything — absent, it refuses rather than defaulting to
 * open.
 *
 * NOTE: alert state is per-process. With several instances each evaluates its
 * own counters, which is correct — the counters are per-process too — but it
 * does mean the same condition can page once per instance. Deduplicate in the
 * receiver, or point the schedule at a single instance.
 */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.ALERT_CHECK_SECRET;
    if (!secret) {
      // Fail closed: an unset secret is a misconfiguration, not permission.
      return NextResponse.json(
        { error: "Alert checking is not configured (ALERT_CHECK_SECRET unset)." },
        { status: 503 },
      );
    }

    const provided =
      req.headers.get("x-alert-secret") ??
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      "";

    if (provided !== secret) {
      logger.security("ALERT_CHECK_UNAUTHORIZED", "Rejected an unauthenticated alert-check call");
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const firings = await runAlertCycle();

    return NextResponse.json({
      evaluated: ALERT_RULES.length,
      fired: firings.length,
      firings,
      // So an operator can tell whether firings are actually going anywhere.
      routed: isAlertingConfigured(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error, "internal/alerts/check");
  }
}
