import { prisma } from "./prisma";
import { assertProjectAccess } from "./tenant";

/**
 * Paginated access to an issue's history.
 *
 * WHY THIS EXISTS
 *
 * A4 bounded the issue payload to the newest 50 comments, time entries,
 * activity rows and attachments, taking it from 689 KB to 54 KB. It did not
 * add any way to read rows 51 and beyond — `/issues/[id]/comments` and
 * `/issues/[id]/time-entries` had POST and nothing else, and there was no
 * activity route at all.
 *
 * So on an issue with 374 comments a user saw 50 and could not reach the other
 * 324. The payload got smaller and the product got worse: a regression
 * introduced by the fix, which is the failure mode of optimising against a
 * measurement instead of against the feature.
 *
 * These endpoints are what makes the bound honest.
 */

export const HISTORY_PAGE_SIZE = 50;
export const HISTORY_MAX_PAGE_SIZE = 200;

export interface HistoryPage<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/** Clamp untrusted paging input. `limit=100000` must not become a new B10. */
export function parsePaging(searchParams: URLSearchParams): { page: number; limit: number } {
  const rawPage = Number(searchParams.get("page") ?? 1);
  const rawLimit = Number(searchParams.get("limit") ?? HISTORY_PAGE_SIZE);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(Math.floor(rawLimit), HISTORY_MAX_PAGE_SIZE)
      : HISTORY_PAGE_SIZE;
  return { page, limit };
}

/**
 * Resolve the issue and authorize the caller through its project.
 *
 * Every history endpoint goes through this. Reading an issue's comments by the
 * issue id without a project check is the same shape as the two cross-tenant
 * leaks the isolation suites already found.
 */
export async function assertIssueHistoryAccess(issueId: string) {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { id: true, projectId: true },
  });
  if (!issue) throw new Error("Issue not found");
  await assertProjectAccess(issue.projectId);
  return issue;
}

/**
 * Newest first, consistently with the bounded lists in the issue payload.
 *
 * Page 1 therefore matches what the detail view already showed, and "load
 * earlier" walks backwards through history. A client that wants oldest-first
 * display reverses the page it received.
 */
export async function paginate<T>(
  countFn: () => Promise<number>,
  findFn: (skip: number, take: number) => Promise<T[]>,
  page: number,
  limit: number
): Promise<HistoryPage<T>> {
  const skip = (page - 1) * limit;
  const [total, items] = await Promise.all([countFn(), findFn(skip, limit)]);
  return { items, total, page, limit, hasMore: skip + items.length < total };
}
