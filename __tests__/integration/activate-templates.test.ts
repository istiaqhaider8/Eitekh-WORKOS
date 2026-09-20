/**
 * SAP Activate increment 8 — methodology templates and variants.
 *
 * THE EXIT GATE IS THE FIRST BLOCK.
 *
 * Enabling Activate now seeds a project from template ROWS instead of from a
 * TypeScript constant. The whole claim of this increment is that this changed
 * nothing about what a project gets, so the test compares the seeded rows
 * against the constant itself — key, name, position, gate name and
 * description, and every criterion in order. Asserting "six phases appeared"
 * would pass just as happily if the wording had drifted.
 *
 * The other 123 Activate tests passing unchanged is the second half of that
 * proof, and it costs nothing to keep.
 */

import { PrismaClient } from "@prisma/client";
import { api, expectDenied, expectAllowed, waitForServer, type Fixture } from "./harness";
import { createFixture, destroyFixture } from "./fixture";
import { ACTIVATE_PHASES, ACTIVATE_WORKSTREAMS } from "@/lib/activate";
import { BUILT_IN_TEMPLATE_KEY, BUILT_IN_TEMPLATE_VERSION } from "@/lib/activate-templates";

const prisma = new PrismaClient();
let fx: Fixture;

/** A template belonging to org B, used to prove tenants cannot borrow one. */
let orgBTemplateId: string;
/** An unpublished template of org A, which must be offered to nobody. */
let draftTemplateId: string;

beforeAll(async () => {
  await waitForServer();
  fx = await createFixture(prisma);

  const orgBTemplate = await prisma.methodTemplate.create({
    data: {
      orgId: fx.orgB.orgId,
      key: "ORGB_PRIVATE",
      name: "Org B private method",
      version: 1,
      status: "PUBLISHED",
      phases: { create: [{ key: "DISCOVER", name: "Discover", position: 0 }] },
      workstreams: { create: [{ key: "PROJECT_MANAGEMENT", name: "PM", position: 0 }] },
    },
    select: { id: true },
  });
  orgBTemplateId = orgBTemplate.id;

  const draft = await prisma.methodTemplate.create({
    data: {
      orgId: fx.orgA.orgId,
      key: "ORGA_DRAFT",
      name: "Half-written method",
      version: 1,
      status: "DRAFT",
      phases: { create: [{ key: "DISCOVER", name: "Discover", position: 0 }] },
    },
    select: { id: true },
  });
  draftTemplateId = draft.id;
}, 180_000);

afterAll(async () => {
  await prisma.methodTemplate.deleteMany({
    where: { id: { in: [orgBTemplateId, draftTemplateId].filter(Boolean) } },
  });
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("THE EXIT GATE: seeding from a template matches the constant exactly", () => {
  it("reproduces every phase, gate and criterion, verbatim and in order", async () => {
    const res = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`, {
      method: "POST",
      body: { enabled: true },
    });
    expect(res.status).toBe(201);

    const phases = await prisma.activatePhase.findMany({
      where: { projectId: fx.orgA.projectId },
      orderBy: { position: "asc" },
      select: {
        key: true,
        name: true,
        position: true,
        gates: {
          orderBy: { position: "asc" },
          select: {
            name: true,
            description: true,
            criteria: { orderBy: { position: "asc" }, select: { criterion: true } },
          },
        },
      },
    });

    // Compared as whole structures rather than field by field: an assertion
    // per field is an assertion somebody forgets to add when a field is.
    expect(
      phases.map((p) => ({
        key: p.key,
        name: p.name,
        position: p.position,
        gate: {
          name: p.gates[0].name,
          description: p.gates[0].description,
          criteria: p.gates[0].criteria.map((c) => c.criterion),
        },
      }))
    ).toEqual(
      ACTIVATE_PHASES.map((p, i) => ({
        key: p.key,
        name: p.name,
        position: i,
        gate: {
          name: p.gate.name,
          description: p.gate.description,
          criteria: p.gate.criteria,
        },
      }))
    );
  });

  it("reproduces every workstream, verbatim and in order", async () => {
    const ws = await prisma.activateWorkstream.findMany({
      where: { projectId: fx.orgA.projectId },
      orderBy: { position: "asc" },
      select: { key: true, name: true, position: true },
    });
    expect(ws).toEqual(ACTIVATE_WORKSTREAMS.map((w, i) => ({ key: w.key, name: w.name, position: i })));
  });

  it("stamps the project with the template it came from", async () => {
    const profile = await prisma.activateProfile.findUnique({
      where: { projectId: fx.orgA.projectId },
      select: { templateId: true, templateVersion: true },
    });
    expect(profile?.templateId).toBeTruthy();
    expect(profile?.templateVersion).toBe(BUILT_IN_TEMPLATE_VERSION);

    const template = await prisma.methodTemplate.findUnique({
      where: { id: profile!.templateId! },
      select: { key: true, orgId: true, status: true },
    });
    expect(template?.key).toBe(BUILT_IN_TEMPLATE_KEY);
    // Built-in means owned by nobody.
    expect(template?.orgId).toBeNull();
    expect(template?.status).toBe("PUBLISHED");
  });

  it("creates exactly one built-in template however many times it is seeded", async () => {
    // The unique index carrying NULLS NOT DISTINCT is what makes this true;
    // a plain unique would place no constraint on rows whose orgId is NULL.
    await api(fx.orgB.users.OWNER, `/api/projects/${fx.orgB.projectId}/activate`, {
      method: "POST",
      body: { enabled: true },
    });
    const count = await prisma.methodTemplate.count({
      where: { orgId: null, key: BUILT_IN_TEMPLATE_KEY, version: BUILT_IN_TEMPLATE_VERSION },
    });
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("Listing the templates a project may use", () => {
  it("offers the built-in template, with its shape", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/templates`
    );
    expectAllowed(res, "the owner listing templates");

    const builtIn = res.body.templates.find((t: any) => t.key === BUILT_IN_TEMPLATE_KEY);
    expect(builtIn).toBeDefined();
    expect(builtIn.builtIn).toBe(true);
    expect(builtIn.phaseCount).toBe(ACTIVATE_PHASES.length);
    expect(builtIn.workstreamCount).toBe(ACTIVATE_WORKSTREAMS.length);
  });

  it("does not offer another organization's template", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/templates`
    );
    const keys = res.body.templates.map((t: any) => t.key);
    expect(keys).not.toContain("ORGB_PRIVATE");
    // Nor its name, which is the part that would actually leak.
    expect(JSON.stringify(res.body)).not.toContain("Org B private method");
  });

  it("does not offer a draft, even to the organization that owns it", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/templates`
    );
    const keys = res.body.templates.map((t: any) => t.key);
    // Half-written methodology is what gets stamped onto a real project by
    // accident, and a stamp cannot be withdrawn once the phases exist.
    expect(keys).not.toContain("ORGA_DRAFT");
  });

  it("never exposes which organization owns a template", async () => {
    const res = await api(
      fx.orgA.users.OWNER,
      `/api/projects/${fx.orgA.projectId}/activate/templates`
    );
    for (const t of res.body.templates) expect(t.orgId).toBeUndefined();
  });

  it("refuses a cross-tenant caller, an outsider, a VIEWER and an anonymous one", async () => {
    const path = `/api/projects/${fx.orgA.projectId}/activate/templates`;
    expectDenied(await api(fx.orgB.users.OWNER, path), "org B listing org A's templates");
    expectDenied(await api(fx.outsider, path), "an outsider listing templates");
    expectDenied(await api(fx.orgA.users.VIEWER, path), "a VIEWER listing templates");
    expect((await api(null, path)).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------

describe("Seeding from a template named in the body", () => {
  it("refuses another organization's template, and seeds nothing", async () => {
    // A fresh project of org A, so "seeded nothing" is checkable.
    const project = await prisma.project.create({
      data: {
        id: `${fx.orgA.projectId}_tpl`,
        name: "Template guard project",
        key: "TPLG",
        workspaceId: fx.orgA.workspaceId,
        ownerId: fx.orgA.users.OWNER.id,
      },
      select: { id: true },
    });
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: fx.orgA.users.OWNER.id, role: "PROJECT_ADMIN" },
    });

    const res = await api(fx.orgA.users.OWNER, `/api/projects/${project.id}/activate`, {
      method: "POST",
      body: { enabled: true, templateId: orgBTemplateId },
    });
    // 400, not 404: the caller is authorised for this project, and an id
    // belonging to someone else answers identically to one that never existed.
    expect(res.status).toBe(400);

    expect(await prisma.activatePhase.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.activateProfile.count({ where: { projectId: project.id } })).toBe(0);

    await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } });
  });

  it("refuses a draft template", async () => {
    const res = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`, {
      method: "POST",
      body: { enabled: true, templateId: draftTemplateId },
    });
    expect(res.status).toBe(400);
  });

  it("refuses a template id that does not exist, with the same answer", async () => {
    const res = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`, {
      method: "POST",
      body: { enabled: true, templateId: "cltemplatedoesnotexist" },
    });
    expect(res.status).toBe(400);
  });

  it("still accepts the old request shape, meaning exactly what it used to", async () => {
    // Every caller written before templates existed sends this.
    const res = await api(fx.orgA.users.OWNER, `/api/projects/${fx.orgA.projectId}/activate`, {
      method: "POST",
      body: { enabled: true },
    });
    expect(res.status).toBe(201);

    const profile = await prisma.activateProfile.findUnique({
      where: { projectId: fx.orgA.projectId },
      select: { templateId: true },
    });
    const template = await prisma.methodTemplate.findUnique({
      where: { id: profile!.templateId! },
      select: { key: true },
    });
    expect(template?.key).toBe(BUILT_IN_TEMPLATE_KEY);
  });
});

// ---------------------------------------------------------------------------

describe("A running project outlives its template", () => {
  it("keeps its phases when the template it came from is deleted", async () => {
    /**
     * There is deliberately no foreign key from ActivateProfile to
     * MethodTemplate. A customer retiring or deleting a template must not take
     * their in-flight projects with it, and a foreign key would make deletion
     * either impossible or destructive — both worse than an id that no longer
     * resolves.
     */
    const doomed = await prisma.methodTemplate.create({
      data: {
        orgId: fx.orgA.orgId,
        key: "ORGA_DOOMED",
        name: "Soon to be deleted",
        version: 1,
        status: "PUBLISHED",
        phases: {
          create: [
            {
              key: "DISCOVER",
              name: "Discover",
              position: 0,
              gates: { create: [{ name: "Discover gate", position: 0 }] },
            },
          ],
        },
        workstreams: { create: [{ key: "PROJECT_MANAGEMENT", name: "PM", position: 0 }] },
      },
      select: { id: true },
    });

    const project = await prisma.project.create({
      data: {
        id: `${fx.orgA.projectId}_doom`,
        name: "Outlives its template",
        key: "DOOM",
        workspaceId: fx.orgA.workspaceId,
        ownerId: fx.orgA.users.OWNER.id,
      },
      select: { id: true },
    });
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: fx.orgA.users.OWNER.id, role: "PROJECT_ADMIN" },
    });

    const enabled = await api(fx.orgA.users.OWNER, `/api/projects/${project.id}/activate`, {
      method: "POST",
      body: { enabled: true, templateId: doomed.id },
    });
    expect(enabled.status).toBe(201);
    expect(await prisma.activatePhase.count({ where: { projectId: project.id } })).toBe(1);

    await prisma.methodTemplate.delete({ where: { id: doomed.id } });

    // The plan survives; only the stamp now points at nothing.
    expect(await prisma.activatePhase.count({ where: { projectId: project.id } })).toBe(1);
    const stillReadable = await api(fx.orgA.users.OWNER, `/api/projects/${project.id}/activate`);
    expect(stillReadable.status).toBe(200);
    expect(stillReadable.body.phases).toHaveLength(1);

    await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } });
  });
});
