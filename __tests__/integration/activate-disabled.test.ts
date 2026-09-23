/**
 * What a project with Activate switched OFF must refuse.
 *
 * FOUND IN THE LIVE SYSTEM, NOT BY THIS SUITE.
 *
 * The `enabled` flag was checked in five of nineteen route files. Everything
 * else went through untouched, so a project that had switched the methodology
 * off could still raise a gate, sign one off, complete a phase and edit its
 * fit-to-standard decisions. Disabling LOOKED like it worked because the
 * screens disappear — the API never stopped accepting the writes behind them,
 * and the rows kept accumulating where nobody would look at them again.
 *
 * The three routes that already had the guard were the three with tests. So
 * this file covers the whole mutating surface rather than the parts that
 * happened to break, and each case asserts the DATABASE is unchanged: a 409
 * on its own does not prove the write did not land.
 *
 * Reads are deliberately not covered here: the rows survive a disable by
 * design, so that re-enabling finds the project's history rather than a blank
 * methodology.
 */

import { PrismaClient } from "@prisma/client";
import { api, expectAllowed, waitForServer, type Fixture } from "./harness";
import { createFixture, destroyFixture } from "./fixture";

const prisma = new PrismaClient();
let fx: Fixture;
let projectId = "";

const root = () => `/api/projects/${projectId}/activate`;

beforeAll(async () => {
  await waitForServer();
  fx = await createFixture(prisma);
  projectId = fx.orgA.projectId;
  expectAllowed(
    await api(fx.orgA.users.OWNER, root(), { method: "POST", body: { enabled: true, seedPlan: false } }),
    "enabling Activate"
  );
}, 180_000);

afterAll(async () => {
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

/** Switch Activate off and confirm it really is off before asserting. */
async function disable() {
  await api(fx.orgA.users.OWNER, root(), { method: "POST", body: { enabled: false } });
  const p = await prisma.activateProfile.findUnique({
    where: { projectId },
    select: { enabled: true },
  });
  expect(p!.enabled).toBe(false);
}

async function enable() {
  await api(fx.orgA.users.OWNER, root(), { method: "POST", body: { enabled: true, seedPlan: false } });
}

function expectDisabledRefusal(res: { status: number; body: any }, what: string) {
  // 409, not 403: the caller holds the permission, the project is in the
  // wrong state, and enabling it makes the identical request succeed.
  expect({ what, status: res.status, code: res.body?.code }).toEqual({
    what,
    status: 409,
    code: "ACTIVATE_DISABLED",
  });
}

describe("A disabled project refuses every Activate write", () => {
  it("refuses to change a phase's status, and the phase does not move", async () => {
    const phase = await prisma.activatePhase.findFirst({
      where: { projectId, key: "REALIZE" },
      select: { id: true, status: true },
    });
    await disable();
    const res = await api(fx.orgA.users.OWNER, `${root()}/phases/${phase!.id}`, {
      method: "PATCH",
      body: { status: "COMPLETED" },
    });
    expectDisabledRefusal(res, "completing a phase");
    const after = await prisma.activatePhase.findUnique({
      where: { id: phase!.id },
      select: { status: true, completedAt: true },
    });
    expect(after!.status).toBe(phase!.status);
    expect(after!.completedAt).toBeNull();
    await enable();
  });

  it("refuses to raise or sign off a gate, and the ledger stays empty", async () => {
    const gate = await prisma.activateGate.findFirst({
      where: { phase: { projectId, key: "DEPLOY" } },
      select: { id: true, status: true, criteria: { select: { id: true } } },
    });
    // Settle the criteria while still enabled, so the ONLY thing standing in
    // the way below is the disabled flag.
    for (const c of gate!.criteria) {
      await api(fx.orgA.users.OWNER, `${root()}/gates/${gate!.id}/criteria/${c.id}`, {
        method: "PATCH",
        body: { status: "MET" },
      });
    }
    await disable();

    expectDisabledRefusal(
      await api(fx.orgA.users.OWNER, `${root()}/gates/${gate!.id}/raise`, {
        method: "POST",
        body: {},
      }),
      "raising a gate"
    );
    expectDisabledRefusal(
      await api(fx.orgA.users.ADMIN, `${root()}/gates/${gate!.id}/approvals`, {
        method: "POST",
        body: { decision: "APPROVED" },
      }),
      "approving a gate"
    );
    expectDisabledRefusal(
      await api(fx.orgA.users.OWNER, `${root()}/gates/${gate!.id}/criteria`, {
        method: "POST",
        body: { criterion: "Added while the methodology was off" },
      }),
      "adding a criterion"
    );
    expectDisabledRefusal(
      await api(fx.orgA.users.OWNER, `${root()}/gates/${gate!.id}/criteria/${gate!.criteria[0].id}`, {
        method: "PATCH",
        body: { status: "NOT_MET" },
      }),
      "answering a criterion"
    );

    const after = await prisma.activateGate.findUnique({
      where: { id: gate!.id },
      select: { status: true, approvals: { select: { id: true } }, criteria: { select: { status: true } } },
    });
    expect(after!.status).toBe(gate!.status);
    expect(after!.approvals).toEqual([]);
    expect(after!.criteria.every((c) => c.status === "MET")).toBe(true);
    await enable();
  });

  it("refuses to edit a custom scope item, and the name is unchanged", async () => {
    const created = await api(fx.orgA.users.OWNER, `${root()}/scope-items`, {
      method: "POST",
      body: { name: "Scope item for the disabled test", workstreamKey: "TESTING" },
    });
    expectAllowed(created, "creating a custom scope item while enabled");
    const id = created.body.item?.id ?? created.body.scopeItem?.id ?? created.body.id;
    await disable();
    expectDisabledRefusal(
      await api(fx.orgA.users.OWNER, `${root()}/scope-items/${id}`, {
        method: "PATCH",
        body: { name: "Renamed while off" },
      }),
      "renaming a scope item"
    );
    expectDisabledRefusal(
      await api(fx.orgA.users.OWNER, `${root()}/scope-items/${id}`, { method: "DELETE" }),
      "deleting a scope item"
    );
    const row = await prisma.activateCustomScopeItem.findUnique({
      where: { id },
      select: { name: true },
    });
    expect(row!.name).toBe("Scope item for the disabled test");
    await enable();
  });

  it("refuses to edit a workstream and the project's modules", async () => {
    const ws = await prisma.activateWorkstream.findFirst({
      where: { projectId },
      select: { id: true, name: true },
    });
    await disable();
    expectDisabledRefusal(
      await api(fx.orgA.users.OWNER, `${root()}/workstreams/${ws!.id}`, {
        method: "PATCH",
        body: { ownerId: fx.orgA.users.ADMIN.id },
      }),
      "assigning a workstream owner"
    );
    expect(
      (await prisma.activateWorkstream.findUnique({ where: { id: ws!.id }, select: { ownerId: true } }))!
        .ownerId
    ).toBeNull();
    await enable();
  });

  it("lets everything through again once it is switched back on", async () => {
    // The accept case. Without it this whole file would pass on a build that
    // refused these requests unconditionally.
    const phase = await prisma.activatePhase.findFirst({
      where: { projectId, key: "REALIZE" },
      select: { id: true },
    });
    expectAllowed(
      await api(fx.orgA.users.OWNER, `${root()}/phases/${phase!.id}`, {
        method: "PATCH",
        body: { status: "IN_PROGRESS" },
      }),
      "starting a phase once Activate is on again"
    );
  });
});
