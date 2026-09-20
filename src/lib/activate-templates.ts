/**
 * Methodology templates: what a project is seeded FROM.
 *
 * WHAT CHANGED, AND WHAT DELIBERATELY DID NOT
 *
 * Until now `enableActivate` copied a TypeScript constant straight into a
 * project's rows. That worked, and it had one real limit: there was exactly
 * one methodology, with no version and no way for a customer or a product line
 * to have their own. This module adds the layer above — named, versioned
 * templates — while keeping the built-in methodology byte-for-byte what it was.
 *
 * The instance side is unchanged. Phases, gates and criteria were already
 * per-project rows, so the failure this layer usually exists to prevent —
 * editing the master plan silently rewriting every running project — was
 * already impossible here. What was missing was the template itself.
 *
 * WHY THE BUILT-IN TEMPLATE IS UPSERTED FROM CODE RATHER THAN SEEDED BY SQL
 *
 * `ACTIVATE_PHASES` and `ACTIVATE_WORKSTREAMS` stay the single source of the
 * built-in content, exactly as the accelerator catalogue stays a JSON file.
 * Publishing a new version of the built-in methodology is therefore a
 * deployment, which is honest: it ships with the product. A migration that
 * INSERTed the content would fork it — the constant and the rows would drift,
 * and nobody would notice until a project was seeded from the stale half.
 *
 * `ensureBuiltInTemplate` is idempotent on `(orgId=null, key, version)`, so
 * calling it on every enable converges rather than duplicating.
 */

import { prisma } from "./prisma";
import { ACTIVATE_PHASES, ACTIVATE_WORKSTREAMS, ACTIVATE_METHODOLOGY_VERSION } from "./activate";

/** The built-in methodology's stable key. */
export const BUILT_IN_TEMPLATE_KEY = "SAP_ACTIVATE";
export const BUILT_IN_TEMPLATE_VERSION = 1;

export const TEMPLATE_STATUSES = ["DRAFT", "PUBLISHED", "RETIRED"] as const;

export interface LoadedTemplate {
  id: string;
  key: string;
  name: string;
  version: number;
  status: string;
  orgId: string | null;
  phases: Array<{
    key: string;
    name: string;
    position: number;
    gates: Array<{
      name: string;
      description: string | null;
      isMandatory: boolean;
      position: number;
      criteria: Array<{ criterion: string; position: number }>;
    }>;
  }>;
  workstreams: Array<{ key: string; name: string; position: number }>;
}

/**
 * Create or converge the built-in template, returning its id.
 *
 * Runs in one transaction. A template with phases but no workstreams, or gates
 * with no criteria, is a state no project should ever be seeded from, and a
 * partial failure here would produce exactly that.
 */
export async function ensureBuiltInTemplate(): Promise<string> {
  return prisma.$transaction(async (tx) => {
    /**
     * findFirst-then-create rather than `upsert`, because the built-in
     * template's `orgId` is NULL.
     *
     * Prisma's compound-unique `where` does not express a NULL component —
     * its generated type wants a string — so an upsert here would have to be
     * cast, and would then depend on how a NULL is matched against a unique
     * index. That is exactly the detail Postgres treats specially: NULLs are
     * DISTINCT in a unique index unless the index says otherwise. The index
     * now says otherwise (see migration 0016), which makes a concurrent double
     * create fail loudly instead of quietly producing a second built-in
     * methodology; this path handles that failure by re-reading rather than
     * propagating it, because losing the race is not an error.
     */
    const existing = await tx.methodTemplate.findFirst({
      where: { orgId: null, key: BUILT_IN_TEMPLATE_KEY, version: BUILT_IN_TEMPLATE_VERSION },
      select: { id: true },
    });

    const template =
      existing ??
      (await tx.methodTemplate
        .create({
          data: {
            orgId: null,
            key: BUILT_IN_TEMPLATE_KEY,
            name: "SAP Activate",
            variant: null,
            version: BUILT_IN_TEMPLATE_VERSION,
            status: "PUBLISHED",
            description:
              `Aligned with the published SAP Activate methodology (${ACTIVATE_METHODOLOGY_VERSION}). ` +
              "Not certified by or affiliated with SAP.",
          },
          select: { id: true },
        })
        .catch(async (e: { code?: string }) => {
          if (e?.code !== "P2002") throw e;
          const raced = await tx.methodTemplate.findFirst({
            where: { orgId: null, key: BUILT_IN_TEMPLATE_KEY, version: BUILT_IN_TEMPLATE_VERSION },
            select: { id: true },
          });
          if (!raced) throw e;
          return raced;
        }));

    for (let i = 0; i < ACTIVATE_PHASES.length; i += 1) {
      const seed = ACTIVATE_PHASES[i];
      const phase = await tx.templatePhase.upsert({
        where: { templateId_key: { templateId: template.id, key: seed.key } },
        update: { name: seed.name, position: i },
        create: { templateId: template.id, key: seed.key, name: seed.name, position: i },
        select: { id: true },
      });

      // The gate is replaced wholesale rather than merged. A template gate has
      // no per-project state to preserve — unlike a project gate, where
      // criteria somebody has already marked met must survive — so rebuilding
      // it is the simplest thing that stays correct as the constant changes.
      await tx.templateGate.deleteMany({ where: { phaseId: phase.id } });
      await tx.templateGate.create({
        data: {
          phaseId: phase.id,
          name: seed.gate.name,
          description: seed.gate.description,
          isMandatory: true,
          position: 0,
          criteria: {
            create: seed.gate.criteria.map((criterion, idx) => ({ criterion, position: idx })),
          },
        },
      });
    }

    for (let i = 0; i < ACTIVATE_WORKSTREAMS.length; i += 1) {
      const ws = ACTIVATE_WORKSTREAMS[i];
      await tx.templateWorkstream.upsert({
        where: { templateId_key: { templateId: template.id, key: ws.key } },
        update: { name: ws.name, position: i },
        create: { templateId: template.id, key: ws.key, name: ws.name, position: i },
      });
    }

    return template.id;
  });
}

/** Read a template whole, in the order a project should be seeded in. */
export async function loadTemplate(templateId: string): Promise<LoadedTemplate | null> {
  const t = await prisma.methodTemplate.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      key: true,
      name: true,
      version: true,
      status: true,
      orgId: true,
      phases: {
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
              isMandatory: true,
              position: true,
              criteria: { orderBy: { position: "asc" }, select: { criterion: true, position: true } },
            },
          },
        },
      },
      workstreams: { orderBy: { position: "asc" }, select: { key: true, name: true, position: true } },
    },
  });
  return t;
}

/**
 * The templates an organization may seed a project from: its own, plus the
 * built-in ones, published only.
 *
 * A DRAFT is invisible here on purpose. Half-written methodology is exactly
 * the kind of thing that gets stamped onto a real project by accident, and a
 * stamp cannot be taken back once the phases exist.
 */
export async function listTemplatesFor(orgId: string) {
  return prisma.methodTemplate.findMany({
    where: { status: "PUBLISHED", OR: [{ orgId: null }, { orgId }] },
    orderBy: [{ orgId: "asc" }, { key: "asc" }, { version: "desc" }],
    select: {
      id: true,
      key: true,
      name: true,
      variant: true,
      version: true,
      description: true,
      orgId: true,
      _count: { select: { phases: true, workstreams: true } },
    },
  });
}

/**
 * May this organization seed a project from this template?
 *
 * Built-in templates are available to everyone; an organization's own are
 * available only to it. A template belonging to another tenant must be
 * indistinguishable from one that does not exist.
 */
export async function templateUsableBy(
  templateId: string,
  orgId: string
): Promise<{ id: string; version: number } | null> {
  const t = await prisma.methodTemplate.findFirst({
    where: { id: templateId, status: "PUBLISHED", OR: [{ orgId: null }, { orgId }] },
    select: { id: true, version: true },
  });
  return t;
}
