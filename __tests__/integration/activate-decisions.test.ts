/**
 * SAP Activate increments 9 and 10 — modules, scope items, decisions, deltas
 * and generated work.
 *
 * The generation RULES are unit-tested in __tests__/activate-generation.test.ts,
 * where they belong: they are a pure function and deserve to be tested without
 * a server. This suite covers what only a running system can show — that the
 * catalogue is reachable only through the template a project was stamped with,
 * that a decision cannot be recorded against another tenant's scope item, and
 * that generating twice does not double the backlog.
 *
 * The accept case is asserted first in every block.
 */

import { PrismaClient } from "@prisma/client";
import { api, expectDenied, expectAllowed, waitForServer, type Fixture } from "./harness";
import { createFixture, destroyFixture } from "./fixture";

const prisma = new PrismaClient();
let fx: Fixture;

/** Ids from org A's template, read back after Activate is enabled. */
let moduleCoreId: string;
let moduleOptionalId: string;
let siPermissionsId: string; // tagged ux
let siReportingId: string; // in the optional module
/** A scope item belonging to a template org A cannot see. */
let foreignScopeItemId: string;
/** The module holding one scope item per decision, for the status cases. */
let statusModuleId: string;

async function templateIdOf(projectId: string) {
  const p = await prisma.activateProfile.findUnique({
    where: { projectId },
    select: { templateId: true },
  });
  return p!.templateId!;
}

beforeAll(async () => {
  await waitForServer();
  fx = await createFixture(prisma);

  for (const side of ["orgA", "orgB"] as const) {
    await api(fx[side].users.OWNER, `/api/projects/${fx[side].projectId}/activate`, {
      method: "POST",
      body: { enabled: true },
    });
  }

  /**
   * Modules and scope items are authored onto the BUILT-IN template, which
   * both projects share. That is deliberate: it makes the isolation tests
   * below meaningful, because the catalogue is genuinely common and the only
   * thing separating the tenants is their decisions.
   */
  const templateId = await templateIdOf(fx.orgA.projectId);

  const core = await prisma.templateModule.create({
    data: {
      templateId,
      key: "TEST_CORE",
      name: "Core",
      position: 90,
      scopeItems: {
        create: [
          {
            code: "SI-T-01",
            name: "Role-based permissions",
            workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
            tags: "ux",
            position: 0,
          },
        ],
      },
    },
    select: { id: true, scopeItems: { select: { id: true, code: true } } },
  });
  moduleCoreId = core.id;
  siPermissionsId = core.scopeItems[0].id;

  const optional = await prisma.templateModule.create({
    data: {
      templateId,
      key: "TEST_OPTIONAL",
      name: "Optional",
      position: 91,
      scopeItems: {
        create: [
          { code: "SI-T-09", name: "Reporting", workstreamKey: "ANALYTICS", position: 0 },
        ],
      },
    },
    select: { id: true, scopeItems: { select: { id: true } } },
  });
  moduleOptionalId = optional.id;
  siReportingId = optional.scopeItems[0].id;

  // A scope item on a template neither project is stamped with.
  const foreignTemplate = await prisma.methodTemplate.create({
    data: {
      orgId: fx.orgB.orgId,
      key: "FOREIGN_ONLY",
      name: "Unreachable",
      version: 1,
      status: "PUBLISHED",
      modules: {
        create: [
          {
            key: "F",
            name: "Foreign",
            scopeItems: { create: [{ code: "SI-F-01", name: "Secret item", workstreamKey: "TESTING" }] },
          },
        ],
      },
    },
    select: { modules: { select: { scopeItems: { select: { id: true } } } } },
  });
  foreignScopeItemId = foreignTemplate.modules[0].scopeItems[0].id;
}, 240_000);

afterAll(async () => {
  await prisma.templateModule.deleteMany({
    where: { id: { in: [moduleCoreId, moduleOptionalId, statusModuleId].filter(Boolean) } },
  });
  await prisma.methodTemplate.deleteMany({ where: { key: "FOREIGN_ONLY" } });
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("The scope-item catalogue", () => {
  it("shows the modules and items of the template this project was stamped with", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items`
    );
    expectAllowed(res, "the owner reading the catalogue");
    expect(res.body.enabled).toBe(true);

    const codes = res.body.scopeItems.map((i: any) => i.code);
    expect(codes).toContain("SI-T-01");
    expect(codes).toContain("SI-T-09");
    // Tags arrive parsed, so a client need not know the storage format.
    const perms = res.body.scopeItems.find((i: any) => i.code === "SI-T-01");
    expect(perms.tags).toEqual(["ux"]);
    expect(perms.decision).toBeNull();
  });

  it("never shows an item from a template this project is not stamped with", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items`
    );
    expect(JSON.stringify(res.body)).not.toContain("Secret item");
    expect(res.body.scopeItems.map((i: any) => i.id)).not.toContain(foreignScopeItemId);
  });

  it("refuses a cross-tenant caller, an outsider and an anonymous one", async () => {
    const path = `/api/projects/${fx.orgA.projectId}/activate/scope-items`;
    expectDenied(await api(fx.orgB.users.OWNER, path), "org B reading org A's catalogue");
    expectDenied(await api(fx.outsider, path), "an outsider reading the catalogue");
    expect((await api(null, path)).status).toBe(401);
  });

  it("allows a VIEWER to read the catalogue but not to decide against it", async () => {
    // Asserted a denial until the permission matrix was fixed, when no
    // project-scoped role held any activate key. Reading what a workshop
    // will walk through is `activate:view`; recording its outcome is
    // `activate:manage_deliverables`.
    const path = `/api/projects/${fx.orgA.projectId}/activate/scope-items`;
    expectAllowed(await api(fx.orgA.users.VIEWER, path), "a VIEWER reading the catalogue");

    const decide = await api(
      fx.orgA.users.VIEWER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${siPermissionsId}`,
      { method: "PUT", body: { decision: "ADOPT" } }
    );
    expectDenied(decide, "a VIEWER recording a decision");
  });
});

// ---------------------------------------------------------------------------

describe("Modules and waves", () => {
  it("defaults every module to in scope", async () => {
    const res = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate/modules`);
    expectAllowed(res, "the owner listing modules");
    const core = res.body.modules.find((m: any) => m.key === "TEST_CORE");
    // Defaulting the other way would make enabling Activate produce an empty
    // workshop, and the first act of every project would be to switch them on.
    expect(core.inScope).toBe(true);
    expect(core.waveNumber).toBeNull();
  });

  it("switches a module out and records its wave", async () => {
    const res = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate/modules`, {
      method: "PATCH",
      body: { moduleId: moduleOptionalId, inScope: false, waveNumber: 2 },
    });
    expect(res.status).toBe(200);
    expect(res.body.module.inScope).toBe(false);
    // "Not doing it" and "not doing it yet" are different answers.
    expect(res.body.module.waveNumber).toBe(2);
  });

  it("drops an out-of-scope module from the denominator", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items`
    );
    const reporting = res.body.scopeItems.find((i: any) => i.code === "SI-T-09");
    expect(reporting.inScope).toBe(false);
    // A project measured against scope it is not doing reads as behind when
    // it is not.
    const inScopeCodes = res.body.scopeItems.filter((i: any) => i.inScope).map((i: any) => i.code);
    expect(inScopeCodes).not.toContain("SI-T-09");
    expect(res.body.total).toBe(inScopeCodes.length);
  });

  it("refuses a module that is not part of this project's methodology", async () => {
    const res = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate/modules`, {
      method: "PATCH",
      body: { moduleId: "clnotarealmoduleid", inScope: false },
    });
    expect(res.status).toBe(400);
  });

  it("refuses a VIEWER and a cross-tenant caller", async () => {
    const path = `/api/projects/${fx.orgA.projectId}/activate/modules`;
    expectDenied(
      await api(fx.orgA.users.VIEWER, path, { method: "PATCH", body: { moduleId: moduleCoreId } }),
      "a VIEWER changing module scope"
    );
    expectDenied(
      await api(fx.orgB.users.OWNER, path, { method: "PATCH", body: { moduleId: moduleCoreId } }),
      "org B changing org A's module scope"
    );
  });
});

// ---------------------------------------------------------------------------

describe("Recording a decision", () => {
  it("records the decision and its deltas in one request", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${siPermissionsId}`,
      {
        method: "PUT",
        body: {
          decision: "CONFIGURE",
          status: "AGREED",
          rationale: "Standard model accepted; groups need tailoring.",
          deltas: [
            { title: "Permission group structure", priority: "MUST", size: "L" },
            { title: "Matrix manager rule", buildType: "BUSINESS_RULE", priority: "SHOULD" },
          ],
        },
      }
    );
    expect(res.status).toBe(201);
    expect(res.body.decision.decision).toBe("CONFIGURE");
    expect(res.body.decision.deltas).toHaveLength(2);
    // AGREED stamps who and when; DRAFT must not.
    expect(res.body.decision.decidedById).toBe(fx.orgA.users.OWNER.id);
    expect(res.body.decision.decidedAt).not.toBeNull();
  });

  it("clears the sign-off stamp when it goes back to draft", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${siPermissionsId}`,
      { method: "PUT", body: { decision: "CONFIGURE", status: "DRAFT" } }
    );
    expect(res.status).toBe(200);
    // The field must never claim a sign-off that was undone.
    expect(res.body.decision.decidedById).toBeNull();
    expect(res.body.decision.decidedAt).toBeNull();
  });

  it("keeps a delta's id across an edit, so generated work stays linked", async () => {
    const first = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${siPermissionsId}`,
      { method: "PUT", body: { decision: "CONFIGURE", deltas: [{ title: "Keep me" }] } }
    );
    const deltaId = first.body.decision.deltas[0].id;

    const second = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${siPermissionsId}`,
      {
        method: "PUT",
        body: {
          decision: "CONFIGURE",
          deltas: [{ id: deltaId, title: "Keep me, renamed" }, { title: "And a new one" }],
        },
      }
    );
    expect(second.status).toBe(200);
    const ids = second.body.decision.deltas.map((d: any) => d.id);
    // Rebuilding the list would have destroyed the link to anything already
    // generated from this delta, and nobody would notice until the backlog
    // doubled.
    expect(ids).toContain(deltaId);
    expect(second.body.decision.deltas).toHaveLength(2);
  });

  it("deletes a delta that is absent from the payload", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${siPermissionsId}`,
      { method: "PUT", body: { decision: "CONFIGURE", deltas: [{ title: "Only one now" }] } }
    );
    expect(res.body.decision.deltas).toHaveLength(1);
  });

  it("refuses a stale version with 409", async () => {
    const current = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items`
    );
    const version = current.body.scopeItems.find((i: any) => i.id === siPermissionsId).decision
      .version;

    const ok = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${siPermissionsId}`,
      { method: "PUT", body: { decision: "CONFIGURE", version } }
    );
    expect(ok.status).toBe(200);

    const stale = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${siPermissionsId}`,
      { method: "PUT", body: { decision: "EXTEND", version } }
    );
    expect(stale.status).toBe(409);
  });

  it("refuses a scope item from a template this project is not stamped with", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${foreignScopeItemId}`,
      { method: "PUT", body: { decision: "ADOPT" } }
    );
    // 404, indistinguishable from a scope item that does not exist.
    expect(res.status).toBe(404);
    expect(
      await prisma.activateDecision.count({ where: { scopeItemId: foreignScopeItemId } })
    ).toBe(0);
  });

  it("refuses an unknown decision value with 400, not 500", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${siPermissionsId}`,
      { method: "PUT", body: { decision: "PROBABLY_FINE" } }
    );
    expect(res.status).toBe(400);
  });

  it("refuses a delta owner who is not a member of this project", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${siPermissionsId}`,
      {
        method: "PUT",
        body: {
          decision: "CONFIGURE",
          deltas: [{ title: "Owned by an outsider", ownerId: fx.orgB.users.OWNER.id }],
        },
      }
    );
    expect(res.status).toBe(400);
  });

  it("refuses a VIEWER and a cross-tenant caller", async () => {
    const path = `/api/projects/${fx.orgA.projectId}/activate/decisions/${siPermissionsId}`;
    expectDenied(
      await api(fx.orgA.users.VIEWER, path, { method: "PUT", body: { decision: "ADOPT" } }),
      "a VIEWER recording a decision"
    );
    expectDenied(
      await api(fx.orgB.users.OWNER, path, { method: "PUT", body: { decision: "ADOPT" } }),
      "org B recording a decision on org A's project"
    );
  });

  it("keeps the two tenants' decisions apart on the same shared scope item", async () => {
    const b = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgB.projectId}/activate/decisions/${siPermissionsId}`,
      { method: "PUT", body: { decision: "ADOPT" } }
    );
    expect(b.status).toBe(201);

    const aView = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items`
    );
    const aDecision = aView.body.scopeItems.find((i: any) => i.id === siPermissionsId).decision;
    // The catalogue is shared; the decisions are not.
    expect(aDecision.decision).toBe("CONFIGURE");
  });
});

// ---------------------------------------------------------------------------

describe("Generating the backlog", () => {
  it("previews without creating anything", async () => {
    const before = await prisma.issue.count({ where: { projectId: fx.orgA.projectId } });

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/backlog`
    );
    expectAllowed(res, "the owner previewing the backlog");
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.pending).toBeGreaterThan(0);

    // A workshop is where people change their minds mid-sentence, so nothing
    // is created until somebody says so.
    expect(await prisma.issue.count({ where: { projectId: fx.orgA.projectId } })).toBe(before);
  });

  it("creates the issues and links them as deliverables", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/backlog`,
      { method: "POST", body: {} }
    );
    expect(res.status).toBe(201);
    expect(res.body.created).toBeGreaterThan(0);

    const link = await prisma.activateDeliverableLink.findFirst({
      where: { phase: { projectId: fx.orgA.projectId }, originKey: { not: null } },
      select: {
        originKey: true,
        fitGapStatus: true,
        issue: { select: { issueKey: true, projectId: true } },
      },
    });
    expect(link?.issue.projectId).toBe(fx.orgA.projectId);
    // The generated issue is an ordinary issue on the board, not a parallel
    // world with its own numbering.
    expect(link?.issue.issueKey).toMatch(/^[A-Z0-9]+-\d+$/);
  });

  it("is idempotent: generating twice creates nothing the second time", async () => {
    const countAfterFirst = await prisma.issue.count({ where: { projectId: fx.orgA.projectId } });

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/backlog`,
      { method: "POST", body: {} }
    );
    // 200, not 201: nothing was created, and a run that creates nothing has
    // not created anything. The first run returned 201 because it did.
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    // The unique originKey is what makes this true without any bookkeeping
    // table remembering what was already made.
    expect(await prisma.issue.count({ where: { projectId: fx.orgA.projectId } })).toBe(
      countAfterFirst
    );
  });

  it("generates nothing for a module that is out of scope", async () => {
    await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${siReportingId}`,
      { method: "PUT", body: { decision: "EXTEND", deltas: [{ title: "Out of scope work" }] } }
    );

    const preview = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/backlog`
    );
    // The optional module was switched out earlier in this suite.
    expect(preview.body.items.map((i: any) => i.scopeItemId)).not.toContain(siReportingId);
  });

  it("includes it again once the module is switched back in", async () => {
    await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate/modules`, {
      method: "PATCH",
      body: { moduleId: moduleOptionalId, inScope: true },
    });
    const preview = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/backlog`
    );
    // The accept case, so the previous test cannot pass because of a typo.
    expect(preview.body.items.map((i: any) => i.scopeItemId)).toContain(siReportingId);
  });

  it("refuses a VIEWER, a cross-tenant caller and an anonymous one", async () => {
    const path = `/api/projects/${fx.orgA.projectId}/activate/backlog`;
    expectDenied(
      await api(fx.orgA.users.VIEWER, path, { method: "POST", body: {} }),
      "a VIEWER generating a backlog"
    );
    expectDenied(await api(fx.orgB.users.OWNER, path), "org B reading org A's backlog");
    expect((await api(null, path)).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------

/**
 * Scope items a project adds for itself.
 *
 * The thing worth proving here is not that a row can be created — it is that
 * the row lands in the PROJECT and not in the shared catalogue. The built-in
 * template and every content pack are one set of rows read by every tenant
 * stamped with them, so an item written there would appear in front of all of
 * them. Both tenants in this fixture are stamped with the same built-in
 * template, which is exactly what makes the leak test below meaningful.
 */
describe("Custom scope items", () => {
  let customId = "";
  let secondId = "";

  it("lets a project manager add one, and gives it a generated code", async () => {
    const res = await api(
      fx.orgA.users.MANAGER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items`,
      {
        method: "POST",
        body: {
          name: "Works council reporting pack",
          workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
          userFacing: true,
        },
      }
    );
    expectAllowed(res, "a PROJECT_MANAGER adding a scope item");
    expect(res.status).toBe(201);
    customId = res.body.scopeItem.id;
    // Generated, not supplied: a decision log cites an item by its code, so
    // two people in one workshop must not be able to mint the same one.
    expect(res.body.scopeItem.code).toMatch(/^CUS-\d\d$/);
    expect(res.body.scopeItem.custom).toBe(true);
  });

  it("writes it to the project, never to the shared template", async () => {
    const row = await prisma.activateCustomScopeItem.findUnique({
      where: { id: customId },
      select: { projectId: true },
    });
    expect(row?.projectId).toBe(fx.orgA.projectId);
    // The shared catalogue must be untouched. If this ever fails, every tenant
    // seeded from the built-in template is looking at one customer's item.
    expect(
      await prisma.templateScopeItem.count({ where: { name: "Works council reporting pack" } })
    ).toBe(0);
  });

  it("shows it in this project's catalogue, under a grouping of its own", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items`
    );
    const item = res.body.scopeItems.find((i: any) => i.id === customId);
    expect(item).toBeDefined();
    expect(item.custom).toBe(true);
    expect(item.tags).toEqual(["ux"]);
    expect(item.inScope).toBe(true);
    // Template items still report what they are, so a client knows which of
    // the two it may edit.
    expect(res.body.scopeItems.find((i: any) => i.code === "SI-T-01").custom).toBe(false);
    expect(res.body.modules.map((m: any) => m.key)).toContain("CUSTOM");
    // The workstreams ride along because the add form needs exactly the set
    // the POST validates against.
    expect(res.body.workstreams.map((w: any) => w.key)).toContain(
      "APPLICATION_DESIGN_CONFIGURATION"
    );
  });

  it("never shows it to the other tenant, which shares the same template", async () => {
    const res = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgB.projectId}/activate/scope-items`
    );
    expect(res.body.scopeItems.map((i: any) => i.id)).not.toContain(customId);
    expect(JSON.stringify(res.body)).not.toContain("Works council reporting pack");
  });

  it("refuses a workstream or a module that is not this project's", async () => {
    const path = `/api/projects/${fx.orgA.projectId}/activate/scope-items`;
    const badWorkstream = await api(fx.orgA.users.MANAGER, path, {
      method: "POST",
      body: { name: "Filed nowhere real", workstreamKey: "NOT_A_WORKSTREAM" },
    });
    expect(badWorkstream.status).toBe(400);

    // A module id arrives in the BODY, where the path guard cannot see it.
    const foreignModule = await prisma.templateModule.findFirst({
      where: { template: { key: "FOREIGN_ONLY" } },
      select: { id: true },
    });
    const badModule = await api(fx.orgA.users.MANAGER, path, {
      method: "POST",
      body: {
        name: "Filed in another tenant",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        moduleId: foreignModule!.id,
      },
    });
    expect(badModule.status).toBe(400);
    expect(
      await prisma.activateCustomScopeItem.count({
        where: { projectId: fx.orgA.projectId, moduleId: foreignModule!.id },
      })
    ).toBe(0);
  });

  it("refuses a MEMBER, a VIEWER, a cross-tenant caller and an anonymous one", async () => {
    const path = `/api/projects/${fx.orgA.projectId}/activate/scope-items`;
    const body = { name: "Should never exist", workstreamKey: "APPLICATION_DESIGN_CONFIGURATION" };
    expectDenied(
      await api(fx.orgA.users.MEMBER, path, { method: "POST", body }),
      "a MEMBER adding a scope item"
    );
    expectDenied(
      await api(fx.orgA.users.VIEWER, path, { method: "POST", body }),
      "a VIEWER adding a scope item"
    );
    expectDenied(
      await api(fx.orgB.users.OWNER, path, { method: "POST", body }),
      "org B adding a scope item to org A's project"
    );
    expect((await api(null, path, { method: "POST", body })).status).toBe(401);
    expect(
      await prisma.activateCustomScopeItem.count({ where: { name: "Should never exist" } })
    ).toBe(0);
  });

  it("carries a decision and generates work like any other scope item", async () => {
    const decide = await api(
      fx.orgA.users.MANAGER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${customId}`,
      {
        method: "PUT",
        body: {
          decision: "EXTEND",
          status: "AGREED",
          rationale: "Required by the works council agreement.",
          deltas: [{ title: "Quarterly headcount extract", priority: "MUST" }],
        },
      }
    );
    expect(decide.status).toBe(201);

    const preview = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/backlog`
    );
    // A project's own item is not a second-class citizen: it reaches the
    // backlog through the same rules as the catalogue's.
    expect(preview.body.items.map((i: any) => i.scopeItemId)).toContain(customId);
  });

  it("renames one, and leaves a template item alone", async () => {
    const res = await api(
      fx.orgA.users.MANAGER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items/${customId}`,
      { method: "PATCH", body: { name: "Works council reporting pack (annual)" } }
    );
    expectAllowed(res, "a PROJECT_MANAGER renaming its own scope item");
    expect(res.body.scopeItem.name).toBe("Works council reporting pack (annual)");

    // A template item is shared, so editing it through this route is not a
    // thing that exists — 404, because the project has no such item of its own.
    const template = await api(
      fx.orgA.users.MANAGER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items/${siPermissionsId}`,
      { method: "PATCH", body: { name: "Renamed for everybody" } }
    );
    expect(template.status).toBe(404);
    expect(
      await prisma.templateScopeItem.findUnique({
        where: { id: siPermissionsId },
        select: { name: true },
      })
    ).toEqual({ name: "Role-based permissions" });
  });

  it("refuses removal while a decision stands, and says why", async () => {
    const res = await api(
      fx.orgA.users.MANAGER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items/${customId}`,
      { method: "DELETE" }
    );
    // 409, not 403: the caller has the permission, the record is in the wrong
    // state, and there is an obvious way forward. Deleting it would have left
    // the decision pointing at nothing and the catalogue would simply stop
    // showing it — a record disappearing with nobody told.
    expect(res.status).toBe(409);
    expect(await prisma.activateCustomScopeItem.count({ where: { id: customId } })).toBe(1);
  });

  it("removes one that nobody has decided", async () => {
    const created = await api(
      fx.orgA.users.MANAGER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items`,
      {
        method: "POST",
        body: { name: "Added by mistake", workstreamKey: "TESTING" },
      }
    );
    expect(created.status).toBe(201);
    secondId = created.body.scopeItem.id;
    // The sequence continues past what exists, so a code is never silently
    // reused for something else.
    expect(created.body.scopeItem.code).not.toBe("CUS-01");

    const res = await api(
      fx.orgA.users.MANAGER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items/${secondId}`,
      { method: "DELETE" }
    );
    expectAllowed(res, "a PROJECT_MANAGER removing an undecided item it added");
    expect(await prisma.activateCustomScopeItem.count({ where: { id: secondId } })).toBe(0);
  });

  it("never hands a removed item's code to a new one, even with none left", async () => {
    /**
     * The regression this pins was found by live testing, not by this suite:
     * the first implementation derived the next code from the highest one that
     * EXISTED, so removing every custom item reset the sequence to CUS-01 and
     * a workshop's minutes citing CUS-01 would then name a different item. The
     * earlier tests all passed because one item always remained.
     */
    const before = await prisma.activateCustomScopeItem.findMany({
      where: { projectId: fx.orgB.projectId },
      select: { id: true },
    });
    expect(before).toHaveLength(0); // org B has added none, so this starts clean

    const first = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgB.projectId}/activate/scope-items`,
      { method: "POST", body: { name: "The only one", workstreamKey: "TESTING" } }
    );
    expect(first.status).toBe(201);
    expect(first.body.scopeItem.code).toBe("CUS-01");

    const removed = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgB.projectId}/activate/scope-items/${first.body.scopeItem.id}`,
      { method: "DELETE" }
    );
    expect(removed.status).toBe(200);
    expect(
      await prisma.activateCustomScopeItem.count({ where: { projectId: fx.orgB.projectId } })
    ).toBe(0);

    const next = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgB.projectId}/activate/scope-items`,
      { method: "POST", body: { name: "Its successor", workstreamKey: "TESTING" } }
    );
    expect(next.status).toBe(201);
    expect(next.body.scopeItem.code).toBe("CUS-02");
  });

  it("refuses an edit or a removal from another tenant, a VIEWER and an anonymous caller", async () => {
    const path = `/api/projects/${fx.orgA.projectId}/activate/scope-items/${customId}`;
    expectDenied(
      await api(fx.orgB.users.OWNER, path, { method: "PATCH", body: { name: "Theirs now" } }),
      "org B editing org A's scope item"
    );
    expectDenied(await api(fx.orgB.users.OWNER, path, { method: "DELETE" }), "org B removing it");
    expectDenied(
      await api(fx.orgA.users.VIEWER, path, { method: "PATCH", body: { name: "Viewer edit" } }),
      "a VIEWER editing a scope item"
    );
    expect((await api(null, path, { method: "DELETE" })).status).toBe(401);

    // Reaching org A's item through org B's OWN project must also fail, since
    // that path guard passes and only the projectId scoping stands between
    // them.
    const throughOwnProject = await api(
      fx.orgB.users.OWNER,
      `/api/projects/${fx.orgB.projectId}/activate/scope-items/${customId}`,
      { method: "DELETE" }
    );
    expect(throughOwnProject.status).toBe(404);
    expect(await prisma.activateCustomScopeItem.count({ where: { id: customId } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------

/**
 * The fit-to-standard task status, through the running system.
 *
 * The mapping itself is unit-tested against the pure function. What only a
 * real server can show is that the API actually returns it, that it is
 * derived from the decision currently stored rather than from something
 * cached at write time, and that generated work lands in the project's
 * Backlog status and not wherever the workflow happens to start.
 */
describe("Fit-to-standard task status", () => {
  /** A scope item per decision, so the six cases do not overwrite each other. */
  let caseItems: Record<string, string> = {};

  beforeAll(async () => {
    const mod = await prisma.templateModule.create({
      data: {
        templateId: await templateIdOf(fx.orgA.projectId),
        key: "TEST_STATUS",
        name: "Status cases",
        position: 95,
        scopeItems: {
          create: [
            { code: "SI-ST-ADOPT", name: "Adopt case", workstreamKey: "TESTING", position: 0 },
            { code: "SI-ST-DEFER", name: "Defer case", workstreamKey: "TESTING", position: 1 },
            { code: "SI-ST-OOS", name: "Out of scope case", workstreamKey: "TESTING", position: 2 },
            { code: "SI-ST-CONF", name: "Configure case", workstreamKey: "TESTING", position: 3 },
            { code: "SI-ST-EXT", name: "Extend case", workstreamKey: "TESTING", position: 4 },
            { code: "SI-ST-INT", name: "Integrate case", workstreamKey: "TESTING", position: 5 },
          ],
        },
      },
      select: { id: true, scopeItems: { select: { id: true, code: true } } },
    });
    statusModuleId = mod.id;
    caseItems = Object.fromEntries(mod.scopeItems.map((s) => [s.code, s.id]));
  }, 120_000);

  const CASES: Array<[string, string, string]> = [
    // code, decision, expected task status
    ["SI-ST-ADOPT", "ADOPT", "DONE"],
    ["SI-ST-DEFER", "DEFER", "DONE"],
    ["SI-ST-OOS", "OUT_OF_SCOPE", "DONE"],
    ["SI-ST-CONF", "CONFIGURE", "BACKLOG"],
    ["SI-ST-EXT", "EXTEND", "BACKLOG"],
    ["SI-ST-INT", "INTEGRATE", "BACKLOG"],
  ];

  it("reports null for a scope item nobody has decided", async () => {
    // The accept case first: before any decision is recorded, the field must
    // exist and say nothing. A test suite that only checked decided items
    // would pass just as happily if the field were hard-coded.
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items`
    );
    expectAllowed(res, "reading the catalogue before deciding");
    const undecided = res.body.scopeItems.find((i: any) => i.code === "SI-ST-ADOPT");
    expect(undecided).toBeDefined();
    expect(undecided.decision).toBeNull();
    expect(undecided.taskStatus).toBeNull();
  });

  it.each(CASES)("records %s and reports the task status as %s", async (code, decision, expected) => {
    const scopeItemId = caseItems[code];

    const saved = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${scopeItemId}`,
      {
        method: "PUT",
        body: {
          decision,
          status: "AGREED",
          rationale: `Recorded for the ${decision} status case.`,
          // A delta on every decision that accepts one, so the deferred case
          // genuinely has work behind it.
          deltas: ["CONFIGURE", "EXTEND", "INTEGRATE", "DEFER"].includes(decision)
            ? [{ title: `${code} build work`, priority: "SHOULD" }]
            : [],
        },
      }
    );
    expect(saved.status).toBe(201);
    // The save response carries it, so a client need not refetch to show it.
    expect(saved.body.decision.taskStatus).toBe(expected);

    const catalogue = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items`
    );
    const item = catalogue.body.scopeItems.find((i: any) => i.code === code);
    expect(item.decision.decision).toBe(decision);
    expect(item.taskStatus).toBe(expected);
  });

  it("re-derives the status when a decision changes, rather than remembering the old one", async () => {
    const scopeItemId = caseItems["SI-ST-CONF"];
    const path = `/api/projects/${fx.orgA.projectId}/activate/decisions/${scopeItemId}`;

    // CONFIGURE -> BACKLOG was asserted above. Change it to ADOPT.
    const changed = await api(fx.orgA.users.OWNER, path, {
      method: "PUT",
      body: { decision: "ADOPT", status: "AGREED" },
    });
    expect(changed.status).toBe(200);
    expect(changed.body.decision.taskStatus).toBe("DONE");

    const catalogue = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items`
    );
    // A stored copy would still say BACKLOG here. This is the assertion that
    // makes the derived-not-stored decision worth having.
    expect(
      catalogue.body.scopeItems.find((i: any) => i.code === "SI-ST-CONF").taskStatus
    ).toBe("DONE");

    // Put it back, so the backlog assertions below see a build decision.
    await api(fx.orgA.users.OWNER, path, {
      method: "PUT",
      body: {
        decision: "CONFIGURE",
        status: "AGREED",
        deltas: [{ title: "SI-ST-CONF build work", priority: "SHOULD" }],
      },
    });
  });

  it("drops the status back to null when the decision is withdrawn", async () => {
    const scopeItemId = caseItems["SI-ST-OOS"];
    const del = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${scopeItemId}`,
      { method: "DELETE" }
    );
    expect([200, 204]).toContain(del.status);

    const catalogue = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/scope-items`
    );
    expect(
      catalogue.body.scopeItems.find((i: any) => i.code === "SI-ST-OOS").taskStatus
    ).toBeNull();
  });

  it("carries the originating scope item's status onto every planned item", async () => {
    const preview = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/backlog`
    );
    expectAllowed(preview, "previewing the backlog");

    const deferred = preview.body.items.filter((i: any) => i.scopeItemCode === "SI-ST-DEFER");
    const configured = preview.body.items.filter((i: any) => i.scopeItemCode === "SI-ST-CONF");

    // Deferred work still reaches the backlog -- that is the whole point of
    // separating "the decision is settled" from "there is work to do".
    expect(deferred.length).toBeGreaterThan(0);
    expect(deferred.every((i: any) => i.decisionTaskStatus === "DONE")).toBe(true);
    expect(deferred.every((i: any) => i.targetPhaseKey === "RUN")).toBe(true);

    expect(configured.length).toBeGreaterThan(0);
    expect(configured.every((i: any) => i.decisionTaskStatus === "BACKLOG")).toBe(true);
  });

  /**
   * Both branches of the status lookup, against real workflows.
   *
   * This fixture's project has NO Backlog column — To Do, In Progress, Done,
   * the shape a Kanban project ships with. That is the fallback case and it
   * is tested first, because the first version of this test assumed a Scrum
   * workflow, failed, and the honest fix was to test the behaviour that
   * actually exists rather than to loosen the assertion.
   */
  it("falls back to the first column when the workflow has no Backlog", async () => {
    const before = await prisma.issue.count({ where: { projectId: fx.orgA.projectId } });
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/backlog`,
      { method: "POST", body: {} }
    );
    expect([200, 201]).toContain(res.status);
    expect(await prisma.issue.count({ where: { projectId: fx.orgA.projectId } })).toBeGreaterThan(
      before
    );

    // Nothing was invented in somebody's workflow to make room for this.
    expect(
      await prisma.workflowStatus.count({
        where: { workflow: { projectId: fx.orgA.projectId }, category: "BACKLOG" },
      })
    ).toBe(0);

    const generated = await prisma.activateDeliverableLink.findMany({
      where: {
        phase: { projectId: fx.orgA.projectId },
        originKey: { not: null },
        fitGapStatus: { in: ["DEFER", "CONFIGURE", "EXTEND", "INTEGRATE"] },
      },
      select: {
        fitGapStatus: true,
        issue: { select: { issueKey: true, status: { select: { name: true, position: true } } } },
      },
    });
    expect(generated.length).toBeGreaterThan(0);
    for (const link of generated) {
      // The earliest column, which is where a manually created issue starts
      // too — so generated work is not somewhere surprising on the board.
      expect(link.issue.status.name).toBe("To Do");
    }

    // Deferred work is created like any other, NOT as Done: the decision
    // being settled does not mean anybody has built the thing, and creating
    // it complete would count unstarted work towards phase readiness.
    const deferred = generated.filter((l) => l.fitGapStatus === "DEFER");
    expect(deferred.length).toBeGreaterThan(0);
    expect(deferred.every((l) => l.issue.status.name !== "Done")).toBe(true);
  });

  it("uses the Backlog column when the project has one", async () => {
    // Give this project the column a Scrum project ships with, then generate
    // one more item and watch where it lands. Without this half, the test
    // above would pass just as happily if the lookup ignored categories
    // entirely and always took the first status.
    const workflow = await prisma.workflow.findFirst({
      where: { projectId: fx.orgA.projectId },
      select: { id: true },
    });
    await prisma.workflowStatus.create({
      data: {
        workflowId: workflow!.id,
        name: "Backlog",
        category: "BACKLOG",
        position: 0,
        color: "#64748b",
      },
    });

    // A new delta means a new originKey, which means exactly one new issue.
    const scopeItemId = caseItems["SI-ST-EXT"];
    const saved = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/decisions/${scopeItemId}`,
      {
        method: "PUT",
        body: {
          decision: "EXTEND",
          status: "AGREED",
          deltas: [
            { title: "SI-ST-EXT build work", priority: "SHOULD" },
            { title: "SI-ST-EXT second build item", priority: "SHOULD" },
          ],
        },
      }
    );
    expect(saved.status).toBe(200);

    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/backlog`,
      { method: "POST", body: {} }
    );
    expect(res.status).toBe(201);
    expect(res.body.created).toBeGreaterThan(0);

    const newest = await prisma.issue.findFirst({
      where: { projectId: fx.orgA.projectId, title: "SI-ST-EXT second build item" },
      select: { status: { select: { name: true, category: true } } },
    });
    expect(newest?.status.category).toBe("BACKLOG");
    expect(newest?.status.name).toBe("Backlog");
  });

  it("still generates nothing at all from an adopted decision", async () => {
    // The regression that matters in the other direction: the status work
    // must not have turned ADOPT into something that produces items.
    const preview = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/backlog`
    );
    expect(preview.body.items.some((i: any) => i.scopeItemCode === "SI-ST-ADOPT")).toBe(false);
  });
});
