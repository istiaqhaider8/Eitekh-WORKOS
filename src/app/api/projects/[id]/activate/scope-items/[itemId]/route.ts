import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError, ConflictError } from "@/lib/api-error";
import { parseJsonBody, activateCustomScopeItemUpdateSchema } from "@/lib/validation";
import { modulesForProject } from "@/lib/activate-scope";

/**
 * Edit or remove a scope item this project added.
 *
 * ONLY CUSTOM ITEMS.
 *
 * A template scope item is one row read by every tenant seeded from that
 * template, so there is no sense in which one project may rename it. The
 * lookup is against `ActivateCustomScopeItem` scoped by projectId, which means
 * a template item's id — and another project's custom item — are both simply
 * not found. A 404 rather than a 403: the caller is authorised for this
 * project, and "there is no such item of yours" is the whole truth.
 */
async function loadCustom(projectId: string, itemId: string) {
  return prisma.activateCustomScopeItem.findFirst({
    where: { id: itemId, projectId },
    select: { id: true, code: true, tags: true },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: projectId, itemId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_deliverables");

    const parsed = await parseJsonBody(req, activateCustomScopeItemUpdateSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    const existing = await loadCustom(projectId, itemId);
    if (!existing) return NextResponse.json({ error: "Scope item not found" }, { status: 404 });

    if (body.moduleId) {
      const modules = await modulesForProject(projectId);
      if (!modules.some((m) => m.moduleId === body.moduleId)) {
        return NextResponse.json(
          { error: "That module is not part of this project's methodology." },
          { status: 400 }
        );
      }
    }

    if (body.workstreamKey) {
      const ws = await prisma.activateWorkstream.findUnique({
        where: { projectId_key: { projectId, key: body.workstreamKey } },
        select: { id: true },
      });
      if (!ws) {
        return NextResponse.json(
          { error: "That workstream is not part of this project's methodology." },
          { status: 400 }
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.workstreamKey !== undefined) data.workstreamKey = body.workstreamKey;
    // Nullable on purpose: an item can be moved back to the project's own
    // grouping, which is not the same as leaving it where it was.
    if (body.moduleId !== undefined) data.moduleId = body.moduleId;
    if (body.userFacing !== undefined) data.tags = body.userFacing ? "ux" : null;

    const updated = await prisma.activateCustomScopeItem.update({
      where: { id: itemId },
      data,
      select: { id: true, code: true, name: true, workstreamKey: true, tags: true, moduleId: true },
    });

    return NextResponse.json({ scopeItem: { ...updated, custom: true } });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/scope-items/[itemId]");
  }
}

/**
 * Remove a custom scope item.
 *
 * REFUSED WHILE A DECISION EXISTS.
 *
 * A decision records what a group of people agreed about this item, and
 * deleting the item would leave that decision pointing at nothing — which the
 * catalogue renders as simply absent, so the record would vanish without
 * anyone being told. Withdrawing the decision is a separate, deliberate act,
 * and it is the one that should be taken first.
 *
 * A 409 rather than a 403: the caller has the right permission, the resource
 * is in the wrong state, and there is an obvious way forward.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: projectId, itemId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_deliverables");

    const existing = await loadCustom(projectId, itemId);
    if (!existing) return NextResponse.json({ error: "Scope item not found" }, { status: 404 });

    const decision = await prisma.activateDecision.findUnique({
      where: { projectId_scopeItemId: { projectId, scopeItemId: itemId } },
      select: { id: true },
    });
    if (decision) {
      throw new ConflictError(
        `${existing.code} has a recorded decision. Withdraw the decision before removing it.`,
        "SCOPE_ITEM_DECIDED"
      );
    }

    await prisma.activateCustomScopeItem.delete({ where: { id: itemId } });
    return NextResponse.json({ success: true, code: existing.code });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/scope-items/[itemId]");
  }
}
