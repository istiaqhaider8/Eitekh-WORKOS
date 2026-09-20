/**
 * SAP Activate increment 7 — applying an accelerator.
 *
 * The catalogue itself, and the claim that it is data rather than code, are
 * covered by the unit suite. This is about what happens when one is applied:
 * an issue is created in the project, linked as a deliverable of the right
 * phase, and stamped so the answer to "have we done this" is a lookup rather
 * than a guess based on a title someone may have renamed.
 *
 * The accept case is asserted first in every block.
 */

import { PrismaClient } from "@prisma/client";
import { api, expectDenied, expectAllowed, waitForServer, type Fixture } from "./harness";
import { createFixture, destroyFixture } from "./fixture";
import { ACCELERATORS, acceleratorsForPhase } from "@/lib/activate-accelerators";

const prisma = new PrismaClient();
let fx: Fixture;

/** A mandatory Explore accelerator — every catalogue has one. */
const SAMPLE = acceleratorsForPhase("EXPLORE").find((a) => a.isMandatory) ?? ACCELERATORS[0];

beforeAll(async () => {
  await waitForServer();
  fx = await createFixture(prisma);
  for (const side of ["orgA", "orgB"] as const) {
    await api(fx[side].users.OWNER, `/api/projects/${fx[side].projectId}/activate`, {
      method: "POST",
      body: { enabled: true },
    });
  }
}, 180_000);

afterAll(async () => {
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

describe("The accelerator catalogue over HTTP", () => {
  it("offers the catalogue with nothing applied yet", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/accelerators`
    );
    expectAllowed(res, "the owner reading the accelerator catalogue");
    expect(res.body.accelerators).toHaveLength(ACCELERATORS.length);
    for (const a of res.body.accelerators) expect(a.applied).toBeNull();
  });

  it("filters to one phase", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/accelerators?phaseKey=EXPLORE`
    );
    expect(res.status).toBe(200);
    expect(res.body.accelerators).toHaveLength(acceleratorsForPhase("EXPLORE").length);
    for (const a of res.body.accelerators) expect(a.phaseKey).toBe("EXPLORE");
  });

  it("refuses a cross-tenant caller, an outsider and an anonymous one", async () => {
    const path = `/api/projects/${fx.orgA.projectId}/activate/accelerators`;
    expectDenied(await api(fx.orgB.users.OWNER, path), "org B reading org A's accelerators");
    expectDenied(await api(fx.outsider, path), "an outsider reading accelerators");
    expect((await api(null, path)).status).toBe(401);
  });
});

describe("Applying an accelerator", () => {
  let issueId: string;

  it("creates the issue and links it as a deliverable of the right phase", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/accelerators`,
      { method: "POST", body: { key: SAMPLE.key } }
    );
    expect(res.status).toBe(201);
    expect(res.body.issue.title).toBe(SAMPLE.title);
    issueId = res.body.issue.id;

    const link = await prisma.activateDeliverableLink.findUnique({
      where: { issueId },
      select: {
        acceleratorKey: true,
        isMandatory: true,
        phase: { select: { key: true, projectId: true } },
        workstream: { select: { key: true } },
      },
    });
    expect(link?.acceleratorKey).toBe(SAMPLE.key);
    expect(link?.isMandatory).toBe(SAMPLE.isMandatory);
    expect(link?.phase.key).toBe(SAMPLE.phaseKey);
    expect(link?.phase.projectId).toBe(fx.orgA.projectId);
    expect(link?.workstream?.key).toBe(SAMPLE.workstreamKey);
  });

  it("gives the issue a real key from the project's own sequence", async () => {
    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { issueKey: true, keyNumber: true, projectId: true },
    });
    // The accelerator route and the issues route share one allocator, so the
    // key must look exactly like any other issue's.
    expect(issue?.issueKey).toBe(`${fx.orgA.projectKey}-${issue?.keyNumber}`);
    expect(issue?.projectId).toBe(fx.orgA.projectId);

    // And it must not collide with anything already there.
    const clashes = await prisma.issue.count({
      where: { projectId: fx.orgA.projectId, issueKey: issue!.issueKey },
    });
    expect(clashes).toBe(1);
  });

  it("reports it as applied afterwards", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/accelerators?phaseKey=${SAMPLE.phaseKey}`
    );
    const found = res.body.accelerators.find((a: any) => a.key === SAMPLE.key);
    expect(found.applied).not.toBeNull();
    expect(found.applied.id).toBe(issueId);
  });

  it("refuses a second application with 409 and creates nothing", async () => {
    const before = await prisma.issue.count({ where: { projectId: fx.orgA.projectId } });

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/accelerators`,
      { method: "POST", body: { key: SAMPLE.key } }
    );
    expect(res.status).toBe(409);
    // Two identical issues would make "is this done" ambiguous, which is the
    // one question the stamp exists to answer.
    expect(res.body.error).toMatch(/already applied/i);

    const after = await prisma.issue.count({ where: { projectId: fx.orgA.projectId } });
    expect(after).toBe(before);
  });

  it("rejects an unknown accelerator key with 400, not 500", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/accelerators`,
      { method: "POST", body: { key: "NOT_A_REAL_ACCELERATOR" } }
    );
    expect(res.status).toBe(400);
  });

  it("rejects a malformed body with 400", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/accelerators`,
      { method: "POST", body: { key: 42 } }
    );
    expect(res.status).toBe(400);
  });

  it("refuses a VIEWER and a MEMBER, and writes nothing", async () => {
    const other = acceleratorsForPhase("PREPARE")[0];
    const before = await prisma.issue.count({ where: { projectId: fx.orgA.projectId } });

    for (const who of [fx.orgA.users.VIEWER, fx.orgA.users.MEMBER]) {
      const res = await api(
        who,
        `/api/projects/${fx.orgA.projectId}/activate/accelerators`,
        { method: "POST", body: { key: other.key } }
      );
      expectDenied(res, `${who.label} applying an accelerator`);
    }

    expect(await prisma.issue.count({ where: { projectId: fx.orgA.projectId } })).toBe(before);
  });

  it("refuses a cross-tenant caller on the project path", async () => {
    const other = acceleratorsForPhase("REALIZE")[0];
    const res = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/accelerators`,
      { method: "POST", body: { key: other.key } }
    );
    expectDenied(res, "org B applying an accelerator to org A's project");

    const leaked = await prisma.activateDeliverableLink.findFirst({
      where: { acceleratorKey: other.key, phase: { projectId: fx.orgA.projectId } },
    });
    expect(leaked).toBeNull();
  });

  it("keeps the two tenants' applications apart", async () => {
    // Org B applies the SAME accelerator to its own project. Both must
    // succeed and neither may see the other's.
    const res = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgB.projectId}/activate/accelerators`,
      { method: "POST", body: { key: SAMPLE.key } }
    );
    expect(res.status).toBe(201);

    const a = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/accelerators?phaseKey=${SAMPLE.phaseKey}`
    );
    const b = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgB.projectId}/activate/accelerators?phaseKey=${SAMPLE.phaseKey}`
    );
    const aApplied = a.body.accelerators.find((x: any) => x.key === SAMPLE.key).applied;
    const bApplied = b.body.accelerators.find((x: any) => x.key === SAMPLE.key).applied;
    expect(aApplied.id).not.toBe(bApplied.id);
  });

  it("refuses while Activate is switched off", async () => {
    const other = acceleratorsForPhase("RUN")[0];
    await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`, {
      method: "POST",
      body: { enabled: false },
    });

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/accelerators`,
      { method: "POST", body: { key: other.key } }
    );
    // 409: the permission is right, the project state is not.
    expect(res.status).toBe(409);

    await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`, {
      method: "POST",
      body: { enabled: true },
    });
  });
});
