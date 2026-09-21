/**
 * Deploy readiness and the Run picture.
 *
 * WHAT THIS IS FOR
 *
 * Everything else in Activate records decisions. This reports on them: for the
 * Deploy phase, whether the things that must be true before go-live actually
 * are; for Run, what hypercare still has open. It is READ ONLY and it
 * authorizes nothing. A gate is passed by a person signing it, not by a
 * dashboard turning green, and the two must never be confusable — this module
 * says "3 mandatory deliverables are not done", the gate says "Priya approved
 * it at 14:02".
 *
 * WHY THE COUNTS ARE ONE SQL AGGREGATE
 *
 * The exit gate for this increment is query count and p95 at realistic volume.
 * The obvious implementation — load every deliverable and count them in
 * JavaScript — is a constant number of QUERIES but transfers the whole table
 * to do arithmetic the database does better, and on the 20,000-row dataset in
 * development it would move megabytes to produce eight integers. So the
 * per-phase counts are a single GROUP BY, and the only rows that cross the
 * wire whole are the blockers a human is going to read, which are capped.
 *
 * The query is a tagged template, so `projectId` is a bound parameter rather
 * than interpolated text. That matters more here than usual: this is the only
 * raw SQL in Activate, and it is the one place where a tenant scope is written
 * by hand instead of by Prisma.
 */

import { prisma } from "./prisma";
import { ACTIVATE_DECISION_TASK_STATUS } from "./activate-generation";

/** The DEPLOY gate is the go-live decision; RUN's is the handover. */
export const DEPLOY_PHASE_KEY = "DEPLOY";
export const RUN_PHASE_KEY = "RUN";

/**
 * What counts as an open gap on a phase.
 *
 * DERIVED FROM THE TASK-STATUS MAP, NOT WRITTEN OUT AGAIN
 *
 * A gap is a deliverable whose fit-to-standard decision leaves its scope item
 * in BACKLOG — Configure, Extend, Integrate. Adopt, Defer and Out of scope
 * settle the item, so they are not open gaps: nothing about them is waiting
 * on a decision, and deferred work is tracked in Run rather than counted
 * against the phase it was raised in.
 *
 * THIS REPLACES A FILTER THAT COULD NEVER MATCH
 *
 * The query used to count `fitGapStatus = 'GAP'`. 'GAP' belonged to an
 * earlier three-value vocabulary that was replaced by the six decisions, and
 * the column has been validated against the six ever since — so the filter
 * matched nothing, on any project, and every phase reported zero open gaps
 * however many Extends and Integrates it carried. A go-live readiness panel
 * that always says "no gaps" is worse than no panel.
 *
 * It survived because the test wrote 'GAP' into the database directly,
 * through Prisma, bypassing the validation the application goes through. A
 * fixture that can produce states the product cannot will keep a dead branch
 * alive indefinitely.
 */
export const GAP_DECISIONS: string[] = Object.entries(ACTIVATE_DECISION_TASK_STATUS)
  .filter(([, status]) => status === "BACKLOG")
  .map(([decision]) => decision);

/** How many blocking issues to name. Beyond this a list stops being read. */
export const BLOCKER_LIMIT = 20;

interface PhaseCounts {
  phaseId: string;
  total: number;
  mandatory: number;
  done: number;
  mandatoryDone: number;
  gaps: number;
  unassessed: number;
}

export interface GateSummary {
  id: string;
  name: string;
  status: string;
  criteriaTotal: number;
  criteriaSettled: number;
  outstanding: string[];
}

export interface PhaseReadiness extends PhaseCounts {
  key: string;
  name: string;
  status: string;
  gate: GateSummary | null;
  /**
   * Every mandatory deliverable done and every gate criterion settled.
   *
   * Deliberately NOT "the gate is approved". This answers "is it reasonable to
   * ask for sign-off yet", which is a different question from "has someone
   * signed", and collapsing them is how a dashboard starts looking like an
   * authorization.
   */
  readyToRaise: boolean;
}

export interface Blocker {
  linkId: string;
  issueId: string;
  issueKey: string;
  title: string;
  statusName: string | null;
  isMandatory: boolean;
}

export interface ReadinessReport {
  enabled: boolean;
  phases: PhaseReadiness[];
  /** Mandatory Deploy deliverables that are not done, capped at BLOCKER_LIMIT. */
  deployBlockers: Blocker[];
  deployBlockerTotal: number;
}

type ReadinessDb = Pick<
  typeof prisma,
  "$queryRaw" | "activateProfile" | "activatePhase" | "activateDeliverableLink"
>;

const SETTLED = new Set(["MET", "WAIVED"]);

export async function getReadiness(
  projectId: string,
  db: ReadinessDb = prisma
): Promise<ReadinessReport> {
  const profile = await db.activateProfile.findUnique({
    where: { projectId },
    select: { enabled: true },
  });

  if (!profile?.enabled) {
    return { enabled: false, phases: [], deployBlockers: [], deployBlockerTotal: 0 };
  }

  const [phases, counts] = await Promise.all([
    db.activatePhase.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        key: true,
        name: true,
        status: true,
        gates: {
          orderBy: { position: "asc" },
          take: 1,
          select: {
            id: true,
            name: true,
            status: true,
            criteria: { select: { criterion: true, status: true } },
          },
        },
      },
    }),
    /**
     * One GROUP BY for every phase at once.
     *
     * The join to WorkflowStatus is a LEFT JOIN even though `Issue.statusId`
     * is NOT NULL and foreign-key constrained today, so it is equivalent to an
     * INNER JOIN as things stand — an earlier version of this comment claimed
     * otherwise and was wrong. It is written this way because the failure mode
     * is asymmetric: if a status ever becomes optional (a backlog item with no
     * status is a plausible product change), an INNER JOIN would quietly drop
     * those rows from `total`, and a go-live report that UNDERCOUNTS what is
     * outstanding is the one error it must not make. A LEFT JOIN degrades to
     * "not done", which is the safe direction.
     */
    db.$queryRaw<PhaseCounts[]>`
      SELECT l."phaseId"                                                        AS "phaseId",
             COUNT(*)::int                                                      AS total,
             COUNT(*) FILTER (WHERE l."isMandatory")::int                       AS mandatory,
             COUNT(*) FILTER (WHERE s.category = 'DONE')::int                   AS done,
             COUNT(*) FILTER (WHERE l."isMandatory" AND s.category = 'DONE')::int AS "mandatoryDone",
             COUNT(*) FILTER (WHERE l."fitGapStatus" = ANY(${GAP_DECISIONS}))::int AS gaps,
             COUNT(*) FILTER (WHERE l."fitGapStatus" IS NULL)::int              AS unassessed
      FROM "ActivateDeliverableLink" l
      JOIN "ActivatePhase" p ON p.id = l."phaseId"
      JOIN "Issue" i        ON i.id = l."issueId"
      LEFT JOIN "WorkflowStatus" s ON s.id = i."statusId"
      WHERE p."projectId" = ${projectId}
      GROUP BY l."phaseId"
    `,
  ]);

  const byPhase = new Map(counts.map((c) => [c.phaseId, c]));

  const report: PhaseReadiness[] = phases.map((p) => {
    const c = byPhase.get(p.id) ?? {
      phaseId: p.id,
      total: 0,
      mandatory: 0,
      done: 0,
      mandatoryDone: 0,
      gaps: 0,
      unassessed: 0,
    };

    const g = p.gates[0];
    const outstanding = g ? g.criteria.filter((x) => !SETTLED.has(x.status)) : [];
    const gate: GateSummary | null = g
      ? {
          id: g.id,
          name: g.name,
          status: g.status,
          criteriaTotal: g.criteria.length,
          criteriaSettled: g.criteria.length - outstanding.length,
          outstanding: outstanding.map((x) => x.criterion),
        }
      : null;

    return {
      ...c,
      phaseId: p.id,
      key: p.key,
      name: p.name,
      status: p.status,
      gate,
      readyToRaise: outstanding.length === 0 && c.mandatoryDone === c.mandatory,
    };
  });

  const deploy = report.find((p) => p.key === DEPLOY_PHASE_KEY);

  /**
   * The blockers themselves, but only for Deploy and only the mandatory ones.
   *
   * This is the one place rows are fetched rather than counted, because "three
   * things are not done" is not actionable and "VP1-402 Cutover rehearsal is
   * still In Progress" is. Capped, because past twenty nobody reads the list
   * and the count above already says how bad it is.
   */
  let deployBlockers: Blocker[] = [];
  let deployBlockerTotal = 0;

  if (deploy) {
    const notDone = {
      phaseId: deploy.phaseId,
      isMandatory: true,
      issue: { status: { isNot: { category: "DONE" } } },
    };

    const [rows, total] = await Promise.all([
      db.activateDeliverableLink.findMany({
        where: notDone,
        take: BLOCKER_LIMIT,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          isMandatory: true,
          issue: {
            select: {
              id: true,
              issueKey: true,
              title: true,
              status: { select: { name: true } },
            },
          },
        },
      }),
      db.activateDeliverableLink.count({ where: notDone }),
    ]);

    deployBlockers = rows.map((r) => ({
      linkId: r.id,
      issueId: r.issue.id,
      issueKey: r.issue.issueKey,
      title: r.issue.title,
      statusName: r.issue.status?.name ?? null,
      isMandatory: r.isMandatory,
    }));
    deployBlockerTotal = total;
  }

  return { enabled: true, phases: report, deployBlockers, deployBlockerTotal };
}
