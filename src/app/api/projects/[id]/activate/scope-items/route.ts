import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { scopeItemsWithDecisions } from "@/lib/activate-scope";

/**
 * The fit-to-standard catalogue, with whatever this project has decided.
 *
 * The catalogue comes from the template the project was STAMPED with, which
 * is the whole of the tenant boundary here: template tables carry no orgId of
 * their own, and they do not need one, because a project can only reach the
 * template it was stamped with and it could only be stamped with a template
 * that was built-in or its own organization's.
 *
 * Returns `enabled: false` with empty collections for a project not running
 * Activate — matching every other endpoint in this feature, so a client
 * renders an empty state rather than treating a 404 as normal.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:view");

    const { enabled, modules, items, decisions } = await scopeItemsWithDecisions(projectId);
    if (!enabled) {
      return NextResponse.json({ enabled: false, modules: [], scopeItems: [] });
    }

    const byScopeItem = new Map(decisions.map((d) => [d.scopeItemId, d]));
    const inScope = new Set(modules.filter((m) => m.inScope).map((m) => m.moduleId));

    return NextResponse.json({
      enabled: true,
      modules,
      scopeItems: items.map((i) => ({
        id: i.id,
        code: i.code,
        name: i.name,
        workstreamKey: i.workstreamKey,
        // Split rather than shipped as a comma string: a client should not
        // have to know the storage format to ask whether something is
        // user-facing.
        tags: (i.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
        moduleId: i.moduleId,
        inScope: inScope.has(i.moduleId),
        decision: byScopeItem.get(i.id) ?? null,
      })),
      decided: decisions.length,
      // Counted over scope items the project is actually doing, so the
      // denominator matches what a steering committee is being shown.
      total: items.filter((i) => inScope.has(i.moduleId)).length,
    });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/scope-items");
  }
}
