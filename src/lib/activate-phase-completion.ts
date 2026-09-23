/**
 * When a phase's work is finished — and what that does and does not mean.
 *
 * A phase is "work complete" when every task on its worksheet is ticked and
 * every one of its quality-gate criteria is settled. That is a statement
 * about evidence, nothing more:
 *
 *   - it does NOT set the phase to COMPLETED. Somebody with
 *     `activate:manage_phases` presses a button to do that.
 *   - gate sign-off remains a distinct governance step.
 *
 * SAP ACTIVATE PHASE GATE & SIGN-OFF RULES:
 *
 * 1. Discover → Prepare: All Discover Deliverables & Workstreams and Discovery
 *    activities must be completed. System must block Prepare start if Discover
 *    is incomplete.
 * 2. Prepare → Explore: All Prepare Deliverables & Workstreams and Project
 *    Readiness checks must be completed. System must block Explore start if
 *    Prepare is incomplete.
 * 3. Explore → Realize: All Explore Deliverables & Workstreams and all Design
 *    completion checks must be completed. System must block Realize start if
 *    Explore is incomplete.
 * 4. Realize → Deploy: All Realize Deliverables & Workstreams and all Solution
 *    Ready checks must be completed. System must block Deploy start if Realize
 *    is incomplete.
 * 5. Deploy → Run: All Deploy Deliverables & Workstreams and all Go-Live
 *    Readiness checks must be completed. System must block Run start if Deploy
 *    is incomplete.
 *
 * Gate Sign-off Rule:
 * If a user raises a phase gate, the same user is allowed to review and sign
 * off that gate. A separate approver is not required.
 *
 * General Rules:
 * - Previous phase completion is mandatory before starting the next phase.
 * - Approval status is not mandatory for phase progression.
 */

import { prisma } from "./prisma";

export interface PhaseWorkCounts {
  tasksTotal: number;
  tasksComplete: number;
  criteriaTotal: number;
  criteriaSettled: number;
}

/**
 * A criterion that has been met, or deliberately waived, is settled. A waiver
 * is a decision somebody recorded with a reason, not an unanswered question,
 * so it does not hold a phase open.
 */
export const SETTLED_CRITERION_STATUSES = ["MET", "WAIVED"] as const;

export function isCriterionSettled(status: string | null | undefined): boolean {
  return status === "MET" || status === "WAIVED";
}

/**
 * True when every task is complete and every criterion is settled.
 *
 * An empty phase answers FALSE. Zero of zero is arithmetically complete and
 * practically meaningless: without the two `> 0` tests every phase of a
 * brand-new project would come up finished before anyone had opened it, and
 * the badge would mean nothing anywhere else either.
 */
export function isPhaseWorkComplete(counts: PhaseWorkCounts | null | undefined): boolean {
  if (!counts) return false;
  const tasksDone = counts.tasksTotal > 0 && counts.tasksComplete >= counts.tasksTotal;
  const criteriaDone = counts.criteriaTotal > 0 && counts.criteriaSettled >= counts.criteriaTotal;
  return tasksDone && criteriaDone;
}

/**
 * Why the phase cannot be completed yet, for the button's tooltip — or null
 * when it can. A disabled control with no reason on it is a puzzle, and the
 * reason is always one of two specific, countable things.
 */
export function phaseIncompleteReason(counts: PhaseWorkCounts | null | undefined): string | null {
  if (!counts) return "Loading this phase's worksheet.";
  if (counts.tasksTotal === 0 && counts.criteriaTotal === 0) {
    return "This phase has no deliverables or gate criteria yet.";
  }
  const tasksLeft = Math.max(0, counts.tasksTotal - counts.tasksComplete);
  const criteriaLeft = Math.max(0, counts.criteriaTotal - counts.criteriaSettled);
  const parts: string[] = [];
  if (counts.tasksTotal === 0) parts.push("this phase has no tasks yet");
  else if (tasksLeft > 0) parts.push(`${tasksLeft} task${tasksLeft === 1 ? "" : "s"} outstanding`);
  if (counts.criteriaTotal === 0) parts.push("the gate has no criteria yet");
  else if (criteriaLeft > 0) {
    parts.push(`${criteriaLeft} gate criteri${criteriaLeft === 1 ? "on" : "a"} unsettled`);
  }
  if (parts.length === 0) return null;
  return `${parts.join(", ")}.`;
}

/**
 * SAP Activate methodology sequence and prerequisite check definitions.
 */
export interface PhaseProgressionRule {
  fromKey: string;
  toKey: string;
  fromName: string;
  toName: string;
  checkName: string;
  requirementDescription: string;
}

export const PHASE_PROGRESSION_RULES: Record<string, PhaseProgressionRule> = {
  PREPARE: {
    fromKey: "DISCOVER",
    toKey: "PREPARE",
    fromName: "Discover",
    toName: "Prepare",
    checkName: "Discovery activities",
    requirementDescription:
      "All Discover Deliverables & Workstreams and Discovery activities must be completed.",
  },
  EXPLORE: {
    fromKey: "PREPARE",
    toKey: "EXPLORE",
    fromName: "Prepare",
    toName: "Explore",
    checkName: "Project Readiness checks",
    requirementDescription:
      "All Prepare Deliverables & Workstreams and Project Readiness checks must be completed.",
  },
  REALIZE: {
    fromKey: "EXPLORE",
    toKey: "REALIZE",
    fromName: "Explore",
    toName: "Realize",
    checkName: "Design completion checks",
    requirementDescription:
      "All Explore Deliverables & Workstreams and all Design completion checks must be completed.",
  },
  DEPLOY: {
    fromKey: "REALIZE",
    toKey: "DEPLOY",
    fromName: "Realize",
    toName: "Deploy",
    checkName: "Solution Ready checks",
    requirementDescription:
      "All Realize Deliverables & Workstreams and all Solution Ready checks must be completed.",
  },
  RUN: {
    fromKey: "DEPLOY",
    toKey: "RUN",
    fromName: "Deploy",
    toName: "Run",
    checkName: "Go-Live Readiness checks",
    requirementDescription:
      "All Deploy Deliverables & Workstreams and all Go-Live Readiness checks must be completed.",
  },
};

export interface PhaseReadinessCheckResult {
  isComplete: boolean;
  status: string;
  phaseName: string;
  tasksTotal: number;
  tasksComplete: number;
  criteriaTotal: number;
  criteriaSettled: number;
  deliverablesTotal: number;
  deliverablesDone: number;
  unsettledCriteria: string[];
  incompleteDeliverables: string[];
  reason: string | null;
}

/**
 * Reads a phase from the database and evaluates whether all required
 * deliverables, workstream tasks, and gate criteria (readiness checks)
 * are completed.
 */
export async function checkPhaseReadinessAndDeliverables(
  projectId: string,
  phaseKey: string
): Promise<PhaseReadinessCheckResult | null> {
  const phase = await prisma.activatePhase.findUnique({
    where: { projectId_key: { projectId, key: phaseKey } },
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
          criteria: {
            orderBy: { position: "asc" },
            select: { id: true, criterion: true, status: true },
          },
        },
      },
      deliverables: {
        select: {
          id: true,
          phaseCode: true,
          isMandatory: true,
          issue: {
            select: {
              id: true,
              issueKey: true,
              title: true,
              status: { select: { category: true } },
              subtasks: {
                select: { id: true, title: true, isCompleted: true },
              },
            },
          },
        },
      },
    },
  });

  if (!phase) return null;

  const gate = phase.gates[0] || null;
  const criteria = gate?.criteria || [];
  const criteriaTotal = criteria.length;
  const unsettledCriteria = criteria
    .filter((c) => !isCriterionSettled(c.status))
    .map((c) => c.criterion);
  const criteriaSettled = criteriaTotal - unsettledCriteria.length;

  let tasksTotal = 0;
  let tasksComplete = 0;
  let deliverablesDone = 0;
  const incompleteDeliverables: string[] = [];

  for (const del of phase.deliverables) {
    const subtasks = del.issue.subtasks || [];
    const isDoneCategory = del.issue.status?.category === "DONE";
    const subtasksDone = subtasks.length > 0 && subtasks.every((s) => s.isCompleted);

    tasksTotal += subtasks.length;
    tasksComplete += subtasks.filter((s) => s.isCompleted).length;

    if (isDoneCategory || subtasksDone || (subtasks.length === 0 && isDoneCategory)) {
      deliverablesDone++;
    } else {
      incompleteDeliverables.push(
        del.issue.issueKey ? `${del.issue.issueKey}: ${del.issue.title}` : del.issue.title
      );
    }
  }

  const hasDeliverables = phase.deliverables.length > 0;
  const deliverablesComplete = hasDeliverables
    ? tasksTotal > 0
      ? tasksComplete >= tasksTotal
      : deliverablesDone >= phase.deliverables.length
    : true;
  const criteriaComplete = criteriaTotal > 0 ? criteriaSettled >= criteriaTotal : true;

  const isComplete =
    phase.status === "COMPLETED" &&
    deliverablesComplete &&
    criteriaComplete &&
    unsettledCriteria.length === 0 &&
    incompleteDeliverables.length === 0;

  const reason = !isComplete
    ? phase.status !== "COMPLETED"
      ? `Phase ${phase.name} is not marked COMPLETED.`
      : unsettledCriteria.length > 0
        ? `${unsettledCriteria.length} gate criteria unsettled.`
        : incompleteDeliverables.length > 0
          ? `${incompleteDeliverables.length} deliverables or tasks incomplete.`
          : null
    : null;

  return {
    isComplete,
    status: phase.status,
    phaseName: phase.name,
    tasksTotal,
    tasksComplete,
    criteriaTotal,
    criteriaSettled,
    deliverablesTotal: phase.deliverables.length,
    deliverablesDone,
    unsettledCriteria,
    incompleteDeliverables,
    reason,
  };
}

/**
 * Validates whether a target phase can transition to IN_PROGRESS.
 *
 * In SAP Activate Phase Gate Rules:
 * A project cannot move to the next phase unless the previous phase is
 * completed and all required Deliverables, Workstreams, and readiness checks
 * are completed.
 *
 * General Rules:
 * - Previous phase completion is mandatory before starting the next phase.
 * - Approval status is not mandatory for phase progression.
 */
export async function validatePhaseCanStart(
  projectId: string,
  targetPhaseKey: string
): Promise<{ allowed: boolean; error?: string }> {
  const rule = PHASE_PROGRESSION_RULES[targetPhaseKey];
  if (!rule) {
    // Phase has no predecessor (e.g. DISCOVER)
    return { allowed: true };
  }

  const prev = await checkPhaseReadinessAndDeliverables(projectId, rule.fromKey);
  if (!prev) {
    return {
      allowed: false,
      error: `Cannot start ${rule.toName}: Preceding phase ${rule.fromName} not found.`,
    };
  }

  // 1. Previous phase completion is mandatory before starting the next phase
  if (prev.status !== "COMPLETED") {
    return {
      allowed: false,
      error: `Cannot start ${rule.toName}: ${rule.fromName} is incomplete. ${rule.requirementDescription} System must block ${rule.toName} start if ${rule.fromName} is incomplete.`,
    };
  }

  // 2. All deliverables & workstreams must be completed
  if (
    prev.incompleteDeliverables.length > 0 ||
    (prev.tasksTotal > 0 && prev.tasksComplete < prev.tasksTotal)
  ) {
    return {
      allowed: false,
      error: `Cannot start ${rule.toName}: ${rule.fromName} is incomplete. ${rule.requirementDescription} System must block ${rule.toName} start if ${rule.fromName} is incomplete.`,
    };
  }

  // 3. All readiness checks (gate criteria) must be completed
  if (
    prev.unsettledCriteria.length > 0 ||
    (prev.criteriaTotal > 0 && prev.criteriaSettled < prev.criteriaTotal)
  ) {
    return {
      allowed: false,
      error: `Cannot start ${rule.toName}: ${rule.fromName} is incomplete. ${rule.requirementDescription} System must block ${rule.toName} start if ${rule.fromName} is incomplete.`,
    };
  }

  return { allowed: true };
}

/**
 * Validates whether a phase can be marked as COMPLETED.
 * All deliverables, workstreams, and readiness checks must be completed first.
 */
export async function validatePhaseCanComplete(
  projectId: string,
  phaseKey: string
): Promise<{ allowed: boolean; error?: string }> {
  const check = await checkPhaseReadinessAndDeliverables(projectId, phaseKey);
  if (!check) {
    return { allowed: false, error: "Phase not found." };
  }

  const rule = Object.values(PHASE_PROGRESSION_RULES).find((r) => r.fromKey === phaseKey);
  const checkName = rule ? rule.checkName : "quality gate criteria";

  if (
    check.incompleteDeliverables.length > 0 ||
    (check.tasksTotal > 0 && check.tasksComplete < check.tasksTotal)
  ) {
    return {
      allowed: false,
      error: `Cannot complete ${check.phaseName}: All ${check.phaseName} Deliverables & Workstreams must be completed first.`,
    };
  }

  if (
    check.unsettledCriteria.length > 0 ||
    (check.criteriaTotal > 0 && check.criteriaSettled < check.criteriaTotal)
  ) {
    return {
      allowed: false,
      error: `Cannot complete ${check.phaseName}: All ${checkName} must be completed first (${check.unsettledCriteria.length} criterion/criteria unsettled).`,
    };
  }

  return { allowed: true };
}
