import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { assertActivateEnabled } from "@/lib/activate";
import { handleApiError, ConflictError, ForbiddenError } from "@/lib/api-error";
import { parseJsonBody, activateGateApprovalSchema } from "@/lib/validation";
import { recordGateDecision, isGoLiveGate, unsatisfiedCriteria } from "@/lib/activate-gates";
import { logAuditEvent } from "@/lib/audit-logger";
import { syncEngine } from "@/lib/sync-engine";

/**
 * Sign off a gate — approve it or reject it.
 *
 * APPEND ONLY
 *
 * POST is the only method here. There is no PATCH and no DELETE for an
 * approval anywhere in this API, and that absence is the enforcement: a
 * reversal is a new row with decision REJECTED, so the record of who decided
 * what, and when, cannot be edited after the fact. `recordGateDecision`
 * appends the row and refreshes the cached `gate.status` in one transaction.
 *
 * SEPARATION OF DUTIES
 *
 * Whoever raised the gate may not sign it off. Two independent conditions
 * have to hold for a gate to pass: someone with `activate:manage_gates`
 * asserts the criteria are satisfied, and a DIFFERENT someone with
 * `activate:sign_off_gate` accepts that assertion. Collapsing them into one
 * person is the control failure the whole gate mechanism exists to prevent —
 * a project manager under deadline pressure approving their own go-live.
 *
 * A refused attempt is audited as a FAILURE at WARNING. Someone trying to
 * sign off their own gate is exactly the event a review will go looking for,
 * and an authorization check that refuses silently leaves no trace that
 * anyone tried.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; gateId: string }> }
) {
  try {
    const { id: projectId, gateId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:sign_off_gate");
    await assertActivateEnabled(projectId);

    const parsed = await parseJsonBody(req, activateGateApprovalSchema);
    if (!parsed.success) return parsed.error;
    const { decision, comment } = parsed.data;

    const gate = await prisma.activateGate.findFirst({
      where: { id: gateId, phase: { projectId } },
      select: {
        id: true,
        name: true,
        status: true,
        raisedById: true,
        phase: { select: { key: true, name: true } },
        criteria: { select: { criterion: true, status: true } },
      },
    });
    if (!gate) return NextResponse.json({ error: "Gate not found" }, { status: 404 });

    const actor = {
      id: user.id,
      name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      email: user.email,
    };

    /**
     * A decision needs a RAISED gate — or, for a REVOCATION, an approved one.
     *
     * Revocation exists because the schema's append-only contract promises a
     * reversal is a new REJECTED row rather than an edit, and without this
     * branch that promise could never be kept: an APPROVED gate would be
     * terminal and the only way to undo a mistaken go-live approval would be
     * to edit the ledger, which is the one thing this design forbids. Cutover
     * approvals do get withdrawn, so the model has to allow it.
     *
     * Approving an already-approved gate is still a 409 — that is a duplicate,
     * not a reversal.
     *
     * Checked BEFORE the separation-of-duties rule on purpose. An OPEN gate
     * has no raiser, so the SoD comparison would be vacuously true and let a
     * gate be approved without anyone ever asserting its criteria were met,
     * defeating both controls at once.
     */
    const isRevocation = gate.status === "APPROVED" && decision === "REJECTED";
    if (gate.status !== "RAISED" && !isRevocation) {
      throw new ConflictError(
        gate.status === "APPROVED"
          ? "This gate has already been approved."
          : "This gate has not been raised for sign-off.",
        "GATE_NOT_RAISED"
      );
    }

    /**
     * The criteria are checked AGAIN, here, at the moment of signing.
     *
     * Raising already refuses while anything is unsettled, and this used to
     * rely on that. It was not enough: raising and signing are two requests
     * with a review in between, and a criterion could be marked NOT_MET in
     * that window — which is exactly what a reviewer who has found a problem
     * would do. The gate stayed RAISED, nothing re-read the criteria, and a
     * live system produced an APPROVED gate carrying a NOT_MET criterion.
     * The one artefact the whole feature exists to produce, saying two
     * opposite things at once.
     *
     * So the check lives where the consequence is. A reviewer marking a
     * criterion NOT_MET during sign-off now BLOCKS the approval instead of
     * being silently overtaken by it, which is what marking it was for.
     *
     * Only approvals are gated. Rejecting an unsatisfied gate is the correct
     * response to one, and revoking an approval must never be blocked by the
     * state of the thing being revoked.
     */
    if (decision === "APPROVED") {
      const outstanding = unsatisfiedCriteria(gate.criteria);
      if (outstanding.length > 0) {
        throw new ConflictError(
          `This gate cannot be approved while criteria are neither met nor waived: ${outstanding.join("; ")}.`,
          "GATE_CRITERIA_OUTSTANDING"
        );
      }
    }

    if (gate.raisedById === user.id) {
      await logAuditEvent({
        actor,
        action: "ACTIVATE_GATE_SIGN_OFF_DENIED",
        category: "SECURITY",
        severity: "WARNING",
        status: "FAILURE",
        targetResource: `ActivateGate:${gateId}`,
        projectId,
        details: {
          gate: gate.name,
          phase: gate.phase.key,
          reason: "separation of duties: the raiser cannot approve",
        },
      }).catch((e) => console.error("Failed to audit refused sign-off:", e));

      throw new ForbiddenError(
        "You raised this gate, so you cannot sign it off. It needs a different approver."
      );
    }

    const { approvalId, status } = await recordGateDecision({
      gateId,
      approverId: user.id,
      decision,
      comment,
    });

    await logAuditEvent({
      actor,
      action: isRevocation
        ? "ACTIVATE_GATE_APPROVAL_REVOKED"
        : decision === "APPROVED"
          ? "ACTIVATE_GATE_APPROVED"
          : "ACTIVATE_GATE_REJECTED",
      category: "PROJECT",
      // The go-live gate is the one an incident review goes looking for, so
      // it is logged at a level that makes it findable. The RULE is identical
      // for every gate; only the severity differs.
      severity: isGoLiveGate(gate.phase.key) || isRevocation ? "CRITICAL" : "NOTICE",
      status: "SUCCESS",
      targetResource: `ActivateGate:${gateId}`,
      projectId,
      details: {
        gate: gate.name,
        phase: gate.phase.key,
        decision,
        raisedById: gate.raisedById,
        approvalId,
      },
    }).catch((e) => console.error("Failed to audit gate decision:", e));

    syncEngine.publishProjectEvent({
      projectId,
      eventType: "SYSTEM_SYNC_PING",
      entityType: "SYSTEM",
      entityId: gateId,
      data: { activateGate: { id: gateId, name: gate.name, status, phase: gate.phase.key } },
      actor: { id: user.id, email: user.email },
      sourceModule: "Activate",
    });

    return NextResponse.json({ approvalId, gateStatus: status }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/gates/[gateId]/approvals");
  }
}
