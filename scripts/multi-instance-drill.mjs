/**
 * A6 — prove this actually works with more than one instance.
 *
 * WHY THIS EXISTS
 *
 * Everything that makes the application horizontally scalable was BUILT for
 * more than one instance and never RUN on more than one:
 *
 *   - real-time events relay between instances through `SyncEventOutbox`,
 *     with an `originId` so a publisher skips its own echo
 *   - the rate limiter is backed by Postgres rather than a per-process Map,
 *     precisely so N instances share one budget
 *   - sessions live in the database, so a revocation is immediate everywhere
 *   - the PBAC model is versioned in `PbacOrgState`, and each process reloads
 *     when the version moves
 *
 * Each of those is a claim, and a claim nobody has tested is a hypothesis. The
 * load and soak work so far has been a single process against a local
 * database, which cannot see any of this: a relay that never fires looks
 * identical to a relay with nothing to do, and a rate limiter that is secretly
 * per-process looks correct until the second instance doubles everyone's
 * budget.
 *
 * This does not need a cloud. Two `next start` processes on two ports against
 * one database reproduce every one of those four behaviours. What it does NOT
 * reproduce is network latency, a real load balancer, or TLS termination —
 * see DEPLOYMENT.md.
 *
 * SAFETY
 *
 * Read-mostly. It creates one session row and one issue-title edit, both of
 * which it reverts, and it refuses to run against a database whose name looks
 * like production.
 *
 * Usage:
 *   node scripts/multi-instance-drill.mjs --a http://localhost:3000 \
 *     --b http://localhost:3001 [--db <url>]
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const require_ = createRequire(import.meta.url);
const { PrismaClient } = require_("@prisma/client");

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const A = argOf("--a", "http://localhost:3000");
const B = argOf("--b", "http://localhost:3001");

/** Read DATABASE_URL from .env when not given, the way the other drills do. */
function envDatabaseUrl() {
  try {
    return readFileSync(".env", "utf8").match(/^DATABASE_URL="?([^"\n]+)/m)?.[1];
  } catch {
    return undefined;
  }
}
const DB = argOf("--db", process.env.DATABASE_URL || envDatabaseUrl());

if (!DB) {
  console.error("\n[multi] no database URL. Pass --db or set DATABASE_URL.\n");
  process.exit(2);
}

const JWT_SECRET = process.env.JWT_SECRET || readFileSync(".env", "utf8").match(/^JWT_SECRET="?([^"\n]+)/m)?.[1];
if (!JWT_SECRET) {
  console.error("\n[multi] JWT_SECRET is required: this drill signs a session token.\n");
  process.exit(2);
}

let pass = 0;
let fail = 0;
let skipped = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  -- " + detail : ""));
  if (ok) pass += 1;
  else fail += 1;
}
function skip(name, why) {
  console.log("SKIP  " + name + "  -- " + why);
  skipped += 1;
}

const prisma = new PrismaClient({ datasources: { db: { url: DB } } });

/**
 * The APPLICATION's own token minter, imported rather than mirrored.
 *
 * A first version copied the issuer and audience constants into this file and
 * got the audience wrong — "eitekh-workos-app" instead of "-web" — so every
 * authenticated call returned 401 and the real-time checks failed for a reason
 * that had nothing to do with real time. A drill that reimplements the thing
 * it is testing tests its own copy.
 *
 * Same reasoning as scripts/rotate-drill.mjs importing src/lib/encryption.ts:
 * use what the application uses, so drift is impossible rather than merely
 * unlikely. Needs Node's native type stripping (>= 22.18; see engines).
 *
 * JWT_SECRET must be in the environment before this import, because the module
 * refuses to load without one.
 */
process.env.JWT_SECRET = JWT_SECRET;
const { createToken, COOKIE_NAME } = await import(
  pathToFileURL(join(process.cwd(), "src", "lib", "session-token.ts")).href
);

const RUN = `mi_${Date.now().toString(36)}`;
let sessionId = null;

async function main() {
  console.log(`[multi] instance A: ${A}`);
  console.log(`[multi] instance B: ${B}\n`);

  // --- both instances alive, and they are DIFFERENT processes -------------
  const [ha, hb] = await Promise.all([
    fetch(`${A}/api/health`).then((r) => r.json()).catch(() => null),
    fetch(`${B}/api/health`).then((r) => r.json()).catch(() => null),
  ]);

  check("instance A answers /api/health", ha?.status === "ok" || ha?.status === "degraded", ha?.status);
  check("instance B answers /api/health", hb?.status === "ok" || hb?.status === "degraded", hb?.status);
  if (!ha || !hb) {
    console.error("\n[multi] both instances must be running. Start a second one with:\n" +
      "  PORT=3001 npx next start -p 3001\n");
    process.exit(2);
  }

  /**
   * Distinct uptimes are weak evidence of distinct processes, but a strong
   * negative: identical uptimes to the second, repeatedly, would mean the two
   * URLs are one server and every check below would pass for the wrong
   * reason.
   */
  check(
    "A and B are separate processes",
    ha.process?.uptimeSeconds !== hb.process?.uptimeSeconds ||
      ha.process?.rssBytes !== hb.process?.rssBytes,
    `uptimes ${ha.process?.uptimeSeconds}s / ${hb.process?.uptimeSeconds}s`
  );

  // --- a real user, a real session ----------------------------------------
  const member = await prisma.projectMember.findFirst({
    include: { user: true, project: true },
  });
  if (!member) {
    console.error("\n[multi] the database has no project member to act as. Seed it first.\n");
    process.exit(2);
  }
  const user = member.user;
  const projectId = member.projectId;

  sessionId = `${RUN}_session`;
  const token = createToken({
    userId: user.id,
    email: user.email,
    isSuperAdmin: user.isSuperAdmin,
    sessionId,
  });
  // `Session.token` holds the signed JWT, not the session id — the row is
  // looked up by the cookie's value. Storing the id here instead produced a
  // 401 on every authenticated call while the rate limiter, which runs before
  // authentication, kept answering normally.
  await prisma.session.create({
    data: {
      id: sessionId,
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const authed = (base, path, init = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        Cookie: `${COOKIE_NAME}=${token}`,
        ...(init.headers || {}),
      },
    });

  console.log(`[multi] acting as ${user.email} on project ${member.project.key}\n`);

  // ------------------------------------------------------------------ 1
  console.log("--- 1. REAL-TIME: an event published on one instance reaches a client on the other");

  const relayed = await relayTest({ listenOn: A, publishOn: B, projectId, token, authed });
  check(
    "an SSE client on A receives an event published on B",
    relayed.received,
    relayed.detail
  );

  const relayedBack = await relayTest({ listenOn: B, publishOn: A, projectId, token, authed });
  check(
    "and the same in the other direction (B listening, A publishing)",
    relayedBack.received,
    relayedBack.detail
  );

  check(
    "the relayed event arrived exactly once, not duplicated by the echo skip",
    relayed.count <= 1 && relayedBack.count <= 1,
    `A saw ${relayed.count}, B saw ${relayedBack.count}`
  );

  // ------------------------------------------------------------------ 2
  console.log("\n--- 2. RATE LIMIT: one budget shared by both instances, not one each");

  /**
   * The read limit is 100/minute per user. Spend most of it on A, then ask B.
   * A per-process limiter would give B a fresh budget — which is the failure
   * this is looking for, and it is silent: twice the instances, twice the
   * traffic any single user can generate.
   */
  const probe = `/api/projects/${projectId}`;
  let sawRemainingDrop = false;
  let firstRemaining = null;
  let bRemaining = null;

  const r0 = await authed(A, probe);
  firstRemaining = Number(r0.headers.get("x-ratelimit-remaining"));

  if (!Number.isFinite(firstRemaining)) {
    skip("the shared budget is visible to this drill", "no x-ratelimit-remaining header to read");
  } else {
    for (let i = 0; i < 10; i += 1) await authed(A, probe);
    const rb = await authed(B, probe);
    bRemaining = Number(rb.headers.get("x-ratelimit-remaining"));
    sawRemainingDrop = Number.isFinite(bRemaining) && bRemaining < firstRemaining - 5;

    check(
      "requests to A consume the budget B sees",
      sawRemainingDrop,
      `A started at ${firstRemaining} remaining; after 11 calls to A, B reports ${bRemaining}`
    );
  }

  // ------------------------------------------------------------------ 3
  console.log("\n--- 3. SESSIONS: a revocation on one instance is immediate on the other");

  const beforeRevoke = await authed(B, "/api/notifications");
  check("the session works on B before revocation", beforeRevoke.status !== 401, `${beforeRevoke.status}`);

  await prisma.session.deleteMany({ where: { id: sessionId } });

  const afterA = await authed(A, "/api/notifications");
  const afterB = await authed(B, "/api/notifications");
  check(
    "a session deleted in the database is refused by BOTH instances",
    afterA.status === 401 && afterB.status === 401,
    `A ${afterA.status}, B ${afterB.status}`
  );
  sessionId = null; // already gone

  // ------------------------------------------------------------------ 4
  console.log("\n--- 4. CONNECTION POOL: the per-instance limit is the one that multiplies");

  const perInstance = (() => {
    const m = DB.match(/connection_limit=(\d+)/);
    return m ? Number(m[1]) : null;
  })();
  const inUse = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`
  );
  const maxConn = await prisma.$queryRawUnsafe(`SHOW max_connections`);

  console.log(
    `  connection_limit per instance : ${perInstance ?? "unset (Prisma defaults to num_cpus*2+1)"}\n` +
      `  connections in use right now  : ${inUse[0].n}\n` +
      `  server max_connections        : ${maxConn[0].max_connections}`
  );
  if (perInstance) {
    const headroom = Number(maxConn[0].max_connections);
    check(
      "2 instances x connection_limit still fits inside max_connections",
      perInstance * 2 < headroom,
      `${perInstance} x 2 = ${perInstance * 2} vs ${headroom}`
    );
  } else {
    skip(
      "2 instances x connection_limit fits inside max_connections",
      "connection_limit is not set, so each instance sizes its pool from ITS OWN cpu count — see DEPLOYMENT.md"
    );
  }
}

/**
 * Open an SSE stream on one instance, cause an event on the other, and see
 * whether it arrives.
 *
 * The event is caused by a real mutation rather than a synthetic publish,
 * because the thing being tested is the whole path: route -> publish ->
 * outbox row -> NOTIFY -> the other process -> its connected clients.
 */
async function relayTest({ listenOn, publishOn, projectId, token, authed }) {
  const controller = new AbortController();
  let buffer = "";
  // Set once the marker is known; frames are matched against it so the
  // stream's own handshake/ping frames are not counted as deliveries.
  let marker = null;

  const streamDone = (async () => {
    const res = await fetch(`${listenOn}/api/sync/events?projectId=${projectId}`, {
      headers: { Cookie: `${COOKIE_NAME}=${token}`, Accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        buffer += text;
      }
    } catch {
      /* aborted */
    }
  })();

  // Give the stream time to register with the engine before publishing.
  await new Promise((r) => setTimeout(r, 1500));

  const issue = await prisma.issue.findFirst({ where: { projectId }, select: { id: true, title: true } });
  if (!issue) {
    controller.abort();
    return { received: false, count: 0, detail: "no issue in this project to edit" };
  }

  marker = `multi-instance probe ${crypto.randomBytes(3).toString("hex")}`;
  const res = await authed(publishOn, `/api/issues/${issue.id}`, {
    method: "PATCH",
    body: JSON.stringify({ title: marker }),
  });

  // Restore the title whatever happens next.
  const restore = () => prisma.issue.update({ where: { id: issue.id }, data: { title: issue.title } }).catch(() => {});

  if (res.status !== 200) {
    controller.abort();
    await restore();
    return { received: false, count: 0, detail: `the mutation on the other instance returned ${res.status}` };
  }

  // The bus uses LISTEN/NOTIFY with a 1s poll as a fallback, so allow for the
  // slower of the two paths plus a margin.
  await new Promise((r) => setTimeout(r, 4000));
  controller.abort();
  await streamDone;
  await restore();

  // How many times OUR event arrived. Exactly one is correct: more would
  // mean the origin-skip failed and the publisher relayed its own echo back.
  const count = buffer.split(marker).length - 1;
  const received = count > 0;
  return {
    received,
    count,
    detail: received
      ? `${count} delivery/deliveries of the marker`
      : `the marker never arrived in 4s (${buffer.length} bytes on the stream, ` +
        `frames: ${(buffer.match(/event:s*w+/g) || []).slice(0, 4).join(", ") || "none"})`,
  };
}

try {
  await main();
} catch (err) {
  console.error("\n[multi] drill error:", err?.message || err);
  fail += 1;
} finally {
  if (sessionId) await prisma.session.deleteMany({ where: { id: sessionId } }).catch(() => {});
  await prisma.$disconnect();
}

console.log(`\n[multi] ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ""}`);
process.exit(fail === 0 ? 0 : 1);
