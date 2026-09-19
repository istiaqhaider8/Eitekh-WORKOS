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
