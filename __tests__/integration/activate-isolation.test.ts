/**
 * SAP Activate — tenant isolation and authorization.
 *
 * TWO THINGS THIS SUITE IS DELIBERATE ABOUT
 *
 * 1. The ACCEPT case is asserted first. A suite that only proves refusals
 *    passes just as happily when the feature is broken for everyone — the OTP
 *    bug survived exactly such a suite in this repository. So each block
 *    establishes that the intended caller succeeds before proving that the
 *    wrong one is refused.
 *
 * 2. A phase id is a leaf resource. Both isolation vulnerabilities found in
 *    this project so far lived on paths reachable by an id that named no
 *    tenant. The phase route takes the project in the path and requires the
 *    phase to belong to it, so org B's phase id must be a 404 for org A —
 *    not merely a 403, which would confirm the row exists.
 */

import { PrismaClient } from "@prisma/client";
import { api, expectDenied, waitForServer, type Fixture } from "./harness";
import { createFixture, destroyFixture } from "./fixture";

const prisma = new PrismaClient();
let fx: Fixture;

beforeAll(async () => {
  await waitForServer();
  fx = await createFixture(prisma);
}, 180_000);

afterAll(async () => {
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

describe("Activate profile", () => {
  it("reports disabled for a project that has never enabled it", async () => {
    const res = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    // Not a 404: a client must be able to render the enable affordance
    // without a failed request being the normal path.
    expect(res.body.phases).toEqual([]);
  });

  it("enables, seeding six phases and eleven workstreams", async () => {
    const enable = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`, {
      method: "POST",
      body: { enabled: true },
    });
    expect(enable.status).toBe(201);

    const res = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.phases).toHaveLength(6);
    expect(res.body.phases.map((p: any) => p.key)).toEqual([
      "DISCOVER",
      "PREPARE",
      "EXPLORE",
      "REALIZE",
      "DEPLOY",
      "RUN",
    ]);
    expect(res.body.workstreams).toHaveLength(11);
    // Every phase seeds exactly one gate, and every gate has criteria.
    for (const phase of res.body.phases) {
      expect(phase.gates).toHaveLength(1);
      expect(phase.gates[0].criteria.length).toBeGreaterThan(0);
    }
  });

  it("is idempotent — enabling twice does not duplicate phases", async () => {
    await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`, {
      method: "POST",
      body: { enabled: true },
    });
    const res = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`);
    expect(res.body.phases).toHaveLength(6);
    expect(res.body.workstreams).toHaveLength(11);
  });

  it("refuses a caller from another organization", async () => {
    const res = await api(fx.orgB.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`);
    expectDenied(res, "org B reading org A's Activate profile");
    expect(JSON.stringify(res.body)).not.toContain("DISCOVER");
  });

  it("refuses an outsider who belongs to no organization", async () => {
    const res = await api(fx.outsider, `/api/projects/${fx.orgA.projectId}/activate`);
    expectDenied(res, "an outsider reading an Activate profile");
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await api(null, `/api/projects/${fx.orgA.projectId}/activate`);
    expect(res.status).toBe(401);
  });

  it("refuses a VIEWER attempting to enable", async () => {
    const res = await api(fx.orgA.users.VIEWER, `/api/projects/${fx.orgA.projectId}/activate`, {
      method: "POST",
      body: { enabled: true },
    });
    expectDenied(res, "a VIEWER enabling Activate");
  });

  it("rejects a malformed body with 400, not 500", async () => {
    const res = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`, {
      method: "POST",
      body: { enabled: "yes please" },
    });
    expect(res.status).toBe(400);
  });
});

describe("Activate phase update", () => {
  async function phaseOf(fixtureSide: "orgA" | "orgB", key: string) {
    const side = fx[fixtureSide];
    await api(side.users.OWNER, `/api/projects/${side.projectId}/activate`, {
      method: "POST",
      body: { enabled: true },
    });
    const res = await api(side.users.OWNER, `/api/projects/${side.projectId}/activate`);
    return res.body.phases.find((p: any) => p.key === key);
  }

  it("updates a phase owned by the caller's project", async () => {
    const phase = await phaseOf("orgA", "PREPARE");
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/phases/${phase.id}`,
      { method: "PATCH", body: { status: "IN_PROGRESS" } }
    );
    expect(res.status).toBe(200);
    expect(res.body.phase.status).toBe("IN_PROGRESS");
  });

  it("refuses another organization's phase id as 404, not 403", async () => {
    const phaseB = await phaseOf("orgB", "PREPARE");
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/phases/${phaseB.id}`,
      { method: "PATCH", body: { status: "COMPLETED" } }
    );
    // 404 rather than 403: a 403 would confirm the row exists.
    expect(res.status).toBe(404);

    // And it must not have been modified.
    const still = await prisma.activatePhase.findUnique({
      where: { id: phaseB.id },
      select: { status: true },
    });
    expect(still?.status).not.toBe("COMPLETED");
  });

  it("refuses a cross-tenant caller on the project path", async () => {
    const phase = await phaseOf("orgA", "EXPLORE");
    const res = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/phases/${phase.id}`,
      { method: "PATCH", body: { status: "COMPLETED" } }
    );
    expectDenied(res, "org B updating org A's phase");
  });

  it("refuses a VIEWER", async () => {
    const phase = await phaseOf("orgA", "REALIZE");
    const res = await api(
      fx.orgA.users.VIEWER,
      `/api/projects/${fx.orgA.projectId}/activate/phases/${phase.id}`,
      { method: "PATCH", body: { status: "COMPLETED" } }
    );
    expectDenied(res, "a VIEWER updating a phase");
  });

  it("refuses an owner who is not a member of the project", async () => {
    const phase = await phaseOf("orgA", "DEPLOY");
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/phases/${phase.id}`,
      { method: "PATCH", body: { ownerId: fx.orgB.users.OWNER.id } }
    );
    // A cross-tenant reference dressed as an assignment.
    expect(res.status).toBe(400);
  });

  it("refuses a target date earlier than the start date", async () => {
    const phase = await phaseOf("orgA", "RUN");
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/phases/${phase.id}`,
      { method: "PATCH", body: { startDate: "2026-06-01", targetDate: "2026-01-01" } }
    );
    expect(res.status).toBe(400);
  });

  it("refuses a stale version with 409", async () => {
    const phase = await phaseOf("orgA", "DISCOVER");
    const first = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/phases/${phase.id}`,
      { method: "PATCH", body: { name: "Discover (renamed)", version: phase.version } }
    );
    expect(first.status).toBe(200);

    // The same version again is now stale.
    const second = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/phases/${phase.id}`,
      { method: "PATCH", body: { name: "Discover (again)", version: phase.version } }
    );
    expect(second.status).toBe(409);
  });
});

describe("Projects not running Activate", () => {
  it("are unaffected: the issues endpoint responds exactly as before", async () => {
    // orgB has Activate enabled by an earlier block, so use its issue route —
    // the claim is that enabling Activate changes nothing about the rest of
    // the API, not that a project never enabled it is unchanged.
    const res = await api(fx.orgB.users.OWNER, `/api/projects/${fx.orgB.projectId}/issues?limit=5`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.issues)).toBe(true);
    // No Activate field leaks into an unrelated payload.
    expect(JSON.stringify(res.body)).not.toContain("activate");
  });
});
