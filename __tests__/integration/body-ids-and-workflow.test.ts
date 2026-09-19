/**
 * B2 / B4 — the attack shape the isolation suite misses, and the workflow the
 * API does not enforce.
 *
 * WHAT THIS ASKS THAT THE OTHER SUITES DO NOT
 *
 * tenant-isolation.test.ts asks "can tenant A reach tenant B's URL". Every
 * route family it reached has a guard on the PATH. But a mutation takes a body
 * as well, and a body carries ids too:
 *
 *     PATCH /api/issues/<MY OWN issue>
 *     { "sprintId": "<TENANT B's sprint>" }
 *
 * The path is entirely legitimate. The authorization check passes, because it
 * is checking the issue, and the issue is mine. Nothing in that check looks at
 * the body. This is how a route with a correct guard still writes a foreign
 * id into its own tenant's data.
 *
 * The second question is the workflow. `WorkflowTransition` exists as a model
 * and is consulted by PATCH /api/issues/[id] — but the bulk route writes
 * `statusId` straight through:
 *
 *     if (updates.statusId !== undefined) updateData.statusId = updates.statusId;
 *
 * so a project's configured process is enforced one issue at a time and
 * skipped entirely for two. For a customer who bought this because it enforces
 * their process, "the gate holds unless you select two rows" is not a gate.
 *
 * Every test here asserts on the DATABASE after the call, not only on the
 * status code. A route may legitimately answer 200 for the part of a request
 * it was allowed to do; what must never happen is the foreign id landing in a
 * row.
 */

import { PrismaClient } from "@prisma/client";
import {
  api,
  assertSafeTestDatabase,
  type Fixture,
} from "./harness";
import { createFixture, destroyFixture } from "./fixture";

const dbUrl = assertSafeTestDatabase(process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

let fx: Fixture;

beforeAll(async () => {
  fx = await createFixture(prisma);
}, 60_000);

afterAll(async () => {
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

/** Put the issue back to its starting state between tests. */
async function resetIssueA() {
  await prisma.issue.update({
    where: { id: fx.orgA.issueId },
    data: {
      statusId: fx.orgA.statusId,
      sprintId: null,
      epicId: null,
      teamId: null,
      assigneeId: null,
      priority: "MEDIUM",
    },
  });
}

beforeEach(resetIssueA);

// ---------------------------------------------------------------------------
describe("a foreign id in the request body", () => {
  // The actor is org A's ADMIN acting on org A's own issue throughout. Every
  // one of these requests is authorized. The question is only whether the
  // route validates the ids it is handed.

  it("PATCH /issues/[id] must not accept another tenant's sprintId", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}`, {
      method: "PATCH",
      body: { sprintId: fx.orgB.sprintId },
    });

    const issue = await prisma.issue.findUnique({ where: { id: fx.orgA.issueId } });
    expect(issue?.sprintId).not.toBe(fx.orgB.sprintId);
    expect([400, 403, 404]).toContain(res.status);
  });

  it("PATCH /issues/[id] must not accept another tenant's epicId", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}`, {
      method: "PATCH",
      body: { epicId: fx.orgB.epicId },
    });

    const issue = await prisma.issue.findUnique({ where: { id: fx.orgA.issueId } });
    expect(issue?.epicId).not.toBe(fx.orgB.epicId);
    expect([400, 403, 404]).toContain(res.status);
  });

  it("bulk update must not accept another tenant's statusId", async () => {
    // The worst of the set: statusId is a foreign key into another tenant's
    // workflow, so the issue would render with a status that does not exist in
    // its own project's board.
    const res = await api(fx.orgA.users.ADMIN, "/api/issues/bulk", {
      method: "PATCH",
      body: { issueIds: [fx.orgA.issueId], updates: { statusId: fx.orgB.statusId } },
    });

    const issue = await prisma.issue.findUnique({ where: { id: fx.orgA.issueId } });
    expect(issue?.statusId).not.toBe(fx.orgB.statusId);
    expect([400, 403, 404]).toContain(res.status);
  });

  it("bulk update must not accept another tenant's sprintId", async () => {
    const res = await api(fx.orgA.users.ADMIN, "/api/issues/bulk", {
      method: "PATCH",
      body: { issueIds: [fx.orgA.issueId], updates: { sprintId: fx.orgB.sprintId } },
    });

    const issue = await prisma.issue.findUnique({ where: { id: fx.orgA.issueId } });
    expect(issue?.sprintId).not.toBe(fx.orgB.sprintId);
    expect([400, 403, 404]).toContain(res.status);
  });

  it("bulk update must not accept another tenant's epicId", async () => {
    const res = await api(fx.orgA.users.ADMIN, "/api/issues/bulk", {
      method: "PATCH",
      body: { issueIds: [fx.orgA.issueId], updates: { epicId: fx.orgB.epicId } },
    });

    const issue = await prisma.issue.findUnique({ where: { id: fx.orgA.issueId } });
    expect(issue?.epicId).not.toBe(fx.orgB.epicId);
    expect([400, 403, 404]).toContain(res.status);
  });

  it("bulk update must not accept another tenant's teamId", async () => {
    const res = await api(fx.orgA.users.ADMIN, "/api/issues/bulk", {
      method: "PATCH",
      body: { issueIds: [fx.orgA.issueId], updates: { teamId: fx.orgB.teamId } },
    });

    const issue = await prisma.issue.findUnique({ where: { id: fx.orgA.issueId } });
    expect(issue?.teamId).not.toBe(fx.orgB.teamId);
    expect([400, 403, 404]).toContain(res.status);
  });

  it("bulk update must not assign an issue to a user from another tenant", async () => {
    // Assigning someone outside the project is a disclosure in both
    // directions: the assignee appears on a board they cannot open, and the
    // issue appears in their "assigned to me".
    const res = await api(fx.orgA.users.ADMIN, "/api/issues/bulk", {
      method: "PATCH",
      body: { issueIds: [fx.orgA.issueId], updates: { assigneeId: fx.orgB.users.MEMBER.id } },
    });

    const issue = await prisma.issue.findUnique({ where: { id: fx.orgA.issueId } });
    expect(issue?.assigneeId).not.toBe(fx.orgB.users.MEMBER.id);
    expect([400, 403, 404]).toContain(res.status);
  });

  it("control: the SAME fields from the caller's OWN tenant are accepted", async () => {
    // Without this, every assertion above could be satisfied by a route that
    // rejects the field unconditionally — which would pass the suite and break
    // the product.
    const res = await api(fx.orgA.users.ADMIN, "/api/issues/bulk", {
      method: "PATCH",
      body: {
        issueIds: [fx.orgA.issueId],
        updates: { sprintId: fx.orgA.sprintId, epicId: fx.orgA.epicId },
      },
    });

    expect(res.status).toBe(200);
    const issue = await prisma.issue.findUnique({ where: { id: fx.orgA.issueId } });
    expect(issue?.sprintId).toBe(fx.orgA.sprintId);
    expect(issue?.epicId).toBe(fx.orgA.epicId);
  });
});

// ---------------------------------------------------------------------------
describe("workflow transitions are enforced on every write path", () => {
  // The fixture defines exactly one transition: To Do -> In Progress.
  // To Do -> Done has no transition and must be refused everywhere.

  it("PATCH /issues/[id] allows a configured transition", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}`, {
      method: "PATCH",
      body: { statusId: fx.orgA.statusInProgressId },
    });

    expect(res.status).toBe(200);
    const issue = await prisma.issue.findUnique({ where: { id: fx.orgA.issueId } });
    expect(issue?.statusId).toBe(fx.orgA.statusInProgressId);
  });

  it("PATCH /issues/[id] refuses a transition that is not configured", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}`, {
      method: "PATCH",
      body: { statusId: fx.orgA.statusDoneId },
    });

    const issue = await prisma.issue.findUnique({ where: { id: fx.orgA.issueId } });
    expect(issue?.statusId).toBe(fx.orgA.statusId);
    expect([400, 409]).toContain(res.status);
  });

  it("BULK update refuses the same transition the single-issue route refuses", async () => {
    // The bypass. If the rule holds for one issue and not for two, it is not a
    // rule — and "select all, set status to Done" is the single most natural
    // thing to do on a board.
    const res = await api(fx.orgA.users.ADMIN, "/api/issues/bulk", {
      method: "PATCH",
      body: { issueIds: [fx.orgA.issueId], updates: { statusId: fx.orgA.statusDoneId } },
    });

    const issue = await prisma.issue.findUnique({ where: { id: fx.orgA.issueId } });
    expect(issue?.statusId).toBe(fx.orgA.statusId);
    expect([400, 409]).toContain(res.status);
  });

  it("BULK update allows a configured transition", async () => {
    const res = await api(fx.orgA.users.ADMIN, "/api/issues/bulk", {
      method: "PATCH",
      body: { issueIds: [fx.orgA.issueId], updates: { statusId: fx.orgA.statusInProgressId } },
    });

    expect(res.status).toBe(200);
    const issue = await prisma.issue.findUnique({ where: { id: fx.orgA.issueId } });
    expect(issue?.statusId).toBe(fx.orgA.statusInProgressId);
  });

  it("the rejection is a 409 that names what IS allowed", async () => {
    // A 400 saying "Invalid status transition" tells the user nothing about
    // how to proceed, and tells a client author nothing about how to build a
    // status picker that only offers legal moves.
    const res = await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}`, {
      method: "PATCH",
      body: { statusId: fx.orgA.statusDoneId },
    });

    const text = JSON.stringify(res.body ?? res.text);
    expect(text).toMatch(/In Progress|allowed/i);
  });
});

// ---------------------------------------------------------------------------
/**
 * H1 — the CREATE path, which nothing above reaches.
 *
 * The two suites before this one ask whether an UPDATE accepts a foreign id.
 * They were written after PATCH /api/issues/[id] and /api/issues/bulk were
 * found to, and they cover those two routes. POST /api/projects/[id]/issues
 * was never covered by either, and it was the worst of the three: it took
 * teamId, epicId, sprintId, parentIssueId and componentId straight from the
 * body into `connect`, with no check at all.
 *
 * `connect` asks only whether a row with that id exists. It does not ask whose
 * it is. So the result is not a foreign reference grafted onto an existing
 * issue — it is a brand-new row created across the tenant boundary, in a
 * project the caller is fully entitled to write to.
 *
 * Each test asserts on the DATABASE, not only on the status. A 201 with the
 * foreign id absent would be a strange API but not a leak; a 201 with it
 * present is the defect.
 */
describe("POST /projects/[id]/issues — foreign ids in the create body", () => {
  /**
   * Issue the create and report what actually landed.
   *
   * It returns the created row rather than the response body because the
   * response is the route's account of what it did, and the point of these
   * tests is not to take the route's word for it.
   */
  async function create(body: Record<string, unknown>) {
    const res = await api(fx.orgA.users.ADMIN, `/api/projects/${fx.orgA.projectId}/issues`, {
      method: "POST",
      body: { title: `H1 probe ${Math.random().toString(36).slice(2, 8)}`, issueType: "TASK", ...body },
    });
    const created = res.body?.issue?.id
      ? await prisma.issue.findUnique({ where: { id: res.body.issue.id } })
      : null;
    return { res, created };
  }

  // Anything these tests do manage to create is still org A's issue, so it is
  // cleaned up with the rest of the fixture. Removing it here as well keeps a
  // failure from cascading into the next test's assertions.
  const strays: string[] = [];
  afterEach(async () => {
    if (strays.length) {
      await prisma.issue.deleteMany({ where: { id: { in: strays.splice(0) } } });
    }
  });

  it.each([
    ["sprintId", () => fx.orgB.sprintId, (i: any) => i.sprintId],
    ["epicId", () => fx.orgB.epicId, (i: any) => i.epicId],
    ["teamId", () => fx.orgB.teamId, (i: any) => i.teamId],
    ["componentId", () => fx.orgB.componentId, (i: any) => i.componentId],
    ["parentIssueId", () => fx.orgB.issueId, (i: any) => i.parentIssueId],
    ["statusId", () => fx.orgB.statusId, (i: any) => i.statusId],
  ])("must not create an issue carrying another tenant's %s", async (field, foreign, read) => {
    const { res, created } = await create({ [field]: foreign() });
    if (created) strays.push(created.id);

    // The row is the assertion. If one was created at all, the foreign id must
    // not be on it.
    if (created) expect(read(created)).not.toBe(foreign());
    expect([400, 403, 404]).toContain(res.status);
  });

  it("must not create an issue assigned to a user outside the organization", async () => {
    const { res, created } = await create({ assigneeId: fx.orgB.spareUserId });
    if (created) strays.push(created.id);

    if (created) expect(created.assigneeId).not.toBe(fx.orgB.spareUserId);
    expect([400, 403, 404]).toContain(res.status);
  });

  it("control: the same fields from the caller's OWN tenant are accepted", async () => {
    // The six assertions above are all satisfied by a route that refuses these
    // fields outright, which would pass the suite and break issue creation.
    const { res, created } = await create({
      sprintId: fx.orgA.sprintId,
      epicId: fx.orgA.epicId,
      teamId: fx.orgA.teamId,
      componentId: fx.orgA.componentId,
      statusId: fx.orgA.statusId,
      assigneeId: fx.orgA.spareUserId,
    });
    if (created) strays.push(created.id);

    expect(res.status).toBe(201);
    expect(created).not.toBeNull();
    expect(created!.sprintId).toBe(fx.orgA.sprintId);
    expect(created!.epicId).toBe(fx.orgA.epicId);
    expect(created!.teamId).toBe(fx.orgA.teamId);
    expect(created!.componentId).toBe(fx.orgA.componentId);
    expect(created!.statusId).toBe(fx.orgA.statusId);
    expect(created!.assigneeId).toBe(fx.orgA.spareUserId);
  });

  it("control: a create with no optional ids at all still works", async () => {
    // The statusId branch was restructured when the duplicated in-transaction
    // check was removed. This is the path that takes the project's default
    // workflow status, and nothing else in the suite exercises it.
    const { res, created } = await create({});
    if (created) strays.push(created.id);

    expect(res.status).toBe(201);
    expect(created?.statusId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
/**
 * H2 — the same class on the SUBTASK write paths.
 *
 * Triaging the routes that sit beside the three already covered turned up two
 * more that write a foreign key straight from the body:
 *
 *     POST  /api/issues/[id]/subtasks   ->  assigneeId: assigneeId || null
 *     PATCH /api/subtasks/[id]          ->  updateData.assigneeId = assigneeId || null
 *
 * `Subtask.assigneeId` is a real foreign key to `User`, so the write succeeds
 * for any user id in the entire installation. Both routes guard the PATH
 * correctly — they resolve the parent issue's project and call
 * `assertProjectPermission` — and then never look at who the assignee is.
 *
 * The issue-level routes were tightened to require ORGANIZATION membership;
 * these are the same product gesture one level down, so they get the same rule
 * from the same module rather than a third opinion.
 *
 * Checked and found NOT vulnerable while triaging, so deliberately not tested
 * here: /api/sprints (its body `projectId` is the one authorized),
 * /api/epics/[id] and /api/components/[id] (project comes from the loaded row),
 * /api/projects/[id]/import (resolves names against the project's own statuses,
 * sprints and epics) and /api/users/delegations (asserts org access per issue
 * and org membership for the delegate).
 */
describe("subtask write paths must not accept a foreign assignee", () => {
  afterEach(async () => {
    await prisma.subtask.updateMany({
      where: { id: fx.orgA.subtaskId },
      data: { assigneeId: null },
    });
    await prisma.subtask.deleteMany({
      where: { parentIssueId: fx.orgA.issueId, title: { startsWith: "H2 probe" } },
    });
  });

  it("POST /issues/[id]/subtasks must not assign a user from another tenant", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}/subtasks`, {
      method: "POST",
      body: { title: "H2 probe create", assigneeId: fx.orgB.spareUserId },
    });

    const landed = await prisma.subtask.findFirst({
      where: { parentIssueId: fx.orgA.issueId, assigneeId: fx.orgB.spareUserId },
    });
    expect(landed).toBeNull();
    expect([400, 403, 404]).toContain(res.status);
  });

  it("PATCH /subtasks/[id] must not assign a user from another tenant", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/subtasks/${fx.orgA.subtaskId}`, {
      method: "PATCH",
      body: { assigneeId: fx.orgB.spareUserId },
    });

    const subtask = await prisma.subtask.findUnique({ where: { id: fx.orgA.subtaskId } });
    expect(subtask?.assigneeId).not.toBe(fx.orgB.spareUserId);
    expect([400, 403, 404]).toContain(res.status);
  });

  it("control: a subtask CAN be assigned to a user from the caller's own tenant", async () => {
    const created = await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}/subtasks`, {
      method: "POST",
      body: { title: "H2 probe control", assigneeId: fx.orgA.spareUserId },
    });
    expect(created.status).toBe(201);

    const patched = await api(fx.orgA.users.ADMIN, `/api/subtasks/${fx.orgA.subtaskId}`, {
      method: "PATCH",
      body: { assigneeId: fx.orgA.spareUserId },
    });
    expect(patched.status).toBe(200);

    const subtask = await prisma.subtask.findUnique({ where: { id: fx.orgA.subtaskId } });
    expect(subtask?.assigneeId).toBe(fx.orgA.spareUserId);
  });

  it("control: clearing the assignee is still allowed", async () => {
    // Every assertion above is satisfied by a route that refuses assigneeId
    // outright, and `null` must keep meaning "unassign" rather than being
    // treated as an id to validate.
    const res = await api(fx.orgA.users.ADMIN, `/api/subtasks/${fx.orgA.subtaskId}`, {
      method: "PATCH",
      body: { assigneeId: null },
    });
    expect(res.status).toBe(200);
    const subtask = await prisma.subtask.findUnique({ where: { id: fx.orgA.subtaskId } });
    expect(subtask?.assigneeId).toBeNull();
  });
});
