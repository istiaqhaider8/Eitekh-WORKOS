/**
 * H4 — the last of the routes `check-isolation-coverage.mjs` listed as gaps.
 *
 * WHY THEY WERE GAPS
 *
 * Not carelessness: the fixture provisioned no row of the right kind, so a
 * denial test would have been asking for an id that does not exist and would
 * have proved the 404 path rather than the guard. The fixture now creates a
 * PbacRole (with an assignment), a RecurringTask, a Leave and a
 * TaskDelegation per tenant, which is what makes these questions askable.
 *
 * They share the shape that has produced every isolation vulnerability found
 * in this codebase so far:
 *
 *     PATCH /api/pbac/roles/<id>
 *     PATCH /api/users/leave/<id>
 *     DELETE /api/recurring-tasks/<id>
 *
 * The path names a resource and no tenant. Nothing in the URL tells the
 * handler which organization to check against, so the check is easy to omit
 * and impossible to notice omitting.
 *
 * Every test asserts on the DATABASE after the call as well as on the status.
 * A route may answer 403 having already written; a route may answer 200
 * having written nothing. Only the row settles it.
 *
 * `jobs/:id` is deliberately absent. It reads an in-memory store that nothing
 * in the application ever writes to — `enqueueJob` has no callers — so there
 * is no way to create a job to ask for, and the route already refuses any job
 * whose `userId` is not the caller's. It is marked EXEMPT with that reason.
 */

import { PrismaClient } from "@prisma/client";
import {
  api,
  expectDenied,
  expectBodyExcludes,
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

/** Marker strings that must never reach the other tenant. */
const secretsOfB = () => [
  "PBAC SECRET OF TENANT B",
  "LEAVE NOTE OF TENANT B",
  "DELEGATION REASON OF TENANT B",
  "Recurring of tenant B",
];

// ---------------------------------------------------------------------------
describe("PBAC roles", () => {
  it("GET must not return another tenant's role", async () => {
    // Asking with the VICTIM's orgId: the org guard is what should refuse.
    const viaVictimOrg = await api(
      fx.orgA.users.ADMIN,
      `/api/pbac/roles/${fx.orgB.pbacRoleId}?orgId=${fx.orgB.orgId}`
    );
    expectDenied(viaVictimOrg, "GET pbac/roles/[id] with org B's orgId");
    expectBodyExcludes(viaVictimOrg, secretsOfB(), "GET pbac/roles/[id]");

    // Asking with the ATTACKER's own orgId and the victim's role id: the
    // lookup must be scoped, so this is a 404 rather than a leak.
    const viaOwnOrg = await api(
      fx.orgA.users.ADMIN,
      `/api/pbac/roles/${fx.orgB.pbacRoleId}?orgId=${fx.orgA.orgId}`
    );
    expectBodyExcludes(viaOwnOrg, secretsOfB(), "GET pbac/roles/[id] scoped to own org");
  });

  it("PATCH must not rewrite a role belonging to another tenant", async () => {
    // The attack: a legitimate OWNER of org A, naming their OWN orgId — so
    // every org guard passes — and another tenant's role id in the path.
    const res = await api(fx.orgA.users.OWNER, `/api/pbac/roles/${fx.orgB.pbacRoleId}`, {
      method: "PATCH",
      body: {
        orgId: fx.orgA.orgId,
        name: "Taken over by tenant A",
        permissions: ["issues:view"],
      },
    });

    const role = await prisma.pbacRole.findUnique({ where: { id: fx.orgB.pbacRoleId } });

    // The row must still exist, still belong to org B, and still be org B's
    // role. Losing the orgId is the severe half: the role is not merely edited,
    // it is moved out of the tenant that owns it.
    expect(role).not.toBeNull();
    expect(role!.orgId).toBe(fx.orgB.orgId);
    expect(role!.name).not.toBe("Taken over by tenant A");
    expect([400, 403, 404]).toContain(res.status);
  });

  it("PATCH must not toggle the status of another tenant's role", async () => {
    const before = await prisma.pbacRole.findUnique({ where: { id: fx.orgB.pbacRoleId } });

    const res = await api(fx.orgA.users.OWNER, `/api/pbac/roles/${fx.orgB.pbacRoleId}`, {
      method: "PATCH",
      body: { orgId: fx.orgA.orgId, status: "INACTIVE" },
    });

    const after = await prisma.pbacRole.findUnique({ where: { id: fx.orgB.pbacRoleId } });
    expect(after!.status).toBe(before!.status);
    expect(after!.orgId).toBe(fx.orgB.orgId);
    expect([400, 403, 404]).toContain(res.status);
  });

  it("DELETE must not remove another tenant's role", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/pbac/roles/${fx.orgB.pbacRoleId}?orgId=${fx.orgA.orgId}&force=true`,
      { method: "DELETE" }
    );

    const role = await prisma.pbacRole.findUnique({ where: { id: fx.orgB.pbacRoleId } });
    expect(role).not.toBeNull();
    expect(role!.orgId).toBe(fx.orgB.orgId);
    expect([400, 403, 404]).toContain(res.status);
  });

  it("GET roles/[id]/users must not list another tenant's assignees", async () => {
    const res = await api(
      fx.orgA.users.ADMIN,
      `/api/pbac/roles/${fx.orgB.pbacRoleId}/users?orgId=${fx.orgA.orgId}`
    );
    // The assignment in the fixture is org B's spare user. Their id must not
    // come back to org A under any status.
    expectBodyExcludes(res, [fx.orgB.spareUserId], "GET pbac/roles/[id]/users");
  });

  it("POST roles/[id]/users must not assign anyone to another tenant's role", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/pbac/roles/${fx.orgB.pbacRoleId}/users?orgId=${fx.orgA.orgId}`,
      { method: "POST", body: { orgId: fx.orgA.orgId, userId: fx.orgA.spareUserId } }
    );

    const assignment = await prisma.pbacUserRoleAssignment.findFirst({
      where: { roleId: fx.orgB.pbacRoleId, userId: fx.orgA.spareUserId },
    });
    expect(assignment).toBeNull();
    expect([400, 403, 404]).toContain(res.status);
  });

  it("control: a tenant CAN read its own role", async () => {
    // Without this, a route that refuses everyone passes every test above.
    const res = await api(
      fx.orgA.users.ADMIN,
      `/api/pbac/roles/${fx.orgA.pbacRoleId}?orgId=${fx.orgA.orgId}`
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain("PBAC SECRET OF TENANT A");
  });
});

// ---------------------------------------------------------------------------
describe("recurring tasks", () => {
  it("GET must not return another tenant's recurring task", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/recurring-tasks/${fx.orgB.recurringTaskId}`);
    expectDenied(res, "GET recurring-tasks/[id]");
    expectBodyExcludes(res, secretsOfB(), "GET recurring-tasks/[id]");
  });

  it("PATCH must not modify another tenant's recurring task", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/recurring-tasks/${fx.orgB.recurringTaskId}`, {
      method: "PATCH",
      body: { isActive: false },
    });

    const task = await prisma.recurringTask.findUnique({ where: { id: fx.orgB.recurringTaskId } });
    expect(task!.isActive).toBe(true);
    expectDenied(res, "PATCH recurring-tasks/[id]");
  });

  it("DELETE must not remove another tenant's recurring task", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/recurring-tasks/${fx.orgB.recurringTaskId}`, {
      method: "DELETE",
    });

    const task = await prisma.recurringTask.findUnique({ where: { id: fx.orgB.recurringTaskId } });
    expect(task).not.toBeNull();
    expectDenied(res, "DELETE recurring-tasks/[id]");
  });

  it("control: a tenant CAN read its own recurring task", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/recurring-tasks/${fx.orgA.recurringTaskId}`);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("leave requests", () => {
  it("PATCH must not modify another tenant's leave", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/users/leave/${fx.orgB.leaveId}`, {
      method: "PATCH",
      body: { status: "CANCELLED" },
    });

    const leave = await prisma.leave.findUnique({ where: { id: fx.orgB.leaveId } });
    expect(leave!.status).toBe("ACTIVE");
    expectDenied(res, "PATCH users/leave/[id]");
    expectBodyExcludes(res, secretsOfB(), "PATCH users/leave/[id]");
  });

  it("DELETE must not remove another tenant's leave", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/users/leave/${fx.orgB.leaveId}`, {
      method: "DELETE",
    });

    const leave = await prisma.leave.findUnique({ where: { id: fx.orgB.leaveId } });
    expect(leave).not.toBeNull();
    expectDenied(res, "DELETE users/leave/[id]");
  });

  it("control: the owner of a leave can cancel their own", async () => {
    const res = await api(fx.orgA.users.OWNER, `/api/users/leave/${fx.orgA.leaveId}`, {
      method: "PATCH",
      body: { status: "CANCELLED" },
    });
    expect(res.status).toBe(200);

    // Put it back, so the DELETE test above is not order-dependent.
    await prisma.leave.update({ where: { id: fx.orgA.leaveId }, data: { status: "ACTIVE" } });
  });
});

// ---------------------------------------------------------------------------
describe("task delegations", () => {
  it("PATCH must not modify another tenant's delegation", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/users/delegations/${fx.orgB.delegationId}`, {
      method: "PATCH",
      body: { status: "CANCELLED" },
    });

    const delegation = await prisma.taskDelegation.findUnique({
      where: { id: fx.orgB.delegationId },
    });
    expect(delegation!.status).toBe("ACTIVE");
    expectDenied(res, "PATCH users/delegations/[id]");
    expectBodyExcludes(res, secretsOfB(), "PATCH users/delegations/[id]");
  });

  it("DELETE must not remove another tenant's delegation", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/users/delegations/${fx.orgB.delegationId}`, {
      method: "DELETE",
    });

    const delegation = await prisma.taskDelegation.findUnique({
      where: { id: fx.orgB.delegationId },
    });
    expect(delegation).not.toBeNull();
    expectDenied(res, "DELETE users/delegations/[id]");
  });
});
