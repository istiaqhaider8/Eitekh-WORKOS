/**
 * B4 — the route families the isolation suite had never reached.
 *
 * WHY THESE ONES
 *
 * The existing suite covers projects, issues, teams, workspaces and
 * organizations. `scripts/check-isolation-coverage.mjs` counts 43 tenant-scoped
 * routes with no denial test at all. This file takes the families the plan
 * named as highest risk, and they share a shape:
 *
 *     GET /api/attachments/<id>
 *     GET /api/comments/<id>
 *     GET /api/webhooks/<id>
 *
 * The path contains no project and no organization. Nothing in the URL tells
 * the handler which tenant to check against, so the check is easy to omit and
 * impossible to notice omitting. That is exactly how
 * `GET /api/teams/[id]/members` leaked every member's email address across
 * tenants — the route had no tenant check at all, and it read perfectly.
 *
 * WHAT EACH TEST ASSERTS
 *
 * Both halves matter. A denial status alone is not enough, because a route can
 * answer 200 with a filtered body, or 403 with the data already in it. So
 * every case checks the status AND that the response does not contain the
 * other tenant's marker strings.
 *
 * The control cases are not decoration: without them a route that refuses
 * EVERYONE would pass every denial test here while being completely broken.
 */

import { PrismaClient } from "@prisma/client";
import {
  api,
  expectDenied,
  expectAllowed,
  expectBodyExcludes,
  assertSafeTestDatabase,
  type Fixture,
} from "./harness";
import { createFixture, destroyFixture } from "./fixture";

const dbUrl = assertSafeTestDatabase(process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

let fx: Fixture;

beforeAll(async () => {
  fx = await createFixture(prisma);
}, 60_000);

afterAll(async () => {
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

/** Strings that must never appear in a response to the other tenant. */
const secretsOfB = () => [
  "Secret of tenant B",
  "Comment of tenant B",
  "Subtask of tenant B",
  "Component of tenant B",
  "Field of tenant B",
  "secret-of-tenant-B.txt",
  "whsec_secret_of_tenant_B",
  "Automation of tenant B",
  fx.orgB.users.OWNER.email,
];

function expectNoLeak(res: any, what: string) {
  for (const needle of secretsOfB()) {
    expectBodyExcludes(res, needle, what);
  }
}

// ---------------------------------------------------------------------------
describe("leaf resources addressed by their own id", () => {
  /**
   * Each entry names a method the route ACTUALLY implements.
   *
   * Asking for GET everywhere produced 405s on comments/[id],
   * attachments/[id] and workflows/[id]/statuses — and a 405 says nothing
   * about isolation, because a route that does not implement the verb never
   * reaches its own guard. The test would have been asserting on the wrong
   * thing while looking like coverage.
   */
  const cases: Array<{ name: string; path: () => string; method: string; body?: unknown }> = [
    { name: "comments/[id]", method: "PATCH", body: { content: "edited by tenant A" }, path: () => `/api/comments/${fx.orgB.commentId}` },
    { name: "subtasks/[id]", method: "GET", path: () => `/api/subtasks/${fx.orgB.subtaskId}` },
    { name: "components/[id]", method: "GET", path: () => `/api/components/${fx.orgB.componentId}` },
    { name: "custom-fields/[id]", method: "GET", path: () => `/api/custom-fields/${fx.orgB.customFieldId}` },
    { name: "epics/[id]", method: "GET", path: () => `/api/epics/${fx.orgB.epicId}` },
    { name: "automations/[id]", method: "GET", path: () => `/api/automations/${fx.orgB.automationId}` },
    { name: "webhooks/[id]", method: "GET", path: () => `/api/webhooks/${fx.orgB.webhookId}` },
    { name: "workflows/[id]", method: "GET", path: () => `/api/workflows/${fx.orgB.workflowId}` },
    {
      name: "workflows/[id]/statuses",
      method: "POST",
      body: { name: "Injected by tenant A", category: "TODO", color: "#000000" },
      path: () => `/api/workflows/${fx.orgB.workflowId}/statuses`,
    },
    { name: "workflows/[id]/transitions", method: "GET", path: () => `/api/workflows/${fx.orgB.workflowId}/transitions` },
    { name: "attachments/[id]", method: "DELETE", path: () => `/api/attachments/${fx.orgB.attachmentId}` },
    {
      name: "attachments/[id]/content",
      method: "GET",
      path: () => `/api/attachments/${fx.orgB.attachmentId}/content`,
    },
  ];

  for (const c of cases) {
    it(`${c.method} ${c.name} is refused to another tenant`, async () => {
      const res = await api(fx.orgA.users.ADMIN, c.path(), { method: c.method, body: c.body });
      expectDenied(res, `org A admin reaching org B's ${c.name}`);
      expectNoLeak(res, `org B ${c.name}`);
    });
  }

  it("a refused write to another tenant's resource changes nothing", async () => {
    // A denial status is not proof the write did not happen. These two were
    // mutations in the table above; assert on the rows.
    const comment = await prisma.comment.findUnique({ where: { id: fx.orgB.commentId } });
    expect(comment?.content).toBe("Comment of tenant B");

    const attachment = await prisma.attachment.findUnique({ where: { id: fx.orgB.attachmentId } });
    expect(attachment).not.toBeNull();

    const injected = await prisma.workflowStatus.findFirst({
      where: { workflowId: fx.orgB.workflowId, name: "Injected by tenant A" },
    });
    expect(injected).toBeNull();
  });

  it("the attachment CONTENT endpoint does not serve another tenant's bytes", async () => {
    // Singled out because it is the one that returns a file rather than JSON,
    // so a body-substring check on the decoded content is the only assertion
    // that means anything. Serving a file by id alone is the shape of the
    // leaks already found twice.
    const res = await api(fx.orgA.users.ADMIN, `/api/attachments/${fx.orgB.attachmentId}/content`);
    expectDenied(res, "org A admin downloading org B's attachment");
    expect(res.text).not.toContain("ATTACHMENT BODY OF TENANT B");
  });

  it("delivery history is refused to another tenant", async () => {
    // C1 added this route. The payload column holds the tenant's own event
    // data, so a missing guard here leaks issue titles and ids wholesale.
    const res = await api(fx.orgA.users.ADMIN, `/api/webhooks/${fx.orgB.webhookId}/deliveries`);
    expectDenied(res, "org A admin reading org B's webhook deliveries");
    expectNoLeak(res, "org B webhook deliveries");
  });

  it("a delivery cannot be replayed through another tenant's webhook", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/webhooks/${fx.orgB.webhookId}/deliveries`, {
      method: "POST",
      body: { deliveryId: "cuidthatdoesnotexist000" },
    });
    expectDenied(res, "org A admin replaying through org B's webhook");
  });

  it("a webhook secret never reaches another tenant", async () => {
    // The secret is what a receiver uses to verify payloads came from us.
    // Leaking it lets another tenant forge them.
    const list = await api(fx.orgA.users.ADMIN, "/api/webhooks");
    expectBodyExcludes(list, "whsec_secret_of_tenant_B", "org A listing webhooks");
    expectBodyExcludes(list, "hooks.tenant-B.test", "org A listing webhooks");
  });

  // --- controls ------------------------------------------------------------
  const controls: Array<{ name: string; path: () => string }> = [
    { name: "epics/[id]", path: () => `/api/epics/${fx.orgA.epicId}` },
    { name: "workflows/[id]", path: () => `/api/workflows/${fx.orgA.workflowId}` },
    { name: "components/[id]", path: () => `/api/components/${fx.orgA.componentId}` },
    { name: "webhooks/[id]", path: () => `/api/webhooks/${fx.orgA.webhookId}` },
    {
      name: "attachments/[id]/content",
      path: () => `/api/attachments/${fx.orgA.attachmentId}/content`,
    },
  ];

  for (const c of controls) {
    it(`control: org A CAN read its own ${c.name}`, async () => {
      // Without these, a route that refuses everyone passes every denial test
      // above while being entirely broken. Only GET routes are listed: a
      // control that mutates would have to undo itself.
      const res = await api(fx.orgA.users.ADMIN, c.path());
      expectAllowed(res, `org A reading its own ${c.name}`);
    });
  }
});

// ---------------------------------------------------------------------------
describe("project sub-routes that export or download", () => {
  // These return bulk data by design, which makes a missing guard maximally
  // expensive: one request returns the whole project rather than one record.
  const paths = ["export", "reports/download", "import/template", "types", "velocity"];

  for (const p of paths) {
    it(`/projects/[id]/${p} is refused to another tenant`, async () => {
      const res = await api(fx.orgA.users.ADMIN, `/api/projects/${fx.orgB.projectId}/${p}`);
      expectDenied(res, `org A admin reading org B's /${p}`);
      expectNoLeak(res, `org B /${p}`);
    });
  }
});

// ---------------------------------------------------------------------------
describe("an organization id riding in a query string", () => {
  // The PBAC surface takes ?orgId= on several routes. The id is supplied by
  // the caller, which makes "trusting it" the default mistake.
  const paths = [
    "/api/pbac/roles",
    "/api/pbac/users",
    "/api/pbac/matrix",
    "/api/pbac/audit",
    "/api/pbac/inspector",
    "/api/pbac/projects",
    "/api/pbac/classic",
    "/api/pbac/export",
    "/api/orgs/" + "PLACEHOLDER" + "/roles",
  ];

  for (const p of paths) {
    it(`${p} does not honour another tenant's orgId`, async () => {
      const path = p.includes("PLACEHOLDER")
        ? `/api/orgs/${fx.orgB.orgId}/roles`
        : `${p}?orgId=${encodeURIComponent(fx.orgB.orgId)}`;

      const res = await api(fx.orgA.users.ADMIN, path);

      // Either refuse, or answer about the caller's OWN organization. What
      // must never happen is org B's data coming back.
      expect([200, 400, 401, 403, 404]).toContain(res.status);
      expectNoLeak(res, `org A asking PBAC about org B via ${path}`);
      expectBodyExcludes(res, fx.orgB.orgId, `org A asking PBAC about org B via ${path}`);
    });
  }

  it("cache refresh cannot be aimed at another tenant", async () => {
    // Named explicitly in the plan: a body-supplied orgId on an admin action.
    const res = await api(fx.orgA.users.ADMIN, "/api/admin/cache/refresh", {
      method: "POST",
      body: { orgId: fx.orgB.orgId },
    });
    expect([200, 400, 401, 403, 404]).toContain(res.status);
    expectBodyExcludes(res, fx.orgB.orgId, "org A refreshing org B's cache");
  });
});

// ---------------------------------------------------------------------------
describe("collections filtered by a caller-supplied id", () => {
  // These take the scope from a query parameter rather than the path, which
  // makes "trust the parameter" the default mistake — the same shape as the
  // PBAC orgId cases above, on ordinary project resources.

  it("automations cannot be listed for another tenant's project", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/automations?projectId=${fx.orgB.projectId}`);
    expect([200, 400, 401, 403, 404]).toContain(res.status);
    expectNoLeak(res, "org A listing org B's automations");
  });

  it("recurring tasks cannot be listed for another tenant's project", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/recurring-tasks?projectId=${fx.orgB.projectId}`);
    expect([200, 400, 401, 403, 404]).toContain(res.status);
    expectNoLeak(res, "org A listing org B's recurring tasks");
  });

  it("leave requests cannot be listed for another tenant's organization", async () => {
    const res = await api(
      fx.orgA.users.ADMIN,
      `/api/users/leave?orgId=${fx.orgB.orgId}&userId=${fx.orgB.users.MEMBER.id}`
    );
    expect([200, 400, 401, 403, 404]).toContain(res.status);
    expectNoLeak(res, "org A listing org B's leave");
  });

  it("delegations cannot be read for another tenant's issue", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/users/delegations?issueId=${fx.orgB.issueId}`);
    expect([200, 400, 401, 403, 404]).toContain(res.status);
    expectNoLeak(res, "org A reading org B's delegations");
  });

  it("workspace members are not readable by another tenant", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/workspaces/${fx.orgB.workspaceId}/members`);
    expectDenied(res, "org A admin reading org B's workspace members");
    expectNoLeak(res, "org B workspace members");
  });

  it("a user's type cannot be changed by another tenant", async () => {
    // A privilege-shaped write on a user who is not the caller's to touch.
    const before = await prisma.user.findUnique({ where: { id: fx.orgB.users.MEMBER.id } });

    // A VALID userType, deliberately. An invalid one ("CONTRACTOR") is
    // rejected by the schema at 400 before the tenant check runs, so the test
    // would pass without the guard existing — the same trap as asking for a
    // verb the route does not implement.
    const target = before?.userType === "CLIENT" ? "EMPLOYEE" : "CLIENT";
    const res = await api(fx.orgA.users.ADMIN, `/api/users/${fx.orgB.users.MEMBER.id}/type`, {
      method: "PATCH",
      body: { userType: target },
    });
    expectDenied(res, "org A admin changing org B's user type");

    const after = await prisma.user.findUnique({ where: { id: fx.orgB.users.MEMBER.id } });
    expect(after?.userType).toBe(before?.userType);
  });

  it("cache status does not report another tenant", async () => {
    const res = await api(fx.orgA.users.ADMIN, `/api/admin/cache/status?orgId=${fx.orgB.orgId}`);
    expect([200, 400, 401, 403, 404]).toContain(res.status);
    expectBodyExcludes(res, fx.orgB.orgId, "org A reading cache status for org B");
  });
});

// ---------------------------------------------------------------------------
describe("issue history sub-routes", () => {
  // Added in the A4 follow-up, after the isolation suite was written, so they
  // were never covered by it — the exact gap the coverage checker exists for.
  const paths = ["activity", "comments", "time-entries"];

  for (const p of paths) {
    it(`/issues/[id]/${p} is refused to another tenant`, async () => {
      const res = await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgB.issueId}/${p}`);
      expectDenied(res, `org A admin reading org B's issue ${p}`);
      expectNoLeak(res, `org B issue ${p}`);
    });
  }
});
