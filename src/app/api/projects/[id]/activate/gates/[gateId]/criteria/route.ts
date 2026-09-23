import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { assertActivateEnabled } from "@/lib/activate";
import { handleApiError, ConflictError } from "@/lib/api-error";
import { parseJsonBody, activateGateCriterionCreateSchema } from "@/lib/validation";
import { logAuditEvent } from "@/lib/audit-logger";

/**
 * Add a criterion to a quality gate.
 *
 * WHY THIS DID NOT EXIST UNTIL NOW
 *
 * Criteria were seeded with the phase and could be marked met, not met or
 * waived, but never added or removed. That was a reasonable first cut — the
 * methodology says what a gate asks — and it is wrong in practice: a real
 * programme discovers a condition partway through Discover that the template
 * never anticipated, and the only alternative was to leave it off the gate
 * and remember it.
 *
 * WHY A RAISED GATE IS FROZEN
 *
 * Adding a criterion to a gate that is already waiting for sign-off changes
 * the question the approver is being asked, after they were asked it. The
 * gate must be re-raised, which produces a new ledger entry and a new
 * signature. A 409 rather than a 403: the caller has the permission, the
 * gate is in the wrong state, and there is a legitimate way forward.
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

    const parsed = await parseJsonBody(req, activateGateCriterionCreateSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    /**
     * Gate and project resolved in ONE query. A gate id names no tenant on
     * its own; the project comes from the path and the row must chain back
     * to it, or it is a 404 indistinguishable from one that does not exist.
     */
    const gate = await prisma.activateGate.findFirst({
      where: { id: gateId, phase: { projectId } },
      select: { id: true, name: true, status: true, _count: { select: { criteria: true } } },
    });
    if (!gate) return NextResponse.json({ error: "Gate not found" }, { status: 404 });

    if (gate.status === "RAISED" || gate.status === "APPROVED") {
      throw new ConflictError(
        gate.status === "APPROVED"
          ? "This gate has been approved. Re-raise it to change its criteria."
          : "This gate is waiting for sign-off. Withdraw or reject it before changing its criteria.",
        "GATE_LOCKED"
      );
    }

    const created = await prisma.activateGateCriterion.create({
      data: {
        gateId,
        criterion: body.criterion,
        // Appended, so an added criterion does not reorder a list somebody is
        // reading down. Position is presentation; identity is the id.
        position: gate._count.criteria,
      },
      select: { id: true, criterion: true, status: true, position: true },
    });

    await logAuditEvent({
      actor: {
        id: user.id,
        name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
        email: user.email,
      },
      action: "ACTIVATE_CRITERION_ADDED",
      category: "PROJECT",
      severity: "NOTICE",
      status: "SUCCESS",
      targetResource: `ActivateGate:${gateId}`,
      projectId,
      details: { gate: gate.name, criterion: body.criterion },
    }).catch((e) => console.error("Failed to audit criterion creation:", e));

    return NextResponse.json({ criterion: created }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/gates/[gateId]/criteria");
  }
}
