import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError, ConflictError } from "@/lib/api-error";
import { parseJsonBody, activateCustomScopeItemSchema } from "@/lib/validation";
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

    /**
     * The workstreams ride along because the client needs them to ADD an item,
     * and they are exactly the set POST validates against. Fetching them from
     * the profile endpoint instead would let a client offer a choice this
     * route would then refuse.
     */
    const [{ enabled, modules, items, decisions }, workstreams] = await Promise.all([
      scopeItemsWithDecisions(projectId),
      prisma.activateWorkstream.findMany({
        where: { projectId },
        orderBy: { position: "asc" },
        select: { key: true, name: true },
      }),
    ]);
    if (!enabled) {
      return NextResponse.json({ enabled: false, modules: [], scopeItems: [], workstreams: [] });
    }

    const byScopeItem = new Map(decisions.map((d) => [d.scopeItemId, d]));
    const inScope = new Set(modules.filter((m) => m.inScope).map((m) => m.moduleId));

    return NextResponse.json({
      enabled: true,
      modules,
      workstreams,
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
        custom: i.custom,
        inScope: inScope.has(i.moduleId),
        decision: byScopeItem.get(i.id) ?? null,
      })),
      // `custom` tells a client which items it may edit. A template item is
      // shared with every tenant seeded from that template and is read-only.
      decided: decisions.length,
      // Counted over scope items the project is actually doing, so the
      // denominator matches what a steering committee is being shown.
      total: items.filter((i) => inScope.has(i.moduleId)).length,
    });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/scope-items");
  }
}

/**
 * Add a scope item this project needs and the catalogue does not have.
 *
 * WHERE IT GOES
 *
 * Into `ActivateCustomScopeItem`, scoped by project. NOT into the template:
 * the built-in methodology and every content pack are one row read by every
 * tenant seeded from them, so writing a customer's item there would put it in
 * front of all of them.
 *
 * WHY THE CODE IS GENERATED
 *
 * A decision log cites a scope item by its code, so two items answering to
 * the same code make the log ambiguous. Letting people type one means two
 * people in the same workshop can collide; generating it per project means
 * they cannot. The sequence continues past deleted items so a code is never
 * silently reused for something else.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_deliverables");

    const parsed = await parseJsonBody(req, activateCustomScopeItemSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    const { enabled, modules } = await scopeItemsWithDecisions(projectId);
    if (!enabled) {
      throw new ConflictError("Activate is not enabled for this project.", "ACTIVATE_DISABLED");
    }

    /**
     * A named module must be one of THIS project's.
     *
     * `moduleId` arrives in the body and names a row in a template table,
     * which is not tenant-scoped by itself. Without this check an item could
     * be filed under another organization's module, which both leaks that it
     * exists and puts the item somewhere nobody will look.
     */
    if (body.moduleId && !modules.some((m) => m.moduleId === body.moduleId)) {
      return NextResponse.json(
        { error: "That module is not part of this project's methodology." },
        { status: 400 }
      );
    }

    // The workstream must be one the project actually has, for the same
    // reason a generated item has to be filed somewhere real.
    const workstream = await prisma.activateWorkstream.findUnique({
      where: { projectId_key: { projectId, key: body.workstreamKey } },
      select: { id: true },
    });
    if (!workstream) {
      return NextResponse.json(
        { error: "That workstream is not part of this project's methodology." },
        { status: 400 }
      );
    }

    /**
     * The code comes from a counter that only goes up.
     *
     * Deriving it from the highest code that EXISTS was the obvious
     * implementation and it is wrong: remove the last custom item and the next
     * one is handed CUS-01 again, so a workshop's minutes, a gate pack and the
     * decision log all end up citing a code that now means something else. The
     * counter is reconciled against the highest code present before it is
     * used, because a counter that has fallen behind — a restored row, an
     * imported project — must jump past reality rather than collide with it.
     * This is the rule `Project.issueCounter` already follows for issue keys.
     *
     * In a transaction because the read and the write have to be atomic with
     * respect to another person adding an item in the same workshop.
     */
    const item = await prisma.$transaction(async (tx) => {
      const existing = await tx.activateCustomScopeItem.findMany({
        where: { projectId },
        select: { code: true },
      });
      const highest = existing.reduce((n, e) => {
        const m = e.code.match(/(\d+)$/);
        return m ? Math.max(n, Number(m[1])) : n;
      }, 0);

      const profile = await tx.activateProfile.update({
        where: { projectId },
        data: { customScopeCounter: { increment: 1 } },
        select: { customScopeCounter: true },
      });

      let next = profile.customScopeCounter;
      if (next <= highest) {
        next = highest + 1;
        await tx.activateProfile.update({
          where: { projectId },
          data: { customScopeCounter: next },
        });
      }

      return tx.activateCustomScopeItem.create({
        data: {
          projectId,
          moduleId: body.moduleId ?? null,
          code: `CUS-${String(next).padStart(2, "0")}`,
          name: body.name,
          workstreamKey: body.workstreamKey,
          tags: body.userFacing ? "ux" : null,
          position: existing.length,
          createdById: user.id,
        },
        select: {
          id: true,
          code: true,
          name: true,
          workstreamKey: true,
          tags: true,
          moduleId: true,
        },
      });
    });

    return NextResponse.json({ scopeItem: { ...item, custom: true } }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/scope-items");
  }
}
