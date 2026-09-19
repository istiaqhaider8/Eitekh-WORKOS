/**
 * Phase 4 — prove an alert reaches a human.
 *
 * WHY THIS EXISTS
 *
 * There are five alert rules, calibrated against measured baselines, and
 * nothing in the application calls the endpoint that evaluates them. Nothing
 * schedules it; DEPLOYMENT.md says an external cron must. So the rules have
 * never fired, and an alert that has never fired is not a safety net — it is
 * a belief. The worst version of this is an operator who trusts it.
 *
 * WHAT IT DOES
 *
 *   1. stands up a receiver, which is what ALERT_WEBHOOK_URL must point at
 *   2. INDUCES a real failure — 30 failed logins, which is what credential
 *      stuffing looks like from the server's side
 *   3. calls the evaluation endpoint the way cron would, with its secret
 *   4. waits for the webhook to arrive and inspects what it actually says
 *
 * Each step is the real one. It does not call `evaluateAlerts()` directly,
 * because the thing most likely to be broken is the wiring between the parts —
 * the secret, the dispatch, the URL — not the arithmetic in the rule.
 *
 * THE APP MUST ALREADY BE RUNNING with:
 *   ALERT_CHECK_SECRET=<secret>
 *   ALERT_WEBHOOK_URL=http://127.0.0.1:<receiver-port>/hook
 *
 * Usage:
 *   node scripts/alert-drill.mjs --app http://127.0.0.1:3000 \
 *     --secret <secret> [--receiver-port 9411]
 */

import http from "node:http";

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const APP = argOf("--app", "http://127.0.0.1:3000");
const SECRET = argOf("--secret");
const RECEIVER_PORT = Number(argOf("--receiver-port", "9411"));

if (!SECRET) {
  console.error("\n[alert-drill] --secret is required (the app's ALERT_CHECK_SECRET).\n");
  process.exit(2);
}

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  -- " + detail : ""));
  if (ok) pass += 1;
  else fail += 1;
}

/** Everything the receiver was sent, so the assertions can read it. */
const delivered = [];

const receiver = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    /* keep the raw text; a receiver that cannot parse is itself a finding */
  }
  delivered.push({ raw, body, at: Date.now() });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end('{"ok":true}');
});

await new Promise((resolve) => receiver.listen(RECEIVER_PORT, "127.0.0.1", resolve));
console.log(`[alert-drill] receiver listening on http://127.0.0.1:${RECEIVER_PORT}/hook`);

try {
  // ------------------------------------------------------------------ 0
  /**
   * An unauthenticated call must be refused. The endpoint dispatches to an
   * external webhook, so leaving it open would let anyone drive traffic at
   * an incident channel.
   */
  const anon = await fetch(`${APP}/api/internal/alerts/check`, { method: "POST" });
  check("the evaluation endpoint refuses an unauthenticated call", anon.status === 403, `HTTP ${anon.status}`);

  const wrong = await fetch(`${APP}/api/internal/alerts/check`, {
    method: "POST",
    headers: { "x-alert-secret": "not-the-secret" },
  });
  check("and refuses a wrong secret", wrong.status === 403, `HTTP ${wrong.status}`);

  // ------------------------------------------------------------------ 1
  /**
   * Establish the baseline first.
   *
   * Rules evaluate the CHANGE since the previous call, so an evaluation now
   * makes the next one measure only what this drill caused. Without it the
   * drill would be measuring whatever the server had already accumulated.
   */
  const baseline = await fetch(`${APP}/api/internal/alerts/check`, {
    method: "POST",
    headers: { "x-alert-secret": SECRET },
  });
  check("an authorised call is accepted", baseline.status === 200, `HTTP ${baseline.status}`);
  const baselineBody = await baseline.json().catch(() => ({}));
  check(
    "it reports the rules it evaluated",
    typeof baselineBody.evaluated === "number" && baselineBody.evaluated > 0,
    `${baselineBody.evaluated} rule(s)`
  );
  check(
    "and says whether firings are actually routed anywhere",
    baselineBody.routed === true,
    baselineBody.routed ? "ALERT_WEBHOOK_URL is set" : "NOT ROUTED — firings would go nowhere"
  );

  /**
   * Whether the process was quiet before the drill started.
   *
   * The baseline call above is a real evaluation. If the process has already
   * accumulated auth failures — because someone was poking at it, or because
   * an earlier drill ran against this same process — that call FIRES the rule
   * and consumes its fifteen-minute cooldown. The induced spike below is then
   * correctly suppressed, and the drill reports two failures that look exactly
   * like a broken alert.
   *
   * That is the worst possible output: a drill that cries wolf is a drill
   * people learn to ignore, which is the failure this whole phase was about.
   * So say which it is rather than leaving the reader to guess.
   */
  const baselineFired = Array.isArray(baselineBody.firings) ? baselineBody.firings : [];
  if (baselineFired.some((f) => f.id === "auth-failure-spike")) {
    console.log(
      "\n[alert-drill] WARNING: the baseline evaluation ALREADY fired auth-failure-spike.\n" +
        "[alert-drill] This process was not quiet before the drill, so the rule is now in\n" +
        "[alert-drill] cooldown and the induced spike below WILL be suppressed. A failure\n" +
        "[alert-drill] below is that, not a broken alert. Restart the server and re-run."
    );
  }

  delivered.length = 0;

  // ------------------------------------------------------------------ 2
  /**
   * Induce the failure. Thirty failed logins against an address that does not
   * exist — the shape of a credential-stuffing run, and what the
   * auth-failure-spike rule is built to notice (threshold 25).
   */
  console.log("\n[alert-drill] inducing 30 failed logins...");
  for (let i = 0; i < 30; i += 1) {
    await fetch(`${APP}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Origin required: a mutating request without one is refused as CSRF
        // before it reaches authentication, so it would never increment the
        // counter this drill exists to trip.
        Origin: APP,
        /**
         * A different source address per attempt.
         *
         * A first version sent all thirty from one address and only ten
         * landed: the per-IP mutation budget throttled the rest, so the
         * counter never reached the threshold and the drill concluded the
         * alert was broken when the limiter was simply doing its job.
         *
         * Real credential stuffing is distributed — that is why it is worth
         * alerting on rather than just rate limiting. Modelling it from one
         * address tests the limiter, not the alert.
         *
         * Requires the server to run with TRUSTED_PROXY_HOPS=1.
         */
        "X-Forwarded-For": `203.0.113.${(i % 200) + 1}`,
      },
      body: JSON.stringify({
        email: `nobody-${i}@alert-drill.invalid`,
        password: "definitely-not-the-password",
      }),
    }).catch(() => {});
  }

  // ------------------------------------------------------------------ 3
  const fired = await fetch(`${APP}/api/internal/alerts/check`, {
    method: "POST",
    headers: { "x-alert-secret": SECRET },
  });
  const firedBody = await fired.json().catch(() => ({}));

  check(
    "the evaluation detects the spike",
    Array.isArray(firedBody.firings) && firedBody.firings.length > 0,
    `${firedBody.firings?.length ?? 0} firing(s): ${(firedBody.firings ?? []).map((f) => f.id).join(", ") || "none"}`
  );

  // ------------------------------------------------------------------ 4
  // Dispatch is a network call; give it a moment to arrive.
  for (let i = 0; i < 40 && delivered.length === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
  }

  check(
    "the alert ARRIVED at the receiver",
    delivered.length > 0,
    delivered.length ? `${delivered.length} delivery/deliveries` : "nothing arrived in 10s"
  );

  if (delivered.length > 0) {
    const payload = delivered[0];
    check("the payload is JSON a receiver can parse", payload.body !== null);

    const text = payload.raw.toLowerCase();
    check(
      "it names the rule that fired",
      text.includes("auth") || text.includes("authentication"),
      (payload.body?.text || payload.body?.title || payload.raw).toString().slice(0, 100)
    );
    check(
      "it carries enough detail to act on, not just a rule id",
      payload.raw.length > 80,
      `${payload.raw.length} bytes`
    );
  }

  // ------------------------------------------------------------------ 5
  /**
   * The cooldown. Without one, a sustained condition pages every time cron
   * runs — every fifteen minutes, all night — and the first thing anyone does
   * is mute the channel.
   */
  delivered.length = 0;
  const immediate = await fetch(`${APP}/api/internal/alerts/check`, {
    method: "POST",
    headers: { "x-alert-secret": SECRET },
  });
  const immediateBody = await immediate.json().catch(() => ({}));
  check(
    "a second evaluation does not re-page for the same condition (cooldown)",
    (immediateBody.firings?.length ?? 0) === 0,
    `${immediateBody.firings?.length ?? 0} firing(s)`
  );
} catch (err) {
  console.error(`\n[alert-drill] error: ${err?.message || err}`);
  fail += 1;
} finally {
  receiver.close();
}

console.log(`\n[alert-drill] ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
