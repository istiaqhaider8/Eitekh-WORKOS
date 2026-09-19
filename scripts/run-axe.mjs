#!/usr/bin/env node
/**
 * D3 — bring up everything check-axe.mjs needs, run it, tear it down.
 *
 * The authenticated pages are the ones worth checking — login and register are
 * four fields each, while the project board and the settings forms are where
 * people spend their day. Reaching them needs a database, a server and a real
 * session, which is what this arranges.
 *
 * Deliberately shaped like scripts/run-integration-tests.mjs: same refusal to
 * run against a database without "test" in its name, same port guard, same
 * process-group teardown. A second way of doing the same job is a second place
 * for the bug to live.
 *
 * Usage:
 *   AXE_DATABASE_URL=postgresql://... node scripts/run-axe.mjs [--update]
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { PrismaClient } = require_("@prisma/client");
const jwt = require_("jsonwebtoken");

const PORT = Number(process.env.AXE_PORT || 3178);
const BASE_URL = `http://localhost:${PORT}`;

function fail(msg) {
  console.error(`\n[axe] ${msg}\n`);
  process.exit(1);
}

const dbUrl = process.env.AXE_DATABASE_URL;
if (!dbUrl) {
  fail(
    "AXE_DATABASE_URL is not set.\n" +
      "This creates a session row, so it must not run against the development\n" +
      'database. Point it at a scratch database whose name contains "test".'
  );
}
const dbName = dbUrl.split("/").pop().split("?")[0];
if (!/test/i.test(dbName)) {
  fail(`Refusing to run against "${dbName}": its name does not contain "test".`);
}

if (!process.env.JWT_SECRET) fail("JWT_SECRET must be set: the session is signed with it.");

const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: dbUrl,
  JWT_SECRET: process.env.JWT_SECRET,
  FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY || "1".repeat(64),
  BASE_URL: "https://axe.eitekh.example",
  ALLOW_LOCAL_BASE_URL: "1",
  SMTP_HOST: process.env.SMTP_HOST || "smtp.axe.test",
  SMTP_PASS: process.env.SMTP_PASS || "axe",
};

console.log(`[axe] database: ${dbName}`);

const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "inherit", shell: true });
if (migrate.status !== 0) fail("prisma migrate deploy failed");

if (!existsSync(".next/BUILD_ID")) {
  const build = spawnSync("npm", ["run", "build"], { env, stdio: "inherit", shell: true });
  if (build.status !== 0) fail("build failed");
}

// --- a user and a session to look at the authenticated pages with -----------
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const RUN = `axe${Date.now().toString(36)}`;
let sessionId = null;
let projectId = null;
let seededProject = false;

async function seed() {
  // Prefer real fixture data if the database has any: a page with content
  // exercises far more markup than an empty one, and empty states hide
  // contrast problems in the rows they do not render.
  const existing = await prisma.projectMember.findFirst({
    where: { role: "PROJECT_ADMIN" },
    include: { user: { select: { id: true, email: true } }, project: { select: { id: true } } },
  });

  let user = existing?.user ?? null;
  projectId = existing?.project?.id ?? null;

  if (!user) {
    user = await prisma.user.create({
      data: {
        id: `${RUN}_user`,
        email: `${RUN}@axe.test`,
        passwordHash: "x",
        firstName: "Axe",
        lastName: "Probe",
      },
      select: { id: true, email: true },
    });
  }

  /**
   * If there is no project to look at, build one.
   *
   * The project board is the page users spend their day on and by far the most
   * markup in the app — skipping it because the database happened to be empty
   * would mean the audit passes while the page nobody checked is the one that
   * matters. An empty state also hides most contrast problems, because the
   * rows that would show them are never rendered, so the fixture carries a
   * couple of issues.
   */
  if (!projectId) {
    const org = await prisma.organization.create({
      data: { id: `${RUN}_org`, name: "Axe probe", slug: RUN },
    });
    await prisma.organizationMember.create({
      data: { orgId: org.id, userId: user.id, role: "OWNER" },
    });
    const ws = await prisma.workspace.create({
      data: { id: `${RUN}_ws`, orgId: org.id, name: "Axe", slug: `${RUN}-ws` },
    });
    const project = await prisma.project.create({
      data: {
        id: `${RUN}_project`,
        workspaceId: ws.id,
        name: "Axe Probe Project",
        key: "AXE",
        ownerId: user.id,
      },
    });
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: user.id, role: "PROJECT_ADMIN" },
    });
    const wf = await prisma.workflow.create({
      data: { id: `${RUN}_wf`, projectId: project.id, name: "Default", isDefault: true },
    });
    const status = await prisma.workflowStatus.create({
      data: { id: `${RUN}_st`, workflowId: wf.id, name: "To Do", category: "TODO", color: "#888888", position: 1 },
    });
    for (let i = 1; i <= 3; i += 1) {
      await prisma.issue.create({
        data: {
          id: `${RUN}_issue${i}`,
          projectId: project.id,
          keyNumber: i,
          issueKey: `AXE-${i}`,
          title: `Accessibility probe issue ${i}`,
          description: "Rendered so the board has rows to audit.",
          issueType: "TASK",
          statusId: status.id,
          priority: "MEDIUM",
          reporterId: user.id,
        },
      });
    }
    projectId = project.id;
    seededProject = true;
  }

  sessionId = `${RUN}_sess`;
  const token = jwt.sign(
    { userId: user.id, email: user.email, isSuperAdmin: false, sessionId },
    env.JWT_SECRET,
    { expiresIn: "1h", algorithm: "HS256", issuer: "eitekh-workos", audience: "eitekh-workos-web" }
  );
  await prisma.session.create({
    data: { id: sessionId, userId: user.id, token, expiresAt: new Date(Date.now() + 3600_000) },
  });
  return token;
}

async function cleanup() {
  try {
    if (sessionId) await prisma.session.deleteMany({ where: { id: sessionId } });
    if (seededProject) {
      // Reverse order of creation: issues reference the status, the status the
      // workflow, everything the project.
      await prisma.issue.deleteMany({ where: { projectId: `${RUN}_project` } });
      await prisma.workflowStatus.deleteMany({ where: { workflowId: `${RUN}_wf` } });
      await prisma.workflow.deleteMany({ where: { id: `${RUN}_wf` } });
      await prisma.projectMember.deleteMany({ where: { projectId: `${RUN}_project` } });
      await prisma.project.deleteMany({ where: { id: `${RUN}_project` } });
      await prisma.workspace.deleteMany({ where: { id: `${RUN}_ws` } });
      await prisma.organizationMember.deleteMany({ where: { orgId: `${RUN}_org` } });
      await prisma.organization.deleteMany({ where: { id: `${RUN}_org` } });
    }
    await prisma.user.deleteMany({ where: { id: `${RUN}_user` } });
  } catch { /* best effort */ }
  await prisma.$disconnect().catch(() => {});
}

// --- server -----------------------------------------------------------------
async function portIsBusy() {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.status > 0;
  } catch {
    return false;
  }
}

if (await portIsBusy()) {
  fail(`Something is already listening on ${BASE_URL}. Stop it first — otherwise this\nwould audit whatever is already running, quite possibly an older build.`);
}

const token = await seed();

console.log(`[axe] starting server on ${BASE_URL} ...`);
const server = spawn(process.execPath, [require_.resolve("next/dist/bin/next"), "start", "-p", String(PORT)], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-server.pid, "SIGTERM");
    }
  } catch { /* already gone */ }
};
process.on("exit", stop);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { stop(); process.exit(130); });
}

const deadline = Date.now() + 120_000;
for (;;) {
  if (server.exitCode !== null) {
    console.error(log.slice(-3000));
    await cleanup();
    fail(`server exited with ${server.exitCode} before becoming ready`);
  }
  try {
    const r = await fetch(`${BASE_URL}/api/health`);
    if (r.status === 200) break;
  } catch { /* not up yet */ }
  if (Date.now() > deadline) {
    console.error(log.slice(-3000));
    await cleanup();
    fail("server did not become ready in time");
  }
  await new Promise((r) => setTimeout(r, 500));
}

console.log("[axe] server ready; running axe\n");

const axe = spawnSync(
  process.execPath,
  ["scripts/check-axe.mjs", "--url", BASE_URL, ...process.argv.slice(2)],
  {
    env: { ...env, AXE_SESSION_TOKEN: token, AXE_PROJECT_ID: projectId || "" },
    stdio: "inherit",
  }
);

// Focus behaviour, which axe cannot see: it inspects a static snapshot and
// focus only exists while keys are being pressed.
const focus = spawnSync(
  process.execPath,
  ["scripts/check-focus.mjs", "--url", BASE_URL],
  {
    env: { ...env, AXE_SESSION_TOKEN: token, AXE_PROJECT_ID: projectId || "" },
    stdio: "inherit",
  }
);

stop();
await cleanup();
process.exit((axe.status || 0) || (focus.status || 0));
