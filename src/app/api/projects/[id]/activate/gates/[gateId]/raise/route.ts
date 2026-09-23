import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { assertActivateEnabled } from "@/lib/activate";
import { handleApiError, ConflictError } from "@/lib/api-error";
import { parseJsonBody, activateGateRaiseSchema } from "@/lib/validation";
import { unsatisfiedCriteria, isGoLiveGate } from "@/lib/activate-gates";
import { logAuditEvent } from "@/lib/audit-logger";
import { syncEngine } from "@/lib/sync-engine";

/**
 * Submit a gate for sign-off.
 *
 * This is the step that makes separation of duties possible at all: it stamps
 * WHO is asking. Without a stored raiser the approval route has nobody to
 * compare the approver against, and "you cannot approve your own gate"
 * becomes a rule with no subject.
 *
 * Raising is `activate:manage_gates` (HIGH). Approving is a different and
 * more restricted permission, which is the whole point — if one role could do
 * both, the separation would be a convention rather than a control.
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
    await assertProjectPermission(projectId, "activate:manage_gates");
    await assertActivateEnabled(projectId);

    const parsed = await parseJsonBody(req, activateGateRaiseSchema);
    if (!parsed.success) return parsed.error;

    const gate = await prisma.activateGate.findFirst({
      where: { id: gateId, phase: { projectId } },
      select: {
        id: true,
        name: true,
        status: true,
        phase: { select: { key: true, name: true } },
        criteria: { select: { criterion: true, status: true } },
      },
    });
    // 404, not 403: a 403 would confirm another tenant's gate exists.
    if (!gate) return NextResponse.json({ error: "Gate not found" }, { status: 404 });

    if (gate.status === "RAISED") {
      throw new ConflictError("This gate is already awaiting sign-off.", "GATE_ALREADY_RAISED");
    }
    if (gate.status === "APPROVED") {
      throw new ConflictError("This gate has already been approved.", "GATE_APPROVED");
    }

    /**
     * Every criterion must be MET or WAIVED.
     *
     * The refusal names what is outstanding. "Cannot raise this gate" tells
     * whoever is trying nothing about how to proceed, and a gate is exactly
     * the place where a person is likely to be working from a checklist
     * someone else filled in.
     */
    const outstanding = unsatisfiedCriteria(gate.criteria);
    if (outstanding.length > 0) {
      throw new ConflictError(
        `This gate has criteria that are neither met nor waived: ${outstanding.join("; ")}.`,
        "GATE_CRITERIA_OUTSTANDING"
      );
    }

    const raisedAt = new Date();
    const updated = await prisma.activateGate.update({
      where: { id: gateId },
      // Re-raising a rejected gate overwrites the previous raiser: the
      // question is who is asking for THIS sign-off. The earlier attempt is
      // preserved in the approval ledger.
      data: { status: "RAISED", raisedById: user.id, raisedAt },
      select: { id: true, status: true, raisedById: true, raisedAt: true },
    });

    await logAuditEvent({
      actor: {
        id: user.id,
        name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
        email: user.email,
      },
      action: "ACTIVATE_GATE_RAISED",
      category: "PROJECT",
      severity: isGoLiveGate(gate.phase.key) ? "WARNING" : "NOTICE",
      status: "SUCCESS",
      targetResource: `ActivateGate:${gateId}`,
      projectId,
      details: { gate: gate.name, phase: gate.phase.key, criteria: gate.criteria.length },
    }).catch((e) => console.error("Failed to audit gate raise:", e));

    /**
     * Project-scoped, not user-scoped. A gate awaiting sign-off is project
     * governance that every member is entitled to see — unlike a
     * notification, whose content is addressed to one person and must not be
     * fanned out to a whole board.
     */
    syncEngine.publishProjectEvent({
      projectId,
      eventType: "SYSTEM_SYNC_PING",
      entityType: "SYSTEM",
      entityId: gateId,
      data: { activateGate: { id: gateId, name: gate.name, status: "RAISED", phase: gate.phase.key } },
      actor: { id: user.id, email: user.email },
      sourceModule: "Activate",
    });

    return NextResponse.json({ gate: updated });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/gates/[gateId]/raise");
  }
}
