/**
 * Quality gates: the lifecycle, and the one place that records a decision.
 *
 * WHAT A GATE IS FOR
 *
 * Every other table in this feature tracks work. This one records that a
 * named human authorised a phase to end — and for the Deploy gate, that a
 * named human authorised a go-live. That makes it the only part of Activate
 * whose failure mode is not "the board looks wrong" but "the record of who
 * decided is untrue".
 *
 * THE LEDGER IS THE TRUTH; `gate.status` IS A CACHE
 *
 * `ActivateGateApproval` is append-only: a reversal is a new row with
 * decision REJECTED, never an edit of the first row. There is deliberately no
 * PATCH and no DELETE route for it anywhere in the API. `gate.status` exists
 * only so a list view does not have to aggregate approvals for every row, and
 * it is never written on its own — `recordGateDecision` writes the row and
 * the cache inside one transaction, and `deriveGateStatus` is the single
 * definition of what the cache should say. A denormalised status that can
 * drift from its own audit ledger is worse than no status column at all, so
 * the integration suite recomputes it from the ledger and asserts it matches.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export const GATE_STATUSES = ["OPEN", "RAISED", "APPROVED", "REJECTED"] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

export const GATE_DECISIONS = ["APPROVED", "REJECTED"] as const;

/**
 * Criterion states.
 *
 * WAIVED is not a synonym for MET. It means a human decided this criterion
 * does not apply and said so on the record, which is a different thing for an
 * auditor to read than "we did it". Both let a gate be raised; only the words
 * differ, and the words are the point.
 */
export const CRITERION_STATUSES = ["PENDING", "MET", "NOT_MET", "WAIVED"] as const;

/** A criterion in one of these states does not block a gate being raised. */
const SATISFIED = new Set(["MET", "WAIVED"]);

export interface ApprovalRecord {
  decision: string;
  decidedAt: Date;
}

/**
 * What the gate's status SHOULD be, given the ledger and the raise stamp.
 *
 * A total function of stored facts, with no reference to the current
 * `gate.status` — so it can be used both to write the cache and, in tests, to
 * check it. The timestamp comparison is what makes re-raising work: a gate
 * rejected on Monday and re-raised on Tuesday is RAISED, not REJECTED,
 * because the most recent event is the raise.
 */
export function deriveGateStatus(
  approvals: ApprovalRecord[],
  raisedAt: Date | null | undefined
): GateStatus {
  const latest = approvals.reduce<ApprovalRecord | null>(
    (best, a) => (best === null || a.decidedAt > best.decidedAt ? a : best),
    null
  );

  if (!latest) return raisedAt ? "RAISED" : "OPEN";
  if (raisedAt && raisedAt > latest.decidedAt) return "RAISED";
  return latest.decision === "APPROVED" ? "APPROVED" : "REJECTED";
}

/** Criteria that still block the gate, by their text. */
export function unsatisfiedCriteria(
  criteria: Array<{ criterion: string; status: string }>
): string[] {
  return criteria.filter((c) => !SATISFIED.has(c.status)).map((c) => c.criterion);
}

/**
 * Record a decision: append to the ledger and refresh the cache, atomically.
 *
 * Both writes or neither. If the approval row landed and the status update
 * did not, a list view would show a gate still awaiting sign-off that has in
 * fact been signed off — and the person who signed it would have no reason to
 * do it again.
 *
 * Note the status is DERIVED from the ledger after the insert rather than set
 * to the decision that was just made. Those are the same value today. They
 * would stop being the same the moment a second approver or an N-of-M rule
 * arrives, and at that point this function needs no change.
 */
export async function recordGateDecision(params: {
  gateId: string;
  approverId: string;
  decision: "APPROVED" | "REJECTED";
  comment?: string | null;
}): Promise<{ approvalId: string; status: GateStatus }> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const approval = await tx.activateGateApproval.create({
      data: {
        gateId: params.gateId,
        approverId: params.approverId,
        decision: params.decision,
        comment: params.comment ?? null,
      },
      select: { id: true },
    });

    const gate = await tx.activateGate.findUnique({
      where: { id: params.gateId },
      select: {
        raisedAt: true,
        approvals: { select: { decision: true, decidedAt: true } },
      },
    });

    const status = deriveGateStatus(gate?.approvals ?? [], gate?.raisedAt ?? null);

    await tx.activateGate.update({
      where: { id: params.gateId },
      data: { status },
    });

    return { approvalId: approval.id, status };
  });
}

/**
 * True when this gate is the one guarding go-live.
 *
 * Used to raise the audit severity rather than to change the rule. Every gate
 * enforces the same separation of duties; the Deploy gate is simply the one
 * an incident review will go looking for, so it is logged at a level that
 * makes it findable.
 */
export function isGoLiveGate(phaseKey: string): boolean {
  return phaseKey === "DEPLOY";
}
