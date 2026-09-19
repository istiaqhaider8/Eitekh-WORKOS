/**
 * B2 / B4 — validate the ids an issue mutation carries in its BODY.
 *
 * WHY THIS EXISTS
 *
 * The route guards check the PATH. `assertProjectPermission(projectId, ...)`
 * answers "may this user edit issues in this project", and for a request like
 *
 *     PATCH /api/issues/<my own issue>
 *     { "sprintId": "<another tenant's sprint>" }
 *
 * the answer is yes — the issue really is mine. Nothing in that check looks at
 * the body, so the foreign id went straight into the row. Verified against the
 * running app: org B's sprint id, epic id and team id could all be written
 * onto org A's issue, and the bulk route additionally accepted another
 * tenant's `statusId` and assigned issues to users outside the project.
 *
 * Two routes wrote these fields — `issues/[id]` and `issues/bulk` — and they
 * validated different subsets. That is the deeper problem: the single-issue
 * route checked `statusId` and nothing else, the bulk route checked nothing at
 * all, and there was no shared place for the rule to live. This module is that
 * place. A third write path should call it rather than grow a third opinion.
 *
 * WORKFLOW TRANSITIONS
 *
 * The same asymmetry applied to transitions: `issues/[id]` consulted
 * `WorkflowTransition`, `issues/bulk` did not. A rule that holds for one issue
 * and lapses for two is not a rule, and "select all, set status to Done" is
 * the most natural gesture on a board. Both now go through
 * `assertTransitionAllowed`.
 */

import { prisma } from "./prisma";
import { ApiError } from "./api-error";

/** A 400: the request named something real that does not belong here. */
class InvalidReferenceError extends ApiError {
  constructor(message: string) {
    super(400, message, "INVALID_REFERENCE");
  }
}

/** A 409: the move is legal in principle but not from where the issue is. */
export class TransitionNotAllowedError extends ApiError {
  constructor(message: string) {
    super(409, message, "TRANSITION_NOT_ALLOWED");
  }
}

/**
 * The fields of an issue mutation that are foreign keys.
 *
 * `undefined` means "not being changed" and is skipped. `null` means "clear
 * it", which is always allowed — you cannot leak anything by unsetting.
 */
export interface IssueRelationRefs {
  statusId?: string | null;
  sprintId?: string | null;
  epicId?: string | null;
  teamId?: string | null;
  componentId?: string | null;
  assigneeId?: string | null;
  parentIssueId?: string | null;
}

const present = (v: string | null | undefined): v is string =>
  typeof v === "string" && v.trim().length > 0;

/**
 * Every id in `refs` must belong to `projectId` (or, for a user, to the
 * project's organization).
 *
 * Throws a 400 naming the offending field. Deliberately NOT a 404: the caller
 * is authorised for this project, and telling them "that sprint is not in this
 * project" is more useful than pretending it does not exist. It also does not
 * confirm anything about the other tenant — the same message is returned for
 * an id that was never real.
 */
export async function assertIssueRelationsBelongToProject(
  projectId: string,
  refs: IssueRelationRefs
): Promise<void> {
  // Each check is a scoped existence query: "is there a row with this id AND
  // this projectId". A lookup by id followed by a comparison would work too,
  // but it invites the mistake of forgetting the comparison.
  const checks: Array<Promise<void>> = [];

  if (present(refs.statusId)) {
    const id = refs.statusId;
    checks.push(
      prisma.workflowStatus
        .count({ where: { id, workflow: { projectId } } })
        .then((n) => {
          if (n === 0) {
            throw new InvalidReferenceError(
              "The requested status does not belong to this project's workflow."
            );
          }
        })
    );
  }

  if (present(refs.sprintId)) {
    const id = refs.sprintId;
    checks.push(
      prisma.sprint.count({ where: { id, projectId } }).then((n) => {
        if (n === 0) throw new InvalidReferenceError("That sprint does not belong to this project.");
      })
    );
  }

  if (present(refs.epicId)) {
    const id = refs.epicId;
    checks.push(
      prisma.epic.count({ where: { id, projectId } }).then((n) => {
        if (n === 0) throw new InvalidReferenceError("That epic does not belong to this project.");
      })
    );
  }

  if (present(refs.componentId)) {
    const id = refs.componentId;
    checks.push(
      prisma.component.count({ where: { id, projectId } }).then((n) => {
        if (n === 0) throw new InvalidReferenceError("That component does not belong to this project.");
      })
    );
  }

  if (present(refs.parentIssueId)) {
    const id = refs.parentIssueId;
    checks.push(
      prisma.issue.count({ where: { id, projectId } }).then((n) => {
        if (n === 0) throw new InvalidReferenceError("The parent issue does not belong to this project.");
      })
    );
  }

  if (present(refs.teamId)) {
    // A team is scoped to a workspace and optionally to a project. Accept a
    // team of this project, or an unassigned team of the same workspace —
    // which is how the team picker behaves — but never one from elsewhere.
    const id = refs.teamId;
    checks.push(
      prisma.team
        .count({
          where: {
            id,
            OR: [
              { projectId },
              { projectId: null, workspace: { projects: { some: { id: projectId } } } },
            ],
          },
        })
        .then((n) => {
          if (n === 0) {
            throw new InvalidReferenceError("That team does not belong to this project's workspace.");
          }
        })
    );
  }

  if (present(refs.assigneeId)) {
    /**
     * ORGANIZATION membership, not project membership.
     *
     * This deliberately matches what PATCH /api/issues/[id] already required
     * ("Assignee is not a member of this organization"). Tightening it to
     * project membership here would close the tenant hole and also change the
     * product: assigning someone you are about to add to the project is a
     * normal thing to do, and this module exists to make the two write paths
     * agree, not to quietly pick a stricter rule for one of them.
     *
     * A user of another tenant is not an organization member, so the leak is
     * closed either way.
     */
    const id = refs.assigneeId;
    checks.push(
      prisma.organizationMember
        .count({ where: { userId: id, organization: { workspaces: { some: { projects: { some: { id: projectId } } } } } } })
        .then((n) => {
          if (n === 0) {
            throw new InvalidReferenceError("Assignee is not a member of this organization.");
          }
        })
    );
  }

  // Run them together; the first rejection wins. Promise.all rather than a
  // loop because these are independent point lookups and a bulk edit already
  // has enough round trips.
  await Promise.all(checks);
}

/**
 * The status transition must be one the project's workflow permits.
 *
 * A workflow with NO transitions configured permits everything. That is
 * deliberate and pre-existing: most projects never configure transitions, and
 * treating an empty set as "nothing is allowed" would freeze every board on
 * the day this shipped. The rule is opt-in — once a project defines one
 * transition, it has expressed an opinion and the whole workflow is enforced.
 */
export async function assertTransitionAllowed(
  projectId: string,
  fromStatusId: string,
  toStatusId: string
): Promise<void> {
  if (fromStatusId === toStatusId) return;

  const workflow = await prisma.workflow.findFirst({
    where: { projectId, statuses: { some: { id: fromStatusId } } },
    include: { transitions: true },
  });

  if (!workflow || workflow.transitions.length === 0) return;

  const allowed = workflow.transitions.some(
    (t) => t.fromStatusId === fromStatusId && t.toStatusId === toStatusId
  );
  if (allowed) return;

  // Name what IS possible. "Invalid status transition" tells the user nothing
  // about how to proceed and tells a client author nothing about how to build
  // a picker that only offers legal moves.
  const targets = workflow.transitions
    .filter((t) => t.fromStatusId === fromStatusId)
    .map((t) => t.toStatusId);

  const names =
    targets.length > 0
      ? (
          await prisma.workflowStatus.findMany({
            where: { id: { in: targets } },
            select: { name: true },
            orderBy: { position: "asc" },
          })
        ).map((s) => s.name)
      : [];

  throw new TransitionNotAllowedError(
    names.length > 0
      ? `That status change is not allowed by this project's workflow. Allowed from here: ${names.join(", ")}.`
      : "That status change is not allowed by this project's workflow, and this status has no outgoing transitions."
  );
}
