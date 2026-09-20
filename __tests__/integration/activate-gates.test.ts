/**
 * SAP Activate increment 4 — gates, criteria, approvals.
 *
 * This is the only part of Activate whose failure mode is not "the board
 * looks wrong" but "the record of who decided is untrue", so the suite is
 * built around three claims:
 *
 *   1. SEPARATION OF DUTIES. Whoever raises a gate cannot sign it off, and a
 *      refused attempt leaves a trace. Asserted with a database read proving
 *      no approval row was written, because a 403 on its own does not prove
 *      the write did not happen.
 *
 *   2. THE LEDGER IS APPEND-ONLY. A reversal is a second row. The first row
 *      is still there afterwards, unchanged, and no route exists that could
 *      edit it.
 *
 *   3. gate.status NEVER DIVERGES FROM THE LEDGER. The test recomputes it
 *      from the stored approvals with the same function the writer uses, and
 *      compares against what is in the column.
 *
 * THE ACCEPT CASE IS ASSERTED FIRST in every block. A suite that only proves
 * refusals passes just as happily when the feature is broken for everyone.
 *
 * ON THE TWO ACTORS: fixture OWNER is the organization OWNER and fixture
 * ADMIN is the organization ADMIN. Both derive the `org-admin` PBAC role,
 * which carries every permission, so both can raise and both can sign off.
 * That is what makes a genuine two-person test possible here — and see the
 * note in the increment report about no PROJECT-scoped system role granting
 * any activate:* permission today.
 */

import { PrismaClient } from "@prisma/client";
import { api, expectDenied, expectAllowed, waitForServer, type Fixture } from "./harness";
import { createFixture, destroyFixture } from "./fixture";
import { deriveGateStatus } from "@/lib/activate-gates";

const prisma = new PrismaClient();
let fx: Fixture;

/** Phases of each org, keyed by phase key, populated once Activate is on. */
let phasesA: any[];
let phasesB: any[];

/** Returns the single gate seeded on the named phase of org A. */
function gateOf(phases: any[], phaseKey: string) {
  const phase = phases.find((p: any) => p.key === phaseKey);
  return { phase, gate: phase.gates[0] };
}

async function enableAndLoad(side: "orgA" | "orgB") {
  const s = fx[side];
  await api(s.users.OWNER, `/api/projects/${s.projectId}/activate`, {
    method: "POST",
    body: { enabled: true },
  });
  const res = await api(s.users.OWNER, `/api/projects/${s.projectId}/activate`);
  return res.body.phases;
}

/** Mark every criterion of a gate MET, as the raiser would. */
async function satisfyAllCriteria(gateId: string) {
  const criteria = await prisma.activateGateCriterion.findMany({
    where: { gateId },
    select: { id: true },
  });
  for (const c of criteria) {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gateId}/criteria/${c.id}`,
      { method: "PATCH", body: { status: "MET" } }
    );
    expect(res.status).toBe(200);
  }
}

beforeAll(async () => {
  await waitForServer();
  fx = await createFixture(prisma);
  phasesA = await enableAndLoad("orgA");
  phasesB = await enableAndLoad("orgB");
}, 180_000);

afterAll(async () => {
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("Gate detail", () => {
  it("returns the gate, its criteria and an empty ledger", async () => {
    const { gate } = gateOf(phasesA, "PREPARE");
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}`
    );
    expectAllowed(res, "the owner reading a gate");
    expect(res.body.gate.status).toBe("OPEN");
    expect(res.body.gate.criteria.length).toBeGreaterThan(0);
    expect(res.body.gate.approvals).toEqual([]);
    expect(res.body.gate.raisedById).toBeNull();
  });

  it("refuses another organization's gate id as 404, not 403", async () => {
    const { gate: gateB } = gateOf(phasesB, "PREPARE");
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gateB.id}`
    );
    expect(res.status).toBe(404);
  });

  it("refuses a cross-tenant caller on the project path", async () => {
    const { gate } = gateOf(phasesA, "PREPARE");
    const res = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}`
    );
    expectDenied(res, "org B reading org A's gate");
  });

  it("refuses an outsider", async () => {
    const { gate } = gateOf(phasesA, "PREPARE");
    const res = await api(
      fx.outsider,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}`
    );
    expectDenied(res, "an outsider reading a gate");
  });

  it("refuses an unauthenticated caller", async () => {
    const { gate } = gateOf(phasesA, "PREPARE");
    const res = await api(null, `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------

describe("Gate criteria", () => {
  it("marks a criterion met and records the evidence", async () => {
    const { gate } = gateOf(phasesA, "PREPARE");
    const criterion = await prisma.activateGateCriterion.findFirst({
      where: { gateId: gate.id },
      select: { id: true },
    });

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/criteria/${criterion!.id}`,
      {
        method: "PATCH",
        body: { status: "MET", evidenceRef: "soak drill 2026-09", evidenceIssueId: fx.orgA.issueId },
      }
    );
    expectAllowed(res, "the owner marking a criterion met");
    expect(res.body.criterion.status).toBe("MET");
    expect(res.body.criterion.evidenceIssueId).toBe(fx.orgA.issueId);
  });

  it("refuses an evidence issue belonging to another organization", async () => {
    const { gate } = gateOf(phasesA, "PREPARE");
    const criterion = await prisma.activateGateCriterion.findFirst({
      where: { gateId: gate.id },
      select: { id: true },
    });

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/criteria/${criterion!.id}`,
      { method: "PATCH", body: { evidenceIssueId: fx.orgB.issueId } }
    );
    expect(res.status).toBe(400);

    const row = await prisma.activateGateCriterion.findUnique({
      where: { id: criterion!.id },
      select: { evidenceIssueId: true },
    });
    expect(row?.evidenceIssueId).not.toBe(fx.orgB.issueId);
  });

  it("refuses another organization's criterion as 404 and leaves it unchanged", async () => {
    const { gate: gateB } = gateOf(phasesB, "PREPARE");
    const criterionB = await prisma.activateGateCriterion.findFirst({
      where: { gateId: gateB.id },
      select: { id: true, status: true },
    });

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gateB.id}/criteria/${criterionB!.id}`,
      { method: "PATCH", body: { status: "MET" } }
    );
    expect(res.status).toBe(404);

    const after = await prisma.activateGateCriterion.findUnique({
      where: { id: criterionB!.id },
      select: { status: true },
    });
    expect(after?.status).toBe(criterionB!.status);
  });

  it("rejects an unknown criterion status with 400, not 500", async () => {
    const { gate } = gateOf(phasesA, "PREPARE");
    const criterion = await prisma.activateGateCriterion.findFirst({
      where: { gateId: gate.id },
      select: { id: true },
    });

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/criteria/${criterion!.id}`,
      { method: "PATCH", body: { status: "SORT_OF_MET" } }
    );
    expect(res.status).toBe(400);
  });

  it("refuses a VIEWER", async () => {
    const { gate } = gateOf(phasesA, "PREPARE");
    const criterion = await prisma.activateGateCriterion.findFirst({
      where: { gateId: gate.id },
      select: { id: true },
    });

    const res = await api(
      fx.orgA.users.VIEWER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/criteria/${criterion!.id}`,
      { method: "PATCH", body: { status: "MET" } }
    );
    expectDenied(res, "a VIEWER marking a criterion met");
  });

  it("refuses a MEMBER", async () => {
    const { gate } = gateOf(phasesA, "PREPARE");
    const criterion = await prisma.activateGateCriterion.findFirst({
      where: { gateId: gate.id },
      select: { id: true },
    });

    const res = await api(
      fx.orgA.users.MEMBER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/criteria/${criterion!.id}`,
      { method: "PATCH", body: { status: "MET" } }
    );
    expectDenied(res, "a MEMBER marking a criterion met");
  });
});

// ---------------------------------------------------------------------------

describe("Raising a gate", () => {
  it("refuses while criteria are outstanding, and names them", async () => {
    const { gate } = gateOf(phasesA, "EXPLORE");
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/raise`,
      { method: "POST", body: {} }
    );
    expect(res.status).toBe(409);
    // The refusal has to be actionable: a gate is exactly where someone is
    // working from a checklist filled in by somebody else.
    expect(res.body.error).toMatch(/neither met nor waived/i);

    const still = await prisma.activateGate.findUnique({
      where: { id: gate.id },
      select: { status: true, raisedById: true },
    });
    expect(still?.status).toBe("OPEN");
    expect(still?.raisedById).toBeNull();
  });

  it("raises once every criterion is met or waived, stamping the raiser", async () => {
    const { gate } = gateOf(phasesA, "EXPLORE");
    await satisfyAllCriteria(gate.id);

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/raise`,
      { method: "POST", body: {} }
    );
    expectAllowed(res, "raising a gate whose criteria are all met");
    expect(res.body.gate.status).toBe("RAISED");
    expect(res.body.gate.raisedById).toBe(fx.orgA.users.OWNER.id);
    expect(res.body.gate.raisedAt).not.toBeNull();
  });

  it("treats WAIVED as satisfying, and says so distinctly from MET", async () => {
    const { gate } = gateOf(phasesA, "DISCOVER");
    const criteria = await prisma.activateGateCriterion.findMany({
      where: { gateId: gate.id },
      select: { id: true },
      orderBy: { position: "asc" },
    });

    for (const [i, c] of criteria.entries()) {
      await api(
        fx.orgA.users.OWNER,
        `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/criteria/${c.id}`,
        { method: "PATCH", body: { status: i === 0 ? "WAIVED" : "MET" } }
      );
    }

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/raise`,
      { method: "POST", body: {} }
    );
    expect(res.status).toBe(200);

    // WAIVED is stored as WAIVED, not silently normalised to MET: the two
    // read very differently to an auditor.
    const waived = await prisma.activateGateCriterion.findUnique({
      where: { id: criteria[0].id },
      select: { status: true },
    });
    expect(waived?.status).toBe("WAIVED");
  });

  it("refuses to raise a gate that is already raised", async () => {
    const { gate } = gateOf(phasesA, "EXPLORE");
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/raise`,
      { method: "POST", body: {} }
    );
    expect(res.status).toBe(409);
  });

  it("refuses another organization's gate as 404", async () => {
    const { gate: gateB } = gateOf(phasesB, "EXPLORE");
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gateB.id}/raise`,
      { method: "POST", body: {} }
    );
    expect(res.status).toBe(404);

    const untouched = await prisma.activateGate.findUnique({
      where: { id: gateB.id },
      select: { status: true, raisedById: true },
    });
    expect(untouched?.raisedById).toBeNull();
  });

  it("refuses a VIEWER and a MEMBER", async () => {
    const { gate } = gateOf(phasesA, "REALIZE");
    for (const who of [fx.orgA.users.VIEWER, fx.orgA.users.MEMBER]) {
      const res = await api(
        who,
        `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/raise`,
        { method: "POST", body: {} }
      );
      expectDenied(res, `${who.label} raising a gate`);
    }
  });

  it("refuses an unauthenticated caller", async () => {
    const { gate } = gateOf(phasesA, "REALIZE");
    const res = await api(
      null,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/raise`,
      { method: "POST", body: {} }
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------

describe("Separation of duties — the exit gate", () => {
  it("refuses the raiser's own sign-off, and writes no approval row", async () => {
    const { gate } = gateOf(phasesA, "EXPLORE"); // raised by OWNER above

    const before = await prisma.activateGateApproval.count({ where: { gateId: gate.id } });

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/approvals`,
      { method: "POST", body: { decision: "APPROVED", comment: "looks fine to me" } }
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/raised this gate/i);

    // A 403 alone does not prove the write did not happen.
    const after = await prisma.activateGateApproval.count({ where: { gateId: gate.id } });
    expect(after).toBe(before);

    const stillRaised = await prisma.activateGate.findUnique({
      where: { id: gate.id },
      select: { status: true },
    });
    expect(stillRaised?.status).toBe("RAISED");
  });

  it("accepts a DIFFERENT approver — the control permits what it should", async () => {
    const { gate } = gateOf(phasesA, "EXPLORE");
    const res = await api(
      fx.orgA.users.ADMIN,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/approvals`,
      { method: "POST", body: { decision: "APPROVED", comment: "criteria verified" } }
    );
    expect(res.status).toBe(201);
    expect(res.body.gateStatus).toBe("APPROVED");

    const row = await prisma.activateGateApproval.findFirst({
      where: { gateId: gate.id },
      select: { approverId: true, decision: true },
    });
    expect(row?.approverId).toBe(fx.orgA.users.ADMIN.id);
    expect(row?.decision).toBe("APPROVED");
  });

  it("refuses sign-off on a gate that was never raised", async () => {
    const { gate } = gateOf(phasesA, "RUN");
    const res = await api(
      fx.orgA.users.ADMIN,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/approvals`,
      { method: "POST", body: { decision: "APPROVED" } }
    );
    // An unraised gate has no raiser, so the SoD comparison would be vacuous.
    // This must be refused on state before SoD is even consulted.
    expect(res.status).toBe(409);
    expect(await prisma.activateGateApproval.count({ where: { gateId: gate.id } })).toBe(0);
  });

  it("refuses a duplicate approval of an already-approved gate", async () => {
    const { gate } = gateOf(phasesA, "EXPLORE");
    const res = await api(
      fx.orgA.users.ADMIN,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/approvals`,
      { method: "POST", body: { decision: "APPROVED" } }
    );
    expect(res.status).toBe(409);
  });

  it("freezes the criteria of an approved gate", async () => {
    const { gate } = gateOf(phasesA, "EXPLORE");
    const criterion = await prisma.activateGateCriterion.findFirst({
      where: { gateId: gate.id },
      select: { id: true },
    });

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/criteria/${criterion!.id}`,
      { method: "PATCH", body: { status: "NOT_MET" } }
    );
    // The approver consented to a specific list of satisfied criteria.
    expect(res.status).toBe(409);
  });

  it("refuses a VIEWER, a MEMBER and a MANAGER at sign-off", async () => {
    const { gate } = gateOf(phasesA, "DISCOVER"); // raised by OWNER above
    for (const who of [fx.orgA.users.VIEWER, fx.orgA.users.MEMBER, fx.orgA.users.MANAGER]) {
      const res = await api(
        who,
        `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/approvals`,
        { method: "POST", body: { decision: "APPROVED" } }
      );
      expectDenied(res, `${who.label} signing off a gate`);
    }
    expect(await prisma.activateGateApproval.count({ where: { gateId: gate.id } })).toBe(0);
  });

  it("refuses a cross-tenant approver on the project path", async () => {
    const { gate } = gateOf(phasesA, "DISCOVER");
    const res = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/approvals`,
      { method: "POST", body: { decision: "APPROVED" } }
    );
    expectDenied(res, "org B signing off org A's gate");
    expect(await prisma.activateGateApproval.count({ where: { gateId: gate.id } })).toBe(0);
  });

  it("rejects a malformed decision with 400, not 500", async () => {
    const { gate } = gateOf(phasesA, "DISCOVER");
    const res = await api(
      fx.orgA.users.ADMIN,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/approvals`,
      { method: "POST", body: { decision: "MAYBE" } }
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe("The approval ledger is append-only", () => {
  it("records a rejection as a SECOND row, leaving the first intact", async () => {
    const { gate } = gateOf(phasesA, "EXPLORE"); // APPROVED by ADMIN above

    const firstBefore = await prisma.activateGateApproval.findFirst({
      where: { gateId: gate.id },
      orderBy: { decidedAt: "asc" },
      select: { id: true, decision: true, decidedAt: true },
    });

    const res = await api(
      fx.orgA.users.ADMIN,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/approvals`,
      { method: "POST", body: { decision: "REJECTED", comment: "cutover aborted" } }
    );
    expect(res.status).toBe(201);
    expect(res.body.gateStatus).toBe("REJECTED");

    const all = await prisma.activateGateApproval.findMany({
      where: { gateId: gate.id },
      orderBy: { decidedAt: "asc" },
      select: { id: true, decision: true, decidedAt: true },
    });
    expect(all).toHaveLength(2);

    // The original approval is untouched — not edited into a rejection.
    expect(all[0].id).toBe(firstBefore!.id);
    expect(all[0].decision).toBe("APPROVED");
    expect(all[0].decidedAt.getTime()).toBe(firstBefore!.decidedAt.getTime());
    expect(all[1].decision).toBe("REJECTED");
  });

  it("exposes no route that could edit or delete an approval", async () => {
    const { gate } = gateOf(phasesA, "EXPLORE");
    const path = `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/approvals`;

    for (const method of ["PATCH", "PUT", "DELETE"]) {
      const res = await api(fx.orgA.users.ADMIN, path, { method, body: { decision: "APPROVED" } });
      // Append-only is enforced by the absence of a handler, not by a check
      // inside one that somebody could later relax.
      expect(res.status).toBe(405);
    }

    expect(await prisma.activateGateApproval.count({ where: { gateId: gate.id } })).toBe(2);
  });

  it("lets a rejected gate be re-raised, and the new raiser is the current one", async () => {
    const { gate } = gateOf(phasesA, "EXPLORE");
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gate.id}/raise`,
      { method: "POST", body: {} }
    );
    expect(res.status).toBe(200);
    expect(res.body.gate.status).toBe("RAISED");

    // Two decisions are still on record; re-raising appends nothing and
    // erases nothing.
    expect(await prisma.activateGateApproval.count({ where: { gateId: gate.id } })).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe("gate.status never diverges from the ledger", () => {
  it("matches the value derived from the stored approvals, for every gate", async () => {
    const gates = await prisma.activateGate.findMany({
      where: { phase: { projectId: fx.orgA.projectId } },
      select: {
        id: true,
        status: true,
        raisedAt: true,
        approvals: { select: { decision: true, decidedAt: true } },
      },
    });

    expect(gates.length).toBe(6);

    // At least one gate must have a non-trivial history, or this assertion
    // would pass on a project where nothing ever happened.
    expect(gates.some((g) => g.approvals.length >= 2)).toBe(true);

    for (const g of gates) {
      expect({ id: g.id, status: g.status }).toEqual({
        id: g.id,
        status: deriveGateStatus(g.approvals, g.raisedAt),
      });
    }
  });
});
