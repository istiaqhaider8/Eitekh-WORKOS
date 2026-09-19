import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { handleApiError } from "@/lib/api-error";
import { assertIssueRelationsBelongToProject } from "@/lib/issue-relations";

/**
 * H5 — the recurring-task scheduler.
 *
 * WHAT THIS USED TO BE, AND WHY IT HAD TO CHANGE
 *
 * It authenticated with `getCurrentUser()` and then processed EVERY tenant's
 * due recurring tasks. Those two facts do not belong in the same route. Any
 * user with a session — any tenant, any role, no permission check of any kind —
 * could POST here and:
 *
 *   - force every other organization's recurring tasks to fire early
 *   - create issues in projects they cannot see
 *   - have themselves recorded as the REPORTER on those issues, so their name
 *     and email appear in another tenant's issue list
 *   - increment other tenants' issue counters, permanently skipping keys
 *
 * That is a cross-tenant write reachable by anyone who can log in, and it was
 * the most exposed of the ones found in this pass: the others needed the
 * attacker to know an id belonging to the victim, whereas this one needed
 * nothing at all.
 *
 * WHY A SECRET RATHER THAN A SESSION
 *
 * The route is a scheduler. It always operated on all tenants, updating
 * `lastRunAt` and `nextRunAt` as it went — there is no reading of it under
 * which a per-user session is the right credential, because no single user is
 * entitled to run everyone's schedule. DEPLOYMENT.md's answer was a
 * super-admin "service account" cookie, which does not help: the route never
 * checked for super-admin, so any session worked.
 *
 * So it becomes what it already was: a cron endpoint behind a shared secret,
 * exactly like POST /api/internal/alerts/check. Unset secret refuses rather
 * than defaulting to open, because a scheduler that silently accepts anyone is
 * the failure this is fixing.
 *
 * BREAKING: an existing crontab passing a session cookie will now get a 403.
 * Set RECURRING_TASKS_SECRET and send it as `x-cron-secret`; see DEPLOYMENT.md.
 *
 * NOT FIXED HERE, and worth its own change: `getNextCronDate` ignores
 * `scheduleCron` entirely and always adds one day, so WEEKLY and MONTHLY tasks
 * fire daily. That is a scheduling defect, not an authorization one, and
 * correcting it changes when existing tasks run.
 */

/**
 * The next run.
 *
 * Unchanged, deliberately — see the note above. `scheduleCron` holds DAILY,
 * WEEKLY or MONTHLY and this returns tomorrow for all three.
 */
function getNextCronDate(cron: string, fromDate = new Date()): Date {
  // Simple fallback: add 1 day
  const next = new Date(fromDate);
  next.setDate(next.getDate() + 1);
  return next;
}

export async function POST(request: Request) {
  try {
    const secret = process.env.RECURRING_TASKS_SECRET;
    if (!secret) {
      // Fail closed. An unset secret is a misconfiguration, not permission —
      // and this route writes to every tenant in the installation.
      return NextResponse.json(
        { error: "Recurring tasks are not configured (RECURRING_TASKS_SECRET unset)." },
        { status: 503 }
      );
    }

    const provided =
      request.headers.get("x-cron-secret") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      "";

    // Constant-time, so the response time does not report how much of the
    // secret was right.
    const { timingSafeEqual } = await import("node:crypto");
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    const ok = a.length === b.length && timingSafeEqual(a, b);

    if (!ok) {
      logger.security(
        "RECURRING_TRIGGER_UNAUTHORIZED",
        "Rejected an unauthenticated recurring-task trigger"
      );
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = new Date();

    const dueTasks = await prisma.recurringTask.findMany({
      where: {
        isActive: true,
        OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }],
      },
    });

    let createdCount = 0;
    let skippedCount = 0;

    /**
     * The first workflow status per project, fetched once.
     *
     * This was a findFirst INSIDE the loop, so a run with 200 due tasks issued
     * 200 identical queries whenever those tasks shared projects — the classic
     * N+1. The answer only varies per project, and the number of distinct
     * projects in a batch is normally a small fraction of the number of tasks.
     * The counter increment below genuinely has to stay per-task: it is the
     * atomic allocation of the issue key.
     */
    const projectIds = [...new Set(dueTasks.map((t) => t.projectId))];
    const statuses = await prisma.workflowStatus.findMany({
      where: { workflow: { projectId: { in: projectIds } } },
      orderBy: { position: "asc" },
      select: { id: true, workflow: { select: { projectId: true } } },
    });
    const defaultStatusByProject = new Map<string, string>();
    for (const s of statuses) {
      // findMany returns them ordered by position, so the first one seen for a
      // project is the same row the old findFirst would have returned.
      if (!defaultStatusByProject.has(s.workflow.projectId)) {
        defaultStatusByProject.set(s.workflow.projectId, s.id);
      }
    }

    for (const task of dueTasks) {
      let templateData: any = {};
      try {
        templateData = JSON.parse(task.templateData);
      } catch (e) {}

      const defaultStatusId = defaultStatusByProject.get(task.projectId);
      if (!defaultStatusId) continue;

      /**
       * The template's assignee is stored JSON, written when the recurring
       * task was created and never revalidated. A user who has since left the
       * organization — or who was never in it — would otherwise be connected
       * to a freshly created issue every time this runs.
       *
       * A bad assignee must not stop the batch: this route processes every
       * tenant, and one tenant's stale template cannot be allowed to hold up
       * everyone else's schedule. So the task is created unassigned and the
       * skip is counted and logged.
       */
      let assigneeId: string | null = templateData.assigneeId || null;
      if (assigneeId) {
        try {
          await assertIssueRelationsBelongToProject(task.projectId, { assigneeId });
        } catch {
          logger.warn(
            "RECURRING_TASK_ASSIGNEE_INVALID",
            `Recurring task ${task.id} names an assignee who is not a member of its project's organization; creating the issue unassigned.`
          );
          assigneeId = null;
          skippedCount += 1;
        }
      }

      /**
       * Allocate the issue key the way POST /api/projects/[id]/issues does.
       *
       * This route used `project.issueCounter` on its own, which assumes the
       * counter is never behind the highest key in use. It drifts — an import
       * writes keys without touching it, and the create route's own fallback
       * can push keyNumber past it — and `Issue` has a unique constraint on
       * (projectId, keyNumber). So a project in that state made EVERY run of
       * this endpoint throw, creating nothing, for every tenant in the batch.
       *
       * Found by the H5 test rather than by reading: the integration fixture
       * seeds an issue at keyNumber 1 with the counter still at 0, which is
       * exactly the drift, and the first triggered run returned a 500.
       */
      const maxIssue = await prisma.issue.findFirst({
        where: { projectId: task.projectId },
        orderBy: { keyNumber: "desc" },
        select: { keyNumber: true },
      });
      const maxExistingKey = maxIssue?.keyNumber ?? 0;

      let project = await prisma.project.update({
        where: { id: task.projectId },
        data: { issueCounter: { increment: 1 } },
      });

      let keyNumber = project.issueCounter;
      if (keyNumber <= maxExistingKey) {
        keyNumber = maxExistingKey + 1;
        project = await prisma.project.update({
          where: { id: task.projectId },
          data: { issueCounter: keyNumber },
        });
      }

      const issueKey = `${project.key}-${keyNumber}`;

      await prisma.issue.create({
        data: {
          projectId: task.projectId,
          keyNumber,
          issueKey,
          title: templateData.title || "Recurring Task",
          description: templateData.description,
          issueType: templateData.issueType || "TASK",
          priority: templateData.priority || "MEDIUM",
          assigneeId,
          /**
           * The PROJECT's owner, not the caller.
           *
           * `reporterId` is a required foreign key to User, and the caller is
           * now a cron job with no user at all. Even when it was a session,
           * using it was wrong: it stamped one tenant's user onto another
           * tenant's issue, which the issue list then displays. The project
           * owner is always present, always in the right organization, and is
           * who a system-generated issue in that project belongs to.
           */
          reporterId: project.ownerId,
          statusId: defaultStatusId,
        },
      });

      createdCount++;

      const nextRun = getNextCronDate(task.scheduleCron, now);
      await prisma.recurringTask.update({
        where: { id: task.id },
        data: { lastRunAt: now, nextRunAt: nextRun },
      });
    }

    return NextResponse.json({
      success: true,
      triggered: createdCount,
      // So an operator can see templates going stale without reading logs.
      unassignedDueToInvalidAssignee: skippedCount,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    return handleApiError(error, "recurring-tasks/trigger");
  }
}
