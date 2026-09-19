/**
 * A2 — load and soak testing.
 *
 * WHY A HARNESS RATHER THAN k6
 *
 * k6 is a Go binary and Artillery is a heavy dependency; neither is installed
 * here and neither can be verified offline. This is ~250 lines of Node that
 * runs today, drives real HTTP against a real build, and reports the
 * percentiles the alert thresholds need.
 *
 * It is NOT a replacement for k6 at high request rates — one Node process
 * becomes the bottleneck well before a real load generator would, and the
 * numbers below the knee are trustworthy while the numbers at it are not.
 * Treat the p95s as a floor on latency, not a ceiling on capacity, and re-run
 * with a real generator before promising anyone a number.
 *
 * WHAT IT MEASURES
 *
 * The four journeys that matter, against the 20k-issue volume dataset:
 *   board load, issue open, issue update, search.
 *
 * Every performance decision in this codebase so far was made one request at a
 * time. This is the first thing that runs them concurrently, which is where
 * connection-pool sizing, the rate limiter's per-request round-trip and the
 * PBAC version poll actually get tested.
 *
 * Usage:
 *   node scripts/loadtest.mjs --url http://localhost:3162 \
 *     --db "postgresql://..." [--concurrency 10] [--duration 60] [--soak]
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { PrismaClient } = require_("@prisma/client");
const jwt = require_("jsonwebtoken");

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const BASE = argOf("--url", "http://localhost:3162");
const DB = argOf("--db", process.env.DATABASE_URL);
const CONCURRENCY = Number(argOf("--concurrency", 10));
const DURATION_S = Number(argOf("--duration", 30));
const SOAK = argv.includes("--soak");
/**
 * Delay between a worker's requests, in ms.
 *
 * This is not a knob for tuning results — it is the difference between
 * measuring the application and measuring the rate limiter. Authenticated
 * traffic is limited PER USER (100 reads and 30 mutations a minute), and each
 * worker is one user. With no think time, five workers produced 455 req/s and
 * a 7% success ratio: 93% of the run was 429s, and the latency numbers
 * described refusals rather than work.
 *
 * Real load is many users each doing a little, not a few users hammering. So
 * capacity here is modelled by raising the number of users, not the rate per
 * user, and a think time of 1000ms keeps each worker inside its own budget.
 */
const THINK_MS = Number(argOf("--think", 1000));

/**
 * How many real SSE streams to hold open, and how often to churn them.
 *
 * WHY THIS EXISTS
 *
 * The sampler below has always recorded `realtime.openConnections` from
 * /api/health, and the report has always printed "sse connections 0 -> 0".
 * That looked like a clean result. It was not a result at all: nothing in this
 * script ever opened an SSE connection, so the number could only be zero.
 * A soak whose headline leak metric is structurally incapable of moving is
 * worse than no soak, because it is quoted as evidence.
 *
 * With --sse N, N workers hold a real /api/sync/events stream, and every
 * --sse-churn seconds a slice of them disconnect and reconnect. That exercises
 * register/unregister under load, which is where a registry leak shows up as
 * openConnections drifting upward across the run.
 *
 * What it still cannot reproduce locally is a HALF-OPEN connection — a client
 * that vanishes without the socket closing. That is the case the stale-client
 * eviction in sync-engine.ts exists for, and simulating it needs network-level
 * interference rather than a client that simply calls abort(). It is covered
 * by unit tests instead (src/lib/__tests__/sync-engine-stale.test.ts).
 */
const SSE_CLIENTS = Number(argOf("--sse", 0));
const SSE_CHURN_S = Number(argOf("--sse-churn", 30));

if (!DB) {
  console.error("Pass --db with the volume database URL.");
  process.exit(2);
}

const prisma = new PrismaClient({ datasources: { db: { url: DB } } });

const secret = (readFileSync(".env", "utf8").match(/^JWT_SECRET=\s*"?([^"\r\n]+)"?/m) || [])[1];
if (!secret) {
  console.error("JWT_SECRET not found in .env");
  process.exit(2);
}

/** Percentiles from a sorted copy. */
function stats(samples) {
  if (samples.length === 0) return null;
  const s = [...samples].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return {
    n: s.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: s[s.length - 1],
  };
}

console.log(`[load] target ${BASE}`);
console.log(`[load] ${CONCURRENCY} concurrent workers for ${DURATION_S}s${SOAK ? " (soak)" : ""}\n`);

// ---------------------------------------------------------------------------
// Fixture: real sessions for real seeded users.
//
// Each worker gets its OWN user. That is not cosmetic: the rate limiter keys
// authenticated traffic per user, so sharing one identity across ten workers
// would measure the limiter refusing us rather than the application serving us.
// ---------------------------------------------------------------------------
const members = await prisma.projectMember.findMany({
  take: CONCURRENCY,
  distinct: ["userId"],
  include: { user: { select: { id: true, email: true } }, project: { select: { id: true } } },
});

if (members.length < CONCURRENCY) {
  console.error(`Only ${members.length} project members in the dataset; need ${CONCURRENCY}.`);
  process.exit(2);
}

const stamp = Date.now().toString(36);
const sessions = [];
for (let i = 0; i < members.length; i += 1) {
  const m = members[i];
  const sessionId = `load_${stamp}_${i}`;
  const token = jwt.sign(
    { userId: m.user.id, email: m.user.email, isSuperAdmin: false, sessionId },
    secret,
    { expiresIn: "2h", algorithm: "HS256", issuer: "eitekh-workos", audience: "eitekh-workos-web" }
  );
  await prisma.session.create({
    data: { id: sessionId, userId: m.user.id, token, expiresAt: new Date(Date.now() + 2 * 3600_000) },
  });
  // A distinct source address per worker. Generating all the load from one
  // host makes 40 users look like ONE client to the per-IP backstop (600
  // reads/min), which fired on 40% of a run and made the latencies describe
  // refusals. In production those users arrive from 40 addresses; this models
  // that. Anyone re-running from several hosts can drop it.
  sessions.push({
    token,
    sessionId,
    projectId: m.project.id,
    userId: m.user.id,
    ip: `10.${40 + Math.floor(i / 250)}.${Math.floor(i / 250) % 250}.${(i % 250) + 1}`,
  });
}

// A pool of issues to open and update, drawn from the projects the workers can
// actually see.
// Per project, so every worker has issues to open. A single capped query
// across all projects left most workers with none: 319 of 438 "issue open"
// samples were a no-op returning status 0, which the report then counted as
// real work.
const byProject = new Map();
for (const pid of new Set(sessions.map((s) => s.projectId))) {
  const rows = await prisma.issue.findMany({
    where: { projectId: pid },
    select: { id: true },
    take: 50,
  });
  byProject.set(pid, rows.map((r) => r.id));
}
const withoutIssues = [...byProject.entries()].filter(([, v]) => v.length === 0);
if (withoutIssues.length) {
  console.log(`[load] WARNING: ${withoutIssues.length} project(s) have no issues; those workers will skip that journey`);
}

const JOURNEYS = {
  "board load": async (s, pick) => {
    const r = await fetch(`${BASE}/api/projects/${s.projectId}/issues?page=1&limit=50`, {
      headers: { Cookie: `eitekh_session_token=${s.token}`, "x-forwarded-for": s.ip },
    });
    await r.arrayBuffer();
    return r.status;
  },
  "issue open": async (s, pick) => {
    const id = pick(s.projectId);
    if (!id) return 0;
    const r = await fetch(`${BASE}/api/issues/${id}`, {
      headers: { Cookie: `eitekh_session_token=${s.token}`, "x-forwarded-for": s.ip },
    });
    await r.arrayBuffer();
    return r.status;
  },
  "issue update": async (s, pick) => {
    const id = pick(s.projectId);
    if (!id) return 0;
    const r = await fetch(`${BASE}/api/issues/${id}`, {
      method: "PATCH",
      headers: {
        Cookie: `eitekh_session_token=${s.token}`,
        Origin: BASE,
        "x-forwarded-for": s.ip,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ description: `load test ${Date.now()}` }),
    });
    await r.arrayBuffer();
    return r.status;
  },
  search: async (s) => {
    const r = await fetch(`${BASE}/api/search?q=issue`, {
      headers: { Cookie: `eitekh_session_token=${s.token}`, "x-forwarded-for": s.ip },
    });
    await r.arrayBuffer();
    return r.status;
  },
};

const results = {};
for (const name of Object.keys(JOURNEYS)) {
  results[name] = { samples: [], statuses: new Map(), errors: 0 };
}

const record = (name, ms, status) => {
  const r = results[name];
  r.samples.push(ms);
  r.statuses.set(status, (r.statuses.get(status) ?? 0) + 1);
};

let stop = false;
const names = Object.keys(JOURNEYS);
let cursor = 0;

const pickIssue = (projectId) => {
  const list = byProject.get(projectId);
  if (!list || list.length === 0) return null;
  // Deterministic rotation rather than random, so a re-run is comparable.
  cursor = (cursor + 1) % list.length;
  return list[cursor];
};

async function worker(session, index) {
  let i = index;
  while (!stop) {
    const name = names[i % names.length];
    i += 1;
    const t0 = process.hrtime.bigint();
    try {
      const status = await JOURNEYS[name](session, pickIssue);
      // status 0 means the journey had nothing to act on. Recording it would
      // report a 0ms sample as if it were a fast request.
      if (status !== 0) record(name, Number(process.hrtime.bigint() - t0) / 1e6, status);
    } catch (err) {
      results[name].errors += 1;
    }
    if (THINK_MS > 0) await new Promise((r) => setTimeout(r, THINK_MS));
  }
}

// Memory and connection sampling, for the soak.
const samples = [];
const sampler = setInterval(async () => {
  try {
    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`
    );
    const res = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
    samples.push({
      at: new Date().toISOString(),
      dbConnections: n,
      dbLatencyMs: res?.db?.latencyMs ?? null,
      sse: res?.realtime?.openConnections ?? null,
      rss: process.memoryUsage().rss,
    });
  } catch { /* a sampling failure must not end the run */ }
}, 5000);

/**
 * Hold `SSE_CLIENTS` real event streams open, recycling a slice of them every
 * SSE_CHURN_S seconds. Each connection is a genuine authenticated request to
 * /api/sync/events, so the server registers and unregisters a client exactly
 * as it does for a browser.
 */
const sseOpen = new Map(); // index -> AbortController
let sseOpened = 0;
let sseClosed = 0;
let sseFailed = 0;

function openSseClient(i) {
  const s = sessions[i % sessions.length];
  const ac = new AbortController();
  sseOpen.set(i, ac);
  sseOpened += 1;

  fetch(`${BASE}/api/sync/events?projectId=${encodeURIComponent(s.projectId)}`, {
    headers: {
      Cookie: `eitekh_session_token=${s.token}`,
      "x-forwarded-for": s.ip,
      Accept: "text/event-stream",
    },
    signal: ac.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        sseFailed += 1;
        return;
      }
      // Actually consume the stream. A reader that never reads would create
      // backpressure and be indistinguishable from a dead client — which is a
      // different scenario from the one being measured here.
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch {
        /* aborted, which is the normal way these end */
      }
    })
    .catch(() => {
      if (!ac.signal.aborted) sseFailed += 1;
    });
}

function closeSseClient(i) {
  const ac = sseOpen.get(i);
  if (!ac) return;
  ac.abort();
  sseOpen.delete(i);
  sseClosed += 1;
}

let sseChurnTimer = null;
if (SSE_CLIENTS > 0) {
  for (let i = 0; i < SSE_CLIENTS; i += 1) openSseClient(i);
  console.log(`[load] holding ${SSE_CLIENTS} SSE stream(s), recycling a quarter every ${SSE_CHURN_S}s`);

  let cursor = 0;
  sseChurnTimer = setInterval(() => {
    const slice = Math.max(1, Math.floor(SSE_CLIENTS / 4));
    for (let k = 0; k < slice; k += 1) {
      const i = (cursor + k) % SSE_CLIENTS;
      closeSseClient(i);
      openSseClient(i);
    }
    cursor = (cursor + slice) % SSE_CLIENTS;
  }, SSE_CHURN_S * 1000);
}

const started = Date.now();
const workers = sessions.map((s, i) => worker(s, i));
await new Promise((r) => setTimeout(r, DURATION_S * 1000));
stop = true;
await Promise.all(workers);
clearInterval(sampler);

if (sseChurnTimer) clearInterval(sseChurnTimer);
for (const i of [...sseOpen.keys()]) closeSseClient(i);
const elapsed = (Date.now() - started) / 1000;

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
let total = 0;
console.log("journey          n     p50      p95      p99      max     statuses");
console.log("─".repeat(78));
for (const [name, r] of Object.entries(results)) {
  const s = stats(r.samples);
  if (!s) continue;
  total += s.n;
  const codes = [...r.statuses.entries()].map(([c, n]) => `${c}×${n}`).join(" ");
  console.log(
    `${name.padEnd(15)} ${String(s.n).padStart(5)} ` +
      `${s.p50.toFixed(0).padStart(6)}ms ${s.p95.toFixed(0).padStart(6)}ms ` +
      `${s.p99.toFixed(0).padStart(6)}ms ${s.max.toFixed(0).padStart(6)}ms   ${codes}` +
      (r.errors ? `  ERRORS:${r.errors}` : "")
  );
}

console.log("─".repeat(78));
console.log(`${total} requests in ${elapsed.toFixed(1)}s = ${(total / elapsed).toFixed(1)} req/s at concurrency ${CONCURRENCY}\n`);

if (samples.length > 1) {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const maxConn = Math.max(...samples.map((s) => s.dbConnections));
  console.log("resource drift over the run:");
  console.log(`  db connections   ${first.dbConnections} -> ${last.dbConnections} (peak ${maxConn})`);
  console.log(`  db latency       ${first.dbLatencyMs}ms -> ${last.dbLatencyMs}ms`);
  const maxSse = Math.max(...samples.map((s) => s.sse ?? 0));
  console.log(
    `  sse connections  ${first.sse} -> ${last.sse} (peak ${maxSse})` +
      (SSE_CLIENTS === 0
        ? "   << no SSE opened: pass --sse N or this number means nothing"
        : `   [${SSE_CLIENTS} held, ${sseOpened} opened, ${sseClosed} recycled, ${sseFailed} failed]`)
  );

  // The leak signal. With churn, opens and closes balance, so a registry that
  // releases clients correctly ends the run near where it started. Drift here
  // is the whole reason the soak exists.
  if (SSE_CLIENTS > 0) {
    const drift = (last.sse ?? 0) - SSE_CLIENTS;
    console.log(
      `  sse drift        ${drift >= 0 ? "+" : ""}${drift} vs the ${SSE_CLIENTS} expected to be held` +
        (Math.abs(drift) > Math.max(2, SSE_CLIENTS * 0.1)
          ? "   << LEAK SUSPECTED: connections are not being released"
          : "")
    );
  }
  console.log(
    `  harness rss      ${(first.rss / 1048576).toFixed(0)}MB -> ${(last.rss / 1048576).toFixed(0)}MB`
  );
  console.log("\n  (rss is THIS process, not the server — it only shows whether the harness leaked)");
}

// A run where everything 429s or 500s measured nothing.
const allStatuses = new Map();
for (const r of Object.values(results)) {
  for (const [c, n] of r.statuses) allStatuses.set(c, (allStatuses.get(c) ?? 0) + n);
}
const ok = [...allStatuses.entries()].filter(([c]) => c >= 200 && c < 300).reduce((a, [, n]) => a + n, 0);
const ratio = total ? ok / total : 0;
console.log(`\nsuccess ratio: ${(ratio * 100).toFixed(1)}%`);
if (ratio < 0.95) {
  console.log("WARNING: under 95% success. These latency numbers describe failures, not work.");
}

await prisma.session.deleteMany({ where: { id: { startsWith: `load_${stamp}_` } } });
console.log("(load-test sessions removed)");
await prisma.$disconnect();
process.exit(ratio < 0.95 ? 1 : 0);
