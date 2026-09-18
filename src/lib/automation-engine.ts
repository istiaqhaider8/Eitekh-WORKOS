import { prisma } from "./prisma";
import { logger } from "./logger";

/**
 * Automation rule execution.
 *
 * AutomationRule had a model, CRUD endpoints, validation schemas and UI, but
 * nothing ever evaluated the rules — `triggerType` appeared only in the CRUD
 * route and the validation file. Rules could be created and would never run.
 * This module is the missing evaluator.
 *
 * Two hazards are handled deliberately:
 *
 * 1. FEEDBACK LOOPS. A CHANGE_STATUS action itself changes a status, which is
 *    exactly what the STATUS_CHANGED trigger listens for. Without a guard, two
 *    rules pointing at each other (or one rule whose action satisfies its own
 *    trigger) would recurse until the process died. Execution therefore carries
 *    a depth counter and refuses to cascade beyond MAX_CASCADE_DEPTH, and a rule
 *    never re-triggers itself within one cascade.
 *
 * 2. ACTIONS RUN WITHOUT A USER. An action is applied by the system, so it
 *    cannot inherit a caller's permissions. Every action target is therefore
 *    re-validated against the rule's own project — a status must belong to that
 *    project's workflow and an assignee must be a member of it. Otherwise a
 *    crafted actionConfig would be a cross-project write primitive, which is the
 *    same class of bug as the cross-project statusId issue fixed earlier.
 */

export type AutomationTrigger =
  | "ISSUE_CREATED"
  | "STATUS_CHANGED"
  | "ASSIGNEE_CHANGED"
  | "DUE_DATE";

export interface AutomationContext {
  projectId: string;
  issueId: string;
  /** The user whose action triggered this, when there was one. */
  actorId?: string;
  /** Field values before the change, for STATUS_CHANGED / ASSIGNEE_CHANGED. */
  previous?: { statusId?: string | null; assigneeId?: string | null };
  /** How many automation hops led here. Callers from a route leave this at 0. */
  depth?: number;
  /** Rules already fired in this cascade, so none can fire twice. */
  firedRuleIds?: Set<string>;
}

const MAX_CASCADE_DEPTH = 3;

function safeParse(json: string | null | undefined): any {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Evaluates `conditionRules` against the issue.
 *
 * Supported shape: `{ all?: [{field, op, value}], any?: [...] }`, plus a bare
 * array which is treated as `all`. An unparseable or empty condition set means
 * "no conditions", matching the permissive behaviour the UI implies.
 */
function conditionsMatch(conditionRules: string | null | undefined, issue: any): boolean {
  const parsed = safeParse(conditionRules);
  if (!parsed) return true;

  const clauses: any[] = Array.isArray(parsed) ? parsed : parsed.all || parsed.any || [];
  if (clauses.length === 0) return true;

  const test = (c: any): boolean => {
    if (!c || typeof c.field !== "string") return false;
    const actual = issue[c.field];
    const op = (c.op || "eq").toLowerCase();
    switch (op) {
      case "eq":
        return String(actual ?? "") === String(c.value ?? "");
      case "neq":
        return String(actual ?? "") !== String(c.value ?? "");
      case "contains":
        return String(actual ?? "").toLowerCase().includes(String(c.value ?? "").toLowerCase());
      case "isempty":
        return actual === null || actual === undefined || actual === "";
      case "isnotempty":
        return !(actual === null || actual === undefined || actual === "");
      case "in":
        return Array.isArray(c.value) && c.value.map(String).includes(String(actual ?? ""));
      default:
        // An unknown operator must not silently pass, or a typo in a rule
        // would make it fire on everything.
        return false;
    }
  };

  if (Array.isArray(parsed) || parsed.all) return clauses.every(test);
  return clauses.some(test);
}

async function applyAction(
  rule: any,
  issue: any,
  ctx: AutomationContext,
): Promise<{ applied: boolean; statusChanged?: boolean; assigneeChanged?: boolean; detail: string }> {
  const cfg = safeParse(rule.actionConfig) || {};

  switch (rule.actionType) {
    case "CHANGE_STATUS": {
      const targetStatusId = cfg.statusId || cfg.toStatusId;
      if (!targetStatusId) return { applied: false, detail: "no statusId in actionConfig" };
      if (targetStatusId === issue.statusId) return { applied: false, detail: "already in target status" };

      // The status must belong to this project's own workflow.
      const valid = await prisma.workflowStatus.findFirst({
        where: { id: targetStatusId, workflow: { projectId: rule.projectId } },
        select: { id: true },
      });
      if (!valid) {
        logger.security(
          "AUTOMATION_ACTION_REJECTED",
          `Rule ${rule.id} tried to set a status outside its project`,
          { ruleId: rule.id, projectId: rule.projectId, targetStatusId }
        );
        return { applied: false, detail: "statusId does not belong to this project" };
      }

      await prisma.issue.update({ where: { id: issue.id }, data: { statusId: targetStatusId } });
      return { applied: true, statusChanged: true, detail: `status -> ${targetStatusId}` };
    }

    case "ASSIGN_USER": {
      const targetUserId = cfg.userId || cfg.assigneeId;
      if (!targetUserId) return { applied: false, detail: "no userId in actionConfig" };
      if (targetUserId === issue.assigneeId) return { applied: false, detail: "already assigned" };

      // The assignee must be a member of this project.
      const member = await prisma.projectMember.findFirst({
        where: { projectId: rule.projectId, userId: targetUserId },
        select: { id: true },
      });
      if (!member) {
        logger.security(
          "AUTOMATION_ACTION_REJECTED",
          `Rule ${rule.id} tried to assign a non-member`,
          { ruleId: rule.id, projectId: rule.projectId, targetUserId }
        );
        return { applied: false, detail: "user is not a member of this project" };
      }

      await prisma.issue.update({ where: { id: issue.id }, data: { assigneeId: targetUserId } });
      return { applied: true, assigneeChanged: true, detail: `assignee -> ${targetUserId}` };
    }

    case "ADD_COMMENT": {
      const body = typeof cfg.content === "string" ? cfg.content.trim() : "";
      if (!body) return { applied: false, detail: "no content in actionConfig" };

      // Comments need an author. Automations have no user, so attribute to the
      // rule's project owner rather than inventing a synthetic account.
      const project = await prisma.project.findUnique({
        where: { id: rule.projectId },
        select: { ownerId: true },
      });
      const authorId = project?.ownerId || ctx.actorId;
      if (!authorId) return { applied: false, detail: "no author available for the comment" };

      await prisma.comment.create({
        data: { issueId: issue.id, userId: authorId, content: body.slice(0, 5000) },
      });
      return { applied: true, detail: "comment added" };
    }

    case "NOTIFY": {
      const recipients: string[] = Array.isArray(cfg.userIds)
        ? cfg.userIds
        : cfg.userId
        ? [cfg.userId]
        : issue.assigneeId
        ? [issue.assigneeId]
        : [];
      if (recipients.length === 0) return { applied: false, detail: "no recipients resolved" };

      // Only notify people who can actually see the issue.
      const members = await prisma.projectMember.findMany({
        where: { projectId: rule.projectId, userId: { in: recipients } },
        select: { userId: true },
      });
      const allowed = members.map((m) => m.userId);
      if (allowed.length === 0) return { applied: false, detail: "no recipient is a project member" };

      const { notificationEngine } = await import("./notifications");
      await notificationEngine.dispatch({
        recipientUserIds: allowed,
        type: "INFO",
        title: cfg.title || `Automation: ${rule.name}`,
        message: cfg.message || `Rule "${rule.name}" fired on ${issue.issueKey}.`,
        linkUrl: `/projects/${rule.projectId}?issue=${issue.id}`,
        projectId: rule.projectId,
        issueId: issue.id,
      });
      return { applied: true, detail: `notified ${allowed.length} member(s)` };
    }

    default:
      return { applied: false, detail: `unsupported actionType ${rule.actionType}` };
  }
}

/**
 * Runs every active rule for the trigger. Never throws: an automation failure
 * must not fail the user action that triggered it.
 */
export async function runAutomations(trigger: AutomationTrigger, ctx: AutomationContext): Promise<void> {
  const depth = ctx.depth ?? 0;
  const fired = ctx.firedRuleIds ?? new Set<string>();

  if (depth > MAX_CASCADE_DEPTH) {
    logger.warn("AUTOMATION_CASCADE_LIMIT", `Stopped automation cascade at depth ${depth}`, {
      projectId: ctx.projectId,
      issueId: ctx.issueId,
      trigger,
    });
    return;
  }

  try {
    const rules = await prisma.automationRule.findMany({
      where: { projectId: ctx.projectId, isActive: true, triggerType: trigger },
    });
    if (rules.length === 0) return;

    const issue = await prisma.issue.findUnique({ where: { id: ctx.issueId } });
    if (!issue) return;

    for (const rule of rules) {
      if (fired.has(rule.id)) continue;

      try {
        if (!conditionsMatch(rule.conditionRules, issue)) continue;

        fired.add(rule.id);
        const result = await applyAction(rule, issue, ctx);

        logger.info(
          result.applied ? "AUTOMATION_RULE_APPLIED" : "AUTOMATION_RULE_SKIPPED",
          `Rule "${rule.name}" on ${issue.issueKey}: ${result.detail}`,
          { ruleId: rule.id, projectId: rule.projectId, issueId: issue.id, trigger, depth }
        );

        if (!result.applied) continue;

        // Cascade, bounded by depth and the fired-set.
        if (result.statusChanged) {
          await runAutomations("STATUS_CHANGED", {
            ...ctx,
            previous: { statusId: issue.statusId },
            depth: depth + 1,
            firedRuleIds: fired,
          });
        }
        if (result.assigneeChanged) {
          await runAutomations("ASSIGNEE_CHANGED", {
            ...ctx,
            previous: { assigneeId: issue.assigneeId },
            depth: depth + 1,
            firedRuleIds: fired,
          });
        }
      } catch (ruleErr: any) {
        logger.error("AUTOMATION_RULE_FAILED", `Rule ${rule.id} failed`, ruleErr, {
          ruleId: rule.id,
          projectId: ctx.projectId,
          issueId: ctx.issueId,
        });
      }
    }
  } catch (err: any) {
    logger.error("AUTOMATION_ENGINE_ERROR", "Automation evaluation failed", err, {
      projectId: ctx.projectId,
      issueId: ctx.issueId,
      trigger,
    });
  }
}
