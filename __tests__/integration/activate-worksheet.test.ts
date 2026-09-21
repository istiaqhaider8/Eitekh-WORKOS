/**
 * The per-phase implementation worksheet.
 *
 * WHAT ONLY A RUNNING SYSTEM CAN SHOW
 *
 * The counting is arithmetic and could be unit-tested. What could not is
 * that a deliverable added here becomes an ORDINARY ISSUE on the board, that
 * its code comes from a sequence which survives deletion, that a locked gate
 * refuses to have its questions edited, and that none of it is reachable
 * from another tenant. Those live in the seam between route, guard and
 * database, which is where this codebase has found both of its real
 * isolation bugs.
 *
 * The accept case is asserted first in every block, so a suite of refusals
 * cannot pass while the feature is broken for everyone.
 */

import { PrismaClient } from "@prisma/client";
import { api, expectDenied, expectAllowed, waitForServer, type Fixture } from "./harness";
import { createFixture, destroyFixture } from "./fixture";

const prisma = new PrismaClient();
let fx: Fixture;

/** Org A's Discover phase and its gate, read back after Activate is enabled. */
let discoverKey = "DISCOVER";
let gateId = "";

beforeAll(async () => {
  await waitForServer();
  fx = await createFixture(prisma);

  for (const side of ["orgA", "orgB"] as const) {
    await api(fx[side].users.OWNER, `/api/projects/${fx[side].projectId}/activate`, {
      method: "POST",
      body: { enabled: true },
    });
  }

  const gate = await prisma.activateGate.findFirst({
    where: { phase: { projectId: fx.orgA.projectId, key: discoverKey } },
    select: { id: true },
  });
  gateId = gate!.id;
}, 240_000);

afterAll(async () => {
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

const sheet = (projectId: string, phase = discoverKey) =>
  `/api/projects/${projectId}/activate/phases/${phase}/worksheet`;

// ---------------------------------------------------------------------------

describe("Reading a phase worksheet", () => {
  it("returns the phase, its gate and every workstream", async () => {
    const res = await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId));
    expectAllowed(res, "the owner reading the Discover worksheet");

    const w = res.body.worksheet;
    expect(w.phaseKey).toBe("DISCOVER");
    expect(w.deliverableCount).toBe(0);
    expect(w.tasksTotal).toBe(0);
    expect(w.tasksComplete).toBe(0);
    // G0: derived from the phase's position, not stored, so it cannot drift
    // away from where the phase actually sits.
    expect(w.gate.code).toBe("G0");
    expect(w.gate.criteriaTotal).toBeGreaterThan(0);
    expect(w.workstreams.length).toBeGreaterThan(0);
    expect(w.workstreams.every((x: any) => x.deliverableCount === 0)).toBe(true);
  });

  it("is 404 for a phase key this project does not have", async () => {
    const res = await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId, "NOT_A_PHASE"));
    expect(res.status).toBe(404);
  });

  it("refuses a cross-tenant caller, an outsider and an anonymous one", async () => {
    const path = sheet(fx.orgA.projectId);
    expectDenied(await api(fx.orgB.users.OWNER, path), "org B reading org A's worksheet");
    expectDenied(await api(fx.outsider, path), "an outsider reading the worksheet");
    expect((await api(null, path)).status).toBe(401);
  });

  it("lets a VIEWER read it but not add to it", async () => {
    expectAllowed(
      await api(fx.orgA.users.VIEWER, sheet(fx.orgA.projectId)),
      "a VIEWER reading the worksheet"
    );
    expectDenied(
      await api(fx.orgA.users.VIEWER, sheet(fx.orgA.projectId), {
        method: "POST",
        body: { name: "A viewer should not add this" },
      }),
      "a VIEWER adding a deliverable"
    );
  });
});

// ---------------------------------------------------------------------------

describe("Adding a deliverable", () => {
  let firstLinkId = "";
  let firstIssueId = "";

  it("creates an ordinary issue and links it to the phase", async () => {
    const workstreams = await prisma.activateWorkstream.findMany({
      where: { projectId: fx.orgA.projectId },
      select: { id: true, key: true },
    });
    const pm = workstreams.find((w) => w.key === "PROJECT_MANAGEMENT")!;

    const res = await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId), {
      method: "POST",
      body: { name: "Business case and target outcomes", workstreamId: pm.id },
    });
    expect(res.status).toBe(201);
    expect(res.body.deliverable.phaseCode).toBe("D-01");
    firstLinkId = res.body.deliverable.linkId;
    firstIssueId = res.body.deliverable.issueId;

    // An ordinary issue: a real key, on the board, of a type the project
    // allows. Nothing about it is worksheet-only.
    const issue = await prisma.issue.findUnique({
      where: { id: firstIssueId },
      select: {
        issueKey: true,
        issueType: true,
        projectId: true,
        status: { select: { name: true } },
      },
    });
    expect(issue!.projectId).toBe(fx.orgA.projectId);
    expect(issue!.issueKey).toMatch(/^[A-Z0-9]+-\d+$/);
    expect(issue!.issueType).toBe("TASK");
  });

  it("numbers the next one D-02, and counts it against its workstream", async () => {
    const workstreams = await prisma.activateWorkstream.findMany({
      where: { projectId: fx.orgA.projectId },
      select: { id: true, key: true },
    });
    const sol = workstreams.find((w) => w.key === "APPLICATION_DESIGN_CONFIGURATION")!;

    const res = await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId), {
      method: "POST",
      body: { name: "Suite scope and module roadmap", workstreamId: sol.id },
    });
    expect(res.body.deliverable.phaseCode).toBe("D-02");

    const w = (await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId))).body.worksheet;
    expect(w.deliverableCount).toBe(2);
    // Counted from the rows, not stored: the summary and the list cannot
    // disagree because there is only one source for both.
    const byKey = Object.fromEntries(w.workstreams.map((x: any) => [x.key, x.deliverableCount]));
    expect(byKey.PROJECT_MANAGEMENT).toBe(1);
    expect(byKey.APPLICATION_DESIGN_CONFIGURATION).toBe(1);
  });

  it("refuses a nameless deliverable and a workstream from another project", async () => {
    expect(
      (await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId), { method: "POST", body: { name: "x" } }))
        .status
    ).toBe(400);

    // The workstream id arrives in the BODY, where the path guard cannot see
    // it. Without its own check a deliverable could be filed under another
    // tenant's workstream.
    const foreign = await prisma.activateWorkstream.findFirst({
      where: { projectId: fx.orgB.projectId },
      select: { id: true },
    });
    const res = await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId), {
      method: "POST",
      body: { name: "Filed in another tenant", workstreamId: foreign!.id },
    });
    // 400 INVALID_REFERENCE, which is what this codebase answers for a
    // body-carried foreign key belonging to somebody else -- the same answer
    // the decision and scope-item routes give. It is a refusal; it just is
    // not one of the path-guard statuses expectDenied knows about.
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REFERENCE");
    expect(
      await prisma.activateDeliverableLink.count({ where: { workstreamId: foreign!.id } })
    ).toBe(0);
  });

  it("never reuses a code after a deliverable is removed", async () => {
    const removed = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables/${firstLinkId}`,
      { method: "DELETE" }
    );
    expectAllowed(removed, "removing D-01 from the phase");

    const next = await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId), {
      method: "POST",
      body: { name: "Current landscape assessment" },
    });
    /**
     * D-03, not D-01.
     *
     * The counter only goes up. Derived from the highest code still present
     * it would have said D-03 here too — but after removing BOTH it would
     * restart at D-01, and a status report citing D-01 would come to mean a
     * different piece of work. The regression that shape of bug produces was
     * found in the scope-item allocator by live testing, not by a suite.
     */
    expect(next.body.deliverable.phaseCode).toBe("D-03");
  });

  it("keeps the issue on the board when the deliverable is unlinked", async () => {
    // Deliberate: the issue may be in a sprint or carry comments. Unlinking
    // is a statement about the phase plan, not about the work.
    expect(await prisma.issue.count({ where: { id: firstIssueId } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("Tasks on a deliverable", () => {
  let issueId = "";
  let linkId = "";

  beforeAll(async () => {
    const res = await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId), {
      method: "POST",
      body: { name: "Change readiness assessment" },
    });
    issueId = res.body.deliverable.issueId;
    linkId = res.body.deliverable.linkId;
  }, 60_000);

  it("adds tasks as subtasks and counts them", async () => {
    for (const title of [
      "Assess appetite and capacity for change",
      "Identify the populations most affected",
      "Identify sponsorship gaps and how they will be closed",
    ]) {
      const res = await api(fx.orgA.users.OWNER, `/api/issues/${issueId}/subtasks`, {
        method: "POST",
        body: { title },
      });
      expectAllowed(res, `adding the task "${title}"`);
    }

    const w = (await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId))).body.worksheet;
    const d = w.deliverables.find((x: any) => x.linkId === linkId);
    expect(d.tasksTotal).toBe(3);
    expect(d.tasksComplete).toBe(0);
    // The phase total moves with it, from the same rows.
    expect(w.tasksTotal).toBe(3);
    expect(w.tasksComplete).toBe(0);
  });

  it("moves every counter when one task is completed", async () => {
    const w0 = (await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId))).body.worksheet;
    const task = w0.deliverables.find((x: any) => x.linkId === linkId).tasks[0];

    const done = await api(fx.orgA.users.OWNER, `/api/subtasks/${task.id}`, {
      method: "PATCH",
      body: { isCompleted: true },
    });
    expectAllowed(done, "completing a task");

    const w1 = (await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId))).body.worksheet;
    expect(w1.deliverables.find((x: any) => x.linkId === linkId).tasksComplete).toBe(1);
    expect(w1.tasksComplete).toBe(1);
    expect(w1.tasksTotal).toBe(3);
  });

  it("drops the denominator when a task is removed", async () => {
    const w0 = (await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId))).body.worksheet;
    const task = w0.deliverables.find((x: any) => x.linkId === linkId).tasks[2];

    expectAllowed(
      await api(fx.orgA.users.OWNER, `/api/subtasks/${task.id}`, { method: "DELETE" }),
      "removing a task"
    );

    const w1 = (await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId))).body.worksheet;
    expect(w1.deliverables.find((x: any) => x.linkId === linkId).tasksTotal).toBe(2);
    expect(w1.tasksTotal).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe("Gate criteria", () => {
  let addedId = "";

  it("adds a criterion, and the denominator follows", async () => {
    const before = (await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId))).body.worksheet.gate;

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gateId}/criteria`,
      { method: "POST", body: { criterion: "Top ten risks logged with named owners" } }
    );
    expect(res.status).toBe(201);
    addedId = res.body.criterion.id;

    const after = (await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId))).body.worksheet.gate;
    expect(after.criteriaTotal).toBe(before.criteriaTotal + 1);
    expect(after.criteriaMet).toBe(before.criteriaMet);
  });

  it("counts a criterion as met when it is MET or WAIVED, and not before", async () => {
    const base = `/api/projects/${fx.orgA.projectId}/activate/gates/${gateId}/criteria/${addedId}`;
    const read = async () =>
      (await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId))).body.worksheet.gate;

    const start = (await read()).criteriaMet;
    await api(fx.orgA.users.OWNER, base, { method: "PATCH", body: { status: "MET" } });
    expect((await read()).criteriaMet).toBe(start + 1);

    // Waived is a decision somebody took; it settles the criterion as surely
    // as meeting it, and counting it as outstanding would leave the gate
    // permanently short for a reason nobody can act on.
    await api(fx.orgA.users.OWNER, base, { method: "PATCH", body: { status: "WAIVED" } });
    expect((await read()).criteriaMet).toBe(start + 1);

    await api(fx.orgA.users.OWNER, base, { method: "PATCH", body: { status: "PENDING" } });
    expect((await read()).criteriaMet).toBe(start);
  });

  it("removes one, and refuses to empty the gate", async () => {
    expectAllowed(
      await api(
        fx.orgA.users.OWNER,
        `/api/projects/${fx.orgA.projectId}/activate/gates/${gateId}/criteria/${addedId}`,
        { method: "DELETE" }
      ),
      "removing a criterion from an open gate"
    );

    // Empty the rest, then check the last one is refused: a gate with no
    // criteria passes by being empty, which is the same loophole as deleting
    // an unmet criterion, reached by a different road.
    const gate = (await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId))).body.worksheet.gate;
    for (const c of gate.criteria.slice(0, -1)) {
      await api(
        fx.orgA.users.OWNER,
        `/api/projects/${fx.orgA.projectId}/activate/gates/${gateId}/criteria/${c.id}`,
        { method: "DELETE" }
      );
    }
    const last = gate.criteria[gate.criteria.length - 1];
    const refused = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gateId}/criteria/${last.id}`,
      { method: "DELETE" }
    );
    expect(refused.status).toBe(409);
    expect(
      (await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId))).body.worksheet.gate.criteriaTotal
    ).toBe(1);
  });

  it("freezes the criteria once the gate is raised", async () => {
    /**
     * The loophole this closes: a gate is passed when its criteria are
     * satisfied, so if an unmet criterion can be deleted while sign-off is
     * pending, a gate can be "passed" by deleting what it asked for — and
     * the record afterwards shows a clean gate with no trace of the
     * question.
     */
    /**
     * The one remaining criterion has to be satisfied first.
     *
     * A gate refuses to be raised while anything is outstanding, which is
     * the rule working. The first version of this test asked for sign-off on
     * an unmet gate, got a 409, and read the resulting OPEN status as a
     * failure of the freeze rather than as the guard standing in front of it.
     */
    const open = (await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId))).body.worksheet.gate;
    await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gateId}/criteria/${open.criteria[0].id}`,
      { method: "PATCH", body: { status: "MET" } }
    );
    const raised = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gateId}/raise`,
      { method: "POST", body: {} }
    );
    expectAllowed(raised, "raising a gate whose criteria are all settled");

    const gate = (await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId))).body.worksheet.gate;
    expect(gate.status).toBe("RAISED");

    const add = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gateId}/criteria`,
      { method: "POST", body: { criterion: "Sneaked in after raising" } }
    );
    expect(add.status).toBe(409);

    const del = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/gates/${gateId}/criteria/${gate.criteria[0].id}`,
      { method: "DELETE" }
    );
    expect(del.status).toBe(409);
    expect(
      (await api(fx.orgA.users.OWNER, sheet(fx.orgA.projectId))).body.worksheet.gate.criteriaTotal
    ).toBe(1);
  });

  it("refuses criteria changes from another tenant and from a VIEWER", async () => {
    const path = `/api/projects/${fx.orgA.projectId}/activate/gates/${gateId}/criteria`;
    expectDenied(
      await api(fx.orgB.users.OWNER, path, { method: "POST", body: { criterion: "Theirs" } }),
      "org B adding a criterion to org A's gate"
    );
    expectDenied(
      await api(fx.orgA.users.VIEWER, path, { method: "POST", body: { criterion: "Viewer" } }),
      "a VIEWER adding a criterion"
    );
    expect((await api(null, path, { method: "POST", body: { criterion: "Anon" } })).status).toBe(
      401
    );
  });
});

// ---------------------------------------------------------------------------

/**
 * A second phase, because the first one hid a bug.
 *
 * Everything above runs against Discover, and the code allocator was written
 * with "D-" as a literal. That was invisibly correct for as long as Discover
 * was the only phase with a worksheet, and produced D-01 on the Prepare
 * phase the moment a second one existed. A feature that is per-phase needs a
 * test on more than one phase.
 */
describe("A second phase's worksheet", () => {
  it("numbers Prepare deliverables P-01, independently of Discover", async () => {
    const path = `/api/projects/${fx.orgA.projectId}/activate/phases/PREPARE/worksheet`;

    const before = await api(fx.orgA.users.ADMIN, path);
    expectAllowed(before, "reading the Prepare worksheet");
    expect(before.body.worksheet.phaseKey).toBe("PREPARE");
    // Its own gate, its own number: G1, from the phase's position.
    expect(before.body.worksheet.gate.code).toBe("G1");
    expect(before.body.worksheet.deliverableCount).toBe(0);

    const first = await api(fx.orgA.users.ADMIN, path, {
      method: "POST",
      body: { name: "Project charter and governance" },
    });
    expect(first.status).toBe(201);
    expect(first.body.deliverable.phaseCode).toBe("P-01");

    const second = await api(fx.orgA.users.ADMIN, path, {
      method: "POST",
      body: { name: "Plan, RAID and reporting" },
    });
    expect(second.body.deliverable.phaseCode).toBe("P-02");
  });

  it("keeps the two phases' sequences and contents apart", async () => {
    const discover = (await api(fx.orgA.users.ADMIN, sheet(fx.orgA.projectId))).body.worksheet;
    const prepare = (
      await api(
        fx.orgA.users.ADMIN,
        `/api/projects/${fx.orgA.projectId}/activate/phases/PREPARE/worksheet`
      )
    ).body.worksheet;

    // Discover's codes are untouched by anything Prepare did, and neither
    // phase's deliverables appear in the other's worksheet.
    expect(discover.deliverables.every((d: any) => (d.phaseCode ?? "").startsWith("D-"))).toBe(
      true
    );
    expect(prepare.deliverables.every((d: any) => (d.phaseCode ?? "").startsWith("P-"))).toBe(true);
    const discoverIds = new Set(discover.deliverables.map((d: any) => d.linkId));
    expect(prepare.deliverables.some((d: any) => discoverIds.has(d.linkId))).toBe(false);
  });

  it("refuses a cross-tenant caller on the second phase too", async () => {
    // Asserted per phase rather than once: the guard is on the route, but a
    // path that resolves a phase by key has one more place to get the
    // project scoping wrong.
    const path = `/api/projects/${fx.orgA.projectId}/activate/phases/PREPARE/worksheet`;
    expectDenied(await api(fx.orgB.users.OWNER, path), "org B reading org A's Prepare worksheet");
    expectDenied(
      await api(fx.orgB.users.OWNER, path, { method: "POST", body: { name: "Theirs" } }),
      "org B adding to org A's Prepare worksheet"
    );
  });
});

// ---------------------------------------------------------------------------

/**
 * The worksheet lists the phase PLAN, not everything linked to the phase.
 *
 * A fit-to-standard decision card is filed in Explore and is real work in
 * that phase — but it is not a numbered line of the plan: no code, no task
 * list. Counting it among the deliverables would make the header argue with
 * the rows beneath it; dropping it silently would hide real work. So it is
 * counted separately and reported.
 */
describe("Work in a phase that is not a worksheet line", () => {
  it("counts an uncoded deliverable apart from the plan, and says so", async () => {
    const path = `/api/projects/${fx.orgA.projectId}/activate/phases/PREPARE/worksheet`;
    const before = (await api(fx.orgA.users.ADMIN, path)).body.worksheet;
    expect(before.unlistedCount).toBe(0);

    // An issue adopted into the phase from the board: linked, but never a
    // numbered line. A generated decision card has the same shape.
    const phase = await prisma.activatePhase.findUnique({
      where: { projectId_key: { projectId: fx.orgA.projectId, key: "PREPARE" } },
      select: { id: true },
    });
    const link = await prisma.activateDeliverableLink.create({
      data: { issueId: fx.orgA.issueId, phaseId: phase!.id },
      select: { id: true },
    });

    const after = (await api(fx.orgA.users.ADMIN, path)).body.worksheet;
    expect(after.unlistedCount).toBe(1);
    // The plan is unchanged: same rows, same count, same task totals.
    expect(after.deliverableCount).toBe(before.deliverableCount);
    expect(after.deliverables.every((d: any) => d.phaseCode)).toBe(true);
    expect(after.tasksTotal).toBe(before.tasksTotal);

    await prisma.activateDeliverableLink.delete({ where: { id: link.id } });
    expect((await api(fx.orgA.users.ADMIN, path)).body.worksheet.unlistedCount).toBe(0);
  });
});
