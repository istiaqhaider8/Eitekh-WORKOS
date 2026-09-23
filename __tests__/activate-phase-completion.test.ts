/**
 * The rule behind the phase page's "ALL COMPLETE" badge and its
 * Mark complete button.
 *
 * Two things are being protected here. The first is the arithmetic: an empty
 * phase must not read as a finished one, and a waived criterion must not hold
 * a phase open. The second is the boundary — completing the phase and signing
 * its gate stay separate acts, performed by people, and no amount of ticking
 * does either by itself. The last block reads the component's source to check
 * that, because the guarantee lives in what the component does NOT do and
 * there is no return value to assert on.
 */

import { readFileSync } from "node:fs";
import {
  isCriterionSettled,
  isPhaseWorkComplete,
  phaseIncompleteReason,
} from "@/lib/activate-phase-completion";

const counts = (
  tasksComplete: number,
  tasksTotal: number,
  criteriaSettled: number,
  criteriaTotal: number
) => ({ tasksTotal, tasksComplete, criteriaTotal, criteriaSettled });

describe("isCriterionSettled", () => {
  it("counts a met criterion", () => {
    expect(isCriterionSettled("MET")).toBe(true);
  });

  it("counts a waived one: a waiver is an answer, not an open question", () => {
    expect(isCriterionSettled("WAIVED")).toBe(true);
  });

  it("does not count pending or not-met", () => {
    expect(isCriterionSettled("PENDING")).toBe(false);
    expect(isCriterionSettled("NOT_MET")).toBe(false);
  });

  it("does not count a missing status", () => {
    expect(isCriterionSettled(null)).toBe(false);
    expect(isCriterionSettled(undefined)).toBe(false);
  });
});

describe("isPhaseWorkComplete", () => {
  it("is true when every task is done and every criterion is settled", () => {
    expect(isPhaseWorkComplete(counts(25, 25, 7, 7))).toBe(true);
  });

  it("is false with one task outstanding", () => {
    expect(isPhaseWorkComplete(counts(24, 25, 7, 7))).toBe(false);
  });

  it("is false with one criterion unsettled", () => {
    expect(isPhaseWorkComplete(counts(25, 25, 6, 7))).toBe(false);
  });

  it("is false for an empty phase, which is not the same as a finished one", () => {
    // Zero of zero is arithmetically complete and practically meaningless.
    // Without this, every phase of a new project would announce itself done.
    expect(isPhaseWorkComplete(counts(0, 0, 0, 0))).toBe(false);
  });

  it("is false when the tasks are all done but the gate has no criteria", () => {
    expect(isPhaseWorkComplete(counts(25, 25, 0, 0))).toBe(false);
  });

  it("is false when the criteria are settled but the phase has no tasks", () => {
    expect(isPhaseWorkComplete(counts(0, 0, 7, 7))).toBe(false);
  });

  it("is false before the worksheet has loaded", () => {
    // Null and "nothing outstanding" must not look alike.
    expect(isPhaseWorkComplete(null)).toBe(false);
    expect(isPhaseWorkComplete(undefined)).toBe(false);
  });
});

describe("phaseIncompleteReason", () => {
  it("is null when the phase is finished, so the tooltip can say so instead", () => {
    expect(phaseIncompleteReason(counts(25, 25, 7, 7))).toBeNull();
  });

  it("counts the outstanding tasks", () => {
    expect(phaseIncompleteReason(counts(22, 25, 7, 7))).toBe("3 tasks outstanding.");
  });

  it("says one task, singular", () => {
    expect(phaseIncompleteReason(counts(24, 25, 7, 7))).toBe("1 task outstanding.");
  });

  it("counts the unsettled criteria, singular and plural", () => {
    expect(phaseIncompleteReason(counts(25, 25, 6, 7))).toBe("1 gate criterion unsettled.");
    expect(phaseIncompleteReason(counts(25, 25, 4, 7))).toBe("3 gate criteria unsettled.");
  });

  it("names both when both are in the way", () => {
    expect(phaseIncompleteReason(counts(20, 25, 5, 7))).toBe(
      "5 tasks outstanding, 2 gate criteria unsettled."
    );
  });

  it("explains an empty phase rather than reporting nothing outstanding", () => {
    expect(phaseIncompleteReason(counts(0, 0, 0, 0))).toBe(
      "This phase has no deliverables or gate criteria yet."
    );
  });

  it("says so when only one half is empty", () => {
    expect(phaseIncompleteReason(counts(25, 25, 0, 0))).toBe("the gate has no criteria yet.");
    expect(phaseIncompleteReason(counts(0, 0, 7, 7))).toBe("this phase has no tasks yet.");
  });
});

describe("the phase page keeps completing and signing separate", () => {
  const SOURCE = readFileSync("src/components/activate/ActivateWorkspace.tsx", "utf8");

  it("asks a person to complete the phase rather than doing it on the last tick", () => {
    expect(SOURCE).toContain("Mark complete");
    expect(SOURCE).toContain('JSON.stringify({ status: "COMPLETED" })');
  });

  it("offers it only to someone who may manage phases", () => {
    const button = SOURCE.slice(SOURCE.indexOf("Mark complete") - 1600);
    expect(button).toContain('can("activate:manage_phases")');
  });

  it("never raises or approves a gate from the completion state", () => {
    // The whole point of a gate is that somebody raises it and somebody else
    // signs it. A checklist that did either would remove the control while
    // leaving the panel that describes it on screen.
    //
    // Scoped to the button ITSELF rather than to everything between
    // `const allComplete` and the label. That wider slice broke the first
    // time an unrelated element carrying the word "APPROVED" — the phase
    // rail's gate indicator — was added between the two anchors. It failed
    // on a change that could not possibly have caused the problem it
    // describes, which is a test reporting on its own shape rather than on
    // the code. The element below is the thing that must not sign a gate.
    const start = SOURCE.indexOf("Completing a phase is a DECISION");
    expect(start).toBeGreaterThan(-1);
    const labelAt = SOURCE.indexOf("Mark complete", start);
    expect(labelAt).toBeGreaterThan(start);
    const button = SOURCE.slice(start, labelAt);

    expect(button).not.toMatch(/"RAISED"|"APPROVED"|raiseGate|approveGate/);
    // ...and it is a phase status change, nothing else.
    expect(button).toContain('JSON.stringify({ status: "COMPLETED" })');
    expect(button).not.toContain("/approvals");
    expect(button).not.toContain("/raise");
  });

  it("derives the badge from the shared rule rather than its own arithmetic", () => {
    expect(SOURCE).toContain("isPhaseWorkComplete(counts)");
  });

  it("ignores counts belonging to a phase other than the one on screen", () => {
    // During a phase switch the previous phase's totals are still in hand,
    // and they would otherwise light up the button on a phase nobody has
    // opened yet.
    expect(SOURCE).toContain("worksheetCounts?.phaseKey === selected?.key");
  });
});

describe("SAP Activate Phase Gate Rules and progression definitions", () => {
  const { PHASE_PROGRESSION_RULES } = require("@/lib/activate-phase-completion");

  it("defines strict progression prerequisites for all sequential phase transitions", () => {
    expect(PHASE_PROGRESSION_RULES.PREPARE).toEqual({
      fromKey: "DISCOVER",
      toKey: "PREPARE",
      fromName: "Discover",
      toName: "Prepare",
      checkName: "Discovery activities",
      requirementDescription:
        "All Discover Deliverables & Workstreams and Discovery activities must be completed.",
    });

    expect(PHASE_PROGRESSION_RULES.EXPLORE).toEqual({
      fromKey: "PREPARE",
      toKey: "EXPLORE",
      fromName: "Prepare",
      toName: "Explore",
      checkName: "Project Readiness checks",
      requirementDescription:
        "All Prepare Deliverables & Workstreams and Project Readiness checks must be completed.",
    });

    expect(PHASE_PROGRESSION_RULES.REALIZE).toEqual({
      fromKey: "EXPLORE",
      toKey: "REALIZE",
      fromName: "Explore",
      toName: "Realize",
      checkName: "Design completion checks",
      requirementDescription:
        "All Explore Deliverables & Workstreams and all Design completion checks must be completed.",
    });

    expect(PHASE_PROGRESSION_RULES.DEPLOY).toEqual({
      fromKey: "REALIZE",
      toKey: "DEPLOY",
      fromName: "Realize",
      toName: "Deploy",
      checkName: "Solution Ready checks",
      requirementDescription:
        "All Realize Deliverables & Workstreams and all Solution Ready checks must be completed.",
    });

    expect(PHASE_PROGRESSION_RULES.RUN).toEqual({
      fromKey: "DEPLOY",
      toKey: "RUN",
      fromName: "Deploy",
      toName: "Run",
      checkName: "Go-Live Readiness checks",
      requirementDescription:
        "All Deploy Deliverables & Workstreams and all Go-Live Readiness checks must be completed.",
    });
  });
});

