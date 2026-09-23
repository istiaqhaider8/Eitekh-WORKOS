/**
 * When a phase's work is finished — and what that does and does not mean.
 *
 * A phase is "work complete" when every task on its worksheet is ticked and
 * every one of its quality-gate criteria is settled. That is a statement
 * about evidence, nothing more:
 *
 *   - it does NOT set the phase to COMPLETED. Somebody with
 *     `activate:manage_phases` presses a button to do that.
 *   - it does NOT raise the gate, and it certainly does not approve one.
 *     A gate is raised by one person and signed by another, and a checklist
 *     that approved itself would remove the only control the gate provides.
 *
 * Ticking the last box is a strong signal a phase is done, which is why the
 * screen says so plainly. It is not a decision, which is why it does not act.
 *
 * Kept as a pure function so the rule can be tested directly — the empty
 * phase and the waived criterion below are the cases that a rendered check
 * would be awkward to pin down.
 */

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
