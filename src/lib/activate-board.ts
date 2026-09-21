/**
 * Turning a planned item into a card on the board, and keeping it honest.
 *
 * WHY THIS IS NOT IN THE BACKLOG ROUTE ANY MORE
 *
 * Two callers now write these issues. The backlog route creates the whole
 * plan when somebody publishes a workshop, and the decision route creates one
 * card the moment a decision is saved. A second copy of "how a planned item
 * becomes an issue" would drift — different status, a missing deliverable
 * link, an issue type nobody allowed — and the drift would show up as two
 * cards on one board that behave differently for no reason anyone could name.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Deciding WHAT should exist. That is `planBacklog`, which is pure and
 * testable without a database. This module only writes what it is handed.
 */

import { prisma } from "./prisma";
import { planBacklog, taskStatusForDecision, type PlannedItem } from "./activate-generation";
import { scopeItemsWithDecisions } from "./activate-scope";
import { allocateIssueKey, issueStatusIdFor } from "./issue-keys";
import { allowedIssueTypeValues } from "./project-context";

export interface CreatedIssue {
  originKey: string;
  issueKey: string;
  id: string;
}

/** Everything the write loop needs, fetched once rather than per item. */
export interface BoardContext {
  phaseByKey: Map<string, string>;
  wsByKey: Map<string, string>;
  issueType: string | null;
}

export async function loadBoardContext(projectId: string): Promise<BoardContext> {
  const [phases, workstreams, allowedTypes] = await Promise.all([
    prisma.activatePhase.findMany({ where: { projectId }, select: { id: true, key: true } }),
    prisma.activateWorkstream.findMany({ where: { projectId }, select: { id: true, key: true } }),
    allowedIssueTypeValues(projectId),
  ]);
  return {
    phaseByKey: new Map(phases.map((p) => [p.key, p.id])),
    wsByKey: new Map(workstreams.map((w) => [w.key, w.id])),
    issueType: allowedTypes.has("TASK") ? "TASK" : ([...allowedTypes][0] ?? null),
  };
}

/**
 * Create the issues for planned items that do not have one yet.
 *
 * Skips anything whose `originKey` already exists, so this converges rather
 * than duplicating however many times it is called — the unique column does
 * the remembering, and no bookkeeping table is needed.
 *
 * ONE TRANSACTION PER ITEM, NOT ONE FOR THE RUN
 *
 * A single transaction around a hundred issue creations would hold a
 * connection for the duration and lose everything on one bad row. Here a
 * failure stops with everything before it committed, and running again picks
 * up where it left off.
 */
export async function createIssuesForPlan(
  projectId: string,
  items: PlannedItem[],
  reporterId: string,
  ctx: BoardContext
): Promise<CreatedIssue[]> {
  if (items.length === 0) return [];
  if (!ctx.issueType) throw new Error("This project has no issue types configured.");

  const already = await prisma.activateDeliverableLink.findMany({
    where: { phase: { projectId }, originKey: { in: items.map((p) => p.originKey) } },
    select: { originKey: true },
  });
  const done = new Set(already.map((a) => a.originKey as string));

  const created: CreatedIssue[] = [];

  for (const item of items) {
    if (done.has(item.originKey)) continue;

    const phaseId = ctx.phaseByKey.get(item.targetPhaseKey);
    // A plan targeting a phase this project does not have is skipped rather
    // than dropped into an arbitrary one: silently filing work under the
    // wrong phase is worse than not filing it.
    if (!phaseId) continue;

    const issue = await prisma.$transaction(async (tx) => {
      const { keyNumber, issueKey, project } = await allocateIssueKey(tx, projectId);
      const row = await tx.issue.create({
        data: {
          projectId,
          keyNumber,
          issueKey,
          title: item.title,
          description: item.note,
          issueType: ctx.issueType!,
          priority:
            item.priority === "WONT" ? "LOW" : item.priority === "MUST" ? "HIGH" : "MEDIUM",
          /**
           * The column comes from the plan, not from the workflow's shape.
           *
           * Build work is created in the Backlog whatever produced it —
           * including work from a DEFER, whose scope item is settled: the
           * decision being finished does not mean the thing agreed has been
           * built, and creating it Done would count work nobody has started
           * towards phase readiness and the Run dashboard.
           *
           * The scope-item card is the exception, and the only one: an Adopt
           * or an exclusion is finished the moment it is agreed, so it is
           * created in Done rather than sitting on the board forever as a
           * card nobody can act on.
           */
          statusId: issueStatusIdFor(project, item.issueStatus),
          reporterId,
          assigneeId: item.ownerId ?? null,
        },
        select: { id: true, issueKey: true },
      });

      await tx.activateDeliverableLink.create({
        data: {
          issueId: row.id,
          phaseId,
          workstreamId: ctx.wsByKey.get(item.workstreamKey) ?? null,
          isMandatory: item.priority === "MUST",
          fitGapStatus: item.decision,
          originKey: item.originKey,
        },
      });

      return row;
    });

    created.push({ originKey: item.originKey, issueKey: issue.issueKey, id: issue.id });
  }

  return created;
}

/**
 * What to do with a card whose decision just changed.
 *
 * A pure function, because this is the judgement in the whole feature and it
 * deserves to be readable and testable on its own.
 *
 * THE RULE
 *
 *   The card follows the decision until a person moves it. After that it is
 *   theirs.
 *
 * "Has a person moved it" is answered by comparing where the card IS with
 * where the PREVIOUS decision would have put it. If they match, nothing but
 * this feature has touched it and re-filing is invisible and correct. If they
 * differ, somebody dragged it — into progress, into review, into done ahead
 * of the paperwork — and moving it back would be the software overruling a
 * person about their own board. So it stays, and the caller says so out loud
 * rather than leaving the workshop and the board quietly disagreeing.
 */
export type CardAction = "unchanged" | "move" | "leave_alone";

export function decideCardAction(input: {
  /** Where the card is now. */
  currentStatusId: string;
  /** Where the previous decision would have filed it. */
  previousExpectedStatusId: string;
  /** Where the new decision files it. */
  nextExpectedStatusId: string;
}): CardAction {
  if (input.currentStatusId !== input.previousExpectedStatusId) return "leave_alone";
  if (input.nextExpectedStatusId === input.currentStatusId) return "unchanged";
  return "move";
}

/**
 * The card one decision implies, obtained from the same rules as everything
 * else rather than written out a second time.
 *
 * It runs `planBacklog` over this decision alone and keeps the item R6
 * produced. That indirection is the point: the title, the column, the phase
 * and the description all come from one place, so the card a decision makes
 * on save is identical to the one Generate would have made. It also inherits
 * R0 for free — a decision on a module the project is not doing plans
 * nothing, so nothing is created.
 */
export async function planDecisionCard(
  projectId: string,
  decisionId: string
): Promise<PlannedItem | null> {
  const { enabled, modules, items, decisions } = await scopeItemsWithDecisions(projectId);
  if (!enabled) return null;

  const decision = decisions.find((d) => d.id === decisionId);
  if (!decision) return null;

  const planned = planBacklog({
    decisions: [
      {
        id: decision.id,
        scopeItemId: decision.scopeItemId,
        decision: decision.decision,
        openQuestion: decision.openQuestion,
        questionOwnerId: decision.questionOwnerId,
        rationale: decision.rationale,
        // Deliberately empty: saving a decision creates the card, never the
        // build work. Work somebody is being committed to deserves the
        // deliberate act that Generate is.
        deltas: [],
      },
    ],
    scopeItems: new Map(items.map((i) => [i.id, i])),
    modulesInScope: new Set(modules.filter((m) => m.inScope).map((m) => m.moduleId)),
  });

  return planned.find((p) => p.originKey === `decision:${decisionId}`) ?? null;
}

export interface DecisionCardResult {
  issueId: string;
  issueKey: string;
  statusName: string;
  action: "created" | CardAction;
}

/**
 * Put one decision on the board, or bring its card back in line.
 *
 * Called from the decision route on every save, so a workshop's outcome is
 * visible on the board immediately rather than after somebody remembers to
 * publish. It creates ONLY the card standing for the decision: the build work
 * a delta implies still waits for the Generate step, because that is work
 * people are committing somebody to and it deserves a deliberate act.
 *
 * Returns null when there is nothing to show — an out-of-scope module, a
 * phase the project does not have, a project with no issue types. A failure
 * here must never fail the decision itself: the record of what a workshop
 * agreed is the important thing, and a card is a convenience.
 */
export async function syncDecisionCard(
  projectId: string,
  decisionId: string,
  previousDecision: string | null,
  reporterId: string
): Promise<DecisionCardResult | null> {
  const item = await planDecisionCard(projectId, decisionId);
  if (!item) return null;

  const link = await prisma.activateDeliverableLink.findFirst({
    where: { phase: { projectId }, originKey: item.originKey },
    select: {
      id: true,
      issue: { select: { id: true, issueKey: true, statusId: true } },
    },
  });

  if (!link) {
    const ctx = await loadBoardContext(projectId);
    if (!ctx.issueType) return null;
    const [created] = await createIssuesForPlan(projectId, [item], reporterId, ctx);
    if (!created) return null;
    const row = await prisma.issue.findUnique({
      where: { id: created.id },
      select: { status: { select: { name: true } } },
    });
    return {
      issueId: created.id,
      issueKey: created.issueKey,
      statusName: row?.status.name ?? "",
      action: "created",
    };
  }

  /**
   * The card exists, so the question is whether to move it.
   *
   * Both expected columns are resolved through the same function that filed
   * it in the first place, against this project's own workflow — so the
   * comparison means "is it still where we put it", not "is it in a column
   * whose name we recognise".
   */
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { workflows: { include: { statuses: { orderBy: { position: "asc" } } } } },
  });
  if (!project) return null;

  const previousStatus = taskStatusForDecision(previousDecision) ?? "BACKLOG";
  const previousExpectedStatusId = issueStatusIdFor(project, previousStatus);
  const nextExpectedStatusId = issueStatusIdFor(project, item.issueStatus);

  const action = decideCardAction({
    currentStatusId: link.issue.statusId,
    previousExpectedStatusId,
    nextExpectedStatusId,
  });

  if (action === "move") {
    await prisma.issue.update({
      where: { id: link.issue.id },
      data: { statusId: nextExpectedStatusId },
    });
  }

  // The classification on the link follows the decision either way: it is
  // this feature's own bookkeeping, not something a person has an opinion
  // about, and the readiness report counts gaps from it.
  await prisma.activateDeliverableLink.update({
    where: { id: link.id },
    data: { fitGapStatus: item.decision },
  });

  const finalStatusId = action === "move" ? nextExpectedStatusId : link.issue.statusId;
  const statusRow = await prisma.workflowStatus.findUnique({
    where: { id: finalStatusId },
    select: { name: true },
  });

  return {
    issueId: link.issue.id,
    issueKey: link.issue.issueKey,
    statusName: statusRow?.name ?? "",
    action,
  };
}
