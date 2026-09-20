/**
 * Accelerators — SAP Activate's ready-made starting points for the work a
 * phase expects.
 *
 * THE CATALOGUE IS A JSON FILE, AND THAT IS THE WHOLE POINT
 *
 * `src/data/activate-accelerators.json` holds every accelerator. Nothing in
 * this codebase names one: no switch on a key, no per-accelerator branch, no
 * table to migrate. Adding one is an edit to that file and nothing else, which
 * is the exit condition this increment is measured against.
 *
 * The reasoning is the same as for the workstream names in `activate.ts`. This
 * is SAP's vocabulary and SAP changes it. If accelerators were rows, a rename
 * upstream would be a data migration for every customer; if they were an enum,
 * it would be a schema migration for every customer. As a file they are a pull
 * request, and a customer who wants their own can fork the file without
 * touching anything that runs.
 *
 * WHY THE FILE IS VALIDATED RATHER THAN TRUSTED
 *
 * `resolveJsonModule` will happily import a typo. A `phaseKey` of "EXPLOER"
 * would type-check, load, and then quietly produce an accelerator that no
 * phase ever shows — a feature that is missing rather than broken, which is
 * the kind of defect nobody reports. So the file is parsed through a schema at
 * module load and a malformed entry throws immediately, in the unit suite,
 * where it is cheap.
 */

import { z } from "zod";
import catalogue from "@/data/activate-accelerators.json";
import { ACTIVATE_PHASE_KEYS, ACTIVATE_WORKSTREAMS } from "./activate";

const WORKSTREAM_KEYS = ACTIVATE_WORKSTREAMS.map((w) => w.key);

const acceleratorSchema = z.object({
  /** Stable identity. Stamped onto the deliverable link it creates, so this is
   *  how "has this project already applied it" is answered later. */
  key: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  phaseKey: z.string().refine((k) => ACTIVATE_PHASE_KEYS.includes(k), {
    message: "phaseKey must be one of the six Activate phases",
  }),
  workstreamKey: z.string().refine((k) => WORKSTREAM_KEYS.includes(k), {
    message: "workstreamKey must be one of the default workstreams",
  }),
  title: z.string().min(3).max(200),
  description: z.string().min(3).max(1000),
  isMandatory: z.boolean(),
});

export type Accelerator = z.infer<typeof acceleratorSchema>;

function parseCatalogue(raw: unknown): Accelerator[] {
  const parsed = z.array(acceleratorSchema).min(1).safeParse(raw);
  if (!parsed.success) {
    // Thrown at module load, deliberately. A half-valid catalogue that limps
    // along is worse than a build that stops: the missing accelerator would
    // never be noticed, because nobody misses what they have not seen.
    throw new Error(
      `activate-accelerators.json is invalid: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`
    );
  }

  const seen = new Set<string>();
  for (const a of parsed.data) {
    if (seen.has(a.key)) {
      // Keys are how an applied accelerator is recognised, so a duplicate
      // would make "already applied" ambiguous for both of them.
      throw new Error(`activate-accelerators.json has a duplicate key: ${a.key}`);
    }
    seen.add(a.key);
  }

  return parsed.data;
}

export const ACCELERATORS: Accelerator[] = parseCatalogue(catalogue);

/** The accelerators a phase offers, in catalogue order. */
export function acceleratorsForPhase(phaseKey: string): Accelerator[] {
  return ACCELERATORS.filter((a) => a.phaseKey === phaseKey);
}

export function findAccelerator(key: string): Accelerator | undefined {
  return ACCELERATORS.find((a) => a.key === key);
}

/** Exported for the validation test, which needs to feed it bad input. */
export const __parseCatalogueForTests = parseCatalogue;
