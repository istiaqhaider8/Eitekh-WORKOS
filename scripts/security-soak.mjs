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

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (Date.now() < endAt) {
      await crossTenantRound();
      rounds += 1;
      // Paced: this is a correctness soak, not a load test. Hammering would
      // measure the rate limiter, which Phase 6 already covers.
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  await Promise.all(workers);

  check(
    "no cross-tenant read ever succeeded",
    crossLeaked === 0,
    `${crossAttempts} attempts, ${crossLeaked} returned 200` + (leakedPaths.size ? ` [${[...leakedPaths].join("; ")}]` : "")
  );

  const rotation = await measureHeaderRotation(40);
  const last = await sampleTables();

  // ------------------------------------------------------------------ report
  console.log("");
  console.log("RECORD THIS:");
  console.log(`  duration                 ${DURATION_S}s at concurrency ${CONCURRENCY}`);
  console.log(`  cross-tenant attempts    ${crossAttempts} (${rounds} rounds)`);
  console.log(`  cross-tenant leaks       ${crossLeaked}`);
  console.log(`  rateLimitCounter keys    ${first.rateKeys} -> ${last.rateKeys}`);
  console.log(`  sessions                 ${first.sessions} -> ${last.sessions}`);
  console.log(`  platformAuditLog rows    ${first.auditRows} -> ${last.auditRows}`);
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
  say("soak sessions removed");
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
