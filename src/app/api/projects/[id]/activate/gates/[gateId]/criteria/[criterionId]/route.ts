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
