/**
 * D1 — full-text search.
 *
 * WHAT CHANGED, AND WHY THAT NEEDS TESTS OF ITS OWN
 *
 * Search used to be ILIKE '%term%' with the tenant predicate applied by
 * fetching every accessible project id into the application and sending them
 * back as `projectId IN (...)`. It is now a tsvector lookup with the predicate
 * as a subquery inside raw SQL.
 *
 * Two things about that are worth a dedicated suite:
 *
 *   1. THE TENANT PREDICATE WAS REWRITTEN. It moved from JavaScript, where it
 *      was obvious, into SQL, where it is one clause among several and easy to
 *      get subtly wrong. Search reads across every project a user can see, so
 *      a mistake here leaks issue titles and comment bodies in bulk — the
 *      highest-volume disclosure surface in the product.
 *
 *   2. MATCHING SEMANTICS CHANGED. ILIKE matches substrings; a tsvector
 *      matches stemmed words. "permiss" no longer finds "permission" (it is
 *      not a word), while "permissions" now does (same stem). That is a
 *      deliberate improvement and also a behaviour change, so it should be
 *      pinned rather than discovered.
 */

import { PrismaClient } from "@prisma/client";
import { api, expectDenied, assertSafeTestDatabase, type Fixture } from "./harness";
import { createFixture, destroyFixture } from "./fixture";

const dbUrl = assertSafeTestDatabase(process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

let fx: Fixture;

beforeAll(async () => {
  fx = await createFixture(prisma);

  // Distinctive text per tenant, so a leak is unambiguous rather than a
  // coincidence of shared vocabulary.
  await prisma.issue.update({
    where: { id: fx.orgA.issueId },
    data: {
      title: "Zarquon deployment pipeline",
      description: "The zarquon pipeline needs a permission review before release.",
    },
  });
  await prisma.issue.update({
    where: { id: fx.orgB.issueId },
    data: {
      title: "Blorptide deployment pipeline",
      description: "The blorptide pipeline needs a permission review before release.",
    },
  });
  await prisma.comment.update({
    where: { id: fx.orgA.commentId },
    data: { content: "Discussing the zarquon rollout in detail." },
  });
  await prisma.comment.update({
    where: { id: fx.orgB.commentId },
    data: { content: "Discussing the blorptide rollout in detail." },
  });
}, 60_000);

afterAll(async () => {
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

const asA = () => fx.orgA.users.ADMIN;
const text = (res: any) => String(res.text ?? "");

// ---------------------------------------------------------------------------
describe("search finds things", () => {
  it("matches an issue by a word in its title", async () => {
    const res = await api(asA(), "/api/search?q=zarquon");
    expect(res.status).toBe(200);
    expect(text(res)).toContain("Zarquon deployment pipeline");
  });

  it("matches an issue by a word in its description", async () => {
    // Weighted lower than the title, but still a match — the old ILIKE also
    // searched description, so losing this would be a regression.
    const res = await api(asA(), "/api/search?q=release");
    expect(res.status).toBe(200);
    expect(text(res)).toContain("Zarquon deployment pipeline");
  });

  it("matches an issue by its key", async () => {
    const res = await api(asA(), `/api/search?q=${fx.orgA.issueKey}`);
    expect(res.status).toBe(200);
    expect(text(res)).toContain(fx.orgA.issueKey);
  });

  it("matches a comment by its content", async () => {
    const res = await api(asA(), "/api/search?q=rollout&type=comments");
    expect(res.status).toBe(200);
    expect(text(res)).toContain("zarquon rollout");
  });

  it("matches a project by its name", async () => {
    const res = await api(asA(), "/api/search?q=Integration&type=projects");
    expect(res.status).toBe(200);
    expect(res.body?.projects?.length ?? 0).toBeGreaterThan(0);
  });

  it("returns nothing for a term that appears nowhere", async () => {
    const res = await api(asA(), "/api/search?q=xyzzynotpresent");
    expect(res.status).toBe(200);
    expect(res.body?.issues ?? []).toHaveLength(0);
    expect(res.body?.comments ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("the tenant predicate, rewritten into SQL", () => {
  it("does NOT return another tenant's issue", async () => {
    // The whole reason this suite exists. Both tenants' issues match "pipeline"
    // and "permission"; only one may come back.
    for (const q of ["pipeline", "permission", "release", "blorptide"]) {
      const res = await api(asA(), `/api/search?q=${q}`);
      expect(res.status).toBe(200);
      expect(text(res)).not.toContain("Blorptide");
      expect(text(res)).not.toContain(fx.orgB.issueId);
      expect(text(res)).not.toContain(fx.orgB.issueKey);
    }
  });

  it("does NOT return another tenant's comment", async () => {
    const res = await api(asA(), "/api/search?q=rollout&type=comments");
    expect(res.status).toBe(200);
    expect(text(res)).not.toContain("blorptide rollout");
    expect(text(res)).not.toContain(fx.orgB.commentId);
  });

  it("does NOT return another tenant's project", async () => {
    const res = await api(asA(), "/api/search?q=Integration&type=projects");
    expect(res.status).toBe(200);
    expect(text(res)).not.toContain(fx.orgB.projectId);
  });

  it("control: tenant B's own admin DOES find tenant B's issue", async () => {
    // Without this, a predicate that returns nothing for anyone would pass
    // every assertion above.
    const res = await api(fx.orgB.users.ADMIN, "/api/search?q=blorptide");
    expect(res.status).toBe(200);
    expect(text(res)).toContain("Blorptide deployment pipeline");
  });

  it("a user who belongs to nothing finds nothing", async () => {
    const res = await api(fx.outsider, "/api/search?q=pipeline");
    expect(res.status).toBe(200);
    expect(res.body?.issues ?? []).toHaveLength(0);
    expect(res.body?.comments ?? []).toHaveLength(0);
    expect(res.body?.projects ?? []).toHaveLength(0);
  });

  it("search requires a session", async () => {
    const res = await api(null, "/api/search?q=pipeline");
    expectDenied(res, "anonymous search");
  });

  it("a VIEWER of a project can still search it", async () => {
    // The predicate is membership, not permission. A viewer who could not
    // search the project they can read would be a regression.
    const res = await api(fx.orgA.users.VIEWER, "/api/search?q=zarquon");
    expect(res.status).toBe(200);
    expect(text(res)).toContain("Zarquon deployment pipeline");
  });
});

// ---------------------------------------------------------------------------
describe("ranking and query syntax", () => {
  it("ranks a title match above a description-only match", async () => {
    // The old code ordered by createdAt, so the best match was wherever it
    // happened to fall. This is the point of ts_rank and the A/B weights.
    await prisma.issue.create({
      data: {
        id: `${fx.orgA.projectId}_rankprobe`,
        projectId: fx.orgA.projectId,
        keyNumber: 9001,
        issueKey: `${fx.orgA.projectKey}-9001`,
        title: "Unrelated heading",
        description: "A passing mention of zarquon buried in the body text.",
        issueType: "TASK",
        statusId: fx.orgA.statusId,
        priority: "MEDIUM",
        reporterId: fx.orgA.users.OWNER.id,
      },
    });

    const res = await api(asA(), "/api/search?q=zarquon");
    expect(res.status).toBe(200);
    const issues = res.body.issues as Array<{ title: string; rank: number }>;
    expect(issues.length).toBeGreaterThanOrEqual(2);

    const titleHit = issues.findIndex((i) => i.title === "Zarquon deployment pipeline");
    const bodyHit = issues.findIndex((i) => i.title === "Unrelated heading");
    expect(titleHit).toBeGreaterThanOrEqual(0);
    expect(bodyHit).toBeGreaterThanOrEqual(0);
    expect(titleHit).toBeLessThan(bodyHit);

    await prisma.issue.delete({ where: { id: `${fx.orgA.projectId}_rankprobe` } });
  });

  it("stems, so a plural finds the singular", async () => {
    // A behaviour CHANGE from ILIKE, and an improvement: "permissions" and
    // "permission" share a stem.
    const res = await api(asA(), "/api/search?q=permissions");
    expect(res.status).toBe(200);
    expect(text(res)).toContain("Zarquon deployment pipeline");
  });

  it("supports a quoted phrase", async () => {
    const hit = await api(asA(), `/api/search?q=${encodeURIComponent('"deployment pipeline"')}`);
    expect(hit.status).toBe(200);
    expect(text(hit)).toContain("Zarquon deployment pipeline");

    // The same two words in an order that does not occur.
    const miss = await api(asA(), `/api/search?q=${encodeURIComponent('"pipeline deployment"')}`);
    expect(miss.status).toBe(200);
    expect(miss.body?.issues ?? []).toHaveLength(0);
  });

  it("supports excluding a term", async () => {
    const res = await api(asA(), `/api/search?q=${encodeURIComponent("pipeline -zarquon")}`);
    expect(res.status).toBe(200);
    expect(text(res)).not.toContain("Zarquon deployment pipeline");
  });

  it("does not 500 on syntax a user might reasonably type", async () => {
    /**
     * websearch_to_tsquery rather than to_tsquery, specifically for this.
     * to_tsquery raises a syntax error on unbalanced input, which in a search
     * box means the endpoint 500s while the user is still typing. A search
     * that errors is worse than one that ranks badly.
     */
    for (const q of ['"unclosed', "a & b", "()", "!!!", "  ", "and or not", "-", "a|b"]) {
      const res = await api(asA(), `/api/search?q=${encodeURIComponent(q)}`);
      // 400 from the schema is fine (it enforces a minimum length); 500 is not.
      expect([200, 400]).toContain(res.status);
    }
  });
});
