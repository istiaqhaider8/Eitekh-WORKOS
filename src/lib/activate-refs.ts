/**
 * Cross-project reference validation for Activate mutations.
 *
 * WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM issue-relations.ts
 *
 * The route guards check the PATH. `assertProjectPermission(projectId, ...)`
 * answers "may this user manage Activate in this project", and for
 *
 *     POST /api/projects/<my project>/activate/deliverables
 *     { "issueId": "<another tenant's issue>", "phaseId": "<my phase>" }
 *
 * the answer is yes — the project really is mine. Nothing in that check looks
 * at the body. Without this module the foreign id goes straight into the row,
 * which is the exact shape of the bug `issue-relations.ts` was written for.
 *
 * That module's own header says a third write path should call a shared rule
 * rather than grow a third opinion. This IS that rule, for Activate's own
 * foreign keys. It is a sibling rather than an extension because the fields
 * are disjoint — `issue-relations.ts` validates what an ISSUE mutation carries
 * (sprint, epic, team, status), this validates what an ACTIVATE mutation
 * carries (phase, workstream, issue, owner) — and merging them would give one
 * function two unrelated vocabularies.
 *
 * WHY 400 AND NOT 404
 *
 * Same reasoning as its sibling. The caller is authorised for this project, so
 * "that phase does not belong to this project" is more useful than pretending
 * it does not exist, and it confirms nothing about the other tenant: an id
 * that was never real returns the identical message.
 */

import { prisma } from "./prisma";
import { ApiError } from "./api-error";

/** A 400: the request named something real that does not belong here. */
class InvalidReferenceError extends ApiError {
  constructor(message: string) {
    super(400, message, "INVALID_REFERENCE");
  }
}

/**
 * The foreign keys an Activate mutation can carry.
 *
 * `undefined` means "not being changed" and is skipped. `null` means "clear
 * it", which is always allowed — unsetting a reference cannot leak anything.
 */
export interface ActivateRefs {
  phaseId?: string | null;
  workstreamId?: string | null;
  issueId?: string | null;
  ownerId?: string | null;
}

const present = (v: string | null | undefined): v is string =>
  typeof v === "string" && v.trim().length > 0;

/**
 * Every id in `refs` must belong to `projectId`.
 *
 * Each check is a scoped existence query — "is there a row with this id AND
 * this projectId" — rather than a lookup followed by a comparison, because the
 * comparison is the step that gets forgotten.
 */
export async function assertActivateRefsBelongToProject(
  projectId: string,
  refs: ActivateRefs
): Promise<void> {
  const checks: Array<Promise<void>> = [];

  if (present(refs.phaseId)) {
    const id = refs.phaseId;
    checks.push(
      prisma.activatePhase.count({ where: { id, projectId } }).then((n) => {
        if (n === 0) throw new InvalidReferenceError("That phase does not belong to this project.");
      })
    );
  }

  if (present(refs.workstreamId)) {
    const id = refs.workstreamId;
    checks.push(
      prisma.activateWorkstream.count({ where: { id, projectId } }).then((n) => {
        if (n === 0) {
          throw new InvalidReferenceError("That workstream does not belong to this project.");
        }
      })
    );
  }

  if (present(refs.issueId)) {
    const id = refs.issueId;
    checks.push(
      prisma.issue.count({ where: { id, projectId } }).then((n) => {
        if (n === 0) throw new InvalidReferenceError("That issue does not belong to this project.");
      })
    );
  }

  if (present(refs.ownerId)) {
    /**
     * PROJECT membership, deliberately stricter than the assignee rule in
     * `issue-relations.ts`, which accepts any organization member.
     *
     * The difference is not an oversight. An assignee is someone you may be
     * about to add to the project, and loosening that would have changed the
     * product. A phase or workstream owner is an accountable role in the
     * methodology — the person a gate review looks to — and naming someone who
     * cannot open the project is not a workflow worth supporting.
     *
     * The message is the one the phase route already returned before this
     * module existed, so clients and tests see no change.
     */
    const id = refs.ownerId;
    checks.push(
      prisma.projectMember.count({ where: { projectId, userId: id } }).then((n) => {
        if (n === 0) throw new InvalidReferenceError("The owner must be a member of this project.");
      })
    );
  }

  // Independent point lookups, so run them together and let the first
  // rejection win.
  await Promise.all(checks);
}
