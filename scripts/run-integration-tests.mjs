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
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { ghError } from "./gh-annotate.mjs";

/** Resolve Next's CLI entry so the server can be spawned without a shell. */
function require_resolve_next() {
  const req = createRequire(import.meta.url);
  // next/dist/bin/next is the executable the `next` bin shim invokes.
  return req.resolve("next/dist/bin/next");
}

const PORT = Number(process.env.INTEGRATION_PORT || 3141);
const BASE_URL = `http://localhost:${PORT}`;

function fail(msg) {
  console.error(`\n[integration] ${msg}\n`);
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

// The server needs a configuration that satisfies the production boot guard.
// These are test values and exist only for the life of this process.
const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: dbUrl,
  INTEGRATION_BASE_URL: BASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  FIELD_ENCRYPTION_KEY:
    process.env.FIELD_ENCRYPTION_KEY ||
    "1".repeat(64), // not the all-zeros CI placeholder, which the guard rejects
  BASE_URL: process.env.INTEGRATION_PUBLIC_URL || "https://integration.eitekh.test",
  SMTP_HOST: process.env.SMTP_HOST || "smtp.integration.test",
  SMTP_PASS: process.env.SMTP_PASS || "integration",
  // H5. POST /api/recurring-tasks/trigger refuses with 503 when this is unset,
  // so the suite could not tell "correctly locked" from "misconfigured". A
  // fixed test value lets it prove the interesting case: that a valid SESSION
  // is not accepted here, which is the hole this replaced.
  RECURRING_TASKS_SECRET: "integration-recurring-secret",
};

if (!env.JWT_SECRET) {
  fail("JWT_SECRET must be set: the fixture signs session tokens with it.");
}

console.log(`[integration] database: ${dbName}`);

console.log("[integration] applying migrations...");
const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  env,
  stdio: "inherit",
  shell: true,
});
if (migrate.status !== 0) fail("prisma migrate deploy failed");

if (!existsSync(".next/BUILD_ID")) {
  console.log("[integration] no build found; building...");
  const build = spawnSync("npm", ["run", "build"], { env, stdio: "inherit", shell: true });
  if (build.status !== 0) fail("build failed");
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

console.log(`[integration] starting server on ${BASE_URL} ...`);
// `shell: false` and `detached` so the whole process group can be signalled.
// With `shell: true` the shell is the child and `next start` is a grandchild,
// so killing the child orphans the server — which is exactly how a previous
// interrupted run left port 3141 held and broke the next one.
const server = spawn(process.execPath, [require_resolve_next(), "start", "-p", String(PORT)], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

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

async function waitForReady(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      console.error(serverLog.slice(-3000));
      fail(`server exited with code ${server.exitCode} before becoming ready`);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.status === 200) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(serverLog.slice(-3000));
  fail("server did not become ready in time");
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
  console.error("\n[integration] FAILED. Last server output:\n" + serverLog.slice(-2000));

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
  const serverErrors = serverLog
    .split(/\r?\n/)
    .filter((l) => /error|unhandled|prisma|invalid/i.test(l))
    .slice(-6)
    .join(" | ");
  if (serverErrors) ghError("Integration tests (server log)", serverErrors);
}
process.exit(jest.status ?? 1);
