/**
 * M4 — optimistic locking, as one rule rather than one per route.
 *
 * WHY THIS MODULE EXISTS
 *
 * B1 put a version column on `Issue` and the guard inline in
 * `PATCH /api/issues/[id]`. The reasoning was right and the code was correct;
 * the problem is what happens next. Extending it to the other things people
 * edit means copying forty lines into six more routes, and the copies drift —
 * one forgets to bump the counter on the no-version path, another answers 409
 * without the current state, a third does the compare as a separate SELECT and
 * quietly reintroduces the race the whole thing exists to close.
 *
 * That is not hypothetical here. `issue-relations.ts` was written because
 * exactly that had already happened to tenant validation: two write paths,
 * two different subsets of checks, and a hole in the gap between them. This is
 * the same shape, so it gets the same treatment before the copies exist rather
 * than after.
 *
 * WHAT LOST UPDATES COST
 *
 * Two people editing the same record is the normal case on a busy team, and
 * without a guard the second write simply wins. No error, no warning, no
 * trace. The first person's change is gone and neither of them knows — which
 * is why users almost never report it: there is nothing to see.
 *
 * THE GUARD
 *
 * The version is compared inside the same statement that writes.
 * `updateMany` rather than `update` because it reports a COUNT instead of
 * throwing, and zero rows is precisely the signal wanted: somebody wrote
 * first. Doing the compare as a separate SELECT would reintroduce the race —
 * two requests could both read version 3 and both proceed.
 *
 * OPT-IN, DELIBERATELY
 *
 * A request that sends no `version` is not refused. Clients that do not know
 * about the field keep working exactly as before, and the counter is still
 * bumped so that a client which IS sending versions is not fooled into
 * thinking nothing happened. Making it mandatory would break every existing
 * caller on the day it shipped, for a benefit those callers cannot use.
 */

import { NextResponse } from "next/server";
import { ConflictError } from "./api-error";

/**
 * Thrown when the client's `version` no longer matches the row.
 *
 * A sentinel rather than a response because it usually has to abort a
 * transaction: rows written alongside the update — activity log, history,
 * notifications — must not survive an edit that did not happen.
 */
export class VersionConflictError extends ConflictError {
  constructor(public readonly entity: string) {
    super(
      `This ${entity} was changed by someone else while you were editing it.`,
      "VERSION_CONFLICT"
    );
  }
}

/**
 * The part of a Prisma model delegate this needs.
 *
 * Structural rather than generic over Prisma's types: every versioned model's
 * delegate satisfies it, and the alternative is a union that has to be edited
 * every time a column is added to a table.
 */
export interface VersionedDelegate {
  updateMany(args: {
    where: { id: string; version?: number };
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<unknown>;
}

/**
 * Apply an update guarded by the row's version, and bump it.
 *
 * `expectedVersion` undefined means the caller has not opted in; the update
 * proceeds unguarded and the counter still moves.
 *
 * NOTE on what a zero count means: either the version moved or the row is
 * gone. Both are reported as a conflict, and the responder below attaches the
 * current state — which is `null` when it was deleted, and that is the answer
 * to "what happened to it". This matches the behaviour B1 shipped for issues.
 */
export async function applyVersionedUpdate(
  delegate: VersionedDelegate,
  opts: {
    id: string;
    expectedVersion?: number;
    data: Record<string, unknown>;
    /** Named in the error the user reads: "This sprint was changed by...". */
    entity: string;
  }
): Promise<void> {
  const { id, expectedVersion, data, entity } = opts;

  if (expectedVersion !== undefined) {
    const { count } = await delegate.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (count === 0) throw new VersionConflictError(entity);
    return;
  }

  await delegate.update({
    where: { id },
    data: { ...data, version: { increment: 1 } },
  });
}

/**
 * A 409 carrying the CURRENT state, not just a refusal.
 *
 * "Someone else changed this" on its own leaves the user with a form full of
 * edits and no way to see what they would be overwriting. The body carries the
 * server's copy so the client can show the difference and let them choose, and
 * its shape matches that resource's GET so a client can reuse what it already
 * renders.
 *
 * `key` names the field the record is returned under — `issue`, `sprint` — so
 * the response reads the same way as the endpoint it came from.
 */
export function versionConflictResponse(
  message: string,
  key: string,
  current: { version?: number } | null
): NextResponse {
  return NextResponse.json(
    {
      error: message,
      code: "VERSION_CONFLICT",
      currentVersion: current?.version ?? null,
      [key]: current,
    },
    { status: 409 }
  );
}

/**
 * NOTE ON WHERE `version` IS VALIDATED
 *
 * In the request schema — `optimisticVersionField` in `src/lib/validation.ts` —
 * and nowhere else. A first draft of this module also parsed it here, which
 * would have meant two validators for one field: exactly the duplication the
 * module exists to remove, and the kind that drifts until the two disagree
 * about what `null` means.
 *
 * The distinction that matters is that ABSENT means "do not check". So a
 * malformed value must be a 400 rather than quietly becoming absent, because
 * that would switch conflict detection off for the client trying hardest to
 * use it — the failure this module is here to prevent, reintroduced by its
 * own parser. The schema field is written to make that impossible.
 */
