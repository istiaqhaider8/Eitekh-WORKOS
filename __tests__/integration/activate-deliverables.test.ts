/**
 * SAP Activate increment 3 — workstreams, deliverable links, paged queries.
 *
 * THE ACCEPT CASE IS ASSERTED FIRST in every block. A suite that only proves
 * refusals passes just as happily when the feature is broken for everyone,
 * which is how the OTP bug survived a suite in this repository.
 *
 * THE LAST BLOCK IS THE INCREMENT'S EXIT GATE. "No N+1" is a claim about how
 * the query count behaves as the row count grows, so it is measured — the same
 * listing function the route calls is invoked with an instrumented client at
 * two very different sizes, and the counts must match.
 */

import { PrismaClient } from "@prisma/client";
import { api, expectDenied, expectAllowed, waitForServer, type Fixture } from "./harness";
import { createFixture, destroyFixture } from "./fixture";
import { listDeliverables } from "@/lib/activate-deliverables";

const prisma = new PrismaClient();
let fx: Fixture;

/** Phases and workstreams of each org, populated once Activate is enabled. */
let phaseA: any;
let phaseA2: any;
let workstreamA: any;
let phaseB: any;
let workstreamB: any;

async function enableAndLoad(side: "orgA" | "orgB") {
  const s = fx[side];
  await api(s.users.OWNER, `/api/projects/${s.projectId}/activate`, {
    method: "POST",
    body: { enabled: true },
  });
  const res = await api(s.users.OWNER, `/api/projects/${s.projectId}/activate`);
  return res.body;
}

beforeAll(async () => {
  await waitForServer();
  fx = await createFixture(prisma);

  const a = await enableAndLoad("orgA");
  phaseA = a.phases.find((p: any) => p.key === "EXPLORE");
  phaseA2 = a.phases.find((p: any) => p.key === "REALIZE");
  workstreamA = a.workstreams.find((w: any) => w.key === "TESTING");

  const b = await enableAndLoad("orgB");
  phaseB = b.phases.find((p: any) => p.key === "EXPLORE");
  workstreamB = b.workstreams.find((w: any) => w.key === "TESTING");
}, 180_000);

afterAll(async () => {
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("Workstream update", () => {
  it("renames a workstream and assigns an owner who is a project member", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/workstreams/${workstreamA.id}`,
      { method: "PATCH", body: { name: "Testing and QA", ownerId: fx.orgA.users.OWNER.id } }
    );
    expectAllowed(res, "the owner renaming a workstream");
    expect(res.body.workstream.name).toBe("Testing and QA");
    expect(res.body.workstream.ownerId).toBe(fx.orgA.users.OWNER.id);
  });

  it("takes a workstream out of use without deleting it", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/workstreams/${workstreamA.id}`,
      { method: "PATCH", body: { status: "INACTIVE" } }
    );
    expect(res.status).toBe(200);
    expect(res.body.workstream.status).toBe("INACTIVE");

    const still = await prisma.activateWorkstream.findUnique({ where: { id: workstreamA.id } });
    expect(still).not.toBeNull();

    // Put it back so later blocks see a normal project.
    await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/workstreams/${workstreamA.id}`,
      { method: "PATCH", body: { status: "ACTIVE" } }
    );
  });

  it("refuses another organization's workstream id as 404, not 403", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/workstreams/${workstreamB.id}`,
      { method: "PATCH", body: { name: "Taken over" } }
    );
    expect(res.status).toBe(404);

    const untouched = await prisma.activateWorkstream.findUnique({
      where: { id: workstreamB.id },
      select: { name: true },
    });
    expect(untouched?.name).not.toBe("Taken over");
  });

  it("refuses a cross-tenant caller on the project path", async () => {
    const res = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/workstreams/${workstreamA.id}`,
      { method: "PATCH", body: { name: "Taken over" } }
    );
    expectDenied(res, "org B renaming org A's workstream");
  });

  it("refuses a VIEWER", async () => {
    const res = await api(
      fx.orgA.users.VIEWER,
      `/api/projects/${fx.orgA.projectId}/activate/workstreams/${workstreamA.id}`,
      { method: "PATCH", body: { name: "Viewer was here" } }
    );
    expectDenied(res, "a VIEWER renaming a workstream");
  });

  it("refuses an owner from another organization", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/workstreams/${workstreamA.id}`,
      { method: "PATCH", body: { ownerId: fx.orgB.users.OWNER.id } }
    );
    expect(res.status).toBe(400);
  });

  it("refuses an owner who is in the organization but not the project", async () => {
    // The distinction that matters: spareUserId IS an org member, so an
    // organization-level check would let this through.
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/workstreams/${workstreamA.id}`,
      { method: "PATCH", body: { ownerId: fx.orgA.spareUserId } }
    );
    expect(res.status).toBe(400);
  });

  it("rejects an unknown status with 400, not 500", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/workstreams/${workstreamA.id}`,
      { method: "PATCH", body: { status: "SORT_OF_ACTIVE" } }
    );
    expect(res.status).toBe(400);
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await api(
      null,
      `/api/projects/${fx.orgA.projectId}/activate/workstreams/${workstreamA.id}`,
      { method: "PATCH", body: { name: "Anonymous" } }
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------

describe("Deliverable links", () => {
  let linkId: string;

  it("links an issue of this project to a phase", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables`,
      {
        method: "POST",
        body: {
          issueId: fx.orgA.issueId,
          phaseId: phaseA.id,
          workstreamId: workstreamA.id,
          isMandatory: true,
        },
      }
    );
    expect(res.status).toBe(201);
    expect(res.body.deliverable.issueId).toBe(fx.orgA.issueId);
    expect(res.body.deliverable.phaseId).toBe(phaseA.id);
    linkId = res.body.deliverable.id;

    const row = await prisma.activateDeliverableLink.findUnique({ where: { id: linkId } });
    expect(row?.isMandatory).toBe(true);
  });

  it("lists it, with the issue's own fields and no user secrets", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables`
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);

    const found = res.body.deliverables.find((d: any) => d.id === linkId);
    expect(found).toBeDefined();
    expect(found.issue.issueKey).toBe(fx.orgA.issueKey);
    expect(found.phase.key).toBe("EXPLORE");
    expect(found.workstream.key).toBe("TESTING");

    // PERF-0: a User relation selected with `true` ships every column.
    const body = JSON.stringify(res.body);
    for (const secret of [
      "passwordHash",
      "mfaSecret",
      "recoveryCodes",
      "resetToken",
      "verificationToken",
    ]) {
      expect(body).not.toContain(secret);
    }
  });

  it("refuses a second link for the same issue with 409", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables`,
      { method: "POST", body: { issueId: fx.orgA.issueId, phaseId: phaseA2.id } }
    );
    // Not a silent re-point: moving a deliverable is a deliberate PATCH.
    expect(res.status).toBe(409);

    const row = await prisma.activateDeliverableLink.findUnique({
      where: { issueId: fx.orgA.issueId },
      select: { phaseId: true },
    });
    expect(row?.phaseId).toBe(phaseA.id);
  });

  it("moves it to another phase via PATCH", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables/${linkId}`,
      { method: "PATCH", body: { phaseId: phaseA2.id } }
    );
    expect(res.status).toBe(200);
    expect(res.body.deliverable.phaseId).toBe(phaseA2.id);

    // Put it back for the blocks below.
    await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables/${linkId}`,
      { method: "PATCH", body: { phaseId: phaseA.id } }
    );
  });

  it("detaches from a workstream without detaching from the phase", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables/${linkId}`,
      { method: "PATCH", body: { workstreamId: null } }
    );
    expect(res.status).toBe(200);
    expect(res.body.deliverable.workstreamId).toBeNull();
    expect(res.body.deliverable.phaseId).toBe(phaseA.id);

    await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables/${linkId}`,
      { method: "PATCH", body: { workstreamId: workstreamA.id } }
    );
  });

  // --- the body-carried foreign keys ---------------------------------------

  it("refuses an issue belonging to another organization", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables`,
      { method: "POST", body: { issueId: fx.orgB.issueId, phaseId: phaseA.id } }
    );
    expect(res.status).toBe(400);

    const leaked = await prisma.activateDeliverableLink.findUnique({
      where: { issueId: fx.orgB.issueId },
    });
    expect(leaked).toBeNull();
  });

  it("refuses a phase belonging to another organization", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables`,
      { method: "POST", body: { issueId: fx.orgA.issueId, phaseId: phaseB.id } }
    );
    expect(res.status).toBe(400);

    const count = await prisma.activateDeliverableLink.count({ where: { phaseId: phaseB.id } });
    expect(count).toBe(0);
  });

  it("refuses a workstream belonging to another organization", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables/${linkId}`,
      { method: "PATCH", body: { workstreamId: workstreamB.id } }
    );
    expect(res.status).toBe(400);

    const row = await prisma.activateDeliverableLink.findUnique({
      where: { id: linkId },
      select: { workstreamId: true },
    });
    expect(row?.workstreamId).toBe(workstreamA.id);
  });

  it("refuses a PATCH that would move a deliverable onto another org's phase", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables/${linkId}`,
      { method: "PATCH", body: { phaseId: phaseB.id } }
    );
    expect(res.status).toBe(400);
  });

  // --- path-level isolation -------------------------------------------------

  it("refuses another organization's link id as 404, not 403", async () => {
    // Give org B a deliverable of its own to ask for.
    const created = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgB.projectId}/activate/deliverables`,
      { method: "POST", body: { issueId: fx.orgB.issueId, phaseId: phaseB.id } }
    );
    expect(created.status).toBe(201);
    const foreignLinkId = created.body.deliverable.id;

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables/${foreignLinkId}`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(404);

    const still = await prisma.activateDeliverableLink.findUnique({ where: { id: foreignLinkId } });
    expect(still).not.toBeNull();
  });

  it("does not return another organization's deliverables", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables`
    );
    expect(res.status).toBe(200);
    const issueIds = res.body.deliverables.map((d: any) => d.issue.id);
    expect(issueIds).not.toContain(fx.orgB.issueId);
  });

  it("returns an empty page for a phaseId filter naming another org's phase", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables?phaseId=${phaseB.id}`
    );
    // Not a 400: distinguishing "a real phase elsewhere" from "no such phase"
    // would tell the caller something they did not know before asking.
    expect(res.status).toBe(200);
    expect(res.body.deliverables).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it("refuses a cross-tenant caller listing", async () => {
    const res = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables`
    );
    expectDenied(res, "org B listing org A's deliverables");
  });

  it("refuses an outsider", async () => {
    const res = await api(fx.outsider, `/api/projects/${fx.orgA.projectId}/activate/deliverables`);
    expectDenied(res, "an outsider listing deliverables");
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await api(null, `/api/projects/${fx.orgA.projectId}/activate/deliverables`);
    expect(res.status).toBe(401);
  });

  it("refuses a VIEWER creating a link", async () => {
    const res = await api(
      fx.orgA.users.VIEWER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables`,
      { method: "POST", body: { issueId: fx.orgA.issueId, phaseId: phaseA.id } }
    );
    expectDenied(res, "a VIEWER creating a deliverable link");
  });

  it("refuses a VIEWER deleting a link", async () => {
    const res = await api(
      fx.orgA.users.VIEWER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables/${linkId}`,
      { method: "DELETE" }
    );
    expectDenied(res, "a VIEWER deleting a deliverable link");
  });

  it("rejects a malformed body with 400, not 500", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables`,
      { method: "POST", body: { issueId: 42, phaseId: phaseA.id } }
    );
    expect(res.status).toBe(400);
  });

  // --- fit-to-standard classification (increment 5) -------------------------

  it("records a fit-to-standard outcome", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables/${linkId}`,
      { method: "PATCH", body: { fitGapStatus: "ACCEPTED_GAP" } }
    );
    expect(res.status).toBe(200);
    expect(res.body.deliverable.fitGapStatus).toBe("ACCEPTED_GAP");

    const row = await prisma.activateDeliverableLink.findUnique({
      where: { id: linkId },
      select: { fitGapStatus: true },
    });
    expect(row?.fitGapStatus).toBe("ACCEPTED_GAP");
  });

  it("withdraws a classification back to unassessed, which is not FIT", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables/${linkId}`,
      { method: "PATCH", body: { fitGapStatus: null } }
    );
    expect(res.status).toBe(200);
    // Null is a real state — "no workshop has happened" — and must stay
    // distinguishable from "we looked at it and the standard fits".
    expect(res.body.deliverable.fitGapStatus).toBeNull();
  });

  it("surfaces the classification in the list payload", async () => {
    await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables/${linkId}`,
      { method: "PATCH", body: { fitGapStatus: "GAP" } }
    );
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables`
    );
    expect(res.status).toBe(200);
    const found = res.body.deliverables.find((d: any) => d.id === linkId);
    expect(found.fitGapStatus).toBe("GAP");
  });

  it("rejects a classification outside the allowed set with 400, not 500", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables/${linkId}`,
      { method: "PATCH", body: { fitGapStatus: "PROBABLY_FINE" } }
    );
    // The column is TEXT so the database would accept anything; the Zod schema
    // at the API edge is the only thing standing between it and the vocabulary.
    expect(res.status).toBe(400);

    const row = await prisma.activateDeliverableLink.findUnique({
      where: { id: linkId },
      select: { fitGapStatus: true },
    });
    expect(row?.fitGapStatus).toBe("GAP");
  });

  it("refuses a VIEWER classifying a deliverable", async () => {
    const res = await api(
      fx.orgA.users.VIEWER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables/${linkId}`,
      { method: "PATCH", body: { fitGapStatus: "FIT" } }
    );
    expectDenied(res, "a VIEWER classifying a deliverable");
  });

  it("unlinks without deleting the issue", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables/${linkId}`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(200);

    expect(await prisma.activateDeliverableLink.findUnique({ where: { id: linkId } })).toBeNull();
    // The work itself survives a governance edit.
    expect(await prisma.issue.findUnique({ where: { id: fx.orgA.issueId } })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("Deliverables on a project with Activate switched off", () => {
  it("refuses a new link with 409 while allowing the existing ones to be read", async () => {
    await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`, {
      method: "POST",
      body: { enabled: false },
    });

    const create = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables`,
      { method: "POST", body: { issueId: fx.orgA.issueId, phaseId: phaseA.id } }
    );
    // 409, not 403: the permission is right, the project state is not, and
    // enabling it makes the identical request succeed.
    expect(create.status).toBe(409);

    const read = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables`
    );
    expect(read.status).toBe(200);

    // Re-enable: the seed is idempotent and the phases are the same rows.
    await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`, {
      method: "POST",
      body: { enabled: true },
    });
    const after = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`);
    expect(after.body.phases.find((p: any) => p.key === "EXPLORE").id).toBe(phaseA.id);
  });
});

// ---------------------------------------------------------------------------

describe("Paging and the N+1 exit gate", () => {
  const BULK = 60;

  beforeAll(async () => {
    /**
     * Issues created directly, not through the API: this block needs volume,
     * not another exercise of the issue endpoint. They live in the fixture
     * project, so `destroyFixture` removes them by projectId and the links
     * cascade from the issues.
     */
    for (let i = 0; i < BULK; i += 1) {
      const issue = await prisma.issue.create({
        data: {
          projectId: fx.orgA.projectId,
          keyNumber: 1000 + i,
          issueKey: `${fx.orgA.projectKey}-${1000 + i}`,
          title: `Deliverable ${i}`,
          issueType: "TASK",
          statusId: fx.orgA.statusId,
          priority: "MEDIUM",
          reporterId: fx.orgA.users.OWNER.id,
          assigneeId: fx.orgA.users.OWNER.id,
        },
        select: { id: true },
      });
      await prisma.activateDeliverableLink.create({
        data: {
          issueId: issue.id,
          phaseId: phaseA.id,
          workstreamId: i % 2 === 0 ? workstreamA.id : null,
        },
      });
    }
  }, 180_000);

  it("pages with the same contract as the issues endpoint", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables?limit=25&page=1`
    );
    expect(res.status).toBe(200);
    expect(res.body.deliverables).toHaveLength(25);
    expect(res.body.limit).toBe(25);
    expect(res.body.page).toBe(1);
    expect(res.body.total).toBeGreaterThanOrEqual(BULK);
    expect(res.body.totalPages).toBe(Math.ceil(res.body.total / 25));

    const page3 = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables?limit=25&page=3`
    );
    expect(page3.status).toBe(200);
    // Pages must not overlap.
    const first = new Set(res.body.deliverables.map((d: any) => d.id));
    for (const d of page3.body.deliverables) expect(first.has(d.id)).toBe(false);
  });

  it("filters by workstream", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/deliverables?workstreamId=${workstreamA.id}&limit=200`
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(BULK / 2);
    for (const d of res.body.deliverables) expect(d.workstream.id).toBe(workstreamA.id);
  });

  /**
   * THE EXIT GATE.
   *
   * `listDeliverables` is the function the route calls, invoked here with a
   * client that counts the SQL statements Prisma issues. If the query count
   * rises with the number of rows, that is an N+1 and this fails.
   */
  it("issues the same number of queries for 1 row as for 60", async () => {
    const logged = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
    let queries = 0;
    (logged as any).$on("query", () => {
      queries += 1;
    });

    try {
      // Warm up: the first statement on a cold connection is not the thing
      // being measured.
      await listDeliverables(fx.orgA.projectId, { limit: 1 }, logged as any);

      queries = 0;
      const small = await listDeliverables(fx.orgA.projectId, { limit: 1 }, logged as any);
      const queriesForOne = queries;

      queries = 0;
      const large = await listDeliverables(fx.orgA.projectId, { limit: 200 }, logged as any);
      const queriesForMany = queries;

      console.log(
        `[N+1 gate] ${small.deliverables.length} row -> ${queriesForOne} queries; ` +
          `${large.deliverables.length} rows -> ${queriesForMany} queries`
      );

      expect(large.deliverables.length).toBeGreaterThanOrEqual(BULK);
      // Constant, not linear. This is the whole claim.
      expect(queriesForMany).toBe(queriesForOne);
      // And constant at a small number, so a constant-but-absurd count is
      // caught too. Prisma loads each nested relation with its own statement
      // by default, so this is a handful rather than two.
      expect(queriesForMany).toBeLessThanOrEqual(10);
    } finally {
      await logged.$disconnect();
    }
  }, 120_000);
});
