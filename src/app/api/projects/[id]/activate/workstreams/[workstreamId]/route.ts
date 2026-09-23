import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { assertActivateEnabled } from "@/lib/activate";
import { handleApiError } from "@/lib/api-error";
import { parseJsonBody, activateWorkstreamUpdateSchema } from "@/lib/validation";
import { assertActivateRefsBelongToProject } from "@/lib/activate-refs";

/**
 * Rename a workstream, assign its owner, or take it out of use.
 *
 * WHY `activate:manage_phases` AND NOT A SIXTH PERMISSION
 *
 * Workstreams are structural configuration of the methodology, the same kind
 * of thing as phases — who owns Data Management, whether Extensibility is in
 * play on this project. `activate:manage_deliverables` is about the work
 * items that hang off that structure, which is a different and much more
 * frequently granted job. Adding `activate:manage_workstreams` would mean a
 * sixth key that every existing role has to be re-granted, to express a
 * distinction nobody asked for.
 *
 * WHY THERE IS NO OPTIMISTIC LOCKING HERE
 *
 * The M4 convention is opt-in per model, and `ActivateWorkstream` carries no
 * `version` column. That is deliberate rather than an omission: a phase has
 * one because a gate sign-off must not race a phase edit, and the losing side
 * of that race changes what a sign-off means. A workstream edit is a name, an
 * owner and an in-use flag, with no downstream authorization effect, so
 * last-write-wins costs someone a retyped name and nothing else. Adding a
 * column to guard against that would be a migration bought for no risk.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; workstreamId: string }> }
) {
  try {
    const { id: projectId, workstreamId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Access before permission, so a caller outside the tenant is refused
    // before a permission error can confirm the project exists.
    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_phases");
    await assertActivateEnabled(projectId);

    const parsed = await parseJsonBody(req, activateWorkstreamUpdateSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    /**
     * Loaded by id AND projectId together, with the project taken from the
     * path. A workstream id on its own names no tenant, which is the shape
     * both isolation vulnerabilities found in this project had. Another
     * tenant's id is therefore a 404 — not a 403, which would confirm the row
     * exists.
     */
    const workstream = await prisma.activateWorkstream.findFirst({
      where: { id: workstreamId, projectId },
      select: { id: true },
    });
    if (!workstream) return NextResponse.json({ error: "Workstream not found" }, { status: 404 });

    // The body can carry a foreign key; the path guard above says nothing
    // about it.
    await assertActivateRefsBelongToProject(projectId, { ownerId: body.ownerId });

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.status !== undefined) data.status = body.status;
    if (body.ownerId !== undefined) data.ownerId = body.ownerId;

    const updated = await prisma.activateWorkstream.update({
      where: { id: workstreamId },
      data,
      select: {
        id: true,
        key: true,
        name: true,
        status: true,
        ownerId: true,
        position: true,
      },
    });

    return NextResponse.json({ workstream: updated });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/workstreams/[workstreamId]");
  }
}
