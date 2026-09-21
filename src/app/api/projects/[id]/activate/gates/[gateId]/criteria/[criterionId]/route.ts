import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError, ConflictError } from "@/lib/api-error";
import { parseJsonBody, activateCriterionUpdateSchema } from "@/lib/validation";
import { assertActivateRefsBelongToProject } from "@/lib/activate-refs";
import { logAuditEvent } from "@/lib/audit-logger";

/**
 * Mark a gate criterion met, not met or waived, and point at the evidence.
 *
 * WHY AN APPROVED GATE IS FROZEN
 *
 * Editing a criterion of a gate that has already been approved would rewrite
 * the basis of a decision someone signed their name to — the approver
 * consented to a specific list of satisfied criteria, and changing that list
 * afterwards makes the record say something they never agreed to. The gate
 * must be re-raised, which produces a new ledger entry and a new signature.
 *
 * A 409 rather than a 403: the caller has the right permission, the resource
 * is in the wrong state, and there is a legitimate way forward.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; gateId: string; criterionId: string }> }
) {
  try {
    const { id: projectId, gateId, criterionId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_gates");

    const parsed = await parseJsonBody(req, activateCriterionUpdateSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    /**
     * Criterion, gate and project resolved in ONE query. The criterion id
     * names no tenant on its own, and neither does the gate id; the project
     * comes from the path and the row must chain back to it.
     */
    const criterion = await prisma.activateGateCriterion.findFirst({
      where: { id: criterionId, gateId, gate: { phase: { projectId } } },
      select: {
        id: true,
        status: true,
        criterion: true,
        gate: { select: { id: true, status: true, name: true } },
      },
    });
    if (!criterion) return NextResponse.json({ error: "Criterion not found" }, { status: 404 });

    if (criterion.gate.status === "APPROVED") {
      throw new ConflictError(
        "This gate has been approved. Re-raise it to change its criteria.",
        "GATE_APPROVED"
      );
    }

    // The evidence issue is a foreign key arriving in the body; the path guard
    // authorised the project and said nothing about it.
    await assertActivateRefsBelongToProject(projectId, { issueId: body.evidenceIssueId });

    const data: Record<string, unknown> = {};
    if (body.status !== undefined) data.status = body.status;
    if (body.evidenceRef !== undefined) data.evidenceRef = body.evidenceRef;
    if (body.evidenceIssueId !== undefined) data.evidenceIssueId = body.evidenceIssueId;

    const updated = await prisma.activateGateCriterion.update({
      where: { id: criterionId },
      data,
      select: {
        id: true,
        criterion: true,
        status: true,
        evidenceRef: true,
        evidenceIssueId: true,
      },
    });

    if (body.status !== undefined && body.status !== criterion.status) {
      await logAuditEvent({
        actor: {
          id: user.id,
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
          email: user.email,
        },
        action: "ACTIVATE_CRITERION_UPDATED",
        category: "PROJECT",
        severity: "INFO",
        status: "SUCCESS",
        targetResource: `ActivateGateCriterion:${criterionId}`,
        projectId,
        details: {
          gate: criterion.gate.name,
          criterion: criterion.criterion,
          from: criterion.status,
          to: body.status,
        },
      }).catch((e) => console.error("Failed to audit criterion update:", e));
    }

    return NextResponse.json({ criterion: updated });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/gates/[gateId]/criteria/[criterionId]");
  }
}

/**
 * Remove a criterion from a gate.
 *
 * THE LOOPHOLE THIS IS WRITTEN TO CLOSE
 *
 * A gate is passed when its criteria are satisfied. If an unmet criterion
 * can be deleted, a gate can be "passed" by deleting the thing it was asking
 * for — and the record afterwards shows a clean gate with no trace of the
 * question. That is worse than no gate at all, because it looks like
 * assurance.
 *
 * So:
 *
 *   - A RAISED or APPROVED gate refuses deletion outright. The list is what
 *     an approver was asked to sign, or has signed; editing it afterwards
 *     makes the record say something nobody agreed to.
 *
 *   - An open gate permits it, and the removal is AUDITED with the
 *     criterion's text and the status it held. Deleting an unmet criterion
 *     is sometimes legitimate — a condition that turned out not to apply —
 *     and the answer to "was this dropped because it was inconvenient" has
 *     to exist somewhere. `WAIVED` remains the better route, because it
 *     stays visible on the gate.
 *
 *   - The LAST criterion cannot be removed. A gate with no criteria is one
 *     that passes by being empty, which is the same loophole reached by a
 *     different road.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; gateId: string; criterionId: string }> }
) {
  try {
    const { id: projectId, gateId, criterionId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_gates");

    const criterion = await prisma.activateGateCriterion.findFirst({
      where: { id: criterionId, gateId, gate: { phase: { projectId } } },
      select: {
        id: true,
        status: true,
        criterion: true,
        gate: {
          select: { id: true, status: true, name: true, _count: { select: { criteria: true } } },
        },
      },
    });
    if (!criterion) return NextResponse.json({ error: "Criterion not found" }, { status: 404 });

    if (criterion.gate.status === "RAISED" || criterion.gate.status === "APPROVED") {
      throw new ConflictError(
        criterion.gate.status === "APPROVED"
          ? "This gate has been approved. Re-raise it to change its criteria."
          : "This gate is waiting for sign-off. Withdraw or reject it before changing its criteria.",
        "GATE_LOCKED"
      );
    }

    if (criterion.gate._count.criteria <= 1) {
      throw new ConflictError(
        "A gate must keep at least one criterion. Waive this one instead of removing it.",
        "GATE_WOULD_BE_EMPTY"
      );
    }

    await prisma.activateGateCriterion.delete({ where: { id: criterionId } });

    await logAuditEvent({
      actor: {
        id: user.id,
        name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
        email: user.email,
      },
      action: "ACTIVATE_CRITERION_REMOVED",
      category: "PROJECT",
      // Higher than an update on purpose: removing a condition of sign-off is
      // the kind of change somebody should be able to find later.
      severity: "WARNING",
      status: "SUCCESS",
      targetResource: `ActivateGate:${gateId}`,
      projectId,
      details: {
        gate: criterion.gate.name,
        criterion: criterion.criterion,
        statusWhenRemoved: criterion.status,
      },
    }).catch((e) => console.error("Failed to audit criterion removal:", e));

    return NextResponse.json({ success: true, removed: criterion.criterion });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/gates/[gateId]/criteria/[criterionId]");
  }
}
