/**
 * Enabling Activate produces the methodology's plan, not six empty phases.
 *
 * The template now carries 57 deliverables, 213 task titles and 48 gate
 * criteria, and turning Activate on seeds them into the project as real
 * issues. That is a lot of writing to get right silently, and most of the
 * ways it can go wrong produce a plausible-looking screen: tasks in the
 * wrong order, deliverables filed under no workstream, a phase numbered
 * from the wrong sequence, or — worst — work that arrives already ticked.
 *
 * The seeding happens server-side during one request, so this suite spends
 * almost no mutation budget: two enables and a handful of reads.
 */

import { PrismaClient } from "@prisma/client";
import { api, expectAllowed, waitForServer, type Fixture } from "./harness";
import { createFixture, destroyFixture } from "./fixture";
import { ACTIVATE_PHASE_CONTENT, contentTotals } from "@/lib/activate-template-content";

const prisma = new PrismaClient();
let fx: Fixture;

const KEYS = ["DISCOVER", "PREPARE", "EXPLORE", "REALIZE", "DEPLOY", "RUN"];
const PREFIX: Record<string, string> = {
  DISCOVER: "D",
  PREPARE: "P",
  EXPLORE: "E",
  REALIZE: "R",
  DEPLOY: "DP",
  RUN: "RN",
};

beforeAll(async () => {
  await waitForServer();
  fx = await createFixture(prisma);

  // Org A takes the plan; org B declines it. Both in one fixture, so the
  // two outcomes are compared against the same methodology and the same run.
  expectAllowed(
    await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`, {
      method: "POST",
      body: { enabled: true },
    }),
    "enabling Activate with the plan"
  );
  expectAllowed(
    await api(fx.orgB.users.OWNER, `/api/projects/${fx.orgB.projectId}/activate`, {
      method: "POST",
      body: { enabled: true, seedPlan: false },
    }),
    "enabling Activate without the plan"
  );
}, 240_000);

afterAll(async () => {
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

async function phaseOf(projectId: string, key: string) {
  return prisma.activatePhase.findUnique({
    where: { projectId_key: { projectId, key } },
    select: { id: true },
  });
}

describe("A project seeded from the methodology", () => {
  it("gets every deliverable of every phase, in order, under the right code", async () => {
    for (const key of KEYS) {
      const phase = await phaseOf(fx.orgA.projectId, key);
      const links = await prisma.activateDeliverableLink.findMany({
        where: { phaseId: phase!.id },
        orderBy: { phaseCode: "asc" },
        select: { phaseCode: true, issue: { select: { title: true } } },
      });
      const plan = ACTIVATE_PHASE_CONTENT[key].deliverables;

      expect({ key, count: links.length }).toEqual({ key, count: plan.length });
      // Codes run 01..n with this phase's own prefix. A shared sequence, or
      // the wrong prefix, is the failure that made D-01..D-12 appear in
      // Prepare once and went unnoticed until someone read the screen.
      expect(links.map((l) => l.phaseCode)).toEqual(
        plan.map((_, i) => `${PREFIX[key]}-${String(i + 1).padStart(2, "0")}`)
      );
      expect(links.map((l) => l.issue.title)).toEqual(plan.map((d) => d.name));
    }
  });

  it("gets every task, in the order the methodology states them", async () => {
    for (const key of KEYS) {
      const phase = await phaseOf(fx.orgA.projectId, key);
      const links = await prisma.activateDeliverableLink.findMany({
        where: { phaseId: phase!.id },
        orderBy: { phaseCode: "asc" },
        select: {
          issue: {
            select: {
              title: true,
              subtasks: { orderBy: { createdAt: "asc" }, select: { title: true } },
            },
          },
        },
      });
      const plan = ACTIVATE_PHASE_CONTENT[key].deliverables;
      for (let i = 0; i < plan.length; i += 1) {
        // Order matters: a checklist is read top to bottom, and rows written
        // inside one transaction share a timestamp unless something makes
        // them distinct. This is the assertion that catches that.
        expect({ key, d: plan[i].name, tasks: links[i].issue.subtasks.map((t) => t.title) }).toEqual(
          { key, d: plan[i].name, tasks: plan[i].tasks }
        );
      }
    }
  });

  it("totals the whole methodology, so a phase cannot go missing quietly", async () => {
    const links = await prisma.activateDeliverableLink.count({
      where: { phase: { projectId: fx.orgA.projectId } },
    });
    // Scoped to the seeded deliverables. The fixture's own issue carries a
    // subtask of its own, and counting it here would make the total depend
    // on the fixture rather than on the methodology.
    const tasks = await prisma.subtask.count({
      where: { parentIssue: { activateDeliverable: { phase: { projectId: fx.orgA.projectId } } } },
    });
    const criteria = await prisma.activateGateCriterion.count({
      where: { gate: { phase: { projectId: fx.orgA.projectId } } },
    });
    expect({ links, tasks, criteria }).toEqual({
      links: contentTotals().deliverables,
      tasks: contentTotals().tasks,
      criteria: contentTotals().criteria,
    });
  });

  it("arrives with nothing done — no ticked task, no met criterion, no raised gate", async () => {
    // A project that reports progress it has not made is worse than one that
    // reports none: somebody plans against it.
    expect(
      await prisma.subtask.count({
        where: { parentIssue: { projectId: fx.orgA.projectId }, isCompleted: true },
      })
    ).toBe(0);
    expect(
      await prisma.activateGateCriterion.count({
        where: { gate: { phase: { projectId: fx.orgA.projectId } }, status: { not: "PENDING" } },
      })
    ).toBe(0);
    const gates = await prisma.activateGate.findMany({
      where: { phase: { projectId: fx.orgA.projectId } },
      select: { status: true, raisedAt: true },
    });
    expect(gates.every((g) => g.status === "OPEN" && g.raisedAt === null)).toBe(true);
  });

  it("creates ordinary board issues, in the backlog, of a type the project allows", async () => {
    const issues = await prisma.issue.findMany({
      where: { projectId: fx.orgA.projectId, activateDeliverable: { isNot: null } },
      select: {
        issueKey: true,
        issueType: true,
        projectId: true,
        status: { select: { id: true, category: true } },
      },
    });
    expect(issues.length).toBe(contentTotals().deliverables);
    expect(issues.every((i) => i.projectId === fx.orgA.projectId)).toBe(true);
    expect(issues.every((i) => /^[A-Z0-9]+-\d+$/.test(i.issueKey))).toBe(true);

    /**
     * All in one column, and not a finished one.
     *
     * Asserted against the column the shared resolver picks rather than
     * against the literal "BACKLOG": this fixture's workflow is To Do /
     * In Progress / Done with no backlog column at all, and the resolver's
     * documented fallback is the first column. Pinning the category here
     * would test the fixture's workflow, not the seeding — while still
     * missing the failure that matters, which is seeded work landing in
     * Done and reading as already finished.
     */
    const workflow = await prisma.workflow.findFirst({
      where: { projectId: fx.orgA.projectId },
      select: { statuses: { orderBy: { position: "asc" }, select: { id: true, category: true } } },
    });
    const expected =
      workflow!.statuses.find((s) => s.category === "BACKLOG") ?? workflow!.statuses[0];
    expect(issues.every((i) => i.status?.id === expected.id)).toBe(true);
    expect(issues.some((i) => i.status?.category === "DONE")).toBe(false);
    // Every key distinct: the allocator was called once per deliverable.
    expect(new Set(issues.map((i) => i.issueKey)).size).toBe(issues.length);
  });

  it("files each deliverable under the workstream the methodology names", async () => {
    const phase = await phaseOf(fx.orgA.projectId, "DISCOVER");
    const links = await prisma.activateDeliverableLink.findMany({
      where: { phaseId: phase!.id },
      orderBy: { phaseCode: "asc" },
      select: { workstream: { select: { key: true } } },
    });
    expect(links.map((l) => l.workstream?.key ?? null)).toEqual(
      ACTIVATE_PHASE_CONTENT.DISCOVER.deliverables.map((d) => d.workstreamKey)
    );
  });

  it("shows the whole plan through the worksheet the screens read", async () => {
    // The database being right and the screen being right are two claims.
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/phases/REALIZE/worksheet`
    );
    expectAllowed(res, "reading the seeded Realize worksheet");
    const w = res.body.worksheet;
    const plan = ACTIVATE_PHASE_CONTENT.REALIZE;
    expect(w.deliverableCount).toBe(plan.deliverables.length);
    expect(w.tasksTotal).toBe(plan.deliverables.reduce((n, d) => n + d.tasks.length, 0));
    expect(w.tasksComplete).toBe(0);
    expect(w.unlistedCount).toBe(0);
    expect(w.gate.criteriaTotal).toBe(plan.gate.criteria.length);
    expect(w.gate.name).toBe(plan.gate.name);
  });
});

describe("Declining the plan", () => {
  it("still sets up the methodology, with no deliverables at all", async () => {
    const phases = await prisma.activatePhase.findMany({
      where: { projectId: fx.orgB.projectId },
      select: { key: true, gates: { select: { criteria: { select: { id: true } } } } },
    });
    // The skeleton is there...
    expect(phases.length).toBe(KEYS.length);
    expect(phases.every((p) => p.gates.length === 1)).toBe(true);
    expect(phases.every((p) => p.gates[0].criteria.length > 0)).toBe(true);
    // ...and nothing else was created.
    expect(
      await prisma.activateDeliverableLink.count({ where: { phase: { projectId: fx.orgB.projectId } } })
    ).toBe(0);
    expect(
      await prisma.issue.count({
        where: { projectId: fx.orgB.projectId, activateDeliverable: { isNot: null } },
      })
    ).toBe(0);
  });

  it("keeps one project's plan out of the other's", async () => {
    // Both were enabled from the same template in the same run. Every issue
    // the seeding created must belong to the project it was created for.
    const strays = await prisma.issue.count({
      where: {
        projectId: fx.orgB.projectId,
        activateDeliverable: { phase: { projectId: fx.orgA.projectId } },
      },
    });
    expect(strays).toBe(0);
  });
});

describe("Enabling again", () => {
  it("does not duplicate a plan that is already there", async () => {
    const before = await prisma.activateDeliverableLink.count({
      where: { phase: { projectId: fx.orgA.projectId } },
    });
    expectAllowed(
      await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`, {
        method: "POST",
        body: { enabled: true },
      }),
      "re-enabling Activate"
    );
    const after = await prisma.activateDeliverableLink.count({
      where: { phase: { projectId: fx.orgA.projectId } },
    });
    expect(after).toBe(before);
  });

  it("does not retrofit a plan onto a project that declined it", async () => {
    // Skipping a phase that already has deliverables is not the same rule as
    // skipping a project that chose to have none, and the second one matters
    // more: a project running its own plan must not find 57 issues appear
    // because somebody toggled the feature.
    expectAllowed(
      await api(fx.orgB.users.OWNER, `/api/projects/${fx.orgB.projectId}/activate`, {
        method: "POST",
        body: { enabled: true, seedPlan: false },
      }),
      "re-enabling without the plan"
    );
    expect(
      await prisma.activateDeliverableLink.count({ where: { phase: { projectId: fx.orgB.projectId } } })
    ).toBe(0);
  });
});
