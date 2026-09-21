/**
 * The letter a phase's deliverable codes carry.
 *
 * WHY THIS HAS A TEST OF ITS OWN
 *
 * The first implementation hard-coded "D-", which was invisibly correct
 * while only Discover had a worksheet and produced D-01 through D-12 on the
 * Prepare phase the moment a second one did. A constant that is right for
 * exactly one caller is the kind of thing a test catches and a review does
 * not.
 */

import { PHASE_CODE_PREFIX, codePrefixFor } from "@/lib/activate-worksheet";
import { ACTIVATE_PHASES } from "@/lib/activate";

describe("Deliverable code prefixes", () => {
  it.each([
    ["DISCOVER", "D"],
    ["PREPARE", "P"],
    ["EXPLORE", "E"],
    ["REALIZE", "R"],
    ["DEPLOY", "DP"],
    ["RUN", "RN"],
  ])("gives %s the prefix %s", (phase, prefix) => {
    expect(codePrefixFor(phase)).toBe(prefix);
  });

  it("covers every phase the methodology ships", () => {
    // A seventh phase added without a prefix would silently fall back to the
    // first two letters of its key, which may collide with an existing one.
    for (const phase of ACTIVATE_PHASES) {
      expect(PHASE_CODE_PREFIX[phase.key]).toBeDefined();
    }
  });

  it("gives no two phases the same prefix", () => {
    /**
     * The reason the map exists at all. Discover and Deploy both begin with
     * D, Realize and Run both with R, so deriving the prefix from the first
     * letter would put "D-03" on two different pieces of work. Codes are
     * unique per phase so the database would be fine; a status report citing
     * D-03 would not be.
     */
    const prefixes = Object.values(PHASE_CODE_PREFIX);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("falls back to two letters for a phase it has never heard of", () => {
    // A project on a custom methodology still gets a worksheet. Throwing
    // would mean a custom phase could not have one at all.
    expect(codePrefixFor("HYPERCARE")).toBe("HY");
    expect(codePrefixFor("pilot")).toBe("PI");
  });
});
