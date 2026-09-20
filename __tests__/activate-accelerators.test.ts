/**
 * SAP Activate increment 7 — accelerators as data.
 *
 * THE EXIT GATE IS THE LAST BLOCK IN THIS FILE.
 *
 * The claim of this increment is that adding an accelerator is an edit to one
 * JSON file and nothing else — no code change, no migration, no new logic. A
 * claim like that decays silently: someone adds a special case for one
 * accelerator, it works, and a year later the catalogue is half data and half
 * `if` statements. So it is asserted mechanically — no accelerator key may
 * appear anywhere in `src/` except the data file itself.
 *
 * The rest of the file is about the loader refusing bad data loudly. A typo in
 * a `phaseKey` produces an accelerator that no phase ever shows: a feature
 * that is missing rather than broken, which is the kind of defect nobody
 * reports.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ACCELERATORS,
  acceleratorsForPhase,
  findAccelerator,
  __parseCatalogueForTests as parseCatalogue,
} from "@/lib/activate-accelerators";
import { ACTIVATE_PHASE_KEYS, ACTIVATE_WORKSTREAMS } from "@/lib/activate";

const DATA_FILE = "src/data/activate-accelerators.json";

function valid(overrides: Record<string, unknown> = {}) {
  return [
    {
      key: "TEST_ACCELERATOR",
      phaseKey: "EXPLORE",
      workstreamKey: "TESTING",
      title: "A test accelerator",
      description: "Something a phase expects to happen.",
      isMandatory: false,
      ...overrides,
    },
  ];
}

describe("the catalogue that ships", () => {
  it("loads, and every entry points at a real phase and workstream", () => {
    expect(ACCELERATORS.length).toBeGreaterThan(0);
    const workstreamKeys = new Set(ACTIVATE_WORKSTREAMS.map((w) => w.key));
    for (const a of ACCELERATORS) {
      expect(ACTIVATE_PHASE_KEYS).toContain(a.phaseKey);
      expect(workstreamKeys.has(a.workstreamKey)).toBe(true);
    }
  });

  it("covers all six phases, so no phase opens with an empty shelf", () => {
    for (const key of ACTIVATE_PHASE_KEYS) {
      expect(acceleratorsForPhase(key).length).toBeGreaterThan(0);
    }
  });

  it("finds an accelerator by key and returns undefined for one that does not exist", () => {
    const first = ACCELERATORS[0];
    expect(findAccelerator(first.key)).toEqual(first);
    expect(findAccelerator("NOT_A_REAL_KEY")).toBeUndefined();
  });
});

describe("the loader refuses bad data rather than limping", () => {
  it("accepts a well-formed entry — the control case", () => {
    expect(parseCatalogue(valid())).toHaveLength(1);
  });

  it("rejects a phaseKey that is not one of the six", () => {
    // "EXPLOER" type-checks, imports and then shows up nowhere.
    expect(() => parseCatalogue(valid({ phaseKey: "EXPLOER" }))).toThrow(/invalid/i);
  });

  it("rejects a workstreamKey that is not a default workstream", () => {
    expect(() => parseCatalogue(valid({ workstreamKey: "MARKETING" }))).toThrow(/invalid/i);
  });

  it("rejects a duplicate key, because duplicates make 'already applied' ambiguous", () => {
    const two = [...valid(), ...valid({ title: "A different title" })];
    expect(() => parseCatalogue(two)).toThrow(/duplicate key/i);
  });

  it("rejects a malformed key", () => {
    expect(() => parseCatalogue(valid({ key: "lower_case" }))).toThrow(/invalid/i);
    expect(() => parseCatalogue(valid({ key: "X" }))).toThrow(/invalid/i);
  });

  it("rejects an empty catalogue", () => {
    expect(() => parseCatalogue([])).toThrow(/invalid/i);
  });

  it("rejects a missing field", () => {
    const missing = valid();
    delete (missing[0] as Record<string, unknown>).description;
    expect(() => parseCatalogue(missing)).toThrow(/invalid/i);
  });
});

// ---------------------------------------------------------------------------

describe("THE EXIT GATE: accelerators are data, not code", () => {
  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        out.push(...sourceFiles(p));
      } else if (/\.(ts|tsx|js|jsx|json)$/.test(entry)) {
        out.push(p);
      }
    }
    return out;
  }

  it("mentions no accelerator key anywhere in src/ except the data file", () => {
    const files = sourceFiles("src").filter(
      (f) => f.replace(/\\/g, "/") !== DATA_FILE
    );

    const offences: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const a of ACCELERATORS) {
        if (src.includes(a.key)) offences.push(`${file} mentions ${a.key}`);
      }
    }

    /**
     * If this fails, someone has special-cased an accelerator. That is the
     * moment the catalogue stops being data: from then on, adding one means
     * reading the code to find out which ones are handled specially, and the
     * promise this increment makes is no longer true.
     */
    expect(offences).toEqual([]);
  });

  it("is the only place the catalogue is defined", () => {
    // A second JSON file or an inline array would divide the truth. The loader
    // imports exactly one path; this pins that it stays one.
    const loader = readFileSync("src/lib/activate-accelerators.ts", "utf8");
    const imports = loader.match(/from "@\/data\/[^"]+"/g) ?? [];
    expect(imports).toEqual(['from "@/data/activate-accelerators.json"']);
  });

  it("needs no schema change to grow: the stamp is an existing column", () => {
    // acceleratorKey has been on ActivateDeliverableLink since increment 1.
    // If a future accelerator needed a new column, this increment's claim
    // would be false, so the shape of an entry is pinned to what the schema
    // already stores.
    const entryFields = Object.keys(ACCELERATORS[0]).sort();
    expect(entryFields).toEqual(
      ["description", "isMandatory", "key", "phaseKey", "title", "workstreamKey"].sort()
    );
  });
});
