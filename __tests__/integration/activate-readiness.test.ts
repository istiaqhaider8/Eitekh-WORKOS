/**
 * SAP Activate increment 6 — Deploy readiness and the Run picture.
 *
 * TWO CLAIMS THIS SUITE EXISTS TO CHECK
 *
 *   1. The numbers are RIGHT. A readiness report that is merely fast is worse
 *      than none: it would be trusted. So the counts are asserted against a
 *      deliberately mixed set — mandatory and not, done and not, classified
 *      and not — rather than against an all-or-nothing fixture where an
 *      off-by-one or a swapped filter would still produce a plausible answer.
 *
 *   2. The cost does not grow with the project. That is this increment's exit
 *      gate, and it is MEASURED: the same function the route calls is invoked
 *      with an instrumented client at two very different volumes, the query
 *      counts must match, and p95 latency is reported rather than assumed.
 *
 * The accept case is asserted first in every block, as everywhere else here.
 */

import { PrismaClient } from "@prisma/client";
import { api, expectDenied, expectAllowed, waitForServer, type Fixture } from "./harness";
import { createFixture, destroyFixture } from "./fixture";
import { getReadiness, BLOCKER_LIMIT } from "@/lib/activate-readiness";

const prisma = new PrismaClient();
let fx: Fixture;

let deployPhaseId: string;
let runPhaseId: string;

/** Issues created directly: this suite needs volume and a known status mix. */
async function makeIssue(index: number, statusId: string) {
  return prisma.issue.create({
    data: {
      projectId: fx.orgA.projectId,
      keyNumber: 5000 + index,
      issueKey: `${fx.orgA.projectKey}-${5000 + index}`,
      title: `Readiness item ${index}`,
      issueType: "TASK",
      statusId,
      priority: "MEDIUM",
      reporterId: fx.orgA.users.OWNER.id,
    },
    select: { id: true },
  });
}

async function link(
  issueId: string,
  phaseId: string,
  opts: { isMandatory?: boolean; fitGapStatus?: string | null } = {}
) {
  return prisma.activateDeliverableLink.create({
    data: {
      issueId,
      phaseId,
      isMandatory: opts.isMandatory ?? false,
      fitGapStatus: opts.fitGapStatus ?? null,
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  await waitForServer();
  fx = await createFixture(prisma);

  for (const side of ["orgA", "orgB"] as const) {
    const s = fx[side];
    await api(s.users.OWNER, `/api/projects/${s.projectId}/activate`, {
      method: "POST",
      body: { enabled: true },
    });
  }

  const res = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`);
  deployPhaseId = res.body.phases.find((p: any) => p.key === "DEPLOY").id;
  runPhaseId = res.body.phases.find((p: any) => p.key === "RUN").id;

  /**
   * A deliberately mixed Deploy set:
   *   3 mandatory done, 2 mandatory not done, 2 optional done, 1 optional open
   *   carrying an EXTEND decision, 1 optional open unassessed.
   *
   * The classified row used to be written as "GAP", a value from a
   * three-value vocabulary that the six fit-to-standard decisions replaced.
   * Writing it straight through Prisma bypassed the validation the API
   * applies, so this suite stayed green for months while the readiness query
   * counted a value no running system could produce and every project was
   * told it had zero open gaps. The fixture now uses values the product
   * itself stores.
   *
   * Nine rows in total, and every count the report produces is a different
   * number — so a swapped filter cannot coincidentally agree.
   */
  let n = 0;
  for (let i = 0; i < 3; i++) await link((await makeIssue(n++, fx.orgA.statusDoneId)).id, deployPhaseId, { isMandatory: true });
  for (let i = 0; i < 2; i++) await link((await makeIssue(n++, fx.orgA.statusId)).id, deployPhaseId, { isMandatory: true });
  for (let i = 0; i < 2; i++) await link((await makeIssue(n++, fx.orgA.statusDoneId)).id, deployPhaseId);
  await link((await makeIssue(n++, fx.orgA.statusId)).id, deployPhaseId, { fitGapStatus: "EXTEND" });
  await link((await makeIssue(n++, fx.orgA.statusId)).id, deployPhaseId);

  // Run gets a smaller, different mix so the two phases cannot be confused.
  await link((await makeIssue(n++, fx.orgA.statusDoneId)).id, runPhaseId, { isMandatory: true });
  await link((await makeIssue(n++, fx.orgA.statusId)).id, runPhaseId);
}, 240_000);

afterAll(async () => {
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("Readiness report", () => {
  it("reports the Deploy phase with counts that match the data", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/readiness`
    );
    expectAllowed(res, "the owner reading readiness");
    expect(res.body.enabled).toBe(true);

    const deploy = res.body.phases.find((p: any) => p.key === "DEPLOY");
    expect(deploy).toBeDefined();
    expect(deploy.total).toBe(9);
    expect(deploy.mandatory).toBe(5);
    expect(deploy.mandatoryDone).toBe(3);
    // 3 mandatory done + 2 optional done.
    expect(deploy.done).toBe(5);
    expect(deploy.gaps).toBe(1);
    // Everything except the single classified row is unassessed.
    expect(deploy.unassessed).toBe(8);
  });

  it("keeps the phases apart", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/readiness`
    );
    const run = res.body.phases.find((p: any) => p.key === "RUN");
    expect(run.total).toBe(2);
    expect(run.mandatory).toBe(1);
    expect(run.mandatoryDone).toBe(1);

    // A phase with nothing linked reports zeroes rather than being absent —
    // otherwise a client has to distinguish "no deliverables" from "no phase".
    const discover = res.body.phases.find((p: any) => p.key === "DISCOVER");
    expect(discover).toBeDefined();
    expect(discover.total).toBe(0);
  });

  /**
   * Which decisions count as an open gap, against the running report.
   *
   * Added because the filter this asserts was broken for months in a way no
   * test could see: it matched a value from a retired vocabulary, and the
   * fixture wrote that value directly into the database. Here every value is
   * one the API itself stores, and both halves are asserted — the three that
   * must count and the three that must not. A test that only checked the
   * counted half would pass just as happily if everything counted.
   */
  it("counts Configure, Extend and Integrate as gaps, and the settled three as not", async () => {
    const before = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/readiness`
    );
    const runBefore = before.body.phases.find((p: any) => p.key === "RUN").gaps;

    let k = 1500;
    for (const decision of ["CONFIGURE", "EXTEND", "INTEGRATE"]) {
      await link((await makeIssue(k++, fx.orgA.statusId)).id, runPhaseId, {
        fitGapStatus: decision,
      });
    }
    for (const decision of ["ADOPT", "DEFER", "OUT_OF_SCOPE"]) {
      await link((await makeIssue(k++, fx.orgA.statusId)).id, runPhaseId, {
        fitGapStatus: decision,
      });
    }

    const after = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/readiness`
    );
    const run = after.body.phases.find((p: any) => p.key === "RUN");

    // Six rows added, three of them gaps. Asserting the delta rather than an
    // absolute keeps this independent of what the rest of the suite linked.
    expect(run.gaps).toBe(runBefore + 3);
    expect(run.total).toBe(2 + 6);
    // And the settled three are not hidden from the report altogether: they
    // are classified, so they must not fall into `unassessed` either.
    expect(run.unassessed).toBe(2);
  });

  it("names the mandatory Deploy deliverables that are still open", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/readiness`
    );
    expect(res.body.deployBlockerTotal).toBe(2);
    expect(res.body.deployBlockers).toHaveLength(2);
    for (const b of res.body.deployBlockers) {
      expect(b.issueKey).toMatch(/^[A-Z0-9]+-\d+$/);
      // "3 things are not done" is not actionable; a key and a title are.
      expect(typeof b.title).toBe("string");
    }
  });

  it("is not ready to raise while mandatory work is open", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/readiness`
    );
    const deploy = res.body.phases.find((p: any) => p.key === "DEPLOY");
    expect(deploy.readyToRaise).toBe(false);

    // And readiness is NOT the same thing as approval: nothing here says the
    // gate is passed.
    expect(deploy.gate.status).not.toBe("APPROVED");
  });

  it("counts an issue in a non-DONE status as outstanding, not as missing", async () => {
    /**
     * This started out as a test for an issue with NO status, to justify the
     * LEFT JOIN in the aggregate. It could not be written: `Issue.statusId` is
     * NOT NULL in both the schema and the database, so that state does not
     * exist and the test would have asserted a fiction. What IS worth pinning
     * is the direction of the arithmetic — an extra open item must raise
     * `total` and `mandatory` without touching `mandatoryDone`.
     */
    const issue = await makeIssue(900, fx.orgA.statusInProgressId);
    const created = await link(issue.id, deployPhaseId, { isMandatory: true });

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/readiness`
    );
    const deploy = res.body.phases.find((p: any) => p.key === "DEPLOY");
    expect(deploy.total).toBe(10);
    expect(deploy.mandatory).toBe(6);
    expect(deploy.mandatoryDone).toBe(3);

    await prisma.activateDeliverableLink.delete({ where: { id: created.id } });
    await prisma.issue.delete({ where: { id: issue.id } });
  });
});

// ---------------------------------------------------------------------------

describe("Readiness authorization", () => {
  it("refuses a caller from another organization", async () => {
    const res = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/readiness`
    );
    expectDenied(res, "org B reading org A's readiness");
    expect(JSON.stringify(res.body)).not.toContain("deployBlockers");
  });

  it("refuses an outsider", async () => {
    const res = await api(
      fx.outsider,
      `/api/projects/${fx.orgA.projectId}/activate/readiness`
    );
    expectDenied(res, "an outsider reading readiness");
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await api(null, `/api/projects/${fx.orgA.projectId}/activate/readiness`);
    expect(res.status).toBe(401);
  });

  it("ALLOWS a VIEWER to read it, since readiness reports and never decides", async () => {
    /**
     * This asserted a denial until the permission matrix was fixed.
     *
     * At the time, no PROJECT-scoped role held any activate key, so a VIEWER
     * was refused by accident rather than by intent — the test recorded the
     * gap. `activate:view` is now part of the read-only baseline, and a
     * report of whether go-live is realistic is exactly the thing the people
     * who cannot approve it most need to see.
     */
    const res = await api(
      fx.orgA.users.VIEWER,
      `/api/projects/${fx.orgA.projectId}/activate/readiness`
    );
    expectAllowed(res, "a VIEWER reading readiness");
    expect(res.body.enabled).toBe(true);
  });

  it("reports the other organization's own project independently", async () => {
    // The tenant scope in the aggregate is written by hand in SQL, so it gets
    // its own positive check: org B must see ITS numbers, not org A's and not
    // the union of both.
    const res = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgB.projectId}/activate/readiness`
    );
    expect(res.status).toBe(200);
    for (const p of res.body.phases) expect(p.total).toBe(0);
    expect(res.body.deployBlockerTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("Readiness on a project not running Activate", () => {
  it("answers enabled:false rather than 404", async () => {
    await api(fx.orgB.users.OWNER, `/api/projects/${fx.orgB.projectId}/activate`, {
      method: "POST",
      body: { enabled: false },
    });

    const res = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgB.projectId}/activate/readiness`
    );
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.phases).toEqual([]);
    expect(res.body.deployBlockers).toEqual([]);

    await api(fx.orgB.users.OWNER, `/api/projects/${fx.orgB.projectId}/activate`, {
      method: "POST",
      body: { enabled: true },
    });
  });
});

// ---------------------------------------------------------------------------

describe("Cost does not grow with the project — the exit gate", () => {
  const BULK = 150;

  /** Org B's Deploy phase, given a couple of rows so it is small but NOT empty. */
  let orgBDeployPhaseId: string;

  beforeAll(async () => {
    /**
     * Org B is the small case, and it must not be EMPTY.
     *
     * The first version of this gate compared org B with nothing linked
     * against org A with 161 deliverables, and reported 7 queries versus 9.
     * That is not an N+1: Prisma issues no relation queries at all when the
     * parent result set is empty, so the difference measured emptiness rather
     * than growth. Two rows is enough to make every relation load happen, and
     * then the comparison against 150+ rows means what it claims to.
     */
    const bRes = await api(fx.orgB.users.OWNER, `/api/projects/${fx.orgB.projectId}/activate`);
    orgBDeployPhaseId = bRes.body.phases.find((p: any) => p.key === "DEPLOY").id;

    for (let i = 0; i < 2; i++) {
      const issue = await prisma.issue.create({
        data: {
          projectId: fx.orgB.projectId,
          keyNumber: 7000 + i,
          issueKey: `${fx.orgB.projectKey}-${7000 + i}`,
          title: `Small project item ${i}`,
          issueType: "TASK",
          statusId: fx.orgB.statusId,
          priority: "MEDIUM",
          reporterId: fx.orgB.users.OWNER.id,
        },
        select: { id: true },
      });
      await prisma.activateDeliverableLink.create({
        data: { issueId: issue.id, phaseId: orgBDeployPhaseId, isMandatory: true },
      });
    }

    /**
     * Org A is the large case. The mix is stated explicitly rather than left
     * to modular arithmetic: every second item is a Deploy deliverable and
     * mandatory, and one in three is done. That yields ~50 mandatory Deploy
     * items still open, comfortably past BLOCKER_LIMIT, which is the point of
     * the cap test below — an earlier version produced only 12 and the
     * assertion failed for want of data rather than for want of a cap.
     */
    for (let i = 0; i < BULK; i++) {
      const isDeploy = i % 2 === 0;
      const isDone = i % 3 === 0;
      const issue = await makeIssue(2000 + i, isDone ? fx.orgA.statusDoneId : fx.orgA.statusId);
      await link(issue.id, isDeploy ? deployPhaseId : runPhaseId, {
        isMandatory: isDeploy,
        fitGapStatus: i % 7 === 0 ? "CONFIGURE" : null,
      });
    }
  }, 240_000);

  it("caps the blocker list however many are outstanding", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/readiness`
    );
    expect(res.body.deployBlockerTotal).toBeGreaterThan(BLOCKER_LIMIT);
    // The list is capped; the count is not. A truncated list that also
    // truncated the number would understate how much is outstanding.
    expect(res.body.deployBlockers).toHaveLength(BLOCKER_LIMIT);
  });

  it("issues the same number of queries for a small project as for a large one", async () => {
    const logged = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
    let queries = 0;
    (logged as any).$on("query", () => {
      queries += 1;
    });

    try {
      // Warm up: the first statement on a cold connection is not the thing
      // being measured.
      await getReadiness(fx.orgA.projectId, logged as any);

      // orgB: Activate enabled, two deliverables — small but not empty, so
      // every relation load happens in both cases and the counts compare like
      // for like.
      queries = 0;
      const small = await getReadiness(fx.orgB.projectId, logged as any);
      const queriesSmall = queries;
      expect(small.phases.reduce((n, p) => n + p.total, 0)).toBe(2);

      queries = 0;
      const big = await getReadiness(fx.orgA.projectId, logged as any);
      const queriesLarge = queries;

      const deploy = big.phases.find((p) => p.key === "DEPLOY")!;
      expect(deploy.total).toBeGreaterThan(BULK / 2);

      console.log(
        `[readiness gate] 2 deliverables -> ${queriesSmall} queries; ` +
          `${big.phases.reduce((n, p) => n + p.total, 0)} deliverables -> ${queriesLarge} queries`
      );

      // Constant, not proportional. This is the claim.
      expect(queriesLarge).toBe(queriesSmall);
      expect(queriesLarge).toBeLessThanOrEqual(12);
    } finally {
      await logged.$disconnect();
    }
  }, 180_000);

  it("stays quick at volume — p95 reported, not assumed", async () => {
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      const res = await api(
        fx.orgA.users.OWNER,
        `/api/projects/${fx.orgA.projectId}/activate/readiness`
      );
      expect(res.status).toBe(200);
      samples.push(Date.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)];
    const p95 = samples[Math.floor(samples.length * 0.95)];

    console.log(`[readiness gate] p50 ${p50}ms, p95 ${p95}ms over ${samples.length} requests`);

    // A ceiling loose enough not to be flaky on a loaded machine, and tight
    // enough that a table scan or an accidental N+1 would break it. The
    // reported number is the useful part; this only stops silent decay.
    expect(p95).toBeLessThan(2000);
  }, 180_000);
});
