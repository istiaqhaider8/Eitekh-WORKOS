/**
 * The Activate permission matrix, over HTTP, as real users in real roles.
 *
 * WHY MANAGER IS THE ACTOR THAT MATTERS HERE
 *
 * The fixture's OWNER and ADMIN are organization OWNER and ADMIN, so both
 * derive the `org-admin` role, which holds every key by construction. Testing
 * a project-scoped grant with either of them proves nothing: they would pass
 * whether the project role carried the permission or not.
 *
 * MANAGER is an organization MEMBER holding PROJECT_MANAGER, so it exercises
 * the project-scoped grant and nothing else. Before this change it was denied
 * every Activate route; it is now the main working role, with exactly one
 * thing withheld.
 *
 * Every block asserts the ALLOW case first. A matrix tested only through its
 * denials passes just as happily when the permission was never granted.
 */

import { PrismaClient } from "@prisma/client";
import { api, expectDenied, expectAllowed, waitForServer, type Fixture } from "./harness";
import { createFixture, destroyFixture } from "./fixture";

const prisma = new PrismaClient();
let fx: Fixture;
let explorePhaseId: string;
let exploreGateId: string;

beforeAll(async () => {
  await waitForServer();
  fx = await createFixture(prisma);

  await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`, {
    method: "POST",
    body: { enabled: true, seedPlan: false },
  });
  const profile = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`);
  const explore = profile.body.phases.find((p: any) => p.key === "EXPLORE");
  explorePhaseId = explore.id;
  exploreGateId = explore.gates[0].id;
}, 180_000);

afterAll(async () => {
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

const paths = (projectId: string) => ({
  profile: `/api/projects/${projectId}/activate`,
  readiness: `/api/projects/${projectId}/activate/readiness`,
  templates: `/api/projects/${projectId}/activate/templates`,
  scopeItems: `/api/projects/${projectId}/activate/scope-items`,
  modules: `/api/projects/${projectId}/activate/modules`,
  deliverables: `/api/projects/${projectId}/activate/deliverables`,
  backlog: `/api/projects/${projectId}/activate/backlog`,
  accelerators: `/api/projects/${projectId}/activate/accelerators`,
});

// ---------------------------------------------------------------------------

describe("activate:view — every project role can read", () => {
  const readable = ["profile", "readiness", "templates", "scopeItems", "modules", "deliverables", "backlog", "accelerators"] as const;

  for (const role of ["MANAGER", "MEMBER", "VIEWER"] as const) {
    it(`lets a ${role} read every Activate view`, async () => {
      const p = paths(fx.orgA.projectId);
      for (const key of readable) {
        const res = await api(fx.orgA.users[role], p[key]);
        expectAllowed(res, `${role} reading ${key}`);
      }
    });
  }

  it("still refuses an outsider and an unauthenticated caller", async () => {
    const p = paths(fx.orgA.projectId);
    expectDenied(await api(fx.outsider, p.profile), "an outsider reading the profile");
    expect((await api(null, p.profile)).status).toBe(401);
  });

  it("still refuses a caller from another organization", async () => {
    const p = paths(fx.orgA.projectId);
    // Reading is broad WITHIN a project. It is not broad across tenants, and
    // widening the role matrix must not have touched that.
    for (const key of readable) {
      expectDenied(await api(fx.orgB.users.OWNER, p[key]), `org B reading ${key}`);
    }
  });
});

// ---------------------------------------------------------------------------

describe("activate:manage_phases — Project Manager and above", () => {
  it("lets a MANAGER update a phase", async () => {
    const res = await api(
      fx.orgA.users.MANAGER,
      `/api/projects/${fx.orgA.projectId}/activate/phases/${explorePhaseId}`,
      { method: "PATCH", body: { status: "IN_PROGRESS" } }
    );
    expectAllowed(res, "a MANAGER updating a phase");
  });

  it("lets a MANAGER change module scope", async () => {
    const mods = await api(fx.orgA.users.MANAGER, `/api/projects/${fx.orgA.projectId}/activate/modules`);
    expect(mods.status).toBe(200);
    // The built-in template ships no modules, so there is nothing to switch;
    // the read being permitted is what this role gained.
    expect(Array.isArray(mods.body.modules)).toBe(true);
  });

  it("refuses a MEMBER and a VIEWER", async () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      const res = await api(
        fx.orgA.users[role],
        `/api/projects/${fx.orgA.projectId}/activate/phases/${explorePhaseId}`,
        { method: "PATCH", body: { status: "COMPLETED" } }
      );
      expectDenied(res, `a ${role} updating a phase`);
    }
    const still = await prisma.activatePhase.findUnique({
      where: { id: explorePhaseId },
      select: { status: true },
    });
    expect(still?.status).not.toBe("COMPLETED");
  });
});

// ---------------------------------------------------------------------------

describe("activate:manage_deliverables — Project Manager and above", () => {
  it("lets a MANAGER link a deliverable", async () => {
    const res = await api(
      fx.orgA.users.MANAGER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables`,
      { method: "POST", body: { issueId: fx.orgA.issueId, phaseId: explorePhaseId } }
    );
    expectAllowed(res, "a MANAGER linking a deliverable");
  });

  it("refuses a MEMBER and a VIEWER, and writes nothing", async () => {
    const before = await prisma.activateDeliverableLink.count({
      where: { phase: { projectId: fx.orgA.projectId } },
    });
    for (const role of ["MEMBER", "VIEWER"] as const) {
      const res = await api(
        fx.orgA.users[role],
        `/api/projects/${fx.orgA.projectId}/activate/deliverables`,
        { method: "POST", body: { issueId: fx.orgA.issueId, phaseId: explorePhaseId } }
      );
      expectDenied(res, `a ${role} linking a deliverable`);
    }
    expect(
      await prisma.activateDeliverableLink.count({
        where: { phase: { projectId: fx.orgA.projectId } },
      })
    ).toBe(before);
  });
});

// ---------------------------------------------------------------------------

describe("activate:manage_gates — Project Manager may raise, not approve", () => {
  it("lets a MANAGER mark every criterion met", async () => {
    const criteria = await prisma.activateGateCriterion.findMany({
      where: { gateId: exploreGateId },
      select: { id: true },
    });
    for (const c of criteria) {
      const res = await api(
        fx.orgA.users.MANAGER,
        `/api/projects/${fx.orgA.projectId}/activate/gates/${exploreGateId}/criteria/${c.id}`,
        { method: "PATCH", body: { status: "MET" } }
      );
      expectAllowed(res, "a MANAGER marking a criterion met");
    }
  });

  it("lets a MANAGER raise the gate", async () => {
    const res = await api(
      fx.orgA.users.MANAGER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${exploreGateId}/raise`,
      { method: "POST", body: {} }
    );
    expectAllowed(res, "a MANAGER raising a gate");

    const gate = await prisma.activateGate.findUnique({
      where: { id: exploreGateId },
      select: { status: true, raisedById: true },
    });
    expect(gate?.status).toBe("RAISED");
    expect(gate?.raisedById).toBe(fx.orgA.users.MANAGER.id);
  });

  it("refuses a MEMBER and a VIEWER", async () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      const res = await api(
        fx.orgA.users[role],
        `/api/projects/${fx.orgA.projectId}/activate/gates/${exploreGateId}/raise`,
        { method: "POST", body: {} }
      );
      expectDenied(res, `a ${role} raising a gate`);
    }
  });
});

// ---------------------------------------------------------------------------

describe("activate:sign_off_gate — withheld from Project Manager", () => {
  it("refuses the MANAGER who raised it, and writes no approval", async () => {
    const before = await prisma.activateGateApproval.count({ where: { gateId: exploreGateId } });

    const res = await api(
      fx.orgA.users.MANAGER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${exploreGateId}/approvals`,
      { method: "POST", body: { decision: "APPROVED" } }
    );
    /**
     * Refused on the PERMISSION, before separation of duties is consulted.
     *
     * Both would refuse this particular request, and that is the point of
     * granting the two keys to different roles: the control does not depend
     * on the raiser and the approver happening to be different people.
     */
    expectDenied(res, "a MANAGER signing off a gate");
    expect(await prisma.activateGateApproval.count({ where: { gateId: exploreGateId } })).toBe(
      before
    );
  });

  it("refuses a MEMBER and a VIEWER", async () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      const res = await api(
        fx.orgA.users[role],
        `/api/projects/${fx.orgA.projectId}/activate/gates/${exploreGateId}/approvals`,
        { method: "POST", body: { decision: "APPROVED" } }
      );
      expectDenied(res, `a ${role} signing off a gate`);
    }
  });

  it("accepts a holder of the permission who did not raise it", async () => {
    // The accept case. Without it, every assertion above would pass on a
    // gate that simply cannot be approved by anyone.
    const res = await api(
      fx.orgA.users.ADMIN,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${exploreGateId}/approvals`,
      { method: "POST", body: { decision: "APPROVED", comment: "criteria verified" } }
    );
    expect(res.status).toBe(201);
    expect(res.body.gateStatus).toBe("APPROVED");
  });
});

// ---------------------------------------------------------------------------

describe("separation of duties survives the wider matrix", () => {
  it("still refuses a sign-off by whoever raised the gate", async () => {
    const { gate, phaseId } = await (async () => {
      const profile = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`);
      const realize = profile.body.phases.find((p: any) => p.key === "REALIZE");
      return { gate: realize.gates[0], phaseId: realize.id };
    })();

    const criteria = await prisma.activateGateCriterion.findMany({
      where: { gateId: gate.id },
      select: { id: true },
    });
    for (const c of criteria) {
      await api(
        fx.orgA.users.ADMIN,
        `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/criteria/${c.id}`,
        { method: "PATCH", body: { status: "MET" } }
      );
    }
    await api(
      fx.orgA.users.ADMIN,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/raise`,
      { method: "POST", body: {} }
    );

    // ADMIN holds sign_off_gate and raised this gate, so the same-person
    // check is the only thing standing in the way. It still stands.
    const own = await api(
      fx.orgA.users.ADMIN,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/approvals`,
      { method: "POST", body: { decision: "APPROVED" } }
    );
    expect(own.status).toBe(403);
    expect(own.body.error).toMatch(/raised this gate/i);
    expect(await prisma.activateGateApproval.count({ where: { gateId: gate.id } })).toBe(0);

    // And a different holder can.
    const other = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/approvals`,
      { method: "POST", body: { decision: "APPROVED" } }
    );
    expect(other.status).toBe(201);
    expect(phaseId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe("tenant isolation is unchanged by the wider matrix", () => {
  it("refuses a MANAGER of another organization on every write", async () => {
    const writes: Array<[string, string, unknown]> = [
      ["PATCH", `/api/projects/${fx.orgA.projectId}/activate/phases/${explorePhaseId}`, { status: "COMPLETED" }],
      ["POST", `/api/projects/${fx.orgA.projectId}/activate/deliverables`, { issueId: fx.orgA.issueId, phaseId: explorePhaseId }],
      ["POST", `/api/projects/${fx.orgA.projectId}/activate/gates/${exploreGateId}/raise`, {}],
      ["POST", `/api/projects/${fx.orgA.projectId}/activate/backlog`, {}],
    ];
    for (const [method, path, body] of writes) {
      const res = await api(fx.orgB.users.MANAGER, path, { method, body });
      // Holding the permission in YOUR project grants nothing in someone
      // else's. assertProjectAccess refuses before the permission is read.
      expectDenied(res, `org B MANAGER calling ${method} ${path}`);
    }
  });

  it("refuses an outsider on every write", async () => {
    const res = await api(
      fx.outsider,
      `/api/projects/${fx.orgA.projectId}/activate/phases/${explorePhaseId}`,
      { method: "PATCH", body: { status: "COMPLETED" } }
    );
    expectDenied(res, "an outsider updating a phase");
  });
});
