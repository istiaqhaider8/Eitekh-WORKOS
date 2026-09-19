import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { searchSchema, parseQuery } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import { search } from "@/lib/search";

/**
 * D1 — search.
 *
 * This handler used to do three things that did not scale, and one that was
 * simply wrong:
 *
 *   - matched with ILIKE '%term%', which cannot use an index. Measured at
 *     83.671 ms on 20,000 issues with `Rows Removed by Filter: 18017` — a
 *     sequential scan of the whole table, growing linearly.
 *   - fetched EVERY accessible project id into the application and sent them
 *     back as `projectId IN (...)`. For a super admin that is every project in
 *     the installation; the EXPLAIN output was mostly id literals.
 *   - ordered issues by createdAt and comments and projects by nothing at all,
 *     so the best match was wherever it happened to fall.
 *
 * The query now lives in src/lib/search.ts, against the tsvector columns and
 * GIN indexes from migration 0010, ranked with ts_rank, with the tenant
 * predicate as a subquery inside the SQL rather than an id list on the wire.
 *
 * The response shape is unchanged — `{ issues, comments, projects }` — so the
 * command palette and the search page need no edits. Each hit now carries a
 * `rank`, which they can ignore.
 */
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const parsed = parseQuery(searchSchema, searchParams);
    if (!parsed.success) return parsed.error;
    const { q, type, limit } = parsed.data;

    const results = await search(q, type, limit, {
      userId: user.id,
      isSuperAdmin: Boolean(user.isSuperAdmin),
    });

    return NextResponse.json(results);
  } catch (error: any) {
    return handleApiError(error, "search");
  }
}
