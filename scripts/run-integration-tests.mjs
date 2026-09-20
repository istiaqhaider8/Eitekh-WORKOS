/**
 * PROD-5 / PROD-6 — runner for the integration suite.
 *
 * Brings up everything the tests need and tears it down again:
 *
 *   1. Refuses to run unless INTEGRATION_DATABASE_URL names a database with
 *      "test" in it. The suite deletes rows; pointing it at the development
 *      database once would be worse than having no isolation tests.
 *   2. Applies migrations with `migrate deploy`, so the tests run against the
 *      same migration history production does (the PROD-0 lesson).
 *   3. Builds if needed and starts a production server on its own port.
 *   4. Runs jest, then stops the server and reports jest's exit code.
 *
 * Usage:
 *   INTEGRATION_DATABASE_URL=postgresql://... node scripts/run-integration-tests.mjs
 */

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, openSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ghError } from "./gh-annotate.mjs";
import { productionEnvFor } from "./local-production-env.mjs";

/** Resolve Next's CLI entry so the server can be spawned without a shell. */
function require_resolve_next() {
  const req = createRequire(import.meta.url);
  // next/dist/bin/next is the executable the `next` bin shim invokes.
  return req.resolve("next/dist/bin/next");
}

const PORT = Number(process.env.INTEGRATION_PORT || 3141);
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Every way this script gives up, annotated.
 *
 * The jest-failure path was annotated first and it was the wrong half: the CI
 * run that prompted it never reached jest, so the step failed with exit code 1
 * and no annotation at all — exactly the silence being fixed, in the one place
 * the fix had not been applied. The runner refuses for several reasons of its
 * own (no database URL, no JWT secret, migrations failed, the server never
 * came up), and each of those is a message worth reading.
 */
function fail(msg) {
  console.error(`\n[integration] ${msg}\n`);
  ghError("Integration tests", msg);
  process.exit(1);
}

const dbUrl = process.env.INTEGRATION_DATABASE_URL;
if (!dbUrl) {
  fail(
    "INTEGRATION_DATABASE_URL is not set.\n" +
      "These tests create and delete data, so they must never run against the development\n" +
      "database. Point this at a scratch database whose name contains \"test\"."
  );
}
const dbName = dbUrl.split("/").pop().split("?")[0];
if (!/test/i.test(dbName)) {
  fail(
    `Refusing to run against database "${dbName}": its name does not contain "test".\n` +
      "This suite deletes rows."
  );
}

/**
 * A configuration that satisfies the production boot guard ON ITS OWN.
 *
 * It did not, and the failure was invisible on a developer's machine for the
 * worst possible reason: the guard passed locally because the developer's
 * `.env` happened to supply what the runner did not. In CI, where the ambient
 * values are deliberate placeholders, `src/instrumentation.ts` refused to
 * start and the server never came up:
 *
 *     Refusing to start: 3 invalid production configuration setting(s)
 *       - JWT_SECRET still contains a development/CI placeholder value
 *       - FIELD_ENCRYPTION_KEY is the all-zeros CI placeholder
 *       - BASE_URL uses a reserved placeholder domain that cannot resolve
 *
 * The guard is right about all three. The bug was that this runner inherited
 * them and hoped.
 *
 * The `||` fallbacks were the specific mistake: they only fire when a variable
 * is UNSET, and CI sets all of these — to exactly the values the guard
 * rejects. A test harness that is correct only when the surrounding
 * environment is already correct is not a harness.
 */
/**
 * The boot guard's requirements, answered in scripts/local-production-env.mjs
 * rather than here. This harness was the first of five broken by a new guard;
 * the shared module is what stops the sixth.
 */
const { env: baseEnv, notes } = productionEnvFor("integration", {
  DATABASE_URL: dbUrl,
  INTEGRATION_BASE_URL: BASE_URL,
  BASE_URL: process.env.INTEGRATION_PUBLIC_URL || "https://integration.eitekh.test",
});
for (const n of notes) console.log(`[integration] ${n}`);
const env = baseEnv;

// Now guaranteed by construction above; kept as a tripwire in case the
// derivation is ever changed back into something that can yield nothing.
if (!env.JWT_SECRET || !env.FIELD_ENCRYPTION_KEY) {
  fail("JWT_SECRET and FIELD_ENCRYPTION_KEY must both be set: the fixture signs tokens with one and the server boots with the other.");
}

console.log(`[integration] database: ${dbName}`);

console.log("[integration] applying migrations...");
const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  env,
  stdio: "inherit",
  shell: true,
});
if (migrate.status !== 0) fail("prisma migrate deploy failed");

/**
 * Rebuild when the build is MISSING **or** OLDER THAN THE SOURCE.
 *
 * This used to check only `existsSync(".next/BUILD_ID")`, and the difference
 * cost a diagnosis. Increment 3 of the Activate work added three route files
 * and 24 tests; every one of them came back 404 while the other 13 suites
 * passed, because the runner happily served the build from the previous
 * increment. Nothing was wrong with the routes — they did not exist in the
 * bundle being tested.
 *
 * The 404 direction is the embarrassing one, because it is loud. The
 * dangerous direction is the opposite: delete an authorization guard, run the
 * suite against a build that still contains it, and every isolation test
 * passes while the guard is gone from the source. A test suite that can
 * report on code that is not the code in front of you is worse than no suite,
 * and "no build found" was never the same question as "is this build current".
 *
 * Deliberately a timestamp comparison and not a content hash. It is cheap, it
 * has no cache to invalidate, and its failure mode is an unnecessary rebuild
 * rather than a stale one.
 */
const BUILD_INPUTS = ["src", "prisma/schema.prisma", "next.config.mjs", "package.json"];

function newestMtime(path) {
  let newest = 0;
  const visit = (p) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return; // an optional input that is not present
    }
    if (st.isDirectory()) {
      for (const entry of readdirSync(p)) visit(join(p, entry));
      return;
    }
    if (st.mtimeMs > newest) newest = st.mtimeMs;
  };
  visit(path);
  return newest;
}

function buildIsStale() {
  if (!existsSync(".next/BUILD_ID")) return "no build found";
  const builtAt = statSync(".next/BUILD_ID").mtimeMs;
  for (const input of BUILD_INPUTS) {
    if (newestMtime(input) > builtAt) return `${input} is newer than the build`;
  }
  return null;
}

const staleReason = buildIsStale();
if (staleReason) {
  console.log(`[integration] ${staleReason}; building...`);
  const build = spawnSync("npm", ["run", "build"], { env, stdio: "inherit", shell: true });
  if (build.status !== 0) fail("build failed");
} else {
  console.log("[integration] build is current; reusing it");
}

// Refuse to start if something already holds the port.
//
// Otherwise the server fails with EADDRINUSE, the tests run against WHATEVER
// is already listening — quite possibly an older build — and report results
// that describe code nobody is looking at. That is worse than not running.
async function portIsBusy() {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.status > 0;
  } catch {
    return false;
  }
}

if (await portIsBusy()) {
  fail(
    `Something is already listening on ${BASE_URL}.\n` +
      "Refusing to run: the tests would exercise that process instead of a fresh build.\n" +
      "Stop it first (a previous interrupted run may have left one behind)."
  );
}

/**
 * Start the server the way THIS build is meant to be started.
 *
 * next.config.mjs sets `output: "standalone"`, and every build here printed
 *
 *   ⚠ "next start" does not work with "output: standalone" configuration.
 *     Use "node .next/standalone/server.js" instead.
 *
 * The runner used `next start` anyway. It appeared to work — the suite passed
 * for months — so the warning got read as noise. It is not noise: it says the
 * tests were exercising a server started in a way Next does not support, which
 * makes every result from this harness weaker than it looked, and makes
 * unexplained behaviour under load impossible to attribute.
 *
 * A standalone build expects its static assets beside it; `next build` does
 * not copy them, which is the one manual step the deployment docs call out. So
 * they are copied here before boot, otherwise every page request 404s on its
 * own JS and the failure looks like the app rather than the harness.
 */
const STANDALONE = join(".next", "standalone", "server.js");
const useStandalone = existsSync(STANDALONE);

if (useStandalone) {
  cpSync(join(".next", "static"), join(".next", "standalone", ".next", "static"), {
    recursive: true,
  });
  if (existsSync("public")) {
    cpSync("public", join(".next", "standalone", "public"), { recursive: true });
  }
}

/**
 * THE SERVER'S OUTPUT GOES TO A FILE, NOT TO A PIPE.
 *
 * This line is the whole of a bug that took an afternoon to find, and the
 * mechanism is worth stating because it will look like an application fault
 * every time it recurs.
 *
 * The server used to be spawned with `stdio: ["ignore", "pipe", "pipe"]`, and
 * this process drained those pipes with `server.stdout.on("data", …)`. Draining
 * needs the event loop. Jest is launched below with `spawnSync`, which BLOCKS
 * the event loop for the entire test run — so those handlers never ran once a
 * single test had started. The OS pipe buffer filled, and the server's next
 * `console.log` blocked on a write nobody would ever consume.
 *
 * The result looked nothing like a logging problem. The server stopped
 * answering every request, including /api/health; CPU sat flat at 22.59s over
 * 25 seconds with threads, handles and memory frozen; the database was idle
 * with no blocked queries; and there was no error output at all — because the
 * process was blocked INSIDE a logging call. Whichever suites happened to run
 * after the buffer filled failed with 30-second timeouts, a different set each
 * run, which is what made it look like a flaky test rather than a wedged
 * process. The suite that logs most (Activate gates: a security warning per
 * denial, plus event dispatch and audit writes) was blamed for months of
 * behaviour it merely triggered sooner.
 *
 * A file descriptor removes the Node event loop from the path entirely: the
 * kernel writes, and nothing in userspace has to be awake for it. That is
 * strictly better than the old arrangement even ignoring the hang — the full
 * log is now on disk instead of truncated in memory, so the server's account
 * of a failing run survives it.
 */
const SERVER_LOG_PATH = join(tmpdir(), `eitekh-integration-server-${process.pid}.log`);
const serverLogFd = openSync(SERVER_LOG_PATH, "w");

console.log(
  `[integration] starting server on ${BASE_URL} ` +
    `(${useStandalone ? "standalone server.js" : "next start"}); ` +
    `server log: ${SERVER_LOG_PATH}`
);
// `shell: false` and `detached` so the whole process group can be signalled.
// With `shell: true` the shell is the child and `next start` is a grandchild,
// so killing the child orphans the server — which is exactly how a previous
// interrupted run left port 3141 held and broke the next one.
const server = spawn(
  process.execPath,
  useStandalone ? [STANDALONE] : [require_resolve_next(), "start", "-p", String(PORT)],
  {
    // The standalone server takes its port from the environment rather than
    // from a flag.
    env: { ...env, PORT: String(PORT), HOSTNAME: "127.0.0.1" },
    // A FILE DESCRIPTOR, NOT A PIPE. See SERVER_LOG_PATH above.
    stdio: ["ignore", serverLogFd, serverLogFd],
    detached: process.platform !== "win32",
  }
);
/**
 * The server's output, read back from the file on demand.
 *
 * Previously this was a string accumulated by `server.stdout.on("data", …)`.
 * Reading it here instead of accumulating it is the whole point: nothing about
 * the server's logging now depends on this process being responsive.
 */
function readServerLog() {
  try {
    return readFileSync(SERVER_LOG_PATH, "utf8");
  } catch {
    return "";
  }
}

let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try {
    if (process.platform === "win32") {
      // Windows has no process groups; taskkill /T takes the tree.
      spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-server.pid, "SIGTERM");
    }
  } catch { /* already gone */ }
};

process.on("exit", stop);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    stop();
    process.exit(130);
  });
}
// An uncaught error must not leak the server either.
process.on("uncaughtException", (e) => {
  stop();
  console.error(e);
  process.exit(1);
});

/**
 * The lines of the server's log that say something.
 *
 * A readiness timeout reports the runner's view — "it never answered" — while
 * the reason is always in the server's own output: a config guard refusing to
 * boot, a migration that did not apply, a port already in use. On CI that log
 * is unreadable without admin rights, so the useful part travels in the
 * annotation instead.
 */
function serverTail(max = 6) {
  const lines = readServerLog()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && /error|fatal|refus|invalid|must|cannot|fail|listen|EADDR/i.test(l));
  const unique = [...new Set(lines)];
  return unique.slice(-max).join(" | ") || "(nothing on stdout or stderr)";
}

async function waitForReady(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      console.error(readServerLog().slice(-3000));
      fail(
        `server exited with code ${server.exitCode} before becoming ready. ` +
          `Server said: ${serverTail()}`
      );
    }
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.status === 200) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(readServerLog().slice(-3000));
  fail(`server did not become ready in time. Server said: ${serverTail()}`);
}

await waitForReady();
console.log("[integration] server ready; running tests\n");

/**
 * Captured rather than inherited, so a failure can be turned into annotations.
 *
 * On a public repository the Actions job log needs admin rights to read, so a
 * failing suite here says only "exit code 1" to everyone else — the same
 * silence that made the two drill failures take a push each to diagnose. The
 * full output is still printed, unchanged, for anyone who can see the log.
 */
const jest = spawnSync(
  "npx",
  ["jest", "--config", "jest.integration.config.js", ...process.argv.slice(2)],
  { env, encoding: "utf8", maxBuffer: 1 << 28, shell: true }
);

const jestOutput = `${jest.stdout ?? ""}${jest.stderr ?? ""}`;
process.stdout.write(jestOutput);

stop();

if (jest.status !== 0) {
  console.error(
    `\n[integration] FAILED. Server log (${SERVER_LOG_PATH}), last 2000 chars:\n` +
      readServerLog().slice(-2000)
  );

  /**
   * Jest prefixes each failing test with "●". The line after it is usually
   * the assertion, which is the part worth carrying out of the log.
   */
  const lines = jestOutput.split(/\r?\n/);
  const failures = [];
  for (let i = 0; i < lines.length && failures.length < 10; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith("●")) continue;
    if (/Console|deprecat/i.test(line)) continue;
    const detail = lines
      .slice(i + 1, i + 6)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("●"))
      .slice(0, 3)
      .join(" / ");
    failures.push(`${line.replace(/^●\s*/, "")}${detail ? " -- " + detail : ""}`);
  }

  for (const f of failures) ghError("Integration tests", f);

  if (failures.length === 0) {
    // A crash rather than an assertion: no ● lines at all. The tail of the
    // output is then the only thing that says anything.
    ghError("Integration tests", `no individual failures parsed; output tail: ${jestOutput.slice(-1200)}`);
  }

  // The server's own log, which is where a 500 explains itself. Jest only
  // reports the status code it received.
  const serverErrors = readServerLog()
    .split(/\r?\n/)
    .filter((l) => /error|unhandled|prisma|invalid/i.test(l))
    .slice(-6)
    .join(" | ");
  if (serverErrors) ghError("Integration tests (server log)", serverErrors);
}
process.exit(jest.status ?? 1);
