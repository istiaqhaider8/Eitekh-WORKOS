/**
 * A4 — the issue payload must stay bounded.
 *
 * A structural guard, like the ones for the rate limiter and the PBAC store.
 * The defect it prevents is invisible in review and in a green test run: an
 * `include` without a `take` reads perfectly and is wrong only in proportion
 * to how much history a customer has accumulated. The symptom arrives on your
 * busiest tenant's oldest ticket, months after the code was written.
 *
 * Measured before this bound: 689 KB for one issue with 374 comments, of which
 * 380 KB was a single attachment nobody had opened. After: 54 KB.
 */

import { readFileSync } from "fs";
import { join } from "path";

const routeSource = () =>
  readFileSync(join(__dirname, "..", "..", "app", "api", "issues", "[id]", "route.ts"), "utf8");

/** Extract the body of a named relation inside the include tree. */
function relationBlock(src: string, relation: string): string {
  const start = src.indexOf(`        ${relation}: {`);
  if (start === -1) throw new Error(`relation ${relation} not found in the issue route`);
  // Up to the next relation at the same indentation.
  const rest = src.slice(start + 1);
  const end = rest.search(/\n        [a-zA-Z_]+: \{/);
  return rest.slice(0, end === -1 ? 400 : end);
}

describe("the issue detail payload is bounded", () => {
  const src = routeSource();

  it("declares a single history page size rather than scattering magic numbers", () => {
    expect(src).toMatch(/const HISTORY_PAGE_SIZE = \d+/);
  });

  it.each(["comments", "timeEntries", "activityLogs", "attachments"])(
    "%s is bounded by a take",
    (relation) => {
      expect(relationBlock(src, relation)).toMatch(/take: HISTORY_PAGE_SIZE/);
    }
  );

  it("comments are ordered newest-first, so the bound keeps the RELEVANT ones", () => {
    // This ordering was ascending before the bound was added. Adding `take` to
    // an ascending order would have silently returned the OLDEST 50 comments —
    // a bug that looks like a fix.
    expect(relationBlock(src, "comments")).toMatch(/createdAt: "desc"/);
  });

  it.each(["comments", "timeEntries", "activityLogs"])(
    "%s ordering includes a UNIQUE tiebreaker",
    (relation) => {
      // Without one, offset paging over the matching history endpoint is
      // unstable: 204 of one test issue's 374 comments shared a `createdAt`,
      // rows moved between pages, and exactly one became unreachable — 373 of
      // 374. The id makes the order total.
      expect(relationBlock(src, relation)).toMatch(/\{ id: "desc" \}/);
    }
  );

  it("the history endpoints that make the bound honest exist and are authorized", () => {
    // Bounding the payload is only acceptable because the rest is reachable.
    // These routes ARE that guarantee: without them the bound is data loss.
    const base = join(__dirname, "..", "..", "app", "api", "issues", "[id]");
    for (const route of ["comments", "time-entries", "activity"]) {
      const source = readFileSync(join(base, route, "route.ts"), "utf8");
      expect(source).toMatch(/export async function GET/);
      expect(source).toMatch(/assertIssueHistoryAccess/);
      expect(source).toMatch(/parsePaging/);
    }
  });

  it("attachments return metadata only, never the stored bytes", () => {
    const block = relationBlock(src, "attachments");
    // `fileUrl` holds a base64 data URI. Selecting it put every attachment's
    // full contents into every issue fetch.
    expect(block).toMatch(/select: \{/);
    expect(block).not.toMatch(/fileUrl/);
    expect(block).toMatch(/fileName/);
    expect(block).toMatch(/fileSize/);
  });

  it("reports totals, so a client can tell a bounded list is partial", () => {
    // Without this the UI shows 50 of 374 and nothing says so.
    expect(src).toMatch(/_count: \{\s*\n?\s*select: \{[^}]*comments: true/);
  });

  it("there is an endpoint to fetch attachment content from", () => {
    // Bounding the payload is only safe because the content is retrievable
    // elsewhere. If this route were deleted, attachments would break.
    const contentRoute = join(
      __dirname, "..", "..", "app", "api", "attachments", "[id]", "content", "route.ts"
    );
    const content = readFileSync(contentRoute, "utf8");
    expect(content).toMatch(/export async function GET/);
    // And it must authorize — serving a file by id alone is the shape of the
    // cross-tenant leaks the isolation suite already found twice.
    expect(content).toMatch(/assertProjectAccess/);
  });
});
