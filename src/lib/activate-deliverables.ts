/**
 * Listing Activate deliverables.
 *
 * WHY THE QUERY LIVES HERE AND NOT IN THE ROUTE
 *
 * The exit gate for this increment is "no N+1", and that has to be MEASURED,
 * not argued. A measurement that re-implements the query in a test script
 * measures the script. So the real query lives in one exported function, the
 * route calls it, and the performance test calls the same function with an
 * instrumented client — see `db` below.
 *
 * WHY EVERY FIELD IS AN EXPLICIT `select`
 *
 * PERF-0. `include: { assignee: true }` selects every column of User,
 * including passwordHash, mfaSecret and the reset tokens, and a deliverable
 * list is exactly the sort of payload that ends up serialized into an RSC
 * response and shipped to the browser. `publicUserRelation` exists so no call
 * site has to remember the list.
 *
 * WHY THE SCOPE IS `phase: { projectId }`
 *
 * ActivateDeliverableLink has no projectId of its own — it reaches the tenant
 * through its phase. Every query therefore joins through the phase, and the
 * project scope is applied UNCONDITIONALLY, before any caller-supplied filter.
 * A `phaseId` filter naming another tenant's phase intersects to nothing and
 * returns an empty page, rather than needing a separate guard to catch it.
 */

import { prisma } from "./prisma";
import { publicUserRelation } from "./safe-select";

/** Matches the paging contract of GET /api/projects/[id]/issues. */
export const DELIVERABLE_PAGE_DEFAULT = 50;
export const DELIVERABLE_PAGE_MAX = 200;

export interface DeliverableListOptions {
  phaseId?: string | null;
  workstreamId?: string | null;
  page?: number;
  limit?: number;
}

/**
 * A minimal structural type for the client, so the performance test can pass
 * an instrumented PrismaClient without this module depending on the test.
 */
type DeliverableDb = Pick<typeof prisma, "activateDeliverableLink">;

export async function listDeliverables(
  projectId: string,
  opts: DeliverableListOptions = {},
  db: DeliverableDb = prisma
) {
  const limit = Math.max(1, Math.min(DELIVERABLE_PAGE_MAX, opts.limit || DELIVERABLE_PAGE_DEFAULT));
  const page = Math.max(1, opts.page || 1);

  const where: {
    phase: { projectId: string };
    phaseId?: string;
    workstreamId?: string;
  } = { phase: { projectId } };
  if (opts.phaseId) where.phaseId = opts.phaseId;
  if (opts.workstreamId) where.workstreamId = opts.workstreamId;

  /**
   * SEVEN statements, always — measured, not assumed.
   *
   * An earlier version of this comment claimed "two queries, a count and a
   * page". That was wrong, and the measurement said so. Prisma's default
   * relation loading does not join: it issues one additional statement per
   * nested relation and stitches the results in the client. So the real count
   * is the count, the page, and one each for phase, workstream, issue, the
   * issue's status and the issue's assignee — seven.
   *
   * Seven is fine. The property that matters is that it is SEVEN FOR ONE ROW
   * AND SEVEN FOR SIXTY, because each extra statement fetches every related
   * row for the whole page in a single `IN (...)`. That is the difference
   * between a constant and an N+1, and it is what the exit-gate test in
   * `__tests__/integration/activate-deliverables.test.ts` asserts by counting
   * statements at two page sizes rather than by reading this code.
   */
  const [total, deliverables] = await Promise.all([
    db.activateDeliverableLink.count({ where }),
    db.activateDeliverableLink.findMany({
      where,
      orderBy: [{ phase: { position: "asc" } }, { createdAt: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        isMandatory: true,
        acceleratorKey: true,
        fitGapStatus: true,
        createdAt: true,
        phase: { select: { id: true, key: true, name: true, position: true } },
        workstream: { select: { id: true, key: true, name: true } },
        issue: {
          select: {
            id: true,
            issueKey: true,
            title: true,
            issueType: true,
            priority: true,
            status: { select: { id: true, name: true, category: true } },
            assignee: publicUserRelation,
          },
        },
      },
    }),
  ]);

  return {
    deliverables,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
