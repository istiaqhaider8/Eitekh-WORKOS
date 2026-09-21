import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError, ConflictError } from "@/lib/api-error";
import { planBacklog, type PlannedItem } from "@/lib/activate-generation";
import { scopeItemsWithDecisions } from "@/lib/activate-scope";
import { allocateIssueKey, issueStatusIdFor } from "@/lib/issue-keys";
import { allowedIssueTypeValues } from "@/lib/project-context";
import { logAuditEvent } from "@/lib/audit-logger";

/**
 * The backlog the current decisions imply, and turning it into real issues.
 *
 * GENERATION IS EXPLICIT, NOT AUTOMATIC ON SAVE
 *
 * A fit-to-standard workshop is exactly where people change their minds
 * mid-sentence. Creating an issue the instant a delta is typed would fill the
 * board with work that was retracted a minute later, and an issue is not free
 * to withdraw once someone has commented on it or put it in a sprint. So GET
 * shows what WOULD be created and POST creates it, deliberately, when the
 * workshop is over.
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

    const already = await prisma.activateDeliverableLink.findMany({
      where: { phase: { projectId }, originKey: { in: planned.map((p) => p.originKey) } },
      select: { originKey: true },
    });
    const done = new Set(already.map((a) => a.originKey as string));
    const todo = planned.filter((p) => !done.has(p.originKey));

    if (todo.length === 0) {
      return NextResponse.json({ created: 0, skipped: planned.length, issues: [] });
    }

    // Phases and workstreams by key, once, so the loop below does no lookups.
    const [phases, workstreams, allowedTypes] = await Promise.all([
      prisma.activatePhase.findMany({ where: { projectId }, select: { id: true, key: true } }),
      prisma.activateWorkstream.findMany({ where: { projectId }, select: { id: true, key: true } }),
      allowedIssueTypeValues(projectId),
    ]);
    const phaseByKey = new Map(phases.map((p) => [p.key, p.id]));
    const wsByKey = new Map(workstreams.map((w) => [w.key, w.id]));

    const issueType = allowedTypes.has("TASK") ? "TASK" : [...allowedTypes][0];
    if (!issueType) {
      throw new ConflictError("This project has no issue types configured.", "NO_ISSUE_TYPES");
    }

    const created: Array<{ originKey: string; issueKey: string; id: string }> = [];

    for (const item of todo) {
      const phaseId = phaseByKey.get(item.targetPhaseKey);
      // A plan targeting a phase this project does not have is skipped rather
      // than dropped into an arbitrary one: silently filing work under the
      // wrong phase is worse than not filing it.
      if (!phaseId) continue;

      /**
       * One transaction per item rather than one for the whole run.
       *
       * A single transaction around a hundred issue creations would hold a
       * connection for the duration and lose everything on one bad row. Here
       * a failure stops the run with everything before it committed, and
       * re-running picks up where it left off — which the unique originKey
       * makes safe.
       */
      const result = await prisma.$transaction(async (tx) => {
        const { keyNumber, issueKey, project } = await allocateIssueKey(tx, projectId);
        const issue = await tx.issue.create({
          data: {
            projectId,
            keyNumber,
            issueKey,
            title: item.title,
            description: item.note,
            issueType,
            priority: item.priority === "WONT" ? "LOW" : item.priority === "MUST" ? "HIGH" : "MEDIUM",
            /**
             * The column comes from the plan, not from the workflow's shape.
             *
             * Build work is created in the Backlog whatever produced it —
             * including work from a DEFER, whose scope item is settled: the
             * decision being finished does not mean the thing agreed has been
             * built, and creating it Done would count work nobody has started
             * towards phase readiness and the Run dashboard.
             *
             * The scope-item task (R6) is the exception, and the only one: an
             * Adopt or an exclusion is finished the moment it is agreed, so
             * it is created in Done rather than sitting on the board forever
             * as a card nobody can act on.
             *
             * This used to be `defaultStatusIdFor`, the first status by
             * position. For the Scrum template that happened to BE Backlog,
             * so the behaviour is unchanged there — but it was true by
             * coincidence of ordering rather than by intent.
             */
            statusId: issueStatusIdFor(project, item.issueStatus),
            reporterId: user.id,
            assigneeId: item.ownerId ?? null,
          },
          select: { id: true, issueKey: true },
        });

        await tx.activateDeliverableLink.create({
          data: {
            issueId: issue.id,
            phaseId,
            workstreamId: wsByKey.get(item.workstreamKey) ?? null,
            isMandatory: item.priority === "MUST",
            fitGapStatus: item.decision,
            originKey: item.originKey,
          },
        });

        return issue;
      });

      created.push({ originKey: item.originKey, issueKey: result.issueKey, id: result.id });
    }

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

    return NextResponse.json(
      { created: created.length, skipped: planned.length - created.length, issues: created },
      { status: 201 }
    );
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/backlog");
  }
}
