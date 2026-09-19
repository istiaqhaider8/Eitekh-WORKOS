/**
 * PROD-6 — authorization / PBAC route tests.
 *
 * PBAC is the most security-critical and most intricate subsystem here
 * (`pbac-engine.ts` is ~2,300 lines) and had no tests at all. Five PBAC
 * findings were filed against it, including privilege escalation (PBAC-1) and
 * a stale-cache bug (PBAC-2). Role-hierarchy logic without tests regresses.
 *
 * Where PROD-5 asks "can tenant A reach tenant B's data", this asks a
 * different question about a single tenant: **can a role do more than its rank
 * allows?** Both failures are invisible in a green build, and neither is
 * detectable from unit tests of the engine, because the question is whether
 * the ROUTE consults the engine at all.
 *
 * Shares the PROD-5 fixture. Each tenant has one user per role:
 *
 *   OWNER    org OWNER  / project PROJECT_ADMIN
 *   ADMIN    org ADMIN  / project PROJECT_ADMIN
 *   MANAGER  org MEMBER / project PROJECT_MANAGER
 *   MEMBER   org MEMBER / project MEMBER
 *   VIEWER   org MEMBER / project VIEWER
 *
 * plus a SUPER_ADMIN and a user who belongs to nothing.
 */

import { PrismaClient } from "@prisma/client";
import {
  api,
  expectDenied,
  expectAllowed,
  waitForServer,
  type Fixture,
  type TestUser,
} from "./harness";
import { createFixture, destroyFixture, ROLE_SPECS } from "./fixture";

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

/** The documented cross-instance propagation bound from PROD-3, plus slack. */
const PBAC_PROPAGATION_MS = 2_000;
const CAPABILITY_TTL_MS = 5_000;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("PROD-6 — a role cannot exceed its own authority", () => {
  // -------------------------------------------------------------------------
  // VIEWER is the clearest case: read everything in its project, change
  // nothing. Every mutating route must refuse it.
  // -------------------------------------------------------------------------
  describe("VIEWER is denied every mutating route", () => {
    const viewer = () => fx.orgA.users.VIEWER;

    it("can read its own project (control)", async () => {
      // Without this, every denial below would also pass for a VIEWER who
      // simply has no access at all — which is a different bug.
      const res = await api(viewer(), `/api/projects/${fx.orgA.projectId}`);
      expectAllowed(res, "VIEWER reading its own project");
    });

    // Every field is a thunk: this array is built when the describe block is
    // registered, which happens BEFORE beforeAll populates the fixture.
    // Referencing fx eagerly here made the whole suite fail to load.
    const cases: Array<{
      what: string;
      path: () => string;
      method: string;
      body?: () => unknown;
      verify: () => Promise<void>;
    }> = [
      {
        what: "create an issue",
        path: () => `/api/projects/${fx.orgA.projectId}/issues`,
        method: "POST",
        body: () => ({ title: "viewer should not create this", issueType: "TASK", priority: "MEDIUM" }),
        verify: async () => {
          expect(await prisma.issue.count({ where: { title: "viewer should not create this" } })).toBe(0);
        },
      },
      {
        what: "edit the project",
        path: () => `/api/projects/${fx.orgA.projectId}`,
        method: "PATCH",
        body: () => ({ name: "renamed by a viewer" }),
        verify: async () => {
          const p = await prisma.project.findUnique({ where: { id: fx.orgA.projectId } });
          expect(p?.name).toBe("Integration Project A");
        },
      },
      {
        what: "delete the project",
        path: () => `/api/projects/${fx.orgA.projectId}`,
        method: "DELETE",
        verify: async () => {
          expect(await prisma.project.count({ where: { id: fx.orgA.projectId } })).toBe(1);
        },
      },
      {
        what: "edit an issue",
        path: () => `/api/issues/${fx.orgA.issueId}`,
        method: "PATCH",
        body: () => ({ title: "renamed by a viewer" }),
        verify: async () => {
          const i = await prisma.issue.findUnique({ where: { id: fx.orgA.issueId } });
          expect(i?.title).toBe("Secret of tenant A");
        },
      },
      {
        what: "delete an issue",
        path: () => `/api/issues/${fx.orgA.issueId}`,
        method: "DELETE",
        verify: async () => {
          expect(await prisma.issue.count({ where: { id: fx.orgA.issueId } })).toBe(1);
        },
      },
      {
        what: "add a project member",
        path: () => `/api/projects/${fx.orgA.projectId}/members`,
        method: "POST",
        // The spare user IS an organization member but NOT a project member,
        // so the request reaches the permission check instead of failing
        // validation with "User must be a member of the organization".
        body: () => ({ userId: fx.orgA.spareUserId, role: "MEMBER" }),
        verify: async () => {
          expect(
            await prisma.projectMember.count({
              where: { projectId: fx.orgA.projectId, userId: fx.orgA.spareUserId },
            })
          ).toBe(0);
        },
      },
      {
        what: "create a team",
        path: () => "/api/teams",
        method: "POST",
        body: () => ({
          name: "viewer team",
          workspaceId: fx.orgA.workspaceId,
          projectId: fx.orgA.projectId,
        }),
        verify: async () => {
          expect(await prisma.team.count({ where: { name: "viewer team" } })).toBe(0);
        },
      },
      {
        what: "create a project",
        path: () => "/api/projects",
        method: "POST",
        body: () => ({
          workspaceId: fx.orgA.workspaceId,
          name: "viewer project",
          key: "VWR",
          template: "KANBAN",
        }),
        verify: async () => {
          expect(await prisma.project.count({ where: { name: "viewer project" } })).toBe(0);
        },
      },
    ];

    for (const c of cases) {
      it(`cannot ${c.what}`, async () => {
        const res = await api(viewer(), c.path(), {
          method: c.method,
          body: c.body ? c.body() : undefined,
        });
        expectDenied(res, `VIEWER attempting to ${c.what}`);
        // A refusal is not proof: a route can answer 403 having already written.
        await c.verify();
      });
    }
  });

  // -------------------------------------------------------------------------
  // PBAC-1: privilege escalation. No role may grant authority above its own.
  // -------------------------------------------------------------------------
  describe("no role can grant authority above its own", () => {
    /**
     * PROJECT-role authority, highest first. The escalation matrix is built
     * over THIS, not over the organization rank: OWNER and ADMIN both hold the
     * project role PROJECT_ADMIN, so "an ADMIN may not grant PROJECT_ADMIN" is
     * not an escalation at all — it is what a project admin is for.
     */
    const PROJECT_AUTHORITY = ["PROJECT_ADMIN", "PROJECT_MANAGER", "MEMBER", "VIEWER"];
    const authorityOf = (projectRole: string) => PROJECT_AUTHORITY.indexOf(projectRole);

    /** Actor/role pairs where the actor would be granting ABOVE its own level. */
    const escalations: Array<{ actor: string; actorRole: string; grants: string }> = [];
    for (const actor of ROLE_SPECS) {
      for (const grants of PROJECT_AUTHORITY) {
        if (authorityOf(grants) < authorityOf(actor.projectRole)) {
          escalations.push({ actor: actor.label, actorRole: actor.projectRole, grants });
        }
      }
    }

    /**
     * Put the fixture back exactly as declared.
     *
     * Without this the tests are order-dependent: the first legitimate
     * promotion leaves its target at a higher role, and every later test runs
     * against a fixture that no longer matches its own description. That is
     * how the first run of this suite produced an apparent — and false —
     * privilege escalation.
     */
    const resetRoles = async () => {
      for (const spec of ROLE_SPECS) {
        await prisma.projectMember.update({
          where: {
            projectId_userId: {
              projectId: fx.orgA.projectId,
              userId: (fx.orgA.users[spec.label] as TestUser).id,
            },
          },
          data: { role: spec.projectRole },
        });
      }
    };

    beforeEach(resetRoles);
    afterAll(resetRoles);

    it("covers every escalating pair", () => {
      // Guards the loop itself: an empty or truncated matrix would make the
      // suite silently assert nothing.
      expect(escalations.length).toBeGreaterThanOrEqual(6);
    });

    for (const e of escalations) {
      it(`${e.actor} (project ${e.actorRole}) cannot promote anyone to ${e.grants}`, async () => {
        const actor = fx.orgA.users[e.actor] as TestUser;
        // A different user from the actor, so a refusal cannot be an artefact
        // of someone editing their own membership.
        const target = fx.orgA.users.VIEWER;

        const res = await api(actor, `/api/projects/${fx.orgA.projectId}/members`, {
          method: "PATCH",
          body: { userId: target.id, role: e.grants },
        });

        const after = await prisma.projectMember.findUnique({
          where: { projectId_userId: { projectId: fx.orgA.projectId, userId: target.id } },
        });

        if (res.status >= 200 && res.status < 300) {
          throw new Error(
            `${e.actor} (project ${e.actorRole}) was ALLOWED to set a member to ${e.grants} ` +
              `(status ${res.status}); the row is now ${after?.role}.`
          );
        }
        expect(after?.role).toBe("VIEWER");
      });
    }

    it("an organization MEMBER cannot invite an OWNER", async () => {
      // This is the escalation closed in 0f895a0: the invite route took `role`
      // from the body with no check on the inviter's own role, and the
      // invitation acceptance path creates the OrganizationMember from it — so
      // an org MEMBER could mint an OWNER invitation. Pinned so it stays shut.
      const res = await api(fx.orgA.users.MEMBER, "/api/auth/invite", {
        method: "POST",
        body: {
          email: `escalation-probe-member@integration.test`,
          orgId: fx.orgA.orgId,
          role: "OWNER",
        },
      });
      expectDenied(res, "org MEMBER minting an OWNER invitation");
    });

    it("an organization ADMIN cannot invite an OWNER either", async () => {
      // Only an OWNER may create an OWNER.
      const res = await api(fx.orgA.users.ADMIN, "/api/auth/invite", {
        method: "POST",
        body: {
          email: `escalation-probe-admin@integration.test`,
          orgId: fx.orgA.orgId,
          role: "OWNER",
        },
      });
      expectDenied(res, "org ADMIN minting an OWNER invitation");
    });

    it("a PROJECT_MANAGER cannot promote THEMSELVES to PROJECT_ADMIN", async () => {
      // The sharper form of the escalation this suite found: a manager holds
      // projects:manage_members, so nothing but the hierarchy check stops them
      // handing themselves the level above.
      const self = fx.orgA.users.MANAGER;
      const res = await api(self, `/api/projects/${fx.orgA.projectId}/members`, {
        method: "PATCH",
        body: { userId: self.id, role: "PROJECT_ADMIN" },
      });
      const after = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: fx.orgA.projectId, userId: self.id } },
      });
      if (res.status >= 200 && res.status < 300) {
        throw new Error(
          `a PROJECT_MANAGER promoted themselves to PROJECT_ADMIN (status ${res.status}); row is now ${after?.role}`
        );
      }
      expect(after?.role).toBe("PROJECT_MANAGER");
    });

    it("a PROJECT_MANAGER cannot ADD a new member as PROJECT_ADMIN", async () => {
      // The POST path upserts the role too, so guarding only PATCH would leave
      // the same escalation reachable by adding rather than promoting.
      const res = await api(fx.orgA.users.MANAGER, `/api/projects/${fx.orgA.projectId}/members`, {
        method: "POST",
        body: { userId: fx.orgA.spareUserId, role: "PROJECT_ADMIN" },
      });
      if (res.status >= 200 && res.status < 300) {
        throw new Error(`a PROJECT_MANAGER added a member as PROJECT_ADMIN (status ${res.status})`);
      }
      const row = await prisma.projectMember.findFirst({
        where: { projectId: fx.orgA.projectId, userId: fx.orgA.spareUserId },
      });
      expect(row).toBeNull();
    });

    it("a MEMBER cannot promote THEMSELVES", async () => {
      const self = fx.orgA.users.MEMBER;
      const res = await api(self, `/api/projects/${fx.orgA.projectId}/members`, {
        method: "PATCH",
        body: { userId: self.id, role: "PROJECT_ADMIN" },
      });
      const after = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: fx.orgA.projectId, userId: self.id } },
      });
      if (res.status >= 200 && res.status < 300) {
        throw new Error(
          `a MEMBER promoted themselves to PROJECT_ADMIN (status ${res.status}); row is now ${after?.role}`
        );
      }
      expect(after?.role).toBe("MEMBER");
    });

    it("a MEMBER cannot grant themselves a PBAC role", async () => {
      const self = fx.orgA.users.MEMBER;
      const res = await api(self, `/api/pbac/users/${self.id}/roles`, {
        method: "PUT",
        body: { orgId: fx.orgA.orgId, roleIds: [`role_${fx.orgA.orgId}_org-admin`] },
      });
      expectDenied(res, "a MEMBER assigning themselves an org-admin PBAC role");
    });

    it("control: a PROJECT_ADMIN CAN set a member's role", async () => {
      // Otherwise every denial above would also pass on a route that refuses
      // everyone, which is not a hierarchy.
      const target = fx.orgA.users.VIEWER;
      const res = await api(fx.orgA.users.ADMIN, `/api/projects/${fx.orgA.projectId}/members`, {
        method: "PATCH",
        body: { userId: target.id, role: "MEMBER" },
      });
      expectAllowed(res, "PROJECT_ADMIN setting a member's role");
      const after = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: fx.orgA.projectId, userId: target.id } },
      });
      expect(after?.role).toBe("MEMBER");
    });
  });

  // -------------------------------------------------------------------------
  // Super-admin surface. ADMIN-2 was a systemic gap here, so the whole family
  // is covered as a group rather than route by route.
  // -------------------------------------------------------------------------
  describe("the super-admin surface is closed to ordinary roles", () => {
    const paths = [
      "/api/super-admin/stats",
      "/api/super-admin/users",
      "/api/super-admin/orgs",
      "/api/super-admin/projects",
      "/api/super-admin/workspaces",
      "/api/super-admin/security",
      "/api/super-admin/audit-logs",
      "/api/super-admin/health",
      "/api/super-admin/analytics",
      "/api/super-admin/reports",
      "/api/super-admin/sync-monitor",
      "/api/super-admin/features",
      "/api/super-admin/email-settings",
      "/api/super-admin/data-retention",
      "/api/super-admin/backups",
      "/api/super-admin/jobs",
      "/api/super-admin/search",
      "/api/super-admin/access-governance",
      "/api/super-admin/security-threats",
      "/api/super-admin/announcements",
      "/api/super-admin/email-templates",
      // C2. Recipient addresses and subject lines across every tenant, so an
      // organization admin must not reach it either.
      "/api/super-admin/email-outbox",
    ];

    it("covers the whole family", async () => {
      // If routes are added later, this count drifts and someone has to look.
      const { readdirSync } = await import("fs");
      const dirs = readdirSync("src/app/api/super-admin", { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      const uncovered = dirs.filter((d) => !paths.some((p) => p.includes(`/${d}`)));
      expect(uncovered).toEqual([]);
    });

    for (const role of ["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"]) {
      it(`${role} is denied every super-admin route`, async () => {
        const user = fx.orgA.users[role] as TestUser;
        for (const p of paths) {
          const res = await api(user, p);
          expectDenied(res, `${role} reaching ${p}`);
        }
      });
    }

    it("a user who belongs to nothing is denied too", async () => {
      for (const p of paths) {
        expectDenied(await api(fx.outsider, p), `outsider reaching ${p}`);
      }
    });

    it("control: the super admin IS allowed", async () => {
      // Otherwise every denial above would pass on a route that is simply
      // broken.
      const res = await api(fx.superAdmin, "/api/super-admin/stats");
      expectAllowed(res, "super admin reading stats");
    });
  });

  // -------------------------------------------------------------------------
  // PBAC-2 / PBAC-4: a permission change must actually take effect, within the
  // documented bound. After PROD-3 that bound is a shared version counter
  // polled every 2s, plus a 5s capability-cache TTL keyed by that version.
  // -------------------------------------------------------------------------
  describe("permission changes take effect within the documented window", () => {
    it("a demoted PROJECT_ADMIN loses the ability to edit, within the TTL", async () => {
      const subject = fx.orgA.users.MANAGER;

      // Baseline: as PROJECT_MANAGER they may edit the project.
      const before = await api(subject, `/api/projects/${fx.orgA.projectId}`, {
        method: "PATCH",
        body: { description: "set while still a manager" },
      });
      expectAllowed(before, "PROJECT_MANAGER editing the project");

      // Demote them at the database level — the same state any admin action
      // would produce, without depending on another route being correct.
      await prisma.projectMember.update({
        where: { projectId_userId: { projectId: fx.orgA.projectId, userId: subject.id } },
        data: { role: "VIEWER" },
      });

      try {
        await wait(PBAC_PROPAGATION_MS + CAPABILITY_TTL_MS + 1_000);

        const after = await api(subject, `/api/projects/${fx.orgA.projectId}`, {
          method: "PATCH",
          body: { description: "should be refused after demotion" },
        });
        expectDenied(after, "a demoted user editing the project after the cache window");

        const project = await prisma.project.findUnique({ where: { id: fx.orgA.projectId } });
        expect(project?.description).toBe("set while still a manager");
      } finally {
        await prisma.projectMember.update({
          where: { projectId_userId: { projectId: fx.orgA.projectId, userId: subject.id } },
          data: { role: "PROJECT_MANAGER" },
        });
      }
    }, 30_000);

    it("a promotion also takes effect, so the window is not simply 'always deny'", async () => {
      // The mirror image. Without it, a permanently-broken permission check
      // would pass the demotion test above.
      const subject = fx.orgA.users.VIEWER;

      const before = await api(subject, `/api/projects/${fx.orgA.projectId}`, {
        method: "PATCH",
        body: { description: "viewer attempt" },
      });
      expectDenied(before, "VIEWER editing the project");

      await prisma.projectMember.update({
        where: { projectId_userId: { projectId: fx.orgA.projectId, userId: subject.id } },
        data: { role: "PROJECT_ADMIN" },
      });

      try {
        await wait(PBAC_PROPAGATION_MS + CAPABILITY_TTL_MS + 1_000);
        const after = await api(subject, `/api/projects/${fx.orgA.projectId}`, {
          method: "PATCH",
          body: { description: "set after promotion" },
        });
        expectAllowed(after, "a promoted user editing the project");
      } finally {
        await prisma.projectMember.update({
          where: { projectId_userId: { projectId: fx.orgA.projectId, userId: subject.id } },
          data: { role: "VIEWER" },
        });
      }
    }, 30_000);
  });

  // -------------------------------------------------------------------------
  // The project-administration controls (New Project, Assign, Project
  // Settings, Bulk Upload, Teams) are restricted to Super Admin, Org Admin,
  // Project Admin and Project Manager. MEMBER and VIEWER hold none of the keys.
  // -------------------------------------------------------------------------
  describe("project-administration controls are closed to MEMBER and VIEWER", () => {
    const attempts = [
      {
        what: "assign members",
        method: "POST",
        path: () => `/api/projects/${fx.orgA.projectId}/members`,
        body: () => ({ userId: fx.orgA.spareUserId, role: "MEMBER" }),
      },
      {
        what: "bulk-import members",
        method: "POST",
        path: () => `/api/projects/${fx.orgA.projectId}/members/bulk`,
        // Matches bulkMemberImportSchema: mode is validate|import, not
        // "preview". A body the schema rejects never reaches the permission
        // check, so the test would prove nothing.
        body: () => ({ csvData: "email,role\nspare@integration.test,MEMBER", mode: "validate" }),
      },
      {
        what: "import tasks",
        method: "POST",
        path: () => `/api/projects/${fx.orgA.projectId}/import`,
        body: () => ({ csvData: "title,type\nimported by a member,TASK", mode: "validate" }),
      },
    ];

    for (const role of ["MEMBER", "VIEWER"]) {
      for (const a of attempts) {
        it(`${role} cannot ${a.what}`, async () => {
          const res = await api(fx.orgA.users[role] as TestUser, a.path(), {
            method: a.method,
            body: a.body(),
          });
          expectDenied(res, `${role} attempting to ${a.what}`);
        });
      }
    }

    it("control: a PROJECT_ADMIN can assign members", async () => {
      const res = await api(fx.orgA.users.ADMIN, `/api/projects/${fx.orgA.projectId}/members`, {
        method: "POST",
        body: { userId: fx.orgA.spareUserId, role: "MEMBER" },
      });
      expectAllowed(res, "PROJECT_ADMIN assigning a member");
      await prisma.projectMember.deleteMany({
        where: { projectId: fx.orgA.projectId, userId: fx.orgA.spareUserId },
      });
    });
  });
});
