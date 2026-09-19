/**
 * H5 — POST /api/recurring-tasks/trigger is a cron endpoint, not a user one.
 *
 * WHAT THIS IS GUARDING
 *
 * The route authenticated with `getCurrentUser()` and then processed EVERY
 * tenant's due recurring tasks. Any user with a session — any organization,
 * any role, no permission check — could fire every other tenant's schedule,
 * create issues in projects they cannot see, and be recorded as the reporter
 * on them.
 *
 * It is now authenticated by a shared secret, like /api/internal/alerts/check.
 * The isolation-coverage checker exempts it on that basis, so this file is
 * what makes the exemption true rather than merely asserted.
 *
 * The test that matters most is the third one: a perfectly valid session, from
 * an org ADMIN, must be refused. That is the exact request that used to work.
 */

import { PrismaClient } from "@prisma/client";
import { api, assertSafeTestDatabase, type Fixture } from "./harness";
import { createFixture, destroyFixture } from "./fixture";

const dbUrl = assertSafeTestDatabase(process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

/** Mirrors scripts/run-integration-tests.mjs, which sets it on the server. */
const SECRET = "integration-recurring-secret";

let fx: Fixture;

beforeAll(async () => {
  fx = await createFixture(prisma);
}, 60_000);

afterAll(async () => {
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

/** Issues created by a trigger run, so each test starts from a known state. */
async function clearGeneratedIssues() {
  await prisma.issue.deleteMany({
    where: { projectId: fx.orgA.projectId, title: { startsWith: "H5 recurring" } },
  });
  await prisma.recurringTask.deleteMany({
    where: { projectId: { in: [fx.orgA.projectId, fx.orgB.projectId] } },
  });
}

afterEach(clearGeneratedIssues);

const trigger = (init: { user?: any; headers?: Record<string, string> } = {}) =>
  api(init.user ?? null, "/api/recurring-tasks/trigger", {
    method: "POST",
    headers: init.headers,
  });

describe("the recurring-task trigger refuses everything but its own secret", () => {
  it("refuses an anonymous call with no credential at all", async () => {
    const res = await trigger();
    expect(res.status).toBe(403);
  });

  it("refuses a wrong secret", async () => {
    const res = await trigger({ headers: { "x-cron-secret": "not-the-secret" } });
    expect(res.status).toBe(403);
  });

  it("refuses a VALID SESSION — the request that used to work", async () => {
    // An org ADMIN with a real, current session. Before H5 this returned 200
    // and created issues across every tenant in the installation.
    const res = await trigger({ user: fx.orgA.users.ADMIN });
    expect(res.status).toBe(403);
  });

  it("refuses a valid session belonging to a SUPER ADMIN", async () => {
    // DEPLOYMENT.md used to tell operators to drive this with a super-admin
    // "service account" cookie. It never checked for super-admin, so that
    // advice was decoration; now neither works, which is the point.
    const res = await trigger({ user: fx.superAdmin });
    expect(res.status).toBe(403);
  });

  it("accepts the secret as a Bearer token as well as x-cron-secret", async () => {
    const res = await trigger({ headers: { authorization: `Bearer ${SECRET}` } });
    expect(res.status).toBe(200);
  });

  it("a secret that is a PREFIX of the real one is refused", async () => {
    // The comparison is length-checked before it is byte-compared; without
    // that, a shorter buffer throws rather than returning false.
    const res = await trigger({ headers: { "x-cron-secret": SECRET.slice(0, 10) } });
    expect(res.status).toBe(403);
  });
});

describe("what a triggered run actually writes", () => {
  it("creates the issue with the PROJECT OWNER as reporter, not the caller", async () => {
    await prisma.recurringTask.create({
      data: {
        projectId: fx.orgA.projectId,
        scheduleCron: "DAILY",
        templateData: JSON.stringify({ title: "H5 recurring owner-reporter" }),
        isActive: true,
        nextRunAt: new Date(Date.now() - 60_000),
      },
    });

    const res = await trigger({ headers: { "x-cron-secret": SECRET } });
    expect(res.status).toBe(200);
    expect(res.body.triggered).toBeGreaterThanOrEqual(1);

    const issue = await prisma.issue.findFirst({
      where: { projectId: fx.orgA.projectId, title: "H5 recurring owner-reporter" },
    });
    expect(issue).not.toBeNull();

    const project = await prisma.project.findUnique({
      where: { id: fx.orgA.projectId },
      select: { ownerId: true },
    });
    expect(issue!.reporterId).toBe(project!.ownerId);
  });

  it("drops an assignee from another tenant rather than connecting them", async () => {
    // templateData is stored JSON, written when the recurring task was created
    // and never revalidated. A foreign id in it must not reach the issue.
    await prisma.recurringTask.create({
      data: {
        projectId: fx.orgA.projectId,
        scheduleCron: "DAILY",
        templateData: JSON.stringify({
          title: "H5 recurring foreign assignee",
          assigneeId: fx.orgB.spareUserId,
        }),
        isActive: true,
        nextRunAt: new Date(Date.now() - 60_000),
      },
    });

    const res = await trigger({ headers: { "x-cron-secret": SECRET } });
    expect(res.status).toBe(200);

    const issue = await prisma.issue.findFirst({
      where: { projectId: fx.orgA.projectId, title: "H5 recurring foreign assignee" },
    });
    // The issue is still created — one tenant's stale template must not hold
    // up every other tenant's schedule — but unassigned, and counted.
    expect(issue).not.toBeNull();
    expect(issue!.assigneeId).toBeNull();
    expect(res.body.unassignedDueToInvalidAssignee).toBeGreaterThanOrEqual(1);
  });

  it("keeps an assignee who IS a member of the project's organization", async () => {
    await prisma.recurringTask.create({
      data: {
        projectId: fx.orgA.projectId,
        scheduleCron: "DAILY",
        templateData: JSON.stringify({
          title: "H5 recurring own assignee",
          assigneeId: fx.orgA.spareUserId,
        }),
        isActive: true,
        nextRunAt: new Date(Date.now() - 60_000),
      },
    });

    const res = await trigger({ headers: { "x-cron-secret": SECRET } });
    expect(res.status).toBe(200);

    const issue = await prisma.issue.findFirst({
      where: { projectId: fx.orgA.projectId, title: "H5 recurring own assignee" },
    });
    expect(issue!.assigneeId).toBe(fx.orgA.spareUserId);
  });

  it("creates nothing when a refused caller asks", async () => {
    await prisma.recurringTask.create({
      data: {
        projectId: fx.orgA.projectId,
        scheduleCron: "DAILY",
        templateData: JSON.stringify({ title: "H5 recurring must not fire" }),
        isActive: true,
        nextRunAt: new Date(Date.now() - 60_000),
      },
    });

    const res = await trigger({ user: fx.orgA.users.ADMIN });
    expect(res.status).toBe(403);

    const issue = await prisma.issue.findFirst({
      where: { projectId: fx.orgA.projectId, title: "H5 recurring must not fire" },
    });
    expect(issue).toBeNull();
  });
});
