import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { assertActivateEnabled } from "@/lib/activate";
import { handleApiError, ConflictError } from "@/lib/api-error";
import { parseJsonBody, activateModuleScopeSchema } from "@/lib/validation";
import { assertActivateRefsBelongToProject } from "@/lib/activate-refs";
import { modulesForProject } from "@/lib/activate-scope";

/**
 * Which modules of the methodology this project is doing, and in which wave.
 *
 * A module is a grouping of scope items that a project switches in or out as
 * a whole. Switching one out is not a display filter: its scope items stop
 * being counted and stop generating work, because a project measured against
 * scope it is not doing reads as behind when it is not.
 *
 * A module with no row here is IN scope by default. The alternative — every
 * module off until somebody turns it on — means enabling Activate produces an
 * empty workshop, and the first thing anyone does is turn all of them on.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:view");

    return NextResponse.json({ modules: await modulesForProject(projectId) });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/modules");
  }
}

/**
 * Switch a module in or out, set its wave, or name its owner.
 *
 * `activate:manage_phases` rather than `manage_deliverables`: deciding which
 * modules a programme is doing is a scope decision of the same kind as the
 * phase structure itself, not day-to-day work management.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_phases");
    await assertActivateEnabled(projectId);

    const parsed = await parseJsonBody(req, activateModuleScopeSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    /**
     * The module must belong to THIS project's template.
     *
     * `moduleId` arrives in the body and names a row in a template table,
     * which is not tenant-scoped by itself — templates are shared. Without
     * this check a caller could create scope rows against another
     * organization's module, which both leaks that it exists and puts a
     * meaningless row in this project.
     */
    const available = await modulesForProject(projectId);
    const known = available.find((m) => m.moduleId === body.moduleId);
    if (!known) {
      return NextResponse.json(
        { error: "That module is not part of this project's methodology." },
        { status: 400 }
      );
    }

    // An owner must be a member of this project — the same rule phases and
    // workstreams already enforce.
    await assertActivateRefsBelongToProject(projectId, { ownerId: body.ownerId });

    const data: Record<string, unknown> = {};
    if (body.inScope !== undefined) data.inScope = body.inScope;
    // Nullable on purpose: clearing a wave is not the same as wave 0.
    if (body.waveNumber !== undefined) data.waveNumber = body.waveNumber;
    if (body.ownerId !== undefined) data.ownerId = body.ownerId;

    const row = await prisma.activateProjectModule.upsert({
      where: { projectId_moduleId: { projectId, moduleId: body.moduleId } },
      update: data,
      create: {
        projectId,
        moduleId: body.moduleId,
        inScope: body.inScope ?? true,
        waveNumber: body.waveNumber ?? null,
        ownerId: body.ownerId ?? null,
      },
      select: { moduleId: true, inScope: true, waveNumber: true, ownerId: true },
    });

    return NextResponse.json({ module: row });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/modules");
  }
}
