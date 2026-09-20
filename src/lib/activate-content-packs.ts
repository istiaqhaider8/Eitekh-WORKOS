/**
 * Content packs: a methodology variant carrying a scope catalogue.
 *
 * WHAT A PACK IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * A pack supplies MODULES and SCOPE ITEMS — the things a fit-to-standard
 * workshop walks through for a particular product line. It does NOT supply
 * phases, gates or criteria: those are the methodology, they are the same for
 * every variant, and they come from the built-in template. A suite template
 * plus module content beats a template per module combination, because the
 * common material is written once.
 *
 * THE POINT OF THIS FILE IS THAT IT NAMES NOTHING
 *
 * There is no switch on a pack key, no per-pack branch, no table to migrate.
 * Every pack in `src/data/activate-packs/` is loaded generically, and adding
 * one is an edit to that directory and nothing else. The unit suite enforces
 * that mechanically rather than trusting this paragraph — it fails if any
 * pack key, module key or scope-item code appears as a quoted literal in
 * `src/` outside the data directory.
 *
 * WHY THE FILES ARE VALIDATED AT LOAD
 *
 * `resolveJsonModule` will happily import a typo. A `workstreamKey` of
 * "ANALYTCS" type-checks, loads, and then produces a scope item whose
 * generated work is filed under a workstream that does not exist — a defect
 * that surfaces weeks later as a missing item on somebody's report. A bad key
 * throws here, in the unit suite, where it is cheap.
 */

import { z } from "zod";
import { prisma } from "./prisma";
import {
  ACTIVATE_PHASES,
  ACTIVATE_WORKSTREAMS,
  ACTIVATE_METHODOLOGY_VERSION,
} from "./activate";
import successfactors from "@/data/activate-packs/successfactors.json";

const WORKSTREAM_KEYS = ACTIVATE_WORKSTREAMS.map((w) => w.key);

const scopeItemSchema = z.object({
  code: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,31}$/),
  name: z.string().min(3).max(200),
  workstreamKey: z.string().refine((k) => WORKSTREAM_KEYS.includes(k), {
    message: "workstreamKey must be one of the methodology's workstreams",
  }),
  /** Comma-separated flags. `ux` drives the change-and-training rule. */
  tags: z.string().max(200).optional(),
});

const moduleSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  scopeItems: z.array(scopeItemSchema).min(1).max(200),
});

const packSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  variant: z.string().min(2).max(80),
  name: z.string().min(3).max(120),
  description: z.string().max(500),
  modules: z.array(moduleSchema).min(1).max(50),
});

export type ContentPack = z.infer<typeof packSchema>;

/**
 * Every pack that ships.
 *
 * A literal list rather than a directory scan: Next bundles server code, and
 * a runtime `readdir` over `src/data` does not survive that. Adding a pack is
 * therefore one import and one array entry beside it — still data, still no
 * logic, and the unit suite checks the array matches the directory so a file
 * cannot be added and silently never loaded.
 */
const RAW_PACKS: unknown[] = [successfactors];

function parsePacks(raw: unknown[]): ContentPack[] {
  const packs: ContentPack[] = [];
  const seenKeys = new Set<string>();

  for (const r of raw) {
    const parsed = packSchema.safeParse(r);
    if (!parsed.success) {
      throw new Error(
        `An Activate content pack is invalid: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`
      );
    }
    const pack = parsed.data;
    if (seenKeys.has(pack.key)) throw new Error(`Duplicate content pack key: ${pack.key}`);
    seenKeys.add(pack.key);

    // Codes must be unique across the WHOLE pack, not merely within a module.
    // A scope item is cited by its code in a workshop; two items answering to
    // the same code would make a decision log ambiguous.
    const codes = new Set<string>();
    const moduleKeys = new Set<string>();
    for (const m of pack.modules) {
      if (moduleKeys.has(m.key)) throw new Error(`Duplicate module key in ${pack.key}: ${m.key}`);
      moduleKeys.add(m.key);
      for (const si of m.scopeItems) {
        if (codes.has(si.code)) {
          throw new Error(`Duplicate scope item code in ${pack.key}: ${si.code}`);
        }
        codes.add(si.code);
      }
    }
    packs.push(pack);
  }
  return packs;
}

export const CONTENT_PACKS: ContentPack[] = parsePacks(RAW_PACKS);

/** Exported for the validation test, which needs to feed it bad input. */
export const __parsePacksForTests = parsePacks;

/**
 * Create or converge every content pack as a built-in template variant.
 *
 * Each pack becomes its own `MethodTemplate` with `orgId: null` — shipped,
 * shared, read-only — carrying the methodology's own phases and workstreams
 * plus the pack's modules. Idempotent on `(orgId, key, version)`, so calling
 * it on every template listing converges rather than duplicating.
 */
export async function ensureContentPacks(): Promise<string[]> {
  const ids: string[] = [];

  for (const pack of CONTENT_PACKS) {
    const id = await prisma.$transaction(async (tx) => {
      const existing = await tx.methodTemplate.findFirst({
        where: { orgId: null, key: pack.key, version: 1 },
        select: { id: true },
      });

      const template =
        existing ??
        (await tx.methodTemplate
          .create({
            data: {
              orgId: null,
              key: pack.key,
              name: pack.name,
              variant: pack.variant,
              version: 1,
              status: "PUBLISHED",
              description: pack.description,
            },
            select: { id: true },
          })
          .catch(async (e: { code?: string }) => {
            // Lost a race. Not an error — re-read and carry on.
            if (e?.code !== "P2002") throw e;
            const raced = await tx.methodTemplate.findFirst({
              where: { orgId: null, key: pack.key, version: 1 },
              select: { id: true },
            });
            if (!raced) throw e;
            return raced;
          }));

      /**
       * The phases and gates come from the methodology, not the pack.
       *
       * A variant that authored its own phases would be a second methodology
       * wearing the first one's name, and the six Activate phases are the
       * part that does not vary by product line.
       */
      for (let i = 0; i < ACTIVATE_PHASES.length; i += 1) {
        const seed = ACTIVATE_PHASES[i];
        const phase = await tx.templatePhase.upsert({
          where: { templateId_key: { templateId: template.id, key: seed.key } },
          update: { name: seed.name, position: i },
          create: { templateId: template.id, key: seed.key, name: seed.name, position: i },
          select: { id: true },
        });
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

      for (let m = 0; m < pack.modules.length; m += 1) {
        const mod = pack.modules[m];
        const moduleRow = await tx.templateModule.upsert({
          where: { templateId_key: { templateId: template.id, key: mod.key } },
          update: { name: mod.name, description: mod.description ?? null, position: m },
          create: {
            templateId: template.id,
            key: mod.key,
            name: mod.name,
            description: mod.description ?? null,
            position: m,
          },
          select: { id: true },
        });

        for (let s = 0; s < mod.scopeItems.length; s += 1) {
          const si = mod.scopeItems[s];
          /**
           * Upserted rather than rebuilt.
           *
           * A project's DECISIONS reference scope items by id. Deleting and
           * re-creating the catalogue on every load would hand out new ids
           * and orphan every decision a customer had recorded — silently,
           * because a decision whose scope item has vanished is simply not
           * shown.
           */
          await tx.templateScopeItem.upsert({
            where: { moduleId_code: { moduleId: moduleRow.id, code: si.code } },
            update: {
              name: si.name,
              workstreamKey: si.workstreamKey,
              tags: si.tags ?? null,
              position: s,
            },
            create: {
              moduleId: moduleRow.id,
              code: si.code,
              name: si.name,
              workstreamKey: si.workstreamKey,
              tags: si.tags ?? null,
              position: s,
            },
          });
        }
      }

      return template.id;
    });

    ids.push(id);
  }

  return ids;
}

/** How many scope items a pack carries, for a listing. */
export function packSize(pack: ContentPack): number {
  return pack.modules.reduce((n, m) => n + m.scopeItems.length, 0);
}

export const METHODOLOGY_VERSION_FOR_PACKS = ACTIVATE_METHODOLOGY_VERSION;
