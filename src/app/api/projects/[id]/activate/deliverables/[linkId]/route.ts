import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { parseJsonBody, activateDeliverableUpdateSchema } from "@/lib/validation";
import { assertActivateRefsBelongToProject } from "@/lib/activate-refs";

/**
 * A single deliverable link: move it between phases or workstreams, or remove
 * it.
 *
 * TENANT SCOPING
 *
 * `ActivateDeliverableLink` has no projectId of its own — it reaches the
 * tenant through its phase. So every lookup here is
 * `{ id: linkId, phase: { projectId } }`, with the project from the PATH.
 * Loading by `id` alone and checking afterwards would work too, right up
 * until someone adds a branch that returns before the check.
 */
async function loadLink(projectId: string, linkId: string) {
  return prisma.activateDeliverableLink.findFirst({
    where: { id: linkId, phase: { projectId } },
    select: { id: true, issueId: true, phaseId: true },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  try {
    const { id: projectId, linkId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_deliverables");

    const parsed = await parseJsonBody(req, activateDeliverableUpdateSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    const link = await loadLink(projectId, linkId);
    // 404 rather than 403: a 403 would confirm the row exists.
    if (!link) return NextResponse.json({ error: "Deliverable not found" }, { status: 404 });

    await assertActivateRefsBelongToProject(projectId, {
      phaseId: body.phaseId,
      workstreamId: body.workstreamId,
    });

    const data: Record<string, unknown> = {};
    if (body.phaseId !== undefined) data.phaseId = body.phaseId;
    // Nullable on purpose: a deliverable can be detached from a workstream
    // without being detached from its phase.
    if (body.workstreamId !== undefined) data.workstreamId = body.workstreamId;
    if (body.isMandatory !== undefined) data.isMandatory = body.isMandatory;
    if (body.acceleratorKey !== undefined) data.acceleratorKey = body.acceleratorKey;
    // Nullable on purpose: a classification can be withdrawn back to "not yet
    // assessed", which is different from classifying it as FIT.
    if (body.fitGapStatus !== undefined) data.fitGapStatus = body.fitGapStatus;

    const updated = await prisma.activateDeliverableLink.update({
      where: { id: linkId },
      data,
      select: {
        id: true,
        issueId: true,
        phaseId: true,
        workstreamId: true,
        isMandatory: true,
        acceleratorKey: true,
        fitGapStatus: true,
      },
    });

    return NextResponse.json({ deliverable: updated });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/deliverables/[linkId]");
  }
}

/**
 * Unlink. The ISSUE is untouched — this removes the claim that it is a
 * deliverable of a phase, not the work itself. Deleting the issue as a side
 * effect of a governance edit would be an astonishing thing for this route to
 * do.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  try {
    const { id: projectId, linkId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_deliverables");

    const link = await loadLink(projectId, linkId);
    if (!link) return NextResponse.json({ error: "Deliverable not found" }, { status: 404 });

    await prisma.activateDeliverableLink.delete({ where: { id: linkId } });

    return NextResponse.json({ success: true, issueId: link.issueId });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/deliverables/[linkId]");
  }
}
