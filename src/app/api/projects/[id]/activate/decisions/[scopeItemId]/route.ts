import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { parseJsonBody, activateDecisionSchema } from "@/lib/validation";
import { assertActivateRefsBelongToProject } from "@/lib/activate-refs";
import { scopeItemsWithDecisions } from "@/lib/activate-scope";

/**
 * Record what a project decided about one scope item, with its deltas.
 *
 * A DECISION AND ITS DELTAS ARE ONE REQUEST
 *
 * A fit-to-standard workshop settles a scope item as a unit: the outcome, why,
 * and what therefore has to be built. Splitting that across three calls would
 * let a decision sit on screen with deltas that contradict it, in front of the
 * people who just agreed something else. So this is a PUT of the whole
 * decision, and the deltas it carries replace what was there.
 *
 * DELTAS ARE MATCHED BY ID, NOT REBUILT
 *
 * A delta that arrives with an id is updated; one without is created; one that
 * is absent is deleted. Deleting and re-creating them all would be simpler and
 * would silently destroy the link to any issue already generated from a delta,
 * because generation keys on the delta id. Somebody would notice a month later
 * when the backlog doubled.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; scopeItemId: string }> }
) {
  try {
    const { id: projectId, scopeItemId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_deliverables");

    const parsed = await parseJsonBody(req, activateDecisionSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    /**
     * The scope item must belong to THIS project's template.
     *
     * The id is in the PATH but names a row in a template table, which is not
     * tenant-scoped by itself. Reading the project's own catalogue and
     * checking membership is what closes that: another template's scope item
     * is a 404, indistinguishable from one that does not exist.
     */
    const { enabled, items } = await scopeItemsWithDecisions(projectId);
    if (!enabled) {
      return NextResponse.json(
        { error: "Activate is not enabled for this project." },
        { status: 409 }
      );
    }
    const scopeItem = items.find((i) => i.id === scopeItemId);
    if (!scopeItem) return NextResponse.json({ error: "Scope item not found" }, { status: 404 });

    // Owners named in the body must be members of this project.
    await assertActivateRefsBelongToProject(projectId, { ownerId: body.questionOwnerId });
    for (const d of body.deltas ?? []) {
      await assertActivateRefsBelongToProject(projectId, { ownerId: d.ownerId });
    }

    const existing = await prisma.activateDecision.findUnique({
      where: { projectId_scopeItemId: { projectId, scopeItemId } },
      select: { id: true, version: true },
    });

    // Optimistic locking, matching the M4 convention. A workshop has several
    // people editing at once, which is exactly where a silent overwrite of
    // somebody else's rationale would go unnoticed.
    if (existing && body.version !== undefined && body.version !== existing.version) {
      return NextResponse.json(
        {
          error: "This decision was changed by someone else. Reload and try again.",
          currentVersion: existing.version,
        },
        { status: 409 }
      );
    }

    const agreed = body.status === "AGREED";

    const saved = await prisma.$transaction(async (tx) => {
      const decision = existing
        ? await tx.activateDecision.update({
            where: { id: existing.id },
            data: {
              decision: body.decision,
              status: body.status ?? "DRAFT",
              rationale: body.rationale ?? null,
              openQuestion: body.openQuestion ?? null,
              questionOwnerId: body.questionOwnerId ?? null,
              // Stamped when it becomes AGREED, cleared when it goes back to
              // draft, so the field never claims a sign-off that was undone.
              decidedById: agreed ? user.id : null,
              decidedAt: agreed ? new Date() : null,
              version: { increment: 1 },
            },
            select: { id: true, version: true },
          })
        : await tx.activateDecision.create({
            data: {
              projectId,
              scopeItemId,
              decision: body.decision,
              status: body.status ?? "DRAFT",
              rationale: body.rationale ?? null,
              openQuestion: body.openQuestion ?? null,
              questionOwnerId: body.questionOwnerId ?? null,
              decidedById: agreed ? user.id : null,
              decidedAt: agreed ? new Date() : null,
            },
            select: { id: true, version: true },
          });

      const incoming = body.deltas ?? [];
      const keepIds = incoming.map((d) => d.id).filter(Boolean) as string[];

      // Gone from the payload means deleted. Scoped to this decision so a
      // stray id from elsewhere cannot widen the delete.
      await tx.activateDelta.deleteMany({
        where: { decisionId: decision.id, id: { notIn: keepIds.length ? keepIds : ["__none__"] } },
      });

      for (let i = 0; i < incoming.length; i += 1) {
        const d = incoming[i];
        const data = {
          title: d.title,
          buildType: d.buildType ?? "CONFIGURATION",
          priority: d.priority ?? "SHOULD",
          size: d.size ?? "M",
          ownerId: d.ownerId ?? null,
          targetPhaseKey: d.targetPhaseKey ?? null,
          note: d.note ?? null,
          position: i,
        };
        if (d.id) {
          // updateMany, scoped by decisionId: an id belonging to another
          // decision updates nothing rather than being written across.
          await tx.activateDelta.updateMany({
            where: { id: d.id, decisionId: decision.id },
            data,
          });
        } else {
          await tx.activateDelta.create({ data: { decisionId: decision.id, ...data } });
        }
      }

      return decision;
    });

    const full = await prisma.activateDecision.findUnique({
      where: { id: saved.id },
      select: {
        id: true,
        scopeItemId: true,
        decision: true,
        status: true,
        rationale: true,
        openQuestion: true,
        questionOwnerId: true,
        decidedById: true,
        decidedAt: true,
        version: true,
        deltas: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            title: true,
            buildType: true,
            priority: true,
            size: true,
            ownerId: true,
            targetPhaseKey: true,
            note: true,
          },
        },
      },
    });

    return NextResponse.json({ decision: full }, { status: existing ? 200 : 201 });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/decisions/[scopeItemId]");
  }
}

/**
 * Withdraw a decision entirely.
 *
 * Deltas go with it, by cascade. Issues already GENERATED from those deltas do
 * not: they are real work that may be underway, and deleting somebody's
 * in-progress issue because a classification was withdrawn would be an
 * astonishing thing for this route to do. The generated items simply stop
 * being re-proposed.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; scopeItemId: string }> }
) {
  try {
    const { id: projectId, scopeItemId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_deliverables");

    const existing = await prisma.activateDecision.findUnique({
      where: { projectId_scopeItemId: { projectId, scopeItemId } },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Decision not found" }, { status: 404 });

    await prisma.activateDecision.delete({ where: { id: existing.id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/decisions/[scopeItemId]");
  }
}
