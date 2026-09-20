import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { publicUserRelation } from "@/lib/safe-select";

/**
 * One gate, with its criteria and its full approval ledger.
 *
 * TENANT SCOPING
 *
 * A gate hangs off a phase, and the phase carries the projectId — the gate
 * table has none of its own. So the lookup is
 * `{ id: gateId, phase: { projectId } }` with the project from the PATH, and
 * another tenant's gate id is a 404 rather than a 403, because a 403 would
 * confirm the row exists.
 *
 * THE LEDGER IS RETURNED IN FULL, INCLUDING REVERSALS
 *
 * Approvals are append-only, so a gate that was approved and later rejected
 * has two rows and both are returned. Showing only the latest would let a
 * screen present a clean history that the database does not have.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; gateId: string }> }
) {
  try {
    const { id: projectId, gateId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:view");

    const gate = await prisma.activateGate.findFirst({
      where: { id: gateId, phase: { projectId } },
      select: {
        id: true,
        name: true,
        description: true,
        isMandatory: true,
        status: true,
        raisedById: true,
        raisedAt: true,
        phase: { select: { id: true, key: true, name: true } },
        raisedBy: publicUserRelation,
        criteria: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            criterion: true,
            status: true,
            evidenceRef: true,
            evidenceIssueId: true,
            position: true,
          },
        },
        approvals: {
          orderBy: { decidedAt: "desc" },
          select: {
            id: true,
            decision: true,
            comment: true,
            decidedAt: true,
            approver: publicUserRelation,
          },
        },
      },
    });

    if (!gate) return NextResponse.json({ error: "Gate not found" }, { status: 404 });

    return NextResponse.json({ gate });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/gates/[gateId]");
  }
}
