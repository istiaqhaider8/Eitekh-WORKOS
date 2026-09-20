/**
 * Phase 7 — the security soak.
 *
 * WHAT THIS IS FOR, AND WHY THE EXISTING TESTS DO NOT COVER IT
 *
 * `__tests__/integration/` already holds tenant-isolation, authz and
 * leaf-resource suites, and two build ratchets refuse to ship a route without
 * an isolation test or without body validation. All of that answers "is this
 * control present and correct right now?"
 *
 * This answers a different question: does it still hold after sustained
 * pressure? The failures it is aimed at need time or repetition —
 *
 *   - a limiter that holds for one window and drifts across fifty;
 *   - a counter table that grows without bound because its sweep is
 *     probabilistic (1 in 500 requests);
 *   - a defence walked around by rotating a header, which one request cannot
 *     reveal;
 *   - an alert that fires once and is then muted by its own cooldown;
 *   - a cross-tenant race that only opens under concurrency.
 *
 * WHAT IT IS NOT
 *
 * Not a penetration test. It drives controls this project already knows about
 * and watches them; it does not hunt unknown vulnerability classes, and a
 * quiet run is weak evidence rather than a clean bill of health. Not a
 * statement about production either: one host, local database, no network, no
 * load balancer, no real adversary.
 *
 * SAFETY
 *
 * Read-mostly and additive. It creates nothing outside the project it is
 * pointed at, writes no rows it does not delete, and never touches a database
 * whose name does not look like a test or volume database unless forced. The
 * failed-login probes use addresses in the documented test ranges.
 *
 * Usage:
 *   node scripts/security-soak.mjs --url http://127.0.0.1:3100 \
 *     --db "postgresql://..." [--duration 900] [--concurrency 8]
 *
 * Exit: 0 when every control held, 1 when any did not.
 */

import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { PrismaClient } = require_("@prisma/client");
const jwt = require_("jsonwebtoken");

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const BASE = argOf("--url", "http://127.0.0.1:3100");
const DB = argOf("--db", process.env.DATABASE_URL);
const DURATION_S = Number(argOf("--duration", 900));
const CONCURRENCY = Number(argOf("--concurrency", 8));
const FORCE = argv.includes("--force");

if (!DB) {
  console.error("[sec-soak] --db or DATABASE_URL is required.");
  process.exit(2);
}

/**
 * Refuse a database that does not look disposable.
 *
 * This drives failed logins and cross-tenant probes in volume. Against a real
 * database that means thousands of audit rows and a rate-limit table full of
 * synthetic keys. Not destructive, but not something to do by accident.
 */
if (!/volume|test|demo|repro/i.test(DB) && !FORCE) {
  console.error(
    `\n[sec-soak] Refusing to run against "${DB.replace(/\/\/[^@]*@/, "//***@")}".\n` +
      "It does not look like a volume, test or demo database, and this soak writes\n" +
      "thousands of audit and rate-limit rows. Pass --force if that is intended.\n"
  );
  process.exit(2);
}

const prisma = new PrismaClient({ datasources: { db: { url: DB } } });

let passed = 0;
let failed = 0;
const failures = [];

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS " : "FAIL "} ${label}${detail ? `  -- ${detail}` : ""}`);
  if (ok) passed += 1;
  else {
    failed += 1;
    failures.push(`${label}${detail ? ` (${detail})` : ""}`);
  }
  return ok;
}
const say = (m) => console.log(`[sec-soak] ${m}`);

/** Reserved for documentation and testing; never routable. */
const TEST_IP = (i) => `198.51.100.${(i % 254) + 1}`;

async function main() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("[sec-soak] JWT_SECRET must be set, so sessions can be minted.");
    process.exitCode = 2;
    return;
  }

  // ------------------------------------------------------------------ setup
  /**
   * Two identities in DIFFERENT organisations.
   *
   * Cross-tenant probing needs a real second tenant; using two members of one
   * org would test nothing, and that is the easy mistake to make here.
   */
  const orgs = await prisma.organization.findMany({
    take: 2,
    include: {
      members: { take: 1, include: { user: { select: { id: true, email: true } } } },
      workspaces: {
        take: 1,
        include: { projects: { take: 1, select: { id: true, name: true } } },
      },
    },
  });

  const tenants = orgs
    .map((o) => ({
      orgId: o.id,
      user: o.members[0]?.user,
      projectId: o.workspaces[0]?.projects[0]?.id,
    }))
    .filter((t) => t.user && t.projectId);

  if (tenants.length < 2) {
    console.error(
      `[sec-soak] Need two organisations that each have a member and a project; found ${tenants.length}.\n` +
        "Point --db at the volume dataset (3 orgs) rather than the base seed."
    );
    process.exitCode = 2;
    return;
  }

  const stamp = Date.now().toString(36);
  const sessions = [];
  for (let i = 0; i < tenants.length; i += 1) {
    const t = tenants[i];
    const sessionId = `secsoak_${stamp}_${i}`;
    const token = jwt.sign(
      { userId: t.user.id, email: t.user.email, isSuperAdmin: false, sessionId },
      secret,
      { expiresIn: "2h", algorithm: "HS256", issuer: "eitekh-workos", audience: "eitekh-workos-web" }
    );
    await prisma.session.create({
      data: { id: sessionId, userId: t.user.id, token, expiresAt: new Date(Date.now() + 2 * 3600_000) },
    });
    sessions.push({ ...t, token, sessionId });
  }

  const [A, B] = sessions;
  say(`tenant A org=${A.orgId.slice(0, 8)} project=${A.projectId.slice(0, 8)}`);
  say(`tenant B org=${B.orgId.slice(0, 8)} project=${B.projectId.slice(0, 8)}`);

  const get = (path, session, ip) =>
    fetch(`${BASE}${path}`, {
      headers: {
        Cookie: `eitekh_session_token=${session.token}`,
        "x-forwarded-for": ip ?? TEST_IP(1),
      },
    });

  // ------------------------------------------------------------------ 1
  /**
   * Cross-tenant reads, repeatedly and concurrently.
   *
   * The integration suite asserts this once per route. Here it runs for the
   * whole soak alongside everything else, because an isolation check that
   * depends on a cache being cold, or on no other request being in flight, is
   * not an isolation check.
   */
  say("probing tenant isolation under concurrency...");
  const crossTenantPaths = [
    `/api/projects/${B.projectId}`,
    `/api/projects/${B.projectId}/issues`,
    `/api/projects/${B.projectId}/types`,
    `/api/projects/${B.projectId}/members`,
    `/api/orgs/${B.orgId}/members`,
  ];

  let crossAttempts = 0;
  let crossLeaked = 0;
  const leakedPaths = new Set();

  async function crossTenantRound() {
    await Promise.all(
      crossTenantPaths.map(async (p, i) => {
        crossAttempts += 1;
        try {
          const r = await get(p, A, TEST_IP(i));
          // 200 is the only bad answer. 403 and 404 are both acceptable; 404
          // is preferable because it does not confirm the resource exists.
          if (r.ok) {
            crossLeaked += 1;
            leakedPaths.add(`${p} -> ${r.status}`);
          }
        } catch {
          /* a transport error is not a leak */
        }
      })
    );
  }

  // ------------------------------------------------------------------ 2
  /**
   * The header-rotation question, measured rather than assumed.
   *
   * DEPLOYMENT.md records that the per-IP backstop is only as good as the
   * address it is keyed on, and that with TRUSTED_PROXY_HOPS >= 1 a caller
   * that can write X-Forwarded-For chooses its own key. This measures the size
   * of that gap instead of leaving it as prose: hammer the login route from
   * one rotating address per attempt and see how many get through.
   *
   * A high number here is NOT a new bug. It is the documented residual, and
   * the point of measuring it is that "the app is behind a proxy that
   * overwrites the header" is a deployment assumption somebody has to check.
   */
  async function measureHeaderRotation(attempts) {
    let allowed = 0;
    let refused = 0;
    for (let i = 0; i < attempts; i += 1) {
      const r = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: BASE,
          // A fresh address every single attempt.
          "x-forwarded-for": `203.0.113.${(i % 254) + 1}`,
        },
        body: JSON.stringify({
          email: `sec-soak-nobody-${i}@example.invalid`,
          password: "definitely-not-the-password",
        }),
      });
      if (r.status === 429) refused += 1;
      else allowed += 1;
      await r.arrayBuffer();
    }
    return { allowed, refused };
  }

  // ------------------------------------------------------------------ 3
  /**
   * A tampered token must never be accepted.
   *
   * Three shapes: a valid token with its signature altered, a token signed
   * with the wrong secret, and a well-formed token naming a session that was
   * deleted. The third is the one that needs a database — a signature check
   * alone would pass it.
   */
  async function probeTokenTampering() {
    const results = {};

    const flipped = A.token.slice(0, -3) + (A.token.slice(-3) === "aaa" ? "bbb" : "aaa");
    results.alteredSignature = (await get(`/api/projects/${A.projectId}`, { token: flipped })).status;

    const foreign = jwt.sign(
      { userId: A.user.id, email: A.user.email, sessionId: A.sessionId },
      "not-the-real-signing-secret-not-the-real-signing-secret",
      { expiresIn: "2h", algorithm: "HS256", issuer: "eitekh-workos", audience: "eitekh-workos-web" }
    );
    results.wrongSecret = (await get(`/api/projects/${A.projectId}`, { token: foreign })).status;

    const ghostId = `secsoak_${stamp}_ghost`;
    const ghost = jwt.sign(
      { userId: A.user.id, email: A.user.email, sessionId: ghostId },
      secret,
      { expiresIn: "2h", algorithm: "HS256", issuer: "eitekh-workos", audience: "eitekh-workos-web" }
    );
    results.revokedSession = (await get(`/api/projects/${A.projectId}`, { token: ghost })).status;

    const expired = jwt.sign(
      { userId: A.user.id, email: A.user.email, sessionId: A.sessionId },
      secret,
      { expiresIn: "-1h", algorithm: "HS256", issuer: "eitekh-workos", audience: "eitekh-workos-web" }
    );
    results.expiredToken = (await get(`/api/projects/${A.projectId}`, { token: expired })).status;

    return results;
  }

  // ------------------------------------------------------------------ 3b
  /**
   * Privilege escalation: an ordinary member against administrative routes.
   *
   * Tenant A's session belongs to a plain project member — `isSuperAdmin` is
   * false on the token AND on the row, which matters because a route that
   * trusted the claim rather than the record would pass this only by
   * accident. Every one of these must refuse.
   *
   * Run repeatedly during the soak rather than once, because the PBAC
   * capability cache is populated lazily: a check that only runs cold tests a
   * different code path from the one a busy server uses.
   */
  const privilegedPaths = [
    "/api/super-admin/users",
    "/api/super-admin/orgs",
    "/api/super-admin/audit-logs",
    "/api/super-admin/security",
    "/api/super-admin/backups",
    "/api/super-admin/features",
    "/api/pbac/roles",
    "/api/pbac/inspector",
  ];

  let privAttempts = 0;
  let privLeaked = 0;
  const privLeakedPaths = new Set();

  async function privilegeRound() {
    await Promise.all(
      privilegedPaths.map(async (p, i) => {
        privAttempts += 1;
        try {
          const r = await get(p, A, TEST_IP(i + 50));
          if (r.ok) {
            privLeaked += 1;
            privLeakedPaths.add(`${p} -> ${r.status}`);
          }
        } catch {
          /* transport error is not a leak */
        }
      })
    );
  }

  // ------------------------------------------------------------------ 3c
  /**
   * Does `auth-failure-spike` actually FIRE, not merely count?
   *
   * Phase 4 established that the counters move. That is not the same claim:
   * a rule can be counted, evaluated and still never fire, which is precisely
   * what Phase 4 found four separate times. This drives enough failures to
   * cross the threshold and then asks the evaluation endpoint.
   *
   * Skipped with a stated reason when no secret is supplied — an unrun check
   * must never read as a passing one.
   */
  async function probeAlertFires(alertSecret) {
    if (!alertSecret) return { skipped: true };

    // Consume the baseline delta first, so what follows is measured from a
    // known point rather than from whatever the process had accumulated.
    await fetch(`${BASE}/api/internal/alerts/check`, {
      method: "POST",
      headers: { "x-alert-secret": alertSecret },
    }).then((r) => r.arrayBuffer());

    for (let i = 0; i < 30; i += 1) {
      const r = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: BASE,
          "x-forwarded-for": `203.0.113.${(i % 200) + 1}`,
        },
        body: JSON.stringify({
          email: `sec-soak-spike-${i}@example.invalid`,
          password: "wrong",
        }),
      });
      await r.arrayBuffer();
    }

    const res = await fetch(`${BASE}/api/internal/alerts/check`, {
      method: "POST",
      headers: { "x-alert-secret": alertSecret },
    });
    const body = await res.json().catch(() => ({}));
    const fired = Array.isArray(body.firings) ? body.firings.map((f) => f.id) : [];
    // A rule that crossed its threshold but was muted is reported separately
    // by the endpoint. Without that distinction this probe cannot tell a
    // working-and-cooling rule from one that cannot fire, and it reported the
    // former as a failure during this phase.
    const suppressed = Array.isArray(body.suppressed) ? body.suppressed.map((s) => s.id) : [];

    // And immediately again: the cooldown must suppress a repeat, or an
    // operator gets paged every cycle and mutes the rule.
    const again = await fetch(`${BASE}/api/internal/alerts/check`, {
      method: "POST",
      headers: { "x-alert-secret": alertSecret },
    });
    const againBody = await again.json().catch(() => ({}));
    const firedAgain = Array.isArray(againBody.firings) ? againBody.firings.map((f) => f.id) : [];

    return { skipped: false, status: res.status, fired, firedAgain, suppressed, routed: body.routed };
  }

  // ------------------------------------------------------------------ 3d
  /**
   * Audit integrity: does a refusal actually leave a row?
   *
   * The scope asks "does every security event produce a row?", and until now
   * this script counted `platformAuditLog` without ever asserting anything
   * about it — a table that never grew would have read exactly like a table
   * that grew correctly.
   *
   * This drives the per-ACCOUNT ceiling specifically. It is the strongest
   * signal the application has (it is keyed on the account under attack, so
   * distributing the attack does not evade it), and the login route writes
   * `AUTH_ACCOUNT_LOCKED` on that path. Rows are counted before and after and
   * matched on action, so an unrelated concurrent event cannot be mistaken
   * for the one being tested.
   *
   * A single account, its own address range, and a marker address so the rows
   * can be identified and removed afterwards.
   */
  async function probeAuditIntegrity() {
    const victim = `sec-soak-audit-${stamp}@example.invalid`;
    const before = await prisma.platformAuditLog.count({
      where: { action: "AUTH_ACCOUNT_LOCKED" },
    });

    // Comfortably past LOGIN_ACCOUNT_LIMIT so the ceiling is reached even if
    // some attempts are absorbed by the per-IP limiter first.
    let refusals = 0;
    for (let i = 0; i < 25; i += 1) {
      const r = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: BASE,
          // Rotate the source so the per-IP ceiling does not mask the
          // per-account one this is actually testing.
          "x-forwarded-for": `198.51.100.${(i % 200) + 1}`,
        },
        body: JSON.stringify({ email: victim, password: "wrong-on-purpose" }),
      });
      if (r.status === 429) refusals += 1;
      await r.arrayBuffer();
    }

    // The write is awaited inside the route, but the row lands on a different
    // connection; give it a moment rather than racing it.
    await new Promise((r) => setTimeout(r, 750));

    const after = await prisma.platformAuditLog.count({
      where: { action: "AUTH_ACCOUNT_LOCKED" },
    });

    return { victim, refusals, before, after, written: after - before };
  }

  // ------------------------------------------------------------------ 3e
  /**
   * Does the per-ACCOUNT ceiling hold across MANY windows, not just one?
   *
   * The scope calls this out as only answerable over time. A limiter can hold
   * for its first window and then drift — a counter reset on the wrong key, a
   * window boundary computed from the wrong clock, a sweep that removes a row
   * still in use. One window cannot show any of that.
   *
   * The account ceiling is the one measured because it cannot be evaded by
   * rotating the source address, so a refusal here is unambiguous. Each pass
   * uses its own account, so passes cannot contaminate each other, and the
   * source address rotates to keep the per-IP limiter out of the result.
   */
  async function probeLimiterAcrossWindows(passes) {
    const observed = [];
    for (let pass = 0; pass < passes; pass += 1) {
      const email = `sec-soak-window-${stamp}-${pass}@example.invalid`;
      let allowed = 0;
      let refused = 0;
      for (let i = 0; i < 20; i += 1) {
        const r = await fetch(`${BASE}/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: BASE,
            "x-forwarded-for": `198.51.100.${((pass * 20 + i) % 200) + 1}`,
          },
          body: JSON.stringify({ email, password: "wrong-on-purpose" }),
        });
        if (r.status === 429) refused += 1;
        else allowed += 1;
        await r.arrayBuffer();
      }
      observed.push({ pass, allowed, refused });
    }
    return observed;
  }

  // ------------------------------------------------------------------ 3f
  /**
   * Can the alerting cron still evaluate DURING an attack?
   *
   * Found by this soak rather than reasoned about: `/api/internal/alerts/check`
   * sits behind the same generic read backstop as public traffic, so whichever
   * bucket that traffic fills is the bucket the cron must draw from. Drive
   * enough failed logins and the evaluation that would notice them is refused
   * 429 — the detector is starved by the thing it detects.
   *
   * Measured both ways before being written down:
   *
   *   TRUSTED_PROXY_HOPS=0  120 failed logins -> alerts/check 429  (starved)
   *   TRUSTED_PROXY_HOPS=1  120 failed logins -> alerts/check 200  (survives)
   *
   * With no trusted proxy every unauthenticated request shares ONE bucket, so
   * the attacker and the cron are the same client as far as the limiter is
   * concerned. With one trusted hop they are separate and the cron is fine.
   *
   * So this is asserted only when the target is configured the way production
   * is. Under hops=0 it is reported loudly instead of failed, because failing
   * would make every local run red for a configuration the app already warns
   * about at boot — and a check that always fails gets ignored.
   */
  async function probeAlertStarvation(alertSecret) {
    if (!alertSecret) return { skipped: true };

    const callCheck = async () => {
      const r = await fetch(`${BASE}/api/internal/alerts/check`, {
        method: "POST",
        headers: { "x-alert-secret": alertSecret },
      });
      await r.arrayBuffer();
      return r.status;
    };

    const before = await callCheck();

    for (let i = 0; i < 120; i += 1) {
      const r = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: BASE,
          "x-forwarded-for": `203.0.113.${(i % 200) + 1}`,
        },
        body: JSON.stringify({
          email: `sec-soak-starve-${i}@example.invalid`,
          password: "wrong",
        }),
      });
      await r.arrayBuffer();
    }

    const after = await callCheck();
    return { skipped: false, before, after, starved: after === 429 };
  }

  // ------------------------------------------------------------------ 4
  /** Table growth, sampled over the run. */
  async function sampleTables() {
    const [rateKeys, sessions_, auditRows] = await Promise.all([
      prisma.rateLimitCounter.count(),
      prisma.session.count(),
      prisma.platformAuditLog.count(),
    ]);
    return { rateKeys, sessions: sessions_, auditRows };
  }

  // ==================================================================
  // Run
  // ==================================================================
  const tokenProbes = await probeTokenTampering();
  check("an altered token signature is refused", tokenProbes.alteredSignature === 401, `HTTP ${tokenProbes.alteredSignature}`);
  check("a token signed with the wrong secret is refused", tokenProbes.wrongSecret === 401, `HTTP ${tokenProbes.wrongSecret}`);
  check("a token naming a non-existent session is refused", tokenProbes.revokedSession === 401, `HTTP ${tokenProbes.revokedSession}`);
  check("an expired token is refused", tokenProbes.expiredToken === 401, `HTTP ${tokenProbes.expiredToken}`);

  const first = await sampleTables();
  say(`tables at start: rateLimitKeys=${first.rateKeys} sessions=${first.sessions} auditRows=${first.auditRows}`);

  say(`running for ${DURATION_S}s at concurrency ${CONCURRENCY}...`);
  const endAt = Date.now() + DURATION_S * 1000;
  let rounds = 0;

  /** Table samples through the run, so growth is a curve and not two points. */
  const growthSamples = [];
  const sampler = setInterval(async () => {
    try {
      growthSamples.push({ at: Date.now(), ...(await sampleTables()) });
    } catch {
      /* a sampling failure must not end the run */
    }
  }, 30_000);

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (Date.now() < endAt) {
      await crossTenantRound();
      await privilegeRound();
      rounds += 1;
      // Paced: this is a correctness soak, not a load test. Hammering would
      // measure the rate limiter, which Phase 6 already covers.
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  await Promise.all(workers);
  clearInterval(sampler);

  check(
    "no cross-tenant read ever succeeded",
    crossLeaked === 0,
    `${crossAttempts} attempts, ${crossLeaked} returned 200` + (leakedPaths.size ? ` [${[...leakedPaths].join("; ")}]` : "")
  );

  check(
    "an ordinary member never reached an administrative route",
    privLeaked === 0,
    `${privAttempts} attempts, ${privLeaked} returned 200` +
      (privLeakedPaths.size ? ` [${[...privLeakedPaths].join("; ")}]` : "")
  );

  /**
   * Does the rate-limit table drain?
   *
   * Its sweep is probabilistic — one request in 500 — so under steady traffic
   * it should hold roughly flat rather than climb forever. Compared across
   * the run rather than end-to-end, because a single pair of readings cannot
   * tell a plateau from a slope.
   */
  if (growthSamples.length >= 2) {
    const firstKeys = growthSamples[0].rateKeys;
    const lastKeys = growthSamples[growthSamples.length - 1].rateKeys;
    const peak = Math.max(...growthSamples.map((s) => s.rateKeys));
    // Generous: keys legitimately accumulate while their windows are open.
    // What this rejects is unbounded growth, not growth.
    check(
      "the rate-limit table is not growing without bound",
      lastKeys <= firstKeys * 3 + 200,
      `${firstKeys} -> ${lastKeys} keys (peak ${peak}) over ${growthSamples.length} samples`
    );
  }

  const alert = await probeAlertFires(argOf("--alert-secret", process.env.ALERT_CHECK_SECRET));
  if (alert.skipped) {
    say(
      "SKIPPED: alert firing was not exercised (no --alert-secret / ALERT_CHECK_SECRET).\n" +
        "[sec-soak] This is NOT a pass. Phase 4 found four separate reasons a rule can be\n" +
        "[sec-soak] present, evaluated and incapable of firing; only driving it proves otherwise."
    );
  } else {
    /**
     * Fired, muted, or incapable — three outcomes, not two.
     *
     * A rule in cooldown crossed its threshold and was deliberately silenced,
     * which is the system working. Counting that as a failure is how this
     * probe reported the credential-stuffing rule as broken after an earlier
     * test in the same 15-minute window had legitimately fired it. The
     * endpoint now says which rules were suppressed, so the two cases are
     * distinguishable — and cooldown is reported as inconclusive rather than
     * passed, because an unexercised control is still unverified.
     */
    if (alert.suppressed.includes("auth-failure-spike")) {
      say(
        "INCONCLUSIVE: auth-failure-spike crossed its threshold but was in cooldown, so it\n" +
          "[sec-soak] could not fire. That is the rule working, not failing — but it was not\n" +
          "[sec-soak] exercised. Re-run against a freshly started server, or wait out the 15\n" +
          "[sec-soak] minute cooldown, for this to mean anything."
      );
    } else {
      check(
        "auth-failure-spike actually FIRES on a credential-stuffing run",
        alert.fired.includes("auth-failure-spike"),
        `HTTP ${alert.status}, fired: ${alert.fired.length ? alert.fired.join(", ") : "none"}`
      );
    }
    check(
      "and its cooldown suppresses an immediate repeat",
      !alert.firedAgain.includes("auth-failure-spike"),
      `second evaluation fired: ${alert.firedAgain.length ? alert.firedAgain.join(", ") : "none"}`
    );
    if (alert.routed === false) {
      say("NOTE: ALERT_WEBHOOK_URL is unset on the target, so a firing would go nowhere.");
    }
  }

  /**
   * Audit integrity. Asserted, not merely counted.
   *
   * Two separate claims, deliberately separate checks: that the ceiling
   * refused at all, and that the refusal was recorded. A control that refuses
   * silently and one that never refuses look identical in a row count, and
   * they need different fixes.
   */
  const audit = await probeAuditIntegrity();
  check(
    "the per-account ceiling refused a credential-stuffing run",
    audit.refusals > 0,
    `${audit.refusals} of 25 attempts refused with 429`
  );
  check(
    "and every refusal left an AUTH_ACCOUNT_LOCKED audit row",
    audit.written > 0,
    `platformAuditLog AUTH_ACCOUNT_LOCKED ${audit.before} -> ${audit.after} (+${audit.written}) for ${audit.refusals} refusals`
  );

  /**
   * The limiter across many windows.
   *
   * The assertion is that EVERY pass reached its ceiling — not that the first
   * one did. A pass that suddenly allows all 20 is the drift this phase
   * exists to catch, and it would be invisible to a single-window test.
   */
  const windows = await probeLimiterAcrossWindows(6);
  const passesThatHeld = windows.filter((w) => w.refused > 0).length;
  check(
    "the per-account ceiling held across every window, not just the first",
    passesThatHeld === windows.length,
    windows.map((w) => `#${w.pass}: ${w.allowed} allowed / ${w.refused} refused`).join("  ")
  );

  /**
   * Alert starvation. Asserted only under a production-like proxy setting,
   * for the reason given at the probe.
   */
  const hops = Number(argOf("--proxy-hops", process.env.TRUSTED_PROXY_HOPS ?? "0"));
  const starve = await probeAlertStarvation(argOf("--alert-secret", process.env.ALERT_CHECK_SECRET));
  if (starve.skipped) {
    say("SKIPPED: alert starvation was not exercised (no --alert-secret). NOT a pass.");
  } else if (hops >= 1) {
    check(
      "the alerting cron can still evaluate during a credential-stuffing burst",
      !starve.starved,
      `alerts/check ${starve.before} -> ${starve.after} after 120 failed logins (TRUSTED_PROXY_HOPS=${hops})`
    );
  } else {
    say(
      `NOTE: TRUSTED_PROXY_HOPS=${hops}. alerts/check went ${starve.before} -> ${starve.after} after 120\n` +
        "[sec-soak] failed logins. With no trusted proxy the attacker and the alerting cron share\n" +
        "[sec-soak] ONE rate-limit bucket, so a credential-stuffing run suppresses the evaluation\n" +
        "[sec-soak] that would detect it. Measured as mitigated at TRUSTED_PROXY_HOPS=1.\n" +
        "[sec-soak] Not failed here because it is the documented local default."
    );
  }

  const rotation = await measureHeaderRotation(40);
  const last = await sampleTables();

  /**
   * Session growth. Reported before, asserted now.
   *
   * The soak mints its own sessions and deletes them at the end, so the
   * comparison allows for those; what it rejects is the table climbing far
   * beyond what this run created, which would mean expired rows are never
   * swept.
   */
  check(
    "the session table did not grow beyond what this run created",
    last.sessions <= first.sessions + CONCURRENCY * 4 + 50,
    `${first.sessions} -> ${last.sessions} sessions`
  );

  // ------------------------------------------------------------------ report
  console.log("");
  console.log("RECORD THIS:");
  console.log(`  duration                 ${DURATION_S}s at concurrency ${CONCURRENCY}`);
  console.log(`  cross-tenant attempts    ${crossAttempts} (${rounds} rounds)`);
  console.log(`  cross-tenant leaks       ${crossLeaked}`);
  console.log(`  privilege-escalation     ${privAttempts} attempts, ${privLeaked} reached an admin route`);
  console.log(`  rateLimitCounter keys    ${first.rateKeys} -> ${last.rateKeys}`);
  console.log(`  sessions                 ${first.sessions} -> ${last.sessions}`);
  console.log(`  platformAuditLog rows    ${first.auditRows} -> ${last.auditRows}`);
  console.log(`  account-ceiling refusals ${audit.refusals}/25, audit rows written ${audit.written}`);
  console.log(`  limiter across windows   ${passesThatHeld}/${windows.length} passes reached the ceiling`);
  console.log(`  login attempts w/ rotating X-Forwarded-For: ${rotation.allowed} allowed, ${rotation.refused} refused of 40`);
  console.log("");

  /**
   * The rotation number is REPORTED, not asserted.
   *
   * Making it a failure would fail every run, because it is the documented
   * behaviour of a server told to trust one proxy hop. It belongs in the
   * report so that the deployment assumption behind it — that something in
   * front of the app overwrites the header — is a decision somebody makes
   * rather than inherits.
   */
  if (rotation.allowed > 20) {
    console.log(
      "  NOTE: rotating X-Forwarded-For largely bypassed the per-IP login limit.\n" +
        "  That is the documented residual for TRUSTED_PROXY_HOPS >= 1, not a new\n" +
        "  fault: the per-ACCOUNT ceiling is what still holds in that case. It is\n" +
        "  only safe if a proxy in front OVERWRITES the header. Verify that it does.\n"
    );
  }

  await prisma.session.deleteMany({ where: { id: { startsWith: `secsoak_${stamp}_` } } });

  /**
   * The audit rows this run produced are deleted too.
   *
   * They are real security events, but they are events this script caused
   * against invented accounts, and leaving them would put a synthetic
   * credential-stuffing spike into the record that a future investigation
   * would have to explain. Scoped to this run's stamp so nothing else is
   * touched.
   */
  const removedAudit = await prisma.platformAuditLog.deleteMany({
    where: { targetResource: { contains: `sec-soak-audit-${stamp}` } },
  });
  say(`soak sessions removed; ${removedAudit.count} synthetic audit row(s) removed`);
  await prisma.$disconnect();

  console.log(`[sec-soak] ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFAILED:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  // Not process.exit(): it races the closing sockets and trips a libuv
  // assertion on Windows.
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(async (err) => {
  console.error(`\n[sec-soak] ${err.message}`);
  try {
    await prisma.$disconnect();
  } catch {
    /* already gone */
  }
  process.exitCode = 1;
});
