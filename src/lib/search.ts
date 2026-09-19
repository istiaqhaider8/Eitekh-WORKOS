/**
 * D1 — full-text search.
 *
 * WHAT WAS WRONG
 *
 * /api/search matched with Prisma `contains` + `mode: "insensitive"`, i.e.
 * ILIKE '%term%'. A leading wildcard cannot use a B-tree index, so every
 * search was a sequential scan. Measured on the volume dataset:
 *
 *   Seq Scan on "Issue"  ...  Rows Removed by Filter: 18017
 *   Execution Time: 83.671 ms
 *
 * 84 ms at 20,000 issues, growing linearly, on the feature people use most and
 * judge fastest. And there was no ranking: issues came back ordered by
 * createdAt, so the best match was wherever it happened to fall, while comments
 * and projects came back in no order at all.
 *
 * WHAT IT DOES NOW
 *
 * `searchVector @@ websearch_to_tsquery(...)` against the GIN indexes added in
 * migration 0010, ordered by ts_rank. websearch_to_tsquery rather than
 * plainto_tsquery because it accepts what users already type — quoted phrases,
 * OR, and a leading minus to exclude — and, unlike to_tsquery, it never throws
 * on malformed input. A search box that 500s on an unbalanced quote is worse
 * than one that ranks badly.
 *
 * TENANT SCOPING
 *
 * Stays in the query, as a join against ProjectMember rather than an IN list of
 * ids. The route used to fetch every accessible project id into the app and
 * send them back as `projectId = ANY($1)`; for a super admin that was every
 * project in the installation, and the EXPLAIN output was mostly id literals.
 * A subquery is both smaller on the wire and correct as the number of projects
 * grows.
 *
 * $queryRaw is unavoidable here: Prisma has no tsvector support. Every value is
 * parameterised — the tenant predicate is the one place in this codebase where
 * a string concatenation would be a cross-tenant read.
 */

import { prisma } from "./prisma";

export type SearchType = "all" | "issues" | "comments" | "projects";

export interface SearchIssueHit {
  id: string;
  issueKey: string;
  title: string;
  description: string | null;
  projectId: string;
  priority: string;
  issueType: string;
  createdAt: Date;
  statusName: string | null;
  rank: number;
}

export interface SearchCommentHit {
  id: string;
  content: string;
  createdAt: Date;
  issueId: string;
  issueKey: string;
  issueTitle: string;
  authorFirstName: string | null;
  authorLastName: string | null;
  rank: number;
}

export interface SearchProjectHit {
  id: string;
  name: string;
  key: string;
  description: string | null;
  status: string;
  rank: number;
}

/**
 * The tenant predicate, as SQL fragments.
 *
 * A super admin sees everything; everyone else sees projects they are an
 * explicit member of, or own. That is the same rule the old code applied — it
 * just applied it by materialising the id list in JavaScript first.
 */
function projectScope(userId: string, isSuperAdmin: boolean) {
  return { userId, isSuperAdmin };
}

export async function searchIssues(
  q: string,
  limit: number,
  scope: { userId: string; isSuperAdmin: boolean }
): Promise<SearchIssueHit[]> {
  return prisma.$queryRaw<SearchIssueHit[]>`
    SELECT i.id, i."issueKey", i.title, i.description, i."projectId",
           i.priority, i."issueType", i."createdAt",
           s.name AS "statusName",
           ts_rank(i."searchVector", websearch_to_tsquery('english', ${q})) AS rank
      FROM "Issue" i
      LEFT JOIN "WorkflowStatus" s ON s.id = i."statusId"
     WHERE i."searchVector" @@ websearch_to_tsquery('english', ${q})
       AND (
         ${scope.isSuperAdmin}
         OR EXISTS (
           SELECT 1 FROM "Project" p
            WHERE p.id = i."projectId"
              AND (p."ownerId" = ${scope.userId}
                   OR EXISTS (SELECT 1 FROM "ProjectMember" pm
                               WHERE pm."projectId" = p.id AND pm."userId" = ${scope.userId}))
         )
       )
     -- id as a final tiebreaker: ranks tie constantly (many issues share a
     -- title here), and offset paging over a non-unique order drops rows.
     ORDER BY rank DESC, i."createdAt" DESC, i.id DESC
     LIMIT ${limit}
  `;
}

export async function searchComments(
  q: string,
  limit: number,
  scope: { userId: string; isSuperAdmin: boolean }
): Promise<SearchCommentHit[]> {
  return prisma.$queryRaw<SearchCommentHit[]>`
    SELECT c.id, c.content, c."createdAt",
           i.id AS "issueId", i."issueKey", i.title AS "issueTitle",
           u."firstName" AS "authorFirstName", u."lastName" AS "authorLastName",
           ts_rank(c."searchVector", websearch_to_tsquery('english', ${q})) AS rank
      FROM "Comment" c
      JOIN "Issue" i ON i.id = c."issueId"
      LEFT JOIN "User" u ON u.id = c."userId"
     WHERE c."searchVector" @@ websearch_to_tsquery('english', ${q})
       AND (
         ${scope.isSuperAdmin}
         OR EXISTS (
           SELECT 1 FROM "Project" p
            WHERE p.id = i."projectId"
              AND (p."ownerId" = ${scope.userId}
                   OR EXISTS (SELECT 1 FROM "ProjectMember" pm
                               WHERE pm."projectId" = p.id AND pm."userId" = ${scope.userId}))
         )
       )
     ORDER BY rank DESC, c."createdAt" DESC, c.id DESC
     LIMIT ${limit}
  `;
}

export async function searchProjects(
  q: string,
  limit: number,
  scope: { userId: string; isSuperAdmin: boolean }
): Promise<SearchProjectHit[]> {
  return prisma.$queryRaw<SearchProjectHit[]>`
    SELECT p.id, p.name, p.key, p.description, p.status,
           ts_rank(p."searchVector", websearch_to_tsquery('english', ${q})) AS rank
      FROM "Project" p
     WHERE p."searchVector" @@ websearch_to_tsquery('english', ${q})
       AND (
         ${scope.isSuperAdmin}
         OR p."ownerId" = ${scope.userId}
         OR EXISTS (SELECT 1 FROM "ProjectMember" pm
                     WHERE pm."projectId" = p.id AND pm."userId" = ${scope.userId})
       )
     ORDER BY rank DESC, p."createdAt" DESC, p.id DESC
     LIMIT ${limit}
  `;
}

export async function search(
  q: string,
  type: SearchType,
  limit: number,
  scope: { userId: string; isSuperAdmin: boolean }
) {
  const wants = (t: SearchType) => type === "all" || type === t;

  // In parallel: three independent index lookups, and "all" is the common case
  // from the command palette.
  const [issues, comments, projects] = await Promise.all([
    wants("issues") ? searchIssues(q, limit, scope) : Promise.resolve([]),
    wants("comments") ? searchComments(q, limit, scope) : Promise.resolve([]),
    wants("projects") ? searchProjects(q, limit, scope) : Promise.resolve([]),
  ]);

  return { issues, comments, projects };
}

export { projectScope };
