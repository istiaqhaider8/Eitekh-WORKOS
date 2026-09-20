import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError, ConflictError } from "@/lib/api-error";
import { parseJsonBody, activateDeliverableCreateSchema } from "@/lib/validation";
import { assertActivateRefsBelongToProject } from "@/lib/activate-refs";
import { listDeliverables } from "@/lib/activate-deliverables";
import { isActivateEnabled } from "@/lib/activate";

/**
 * The deliverables of a project's Activate phases.
 *
 * A deliverable IS an issue. There is no parallel work-item table, no second
 * place to look for the same piece of work, and no sync to get wrong — the
 * link row says which phase and workstream an existing issue belongs to, and
 * that is all it says.
 *
 * PAGING matches GET /api/projects/[id]/issues exactly: `?page=&limit=`,
 * responding with `{ total, page, limit, totalPages }`. A second convention
 * for the same product would be a worse cost than the one saved by picking a
 * nicer scheme here.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:view");

    const { searchParams } = new URL(req.url);

    /**
     * The filters are passed through unvalidated ON PURPOSE.
     *
     * `listDeliverables` applies `phase: { projectId }` unconditionally before
     * any filter, so a phaseId belonging to another tenant intersects to
     * nothing and returns an empty page. Validating it first would turn that
     * into a 400 that distinguishes "a real phase elsewhere" from "no such
     * phase" — strictly more information than the caller had before asking.
     */
    const result = await listDeliverables(projectId, {
      phaseId: searchParams.get("phaseId"),
      workstreamId: searchParams.get("workstreamId"),
      page: Number(searchParams.get("page")) || 1,
      limit: Number(searchParams.get("limit")) || undefined,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/deliverables");
  }
}

/**
 * Declare an existing issue a deliverable of a phase.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_deliverables");

    const parsed = await parseJsonBody(req, activateDeliverableCreateSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    /**
     * Phases survive a disable, so a phaseId can still resolve on a project
     * that has switched Activate off. Writing new governance data into a
     * methodology nobody is running would produce rows no screen shows.
     * A 409 rather than a 403: the caller has the right permission, the
     * project is in the wrong state, and enabling it makes the identical
     * request succeed.
     */
    if (!(await isActivateEnabled(projectId))) {
      throw new ConflictError("Activate is not enabled for this project.", "ACTIVATE_DISABLED");
    }

    // Everything in the body that is a foreign key. The path guard above
    // authorised the PROJECT; it said nothing about these.
    await assertActivateRefsBelongToProject(projectId, {
      issueId: body.issueId,
      phaseId: body.phaseId,
      workstreamId: body.workstreamId,
    });

    /**
     * `issueId` is unique: an issue is a deliverable of at most one phase.
     *
     * A second link is refused rather than silently re-pointed. Quietly moving
     * a deliverable from Realize to Explore because someone re-ran a link
     * action would rewrite what the project reported it had delivered, and
     * nothing in the request said "move". Moving is PATCH, and deliberate.
     */
    const existing = await prisma.activateDeliverableLink.findUnique({
      where: { issueId: body.issueId },
      select: { id: true, phaseId: true },
    });
    if (existing) {
      throw new ConflictError(
        "That issue is already a deliverable of a phase. Move it instead of linking it again.",
        "DELIVERABLE_EXISTS"
      );
    }

    const link = await prisma.activateDeliverableLink.create({
      data: {
        issueId: body.issueId,
        phaseId: body.phaseId,
        workstreamId: body.workstreamId ?? null,
        isMandatory: body.isMandatory ?? false,
        acceleratorKey: body.acceleratorKey ?? null,
      },
      select: {
        id: true,
        issueId: true,
        phaseId: true,
        workstreamId: true,
        isMandatory: true,
        acceleratorKey: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ deliverable: link }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/deliverables");
  }
}
