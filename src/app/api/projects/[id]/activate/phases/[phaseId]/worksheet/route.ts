import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError, ConflictError } from "@/lib/api-error";
import { parseJsonBody, activateWorksheetDeliverableSchema } from "@/lib/validation";
import { assertActivateRefsBelongToProject } from "@/lib/activate-refs";
import { createWorksheetDeliverable, getPhaseWorksheet } from "@/lib/activate-worksheet";
import { isActivateEnabled } from "@/lib/activate";
import { logAuditEvent } from "@/lib/audit-logger";

/**
 * One phase's implementation worksheet.
 *
 * WHY THE PHASE IS ADDRESSED BY KEY AND NOT BY ID
 *
 * The path carries the phase KEY — DISCOVER, PREPARE — not a cuid. A phase
 * key is meaningful, stable across projects and impossible to point at
 * another tenant's row: the lookup is `projectId_key`, so a key from
 * somebody else's project resolves to this project's phase of that name, or
 * to nothing. An id in the path would need its own ownership check, which is
 * the shape both isolation bugs found in this codebase actually had.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string }> }
) {
  try {
    const { id: projectId, phaseId: phaseKey } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:view");

    const worksheet = await getPhaseWorksheet(projectId, phaseKey.toUpperCase());
    if (!worksheet) return NextResponse.json({ error: "Phase not found" }, { status: 404 });

    return NextResponse.json({ worksheet });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/phases/[phaseId]/worksheet");
  }
}

/**
 * Add a deliverable to this phase.
 *
 * Creates the underlying issue as well as the link, because the form offers
 * a name and a workstream and nothing else. It goes through the same issue
 * allocator as every other issue in the product, so what appears is an
 * ordinary card on the board rather than a worksheet-only object.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string }> }
) {
  try {
    const { id: projectId, phaseId: phaseKey } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_deliverables");

    const parsed = await parseJsonBody(req, activateWorksheetDeliverableSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    /**
     * Phases survive a disable, so a phase key still resolves on a project
     * that has switched Activate off. Writing new governance data into a
     * methodology nobody is running would produce rows no screen shows.
     */
    if (!(await isActivateEnabled(projectId))) {
      throw new ConflictError("Activate is not enabled for this project.", "ACTIVATE_DISABLED");
    }

    const phase = await prisma.activatePhase.findUnique({
      where: { projectId_key: { projectId, key: phaseKey.toUpperCase() } },
      select: { id: true },
    });
    if (!phase) return NextResponse.json({ error: "Phase not found" }, { status: 404 });

    // The workstream arrives in the BODY, where the path guard cannot see it.
    await assertActivateRefsBelongToProject(projectId, { workstreamId: body.workstreamId });

    const created = await createWorksheetDeliverable({
      projectId,
      phaseId: phase.id,
      workstreamId: body.workstreamId ?? null,
      name: body.name,
      reporterId: user.id,
    });

    await logAuditEvent({
      actor: {
        id: user.id,
        name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
        email: user.email,
      },
      action: "ACTIVATE_DELIVERABLE_CREATED",
      category: "PROJECT",
      severity: "NOTICE",
      status: "SUCCESS",
      targetResource: `Issue:${created.issueId}`,
      projectId,
      details: { phaseKey: phaseKey.toUpperCase(), phaseCode: created.phaseCode },
    }).catch((e) => console.error("Failed to audit deliverable creation:", e));

    return NextResponse.json({ deliverable: created }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/phases/[phaseId]/worksheet");
  }
}
