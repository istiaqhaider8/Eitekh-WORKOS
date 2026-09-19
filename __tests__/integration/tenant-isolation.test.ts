/**
 * PROD-5 — tenant-isolation integration tests.
 *
 * For a multi-tenant product the catastrophic failure is one tenant reading
 * another's data. Before this suite, nothing in the repository would have
 * caught its return: every test was library-level, and no test exercised
 * `assertProjectAccess` or `assertOrgAccess` through a route.
 *
 * The shape of every test here is the same: a fully legitimate, authenticated
 * user of organization A asks for a resource belonging to organization B. The
 * only acceptable answers are 401, 403 and 404 — and never B's data.
 *
 * WHAT COUNTS AS A PASS
 *
 * `expectDenied` deliberately rejects 429 and 500 as well as 200. A rate-limited
 * or crashing request proves nothing about isolation, and counting either as a
 * pass is how a suite quietly stops testing what it claims to test.
 *
 * Each family also asserts a CONTROL case: the same request, made by a
 * legitimate member of the owning tenant, succeeds. Without it a suite can pass
 * because every route is broken for everyone, which is not isolation.
 */

import { PrismaClient } from "@prisma/client";
import {
  api,
  expectDenied,
  expectAllowed,
  expectBodyExcludes,
  expectFilteredOrDenied,
  waitForServer,
  type Fixture,
} from "./harness";
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
}, 60_000);

describe("PROD-5 — a user of org A cannot reach org B's resources", () => {
  // -------------------------------------------------------------------------
  // Control cases. If these fail, every denial below is meaningless.
  // -------------------------------------------------------------------------
  describe("control: the owning tenant CAN reach its own resources", () => {
    it("org A's admin reads org A's project", async () => {
      const res = await api(fx.orgA.users.ADMIN, `/api/projects/${fx.orgA.projectId}`);
      expectAllowed(res, "org A admin reading org A's project");
    });

    it("org A's admin reads org A's issue", async () => {
      const res = await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}`);
      expectAllowed(res, "org A admin reading org A's issue");
    });
  });

  // -------------------------------------------------------------------------
  // IDOR: direct access by another tenant's resource id.
  // -------------------------------------------------------------------------
  describe("direct id access (IDOR)", () => {
    const asA = () => fx.orgA.users.ADMIN;

    it("project read", async () => {
      const res = await api(asA(), `/api/projects/${fx.orgB.projectId}`);
      expectDenied(res, "org A admin reading org B's project");
      expectBodyExcludes(res, "Secret of tenant B", "org B project read");
    });

    it("issue read", async () => {
      const res = await api(asA(), `/api/issues/${fx.orgB.issueId}`);
      expectDenied(res, "org A admin reading org B's issue");
      expectBodyExcludes(res, "Secret of tenant B", "org B issue read");
    });

    it("issue update", async () => {
      const res = await api(asA(), `/api/issues/${fx.orgB.issueId}`, {
        method: "PATCH",
        body: { title: "tampered by tenant A" },
      });
      expectDenied(res, "org A admin updating org B's issue");

      // Belt and braces: the row itself must be untouched. A route could
      // answer 403 after having already written.
      const issue = await prisma.issue.findUnique({ where: { id: fx.orgB.issueId } });
      expect(issue?.title).toBe("Secret of tenant B");
    });

    it("issue delete", async () => {
      const res = await api(asA(), `/api/issues/${fx.orgB.issueId}`, { method: "DELETE" });
      expectDenied(res, "org A admin deleting org B's issue");
      const issue = await prisma.issue.findUnique({ where: { id: fx.orgB.issueId } });
      expect(issue).not.toBeNull();
    });

    it("organization read", async () => {
      const res = await api(asA(), `/api/orgs/${fx.orgB.orgId}`);
      expectDenied(res, "org A admin reading org B");
    });

    it("organization members", async () => {
      const res = await api(asA(), `/api/orgs/${fx.orgB.orgId}/members`);
      expectDenied(res, "org A admin listing org B's members");
      expectBodyExcludes(res, fx.orgB.users.OWNER.email, "org B member list");
    });

    it("workspace read", async () => {
      const res = await api(asA(), `/api/workspaces/${fx.orgB.workspaceId}`);
      expectDenied(res, "org A admin reading org B's workspace");
    });

    it("team members — the personal data case", async () => {
      // This one found a real leak. `GET /api/teams/[id]/members` authenticated
      // the caller and then queried `teamMember.findMany({ where: { teamId } })`
      // for any id at all, returning every member's id, EMAIL, first and last
      // name and avatar. `checkTeamAdmin` existed in the same file and the GET
      // handler never called it.
      const res = await api(asA(), `/api/teams/${fx.orgB.teamId}/members`);
      expectDenied(res, "org A admin listing org B's team members");
      expectBodyExcludes(res, fx.orgB.users.OWNER.email, "org B team member emails");
      expectBodyExcludes(res, fx.orgB.users.MEMBER.email, "org B team member emails");
    });

    it("team read", async () => {
      const res = await api(asA(), `/api/teams/${fx.orgB.teamId}`);
      expectDenied(res, "org A admin reading org B's team");
      expectBodyExcludes(res, "team of tenant B", "org B team record");
    });

    it("control: org A's admin CAN list its own team's members", async () => {
      // Without this, the denial above would also pass if the route were simply
      // broken for everyone.
      const res = await api(asA(), `/api/teams/${fx.orgA.teamId}/members`);
      expectAllowed(res, "org A admin listing org A's team members");
      expect(res.text).toContain(fx.orgA.users.MEMBER.email);
    });
  });

  // -------------------------------------------------------------------------
  // Nested resources: the parent is the thing being protected, and a nested
  // route is the classic place for the check to be forgotten.
  // -------------------------------------------------------------------------
  describe("nested project resources", () => {
    const paths = [
      "issues",
      "members",
      "analytics",
      "context",
      "availability",
      "delegations",
      "priorities",
    ];

    for (const p of paths) {
      it(`/projects/[id]/${p}`, async () => {
        const res = await api(fx.orgA.users.ADMIN, `/api/projects/${fx.orgB.projectId}/${p}`);
        expectDenied(res, `org A admin reading org B's /${p}`);
        expectBodyExcludes(res, "Secret of tenant B", `org B /${p}`);
        expectBodyExcludes(res, fx.orgB.users.OWNER.email, `org B /${p}`);
      });
    }
  });

  describe("nested issue resources", () => {
    // Each entry names a method the route actually implements. Asking for GET
    // everywhere produced 405s, which say nothing about isolation: a route
    // that does not implement the verb never reaches its own guard, so the
    // test would have been asserting on the wrong thing.
    const cases: Array<{ path: string; method: string; body?: unknown }> = [
      { path: "comments", method: "POST", body: { content: "injected by tenant A" } },
      { path: "attachments", method: "GET" },
      { path: "subtasks", method: "POST", body: { title: "injected by tenant A" } },
      { path: "watchers", method: "GET" },
      { path: "time-entries", method: "POST", body: { durationMinutes: 5, description: "injected" } },
      { path: "dependencies", method: "GET" },
      { path: "custom-fields", method: "GET" },
    ];

    for (const c of cases) {
      it(`${c.method} /issues/[id]/${c.path}`, async () => {
        const res = await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgB.issueId}/${c.path}`, {
          method: c.method,
          body: c.body,
        });
        expectDenied(res, `org A admin ${c.method} on org B's issue /${c.path}`);
      });
    }

    it("nothing was written to org B's issue despite the refusals", async () => {
      // A route can refuse and still have written first, so a refusal alone is
      // not proof that nothing happened.
      //
      // Asserts on the INJECTED CONTENT rather than on a count of zero. The
      // count was only correct while the fixture created no comments of its
      // own; the moment it did (for the B4 leaf-resource tests) this started
      // failing without anything being wrong. Naming what must not exist is
      // both more precise and independent of what the fixture builds.
      const injectedComments = await prisma.comment.count({
        where: { issueId: fx.orgB.issueId, content: { contains: "injected by tenant A" } },
      });
      expect(injectedComments).toBe(0);

      const injectedSubtasks = await prisma.subtask.count({
        where: { parentIssueId: fx.orgB.issueId, title: { contains: "injected by tenant A" } },
      });
      expect(injectedSubtasks).toBe(0);

      // The original check: no child ISSUE was created under org B's issue.
      expect(await prisma.issue.count({ where: { parentIssueId: fx.orgB.issueId } })).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Query-parameter overrides: the caller names another tenant's scope in a
  // query string rather than a path segment.
  // -------------------------------------------------------------------------
  describe("query-parameter scope overrides", () => {
    it("?projectId= pointing at another tenant's project", async () => {
      for (const path of ["/api/epics", "/api/components", "/api/sprints", "/api/workflows", "/api/custom-fields"]) {
        const res = await api(fx.orgA.users.ADMIN, `${path}?projectId=${fx.orgB.projectId}`);
        // The needles are values that belong to org B and that these routes
        // would plausibly echo when scoped to org B's project: the project id
        // itself, and its key, which appears in any issue or entity key.
        expectFilteredOrDenied(
          res,
          [fx.orgB.projectId, fx.orgB.issueId, "Secret of tenant B", "Integration Project B"],
          `${path}?projectId=B`
        );
      }
    });

    it("scope parameters pointing at another tenant", async () => {
      // Each route is probed with the parameter it ACTUALLY reads. Sending
      // ?orgId= to a route that ignores it produces a 400 and proves nothing —
      // the earlier version of this test did exactly that for /api/teams, and
      // passed for the wrong reason.
      const cases = [
        { path: "/api/teams", query: `workspaceId=${fx.orgB.workspaceId}` },
        { path: "/api/teams", query: `projectId=${fx.orgB.projectId}` },
        { path: "/api/workspaces", query: `orgId=${fx.orgB.orgId}` },
      ];

      const needles = [
        fx.orgB.workspaceId,
        fx.orgB.teamId,
        fx.orgB.users.OWNER.email,
        "Integration Org B",
        "Integration Team B",
        "Integration WS B",
      ];

      for (const c of cases) {
        const res = await api(fx.orgA.users.ADMIN, `${c.path}?${c.query}`);
        expectFilteredOrDenied(res, needles, `${c.path}?${c.query}`);
      }
    });

    it("control: the same scope parameters work for the caller's OWN tenant", async () => {
      // Proves the probes above reach live code paths rather than dead ones.
      const own = await api(fx.orgA.users.ADMIN, `/api/teams?workspaceId=${fx.orgA.workspaceId}`);
      expectAllowed(own, "org A admin listing its own workspace's teams");
      expect(own.text).toContain(fx.orgA.teamId);
    });
  });

  // -------------------------------------------------------------------------
  // Bulk endpoints: a single request naming many ids is the easiest place to
  // check the first id and trust the rest.
  // -------------------------------------------------------------------------
  describe("bulk endpoints", () => {
    it("bulk issue update cannot include another tenant's issue", async () => {
      const res = await api(fx.orgA.users.ADMIN, "/api/issues/bulk", {
        method: "PATCH",
        body: { issueIds: [fx.orgA.issueId, fx.orgB.issueId], updates: { priority: "LOW" } },
      });

      // The request may legitimately succeed for org A's own issue. What must
      // never happen is org B's issue changing.
      const bIssue = await prisma.issue.findUnique({ where: { id: fx.orgB.issueId } });
      expect(bIssue?.priority).toBe("MEDIUM");
      expect(bIssue?.title).toBe("Secret of tenant B");
      // Recorded for the report rather than asserted: either answer is
      // defensible as long as B is untouched.
      expect([200, 207, 400, 403, 404]).toContain(res.status);
    });

    it("bulk project member assignment cannot target another tenant's project", async () => {
      const res = await api(fx.orgA.users.ADMIN, `/api/projects/${fx.orgB.projectId}/members/bulk`, {
        method: "POST",
        body: { userIds: [fx.orgA.users.MEMBER.id], role: "MEMBER" },
      });
      expectDenied(res, "org A admin bulk-adding members to org B's project");

      const leaked = await prisma.projectMember.findFirst({
        where: { projectId: fx.orgB.projectId, userId: fx.orgA.users.MEMBER.id },
      });
      expect(leaked).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Real-time: a stream is a long-lived read, and the same rules apply.
  // -------------------------------------------------------------------------
  describe("real-time streams", () => {
    it("cannot subscribe to another tenant's project stream", async () => {
      const res = await fetch(
        `${process.env.INTEGRATION_BASE_URL || "http://localhost:3141"}/api/sync/events?projectId=${fx.orgB.projectId}`,
        { headers: { Cookie: `eitekh_session_token=${fx.orgA.users.ADMIN.token}` } }
      );
      // Read nothing; just assert the handshake was refused.
      expect([401, 403, 404]).toContain(res.status);
    });
  });

  // -------------------------------------------------------------------------
  // A user who belongs to no organization at all.
  // -------------------------------------------------------------------------
  describe("an authenticated user who belongs to nothing", () => {
    it("is denied both tenants' projects", async () => {
      for (const t of [fx.orgA, fx.orgB]) {
        const res = await api(fx.outsider, `/api/projects/${t.projectId}`);
        expectDenied(res, "outsider reading a project");
      }
    });

    it("is denied both tenants' issues", async () => {
      for (const t of [fx.orgA, fx.orgB]) {
        const res = await api(fx.outsider, `/api/issues/${t.issueId}`);
        expectDenied(res, "outsider reading an issue");
      }
    });

    it("sees no projects in listings", async () => {
      const res = await api(fx.outsider, "/api/projects");
      expectFilteredOrDenied(
        res,
        [fx.orgA.projectId, fx.orgB.projectId, "Integration Project A", "Integration Project B"],
        "outsider project listing"
      );
    });
  });

  // -------------------------------------------------------------------------
  // Unauthenticated access. The floor.
  // -------------------------------------------------------------------------
  describe("unauthenticated requests", () => {
    it("are denied on scoped resources", async () => {
      const paths = [
        `/api/projects/${fx.orgA.projectId}`,
        `/api/issues/${fx.orgA.issueId}`,
        `/api/orgs/${fx.orgA.orgId}`,
        `/api/projects/${fx.orgA.projectId}/issues`,
      ];
      for (const p of paths) {
        const res = await api(null, p);
        expectDenied(res, `unauthenticated ${p}`);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Listings must be filtered, not merely ordered.
  // -------------------------------------------------------------------------
  describe("listings are scoped to the caller's tenant", () => {
    it("project listing shows only the caller's own projects", async () => {
      const res = await api(fx.orgA.users.ADMIN, "/api/projects");
      expectFilteredOrDenied(
        res,
        [fx.orgB.projectId, "Integration Project B"],
        "org A project listing"
      );
      // And the caller's own project must actually be there, or "no org B
      // content" would also be satisfied by an empty response.
      if (res.status === 200) expect(res.text).toContain(fx.orgA.projectId);
    });

    it("issue search does not surface another tenant's issues", async () => {
      const res = await api(fx.orgA.users.ADMIN, `/api/search?q=Secret`);
      expectFilteredOrDenied(res, ["Secret of tenant B", fx.orgB.issueId], "cross-tenant search");
      // Prove the search actually matched something, so that "org B absent" is
      // a real result rather than an empty one.
      if (res.status === 200) expect(res.text).toContain("Secret of tenant A");
    });

    it("my-tasks does not surface another tenant's issues", async () => {
      const res = await api(fx.orgA.users.ADMIN, "/api/users/my-tasks");
      expectFilteredOrDenied(res, [fx.orgB.issueId, "Secret of tenant B"], "my-tasks");
    });
  });
});
