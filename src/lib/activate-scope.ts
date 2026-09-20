/**
 * The scope-item catalogue as a project sees it.
 *
 * A project reads its catalogue THROUGH its template stamp. That indirection
 * is what makes the whole thing tenant-safe without a tenant column on the
 * template tables: a project can only ever see modules and scope items that
 * hang off the template it was stamped with, and it was stamped only with a
 * template that was built-in or its own organization's.
 *
 * Everything here is read-only. Writing decisions is the route's job.
 */

import { prisma } from "./prisma";
import type { DecisionInput, ScopeItemInput } from "./activate-generation";

export interface ProjectModuleView {
  moduleId: string;
  key: string;
  name: string;
  description: string | null;
  position: number;
  inScope: boolean;
  waveNumber: number | null;
  ownerId: string | null;
  scopeItemCount: number;
}

/** The template a project was stamped with, or null if it has none. */
async function templateIdFor(projectId: string): Promise<string | null> {
  const p = await prisma.activateProfile.findUnique({
    where: { projectId },
    select: { enabled: true, templateId: true },
  });
  if (!p?.enabled) return null;
  return p.templateId;
}

/**
 * Every module of this project's template, with its scope state.
 *
 * A module with no `ActivateProjectModule` row is IN scope. Defaulting the
 * other way would make enabling Activate produce an empty workshop, and the
 * first thing anyone would do is switch every module on.
 */
export async function modulesForProject(projectId: string): Promise<ProjectModuleView[]> {
  const templateId = await templateIdFor(projectId);
  if (!templateId) return [];

  const [modules, overrides] = await Promise.all([
    prisma.templateModule.findMany({
      where: { templateId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        position: true,
        _count: { select: { scopeItems: true } },
      },
    }),
    prisma.activateProjectModule.findMany({
      where: { projectId },
      select: { moduleId: true, inScope: true, waveNumber: true, ownerId: true },
    }),
  ]);

  const byId = new Map(overrides.map((o) => [o.moduleId, o]));

  return modules.map((m) => {
    const o = byId.get(m.id);
    return {
      moduleId: m.id,
      key: m.key,
      name: m.name,
      description: m.description,
      position: m.position,
      inScope: o ? o.inScope : true,
      waveNumber: o?.waveNumber ?? null,
      ownerId: o?.ownerId ?? null,
      scopeItemCount: m._count.scopeItems,
    };
  });
}

/** The module ids this project is actually doing. */
export async function modulesInScope(projectId: string): Promise<Set<string>> {
  const mods = await modulesForProject(projectId);
  return new Set(mods.filter((m) => m.inScope).map((m) => m.moduleId));
}

/**
 * The catalogue plus whatever this project has decided about it.
 *
 * One query for the scope items and one for the decisions, joined in memory —
 * a constant two statements however many modules there are, rather than one
 * per module.
 */
export async function scopeItemsWithDecisions(projectId: string) {
  const templateId = await templateIdFor(projectId);
  if (!templateId) {
    return { enabled: false as const, modules: [], items: [], decisions: [] };
  }

  const [modules, items, decisions] = await Promise.all([
    modulesForProject(projectId),
    prisma.templateScopeItem.findMany({
      where: { module: { templateId } },
      orderBy: [{ module: { position: "asc" } }, { position: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        workstreamKey: true,
        tags: true,
        moduleId: true,
        position: true,
      },
    }),
    prisma.activateDecision.findMany({
      where: { projectId },
      select: {
        id: true,
        scopeItemId: true,
        decision: true,
        status: true,
        rationale: true,
        openQuestion: true,
        questionOwnerId: true,
        decidedById: true,
        decidedAt: true,
        version: true,
        deltas: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            title: true,
            buildType: true,
            priority: true,
            size: true,
            ownerId: true,
            targetPhaseKey: true,
            note: true,
          },
        },
      },
    }),
  ]);

  return { enabled: true as const, modules, items, decisions };
}

/** Shape the catalogue and decisions the way the generation function wants. */
export function toPlanInput(
  items: Array<ScopeItemInput & { position?: number }>,
  decisions: Array<DecisionInput>,
  inScope: Set<string>
) {
  return {
    decisions,
    scopeItems: new Map(items.map((i) => [i.id, i as ScopeItemInput])),
    modulesInScope: inScope,
  };
}
