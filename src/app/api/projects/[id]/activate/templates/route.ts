import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { ensureBuiltInTemplate, listTemplatesFor } from "@/lib/activate-templates";

/**
 * The methodology templates this project may be seeded from.
 *
 * WHAT A CALLER SEES
 *
 * The built-in template, plus any this organization has authored — published
 * ones only. A draft is invisible: half-written methodology is exactly what
 * gets stamped onto a real project by accident, and a stamp cannot be taken
 * back once the phases exist.
 *
 * TENANT SCOPING
 *
 * The organization comes from the PROJECT in the path, never from the request.
 * Another tenant's template is not filtered out of the response — it is
 * excluded by the query, so it is indistinguishable from one that was never
 * created.
 *
 * `activate:view` rather than a management permission: choosing a template is
 * part of deciding whether to run Activate at all, and the people asking that
 * question are not always the ones who can enable it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Access before permission, so a caller outside the tenant is refused
    // before a permission error can confirm the project exists.
    const access = await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:view");

    // The built-in template is created on first sight rather than by a
    // migration, so a fresh database answers this correctly without anyone
    // having had to enable Activate anywhere first.
    await ensureBuiltInTemplate();

    const orgId = access.project.workspace.orgId;
    const templates = await listTemplatesFor(orgId);

    return NextResponse.json({
      templates: templates.map((t) => ({
        id: t.id,
        key: t.key,
        name: t.name,
        variant: t.variant,
        version: t.version,
        description: t.description,
        // `builtIn` rather than exposing orgId: which organization owns a
        // template is not a caller's business, and "can I edit this" is the
        // only question the client actually has.
        builtIn: t.orgId === null,
        phaseCount: t._count.phases,
        workstreamCount: t._count.workstreams,
      })),
    });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/templates");
  }
}
