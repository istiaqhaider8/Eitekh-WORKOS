/**
 * The per-phase implementation worksheet: deliverables, their tasks, the
 * quality gate and what each workstream is carrying.
 *
 * WHAT A "DELIVERABLE" IS HERE
 *
 * The same thing it is everywhere else in this application: an ordinary Issue
 * linked to a phase by `ActivateDeliverableLink`. The worksheet adds one
 * thing — a per-phase code, D-01, D-02 — so a plan can be cited in a meeting
 * without reading out an issue key. It does NOT add a parallel model. A
 * deliverable created here appears on the board, in reports and in search
 * like any other issue, because it IS any other issue.
 *
 * WHAT A "TASK" IS HERE
 *
 * A `Subtask` of that issue. Checklist-level work, deliberately not a
 * separate issue each: a Discover phase is twenty-five small confirmations,
 * and putting all of them on the Kanban board would bury the work that
 * actually moves. Subtasks already carry completion, an assignee, an
 * estimate and a due date, which is more than this worksheet exposes.
 */

import { prisma } from "./prisma";
import { allocateIssueKey, issueStatusIdFor } from "./issue-keys";
import { allowedIssueTypeValues } from "./project-context";

/**
 * The next code for a phase, allocated inside a transaction.
 *
 * MUST RUN IN A TRANSACTION: the read of the highest existing code and the
 * write of the counter have to be atomic with respect to another person
 * adding a deliverable to the same phase at the same time.
 *
 * The counter is incremented AND reconciled against what exists, because a
 * counter can fall behind reality — a restored row, an imported phase — and
 * a second implementation that forgot the reconciliation would look correct
 * for months and then hand out a code already in use.
 */
export async function allocatePhaseCode(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  phaseId: string
): Promise<string> {
  const existing = await tx.activateDeliverableLink.findMany({
    where: { phaseId, phaseCode: { not: null } },
    select: { phaseCode: true },
  });
  const highest = existing.reduce((n, e) => {
    const m = (e.phaseCode ?? "").match(/(\d+)$/);
    return m ? Math.max(n, Number(m[1])) : n;
  }, 0);

  const phase = await tx.activatePhase.update({
    where: { id: phaseId },
    data: { deliverableCounter: { increment: 1 } },
    select: { deliverableCounter: true },
  });

  let next = phase.deliverableCounter;
  if (next <= highest) {
    next = highest + 1;
    await tx.activatePhase.update({
      where: { id: phaseId },
      data: { deliverableCounter: next },
    });
  }

  return `D-${String(next).padStart(2, "0")}`;
}

export interface CreatedDeliverable {
  linkId: string;
  issueId: string;
  issueKey: string;
  phaseCode: string;
}

/**
 * Create a deliverable from a name and a workstream, and link it to a phase.
 *
 * WHY THIS EXISTS ALONGSIDE THE LINK ROUTE
 *
 * `POST /activate/deliverables` links an issue that already exists, which is
 * right when somebody is adopting a piece of work already on the board. The
 * worksheet form supplies a name and nothing else, so something has to mint
 * the issue — and the alternative, making the user create an issue first and
 * then link it, is two screens for one intention.
 *
 * ONE TRANSACTION
 *
 * The issue, its key and the link are created together or not at all. A
 * failure between them would leave an issue on the board that the worksheet
 * does not know about, which is the sort of orphan nobody finds until they
 * are counting deliverables for a steering committee.
 */
export async function createWorksheetDeliverable(input: {
  projectId: string;
  phaseId: string;
  workstreamId: string | null;
  name: string;
  reporterId: string;
}): Promise<CreatedDeliverable> {
  const allowedTypes = await allowedIssueTypeValues(input.projectId);
  const issueType = allowedTypes.has("TASK") ? "TASK" : [...allowedTypes][0];
  if (!issueType) throw new Error("This project has no issue types configured.");

  return prisma.$transaction(async (tx) => {
    const phaseCode = await allocatePhaseCode(tx, input.phaseId);
    const { keyNumber, issueKey, project } = await allocateIssueKey(tx, input.projectId);

    const issue = await tx.issue.create({
      data: {
        projectId: input.projectId,
        keyNumber,
        issueKey,
        title: input.name,
        issueType,
        priority: "MEDIUM",
        /**
         * The Backlog column, through the same resolver generated Activate
         * work uses. A deliverable somebody has just written down is work
         * nobody has started, and starting it in the workflow's first column
         * by accident of ordering is how generated work ends up somewhere
         * surprising.
         */
        statusId: issueStatusIdFor(project, "BACKLOG"),
        reporterId: input.reporterId,
      },
      select: { id: true, issueKey: true },
    });

    const link = await tx.activateDeliverableLink.create({
      data: {
        issueId: issue.id,
        phaseId: input.phaseId,
        workstreamId: input.workstreamId,
        phaseCode,
      },
      select: { id: true },
    });

    return { linkId: link.id, issueId: issue.id, issueKey: issue.issueKey, phaseCode };
  });
}

export interface WorksheetTask {
  id: string;
  title: string;
  isCompleted: boolean;
}

export interface WorksheetDeliverable {
  linkId: string;
  issueId: string;
  issueKey: string;
  phaseCode: string | null;
  name: string;
  workstreamId: string | null;
  workstreamName: string | null;
  tasks: WorksheetTask[];
  tasksTotal: number;
  tasksComplete: number;
}

export interface WorksheetGate {
  id: string;
  /** G0..G5, derived from the phase's position rather than stored. */
  code: string;
  name: string;
  status: string;
  criteria: Array<{ id: string; criterion: string; status: string; met: boolean }>;
  criteriaTotal: number;
  criteriaMet: number;
}

export interface PhaseWorksheet {
  phaseId: string;
  phaseKey: string;
  phaseName: string;
  deliverables: WorksheetDeliverable[];
  deliverableCount: number;
  tasksTotal: number;
  tasksComplete: number;
  gate: WorksheetGate | null;
  /** Every workstream the project has, with how many deliverables it carries. */
  workstreams: Array<{ id: string; key: string; name: string; deliverableCount: number }>;
}

/**
 * A criterion counts as met when it is MET or WAIVED.
 *
 * Waived is a decision somebody took — "this does not apply here" — and it
 * settles the criterion as surely as meeting it. Counting it as outstanding
 * would leave a gate permanently short of its own total for a reason nobody
 * can act on. This matches `SETTLED` in activate-readiness.ts; the two say
 * the same thing about the same rows and must not drift.
 */
const SETTLED_CRITERION = new Set(["MET", "WAIVED"]);

/**
 * Everything one phase's worksheet needs, in a fixed number of queries.
 *
 * Four, whatever the size of the phase: the phase with its gate, the links
 * with their issues and subtasks, the project's workstreams, and the counts
 * are done in memory. A per-deliverable query for tasks would be the classic
 * N+1 and would show up as a slow screen on exactly the phases that matter
 * most, the ones with the most work in them.
 */
export async function getPhaseWorksheet(
  projectId: string,
  phaseKey: string
): Promise<PhaseWorksheet | null> {
  const phase = await prisma.activatePhase.findUnique({
    where: { projectId_key: { projectId, key: phaseKey } },
    select: {
      id: true,
      key: true,
      name: true,
      position: true,
      gates: {
        orderBy: { position: "asc" },
        take: 1,
        select: {
          id: true,
          name: true,
          status: true,
          criteria: {
            orderBy: { position: "asc" },
            select: { id: true, criterion: true, status: true },
          },
        },
      },
    },
  });
  if (!phase) return null;

  const [links, workstreams] = await Promise.all([
    prisma.activateDeliverableLink.findMany({
      where: { phaseId: phase.id },
      orderBy: [{ phaseCode: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        issueId: true,
        phaseCode: true,
        workstreamId: true,
        workstream: { select: { name: true } },
        issue: {
          select: {
            issueKey: true,
            title: true,
            subtasks: {
              orderBy: { createdAt: "asc" },
              select: { id: true, title: true, isCompleted: true },
            },
          },
        },
      },
    }),
    prisma.activateWorkstream.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
      select: { id: true, key: true, name: true },
    }),
  ]);

  const deliverables: WorksheetDeliverable[] = links.map((l) => {
    const tasks = l.issue.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      isCompleted: s.isCompleted,
    }));
    return {
      linkId: l.id,
      issueId: l.issueId,
      issueKey: l.issue.issueKey,
      phaseCode: l.phaseCode,
      name: l.issue.title,
      workstreamId: l.workstreamId,
      workstreamName: l.workstream?.name ?? null,
      tasks,
      tasksTotal: tasks.length,
      tasksComplete: tasks.filter((t) => t.isCompleted).length,
    };
  });

  const byWorkstream = new Map<string, number>();
  for (const d of deliverables) {
    if (!d.workstreamId) continue;
    byWorkstream.set(d.workstreamId, (byWorkstream.get(d.workstreamId) ?? 0) + 1);
  }

  const g = phase.gates[0];
  const gate: WorksheetGate | null = g
    ? {
        id: g.id,
        // Derived, not stored: the code IS the phase's position, and storing
        // it would let the two disagree.
        code: `G${phase.position}`,
        name: g.name,
        status: g.status,
        criteria: g.criteria.map((c) => ({
          id: c.id,
          criterion: c.criterion,
          status: c.status,
          met: SETTLED_CRITERION.has(c.status),
        })),
        criteriaTotal: g.criteria.length,
        criteriaMet: g.criteria.filter((c) => SETTLED_CRITERION.has(c.status)).length,
      }
    : null;

  return {
    phaseId: phase.id,
    phaseKey: phase.key,
    phaseName: phase.name,
    deliverables,
    deliverableCount: deliverables.length,
    tasksTotal: deliverables.reduce((n, d) => n + d.tasksTotal, 0),
    tasksComplete: deliverables.reduce((n, d) => n + d.tasksComplete, 0),
    gate,
    workstreams: workstreams.map((w) => ({
      ...w,
      deliverableCount: byWorkstream.get(w.id) ?? 0,
    })),
  };
}
