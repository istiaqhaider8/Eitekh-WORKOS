import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError, ConflictError } from "@/lib/api-error";
import { planBacklog, type PlannedItem } from "@/lib/activate-generation";
import { scopeItemsWithDecisions } from "@/lib/activate-scope";
import { createIssuesForPlan, loadBoardContext } from "@/lib/activate-board";
import { logAuditEvent } from "@/lib/audit-logger";

/**
 * The backlog the current decisions imply, and turning it into real issues.
 *
 * BUILD WORK IS EXPLICIT; THE DECISION CARD IS NOT
 *
 * The card standing for a decision is created the moment the decision is
 * saved, by the decision route — because a workshop that records six
 * outcomes and leaves the board empty is one product telling two stories
 * about the same afternoon.
 *
 * The WORK still waits for this route. A fit-to-standard workshop is exactly
 * where people change their minds mid-sentence, and an issue committing
 * somebody to build something is not free to withdraw once a colleague has
 * commented on it or put it in a sprint. So GET shows what WOULD be created
 * and POST creates it, deliberately, when the workshop is over.
 *
 * Both paths write through `activate-board.ts`, so a card created on save is
 * indistinguishable from one this route would have made.
 *
 * IT IS IDEMPOTENT BY CONSTRUCTION
 *
 * Every planned item carries an `originKey` derived from what produced it —
 * a delta id, or a decision id plus the rule that fired — and the column is
 * unique. Running generation twice converges instead of duplicating, and no
 * bookkeeping table is needed to remember what was already made.
 */
async function planFor(projectId: string): Promise<{ enabled: boolean; planned: PlannedItem[] }> {
  const { enabled, modules, items, decisions } = await scopeItemsWithDecisions(projectId);
  if (!enabled) return { enabled: false, planned: [] };

  const inScope = new Set(modules.filter((m) => m.inScope).map((m) => m.moduleId));
  const planned = planBacklog({
    decisions: decisions.map((d) => ({
      id: d.id,
      scopeItemId: d.scopeItemId,
      decision: d.decision,
      openQuestion: d.openQuestion,
      questionOwnerId: d.questionOwnerId,
      // Carried so the scope-item task's description says why, in the words
      // the workshop used, to somebody reading the card on the board months
      // later with none of that context.
      rationale: d.rationale,
      deltas: d.deltas,
    })),
    scopeItems: new Map(items.map((i) => [i.id, i])),
    modulesInScope: inScope,
  });
  return { enabled: true, planned };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:view");

    const { enabled, planned } = await planFor(projectId);
    if (!enabled) return NextResponse.json({ enabled: false, items: [], generated: 0, pending: 0 });

    // Which of them already exist, in one query rather than one per item.
    const existing = await prisma.activateDeliverableLink.findMany({
      where: { phase: { projectId }, originKey: { in: planned.map((p) => p.originKey) } },
      select: { originKey: true, issue: { select: { id: true, issueKey: true } } },
    });
    const byKey = new Map(existing.map((e) => [e.originKey as string, e.issue]));

    return NextResponse.json({
      enabled: true,
      items: planned.map((p) => ({ ...p, issue: byKey.get(p.originKey) ?? null })),
      generated: planned.filter((p) => byKey.has(p.originKey)).length,
      pending: planned.filter((p) => !byKey.has(p.originKey)).length,
    });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/backlog");
  }
}

/**
 * Create the issues the plan calls for, and link them as deliverables.
 *
 * Reuses the same issue-key allocator and deliverable link as the accelerator
 * path, so a generated item is indistinguishable from any other issue on the
 * board — which is the point. The backlog is not a parallel world.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_deliverables");

    const { enabled, planned } = await planFor(projectId);
    if (!enabled) {
      throw new ConflictError("Activate is not enabled for this project.", "ACTIVATE_DISABLED");
    }

    const ctx = await loadBoardContext(projectId);
    if (!ctx.issueType) {
      throw new ConflictError("This project has no issue types configured.", "NO_ISSUE_TYPES");
    }

    // The write loop lives in activate-board.ts, because the decision route
    // creates cards through the same path the moment a decision is saved.
    const created = await createIssuesForPlan(projectId, planned, user.id, ctx);

    await logAuditEvent({
      actor: {
        id: user.id,
        name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
        email: user.email,
      },
      action: "ACTIVATE_BACKLOG_GENERATED",
      category: "PROJECT",
      severity: "NOTICE",
      status: "SUCCESS",
      targetResource: `Project:${projectId}`,
      projectId,
      details: { created: created.length, planned: planned.length },
    }).catch((e) => console.error("Failed to audit backlog generation:", e));

    /**
     * 200 when nothing was created, 201 when something was.
     *
     * A run that creates nothing has not created anything, and a client that
     * cannot tell the difference cannot tell a converged board from a
     * successful generation.
     */
    return NextResponse.json(
      { created: created.length, skipped: planned.length - created.length, issues: created },
      { status: created.length > 0 ? 201 : 200 }
    );
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/backlog");
  }
}
