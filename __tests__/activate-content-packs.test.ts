/**
 * SAP Activate increment 11 — content packs as data.
 *
 * THE EXIT GATE IS THE LAST BLOCK.
 *
 * The claim is that adding a methodology variant with its own scope
 * catalogue is an edit to `src/data/activate-packs/` and nothing else. That
 * decays silently — someone special-cases one pack, it works, and a year
 * later half the catalogue lives in `if` statements — so it is asserted
 * mechanically: no pack key, module key or scope-item code may appear
 * anywhere in `src/` outside the data directory.
 *
 * This is the same gate increment 7 used for accelerators, widened to the
 * three kinds of identifier a pack introduces.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CONTENT_PACKS,
  packSize,
  __parsePacksForTests as parsePacks,
} from "@/lib/activate-content-packs";
import { ACTIVATE_WORKSTREAMS } from "@/lib/activate";

const PACK_DIR = "src/data/activate-packs";

function valid(over: Record<string, unknown> = {}) {
  return [
    {
      key: "TEST_PACK",
      variant: "Test",
      name: "A test pack",
      description: "For the suite.",
      modules: [
        {
          key: "MOD_A",
          name: "Module A",
          scopeItems: [
            { code: "TP-A-01", name: "An item", workstreamKey: "TESTING" },
          ],
        },
      ],
      ...over,
    },
  ];
}

describe("the packs that ship", () => {
  it("load, and every scope item points at a real workstream", () => {
    expect(CONTENT_PACKS.length).toBeGreaterThan(0);
    const keys = new Set(ACTIVATE_WORKSTREAMS.map((w) => w.key));
    for (const pack of CONTENT_PACKS) {
      for (const m of pack.modules) {
        for (const si of m.scopeItems) {
          expect(keys.has(si.workstreamKey)).toBe(true);
        }
      }
    }
  });

  it("carries a catalogue worth running a workshop against", () => {
    const sf = CONTENT_PACKS.find((p) => p.key === "SAP_ACTIVATE_SF");
    expect(sf).toBeDefined();
    expect(sf!.modules.length).toBeGreaterThanOrEqual(8);
    expect(packSize(sf!)).toBeGreaterThanOrEqual(40);
  });

  it("tags the user-facing items, because one generation rule depends on it", () => {
    // Without any `ux` tag the change-and-training rule can never fire, and
    // the pack would look complete while quietly disabling a control.
    const tagged = CONTENT_PACKS.flatMap((p) =>
      p.modules.flatMap((m) => m.scopeItems.filter((si) => (si.tags || "").includes("ux")))
    );
    expect(tagged.length).toBeGreaterThan(0);
  });

  it("registers every file in the pack directory", () => {
    /**
     * The loader holds a literal array of imports rather than scanning the
     * directory, because Next bundles server code and a runtime readdir does
     * not survive that. The cost is that a file can be added and never
     * loaded, so this is the check that makes the cost safe.
     */
    const files = readdirSync(PACK_DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(CONTENT_PACKS.length);
  });
});

describe("the loader refuses bad data rather than limping", () => {
  it("accepts a well-formed pack — the control case", () => {
    expect(parsePacks(valid())).toHaveLength(1);
  });

  it("rejects a workstream key that is not one of the methodology's", () => {
    const bad = valid();
    bad[0].modules[0].scopeItems[0].workstreamKey = "ANALYTCS";
    expect(() => parsePacks(bad)).toThrow(/invalid/i);
  });

  it("rejects a duplicate scope-item code ACROSS modules, not just within one", () => {
    const bad = valid({
      modules: [
        { key: "MOD_A", name: "Module A", scopeItems: [{ code: "TP-A-01", name: "One", workstreamKey: "TESTING" }] },
        { key: "MOD_B", name: "Module B", scopeItems: [{ code: "TP-A-01", name: "Two", workstreamKey: "TESTING" }] },
      ],
    });
    // A scope item is cited by its code in a workshop; two answering to the
    // same code make a decision log ambiguous.
    expect(() => parsePacks(bad)).toThrow(/duplicate scope item code/i);
  });

  it("rejects a duplicate module key", () => {
    const bad = valid({
      modules: [
        { key: "MOD_A", name: "Module A", scopeItems: [{ code: "TP-A-01", name: "One", workstreamKey: "TESTING" }] },
        { key: "MOD_A", name: "Module A again", scopeItems: [{ code: "TP-A-02", name: "Two", workstreamKey: "TESTING" }] },
      ],
    });
    expect(() => parsePacks(bad)).toThrow(/duplicate module key/i);
  });

  it("rejects two packs sharing a key", () => {
    expect(() => parsePacks([...valid(), ...valid({ name: "Another" })])).toThrow(
      /duplicate content pack key/i
    );
  });

  it("rejects a module with no scope items", () => {
    const bad = valid({ modules: [{ key: "MOD_A", name: "Module A", scopeItems: [] }] });
    expect(() => parsePacks(bad)).toThrow(/invalid/i);
  });

  it("rejects a malformed code or key", () => {
    const badCode = valid();
    badCode[0].modules[0].scopeItems[0].code = "lower-case";
    expect(() => parsePacks(badCode)).toThrow(/invalid/i);

    expect(() => parsePacks(valid({ key: "lower_case" }))).toThrow(/invalid/i);
  });
});

// ---------------------------------------------------------------------------

describe("THE EXIT GATE: packs are data, not code", () => {
  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
      else if (/\.(ts|tsx|js|jsx|json)$/.test(entry)) out.push(p);
    }
    return out;
  }

  it("mentions no pack key, module key or scope-item code anywhere in src/ outside the data directory", () => {
    const files = sourceFiles("src").filter(
      (f) => !f.replace(/\\/g, "/").startsWith(PACK_DIR)
    );

    const identifiers: string[] = [];
    for (const pack of CONTENT_PACKS) {
      identifiers.push(pack.key);
      for (const m of pack.modules) {
        identifiers.push(m.key);
        for (const si of m.scopeItems) identifiers.push(si.code);
      }
    }

    /**
     * Matched as a QUOTED LITERAL, not as a bare substring.
     *
     * The first version of this test looked for the raw text and drowned in
     * false positives: module keys like TIME, PERFORMANCE and LEARNING are
     * ordinary words that appear in unrelated enums, constants and prose all
     * over the codebase. A gate that cries wolf is one somebody switches off.
     *
     * A quoted literal is how a special-case would actually be written —
     * `if (m.key === "PAYROLL")` — so this still catches the thing the gate
     * exists for, without flagging the word "time" in a cache manager.
     */
    const quoted = (id: string) =>
      new RegExp(`["'\`]${id.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&")}["'\`]`);

    const offences: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const id of identifiers) {
        if (quoted(id).test(src)) offences.push(`${file} mentions ${id}`);
      }
    }

    /**
     * If this fails, somebody has special-cased a pack. That is the moment
     * the catalogue stops being data: from then on, adding one means reading
     * the code to find out which are handled specially, and the promise this
     * increment makes is no longer true.
     */
    expect(offences).toEqual([]);
  });

  it("needs no schema change to grow", () => {
    // A pack introduces nothing the template tables did not already store,
    // so adding one is never a migration. The shape of a scope item is
    // pinned to exactly what TemplateScopeItem holds.
    const fields = new Set<string>();
    for (const pack of CONTENT_PACKS) {
      for (const m of pack.modules) {
        for (const si of m.scopeItems) Object.keys(si).forEach((k) => fields.add(k));
      }
    }
    for (const f of fields) {
      expect(["code", "name", "workstreamKey", "tags"]).toContain(f);
    }
  });
});
