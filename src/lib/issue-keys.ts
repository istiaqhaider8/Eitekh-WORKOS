/**
 * Allocating the next issue key for a project.
 *
 * WHY THIS IS SHARED RATHER THAN COPIED
 *
 * The rule is not "increment a counter". `Project.issueCounter` is the
 * allocator, but it can fall behind the highest key that actually exists —
 * imported issues, restored rows, anything that wrote an Issue without going
 * through the counter — and when it does, the next allocation would collide
 * with a key already in use. So the counter is incremented AND reconciled
 * against `max(keyNumber)`, and a second implementation that forgot the second
 * half would look correct for months and then produce duplicate keys on
 * exactly the projects that had been imported into.
 *
 * This lived inline in `POST /api/projects/[id]/issues`. The Activate
 * accelerator route needs to create issues too, and copying thirty lines of
 * counter reconciliation into it would have been the second opinion on a rule
 * that must have one. Both call this.
 *
 * MUST RUN INSIDE A TRANSACTION. The read of `max(keyNumber)` and the write of
 * the counter have to be atomic with respect to other allocations, which is
 * why this takes a transaction client rather than the global one.
 */

import type { Prisma } from "@prisma/client";

export interface AllocatedKey {
  keyNumber: number;
  issueKey: string;
  /** The project, with its workflows and ordered statuses, because the caller
   *  almost always needs the default status immediately afterwards and this
   *  has already paid for the row. */
  project: Prisma.ProjectGetPayload<{
    include: { workflows: { include: { statuses: true } } };
  }>;
}

export async function allocateIssueKey(
  tx: Prisma.TransactionClient,
  projectId: string
): Promise<AllocatedKey> {
  const maxIssue = await tx.issue.findFirst({
    where: { projectId },
    orderBy: { keyNumber: "desc" },
    select: { keyNumber: true },
  });
  const maxExistingKey = maxIssue?.keyNumber || 0;

  const include = {
    workflows: {
      include: { statuses: { orderBy: { position: "asc" as const } } },
    },
  };

  let project = await tx.project.update({
    where: { id: projectId },
    data: { issueCounter: { increment: 1 } },
    include,
  });

  let keyNumber = project.issueCounter;
  if (keyNumber <= maxExistingKey) {
    // The counter had fallen behind reality. Jump it past the highest key
    // that exists rather than handing out one that is already taken.
    keyNumber = maxExistingKey + 1;
    project = await tx.project.update({
      where: { id: projectId },
      data: { issueCounter: keyNumber },
      include,
    });
  }

  return { keyNumber, issueKey: `${project.key}-${keyNumber}`, project };
}

/**
 * The status a new issue starts in when the caller did not name one: the first
 * status of the project's own workflow, by position.
 *
 * Throws rather than guessing. A project with no workflow statuses cannot hold
 * an issue at all, and inventing one here would create a row that no board can
 * render.
 */
export function defaultStatusIdFor(project: AllocatedKey["project"]): string {
  const workflow = project.workflows[0];
  const status = workflow?.statuses?.[0];
  if (!status) throw new Error("No workflow statuses defined for this project");
  return status.id;
}
