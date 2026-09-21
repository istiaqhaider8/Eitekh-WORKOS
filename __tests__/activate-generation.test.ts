/**
 * SAP Activate increment 10 — the backlog generation rules.
 *
 * THIS FILE IS THE EXIT GATE.
 *
 * Generation is a pure function so that each rule can be tested on its own,
 * and so a project manager asking "why does this item exist" can be answered
 * from the code rather than from somebody's recollection. Every rule gets a
 * test that it FIRES when it should and, where it matters, that it STAYS
 * SILENT when it should not — a rule tested only in the firing direction is
 * indistinguishable from one that fires always.
 */

import {
  planBacklog,
  taskStatusForDecision,
  ACTIVATE_DECISIONS,
  ACTIVATE_DECISION_TASK_STATUS,
  ACTIVATE_TASK_STATUSES,
  type ActivateDecisionValue,
  type DecisionInput,
  type ScopeItemInput,
} from "@/lib/activate-generation";

const MODULE = "mod-core";
const OTHER_MODULE = "mod-out";

function scopeItem(over: Partial<ScopeItemInput> = {}): ScopeItemInput {
  return {
    id: "si-1",
    code: "SI-01",
    name: "Role-based permissions",
    workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
    tags: null,
    moduleId: MODULE,
    ...over,
  };
}

function decision(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    id: "dec-1",
    scopeItemId: "si-1",
    decision: "CONFIGURE",
    openQuestion: null,
    questionOwnerId: null,
    deltas: [],
    ...over,
  };
}

function delta(over: Partial<DecisionInput["deltas"][number]> = {}) {
  return {
    id: "dl-1",
    title: "Permission group structure by population",
    buildType: "CONFIGURATION",
    priority: "MUST",
    size: "L",
    ownerId: null,
    targetPhaseKey: null,
    note: null,
    ...over,
  };
}

function run(decisions: DecisionInput[], items: ScopeItemInput[], inScope = [MODULE]) {
  return planBacklog({
    decisions,
    scopeItems: new Map(items.map((i) => [i.id, i])),
    modulesInScope: new Set(inScope),
  });
}

describe("R1 — an authored delta becomes one item", () => {
  it("produces one item per delta, carrying its own fields", () => {
    const out = run([decision({ deltas: [delta(), delta({ id: "dl-2", title: "Second" })] })], [scopeItem()]);
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe("Permission group structure by population");
    expect(out[0].priority).toBe("MUST");
    expect(out[0].size).toBe("L");
    expect(out[0].automatic).toBe(false);
    // The workstream comes from the scope item, not the delta: who owns the
    // subject is a property of the subject.
    expect(out[0].workstreamKey).toBe("APPLICATION_DESIGN_CONFIGURATION");
  });

  it("targets Realize by default and Run for a deferred decision", () => {
    expect(run([decision({ deltas: [delta()] })], [scopeItem()])[0].targetPhaseKey).toBe("REALIZE");

    const deferred = run([decision({ decision: "DEFER", deltas: [delta()] })], [scopeItem()]);
    // Deferred work was agreed, just not for this release. Putting it in
    // Realize would make the phase read as behind for work nobody intends to
    // do yet.
    expect(deferred[0].targetPhaseKey).toBe("RUN");
  });

  it("generates nothing for ADOPT or OUT_OF_SCOPE, even with deltas attached", () => {
    for (const d of ["ADOPT", "OUT_OF_SCOPE"]) {
      expect(run([decision({ decision: d, deltas: [delta()] })], [scopeItem()])).toHaveLength(0);
    }
  });
});

describe("R2 — an extension adds a regression scenario", () => {
  it("fires on EXTEND, as a MUST owned by testing", () => {
    const out = run([decision({ decision: "EXTEND" })], [scopeItem()]);
    const r2 = out.find((i) => i.originKey.endsWith(":R2"));
    expect(r2).toBeDefined();
    expect(r2!.priority).toBe("MUST");
    expect(r2!.workstreamKey).toBe("TESTING");
    expect(r2!.automatic).toBe(true);
  });

  it("stays silent on every other decision", () => {
    for (const d of ACTIVATE_DECISIONS.filter((x) => x !== "EXTEND")) {
      const out = run([decision({ decision: d })], [scopeItem()]);
      expect(out.filter((i) => i.originKey.endsWith(":R2"))).toHaveLength(0);
    }
  });
});

describe("R3 — an integration adds error handling and monitoring", () => {
  it("fires on INTEGRATE, owned by integration", () => {
    const out = run([decision({ decision: "INTEGRATE" })], [scopeItem()]);
    const r3 = out.find((i) => i.originKey.endsWith(":R3"));
    expect(r3).toBeDefined();
    expect(r3!.workstreamKey).toBe("INTEGRATION");
    expect(r3!.priority).toBe("MUST");
  });

  it("stays silent on every other decision", () => {
    for (const d of ACTIVATE_DECISIONS.filter((x) => x !== "INTEGRATE")) {
      const out = run([decision({ decision: d })], [scopeItem()]);
      expect(out.filter((i) => i.originKey.endsWith(":R3"))).toHaveLength(0);
    }
  });
});

describe("R4 — a user-facing change adds a change and training item", () => {
  it("fires when the scope item is tagged ux and the decision generates work", () => {
    const out = run([decision({ decision: "CONFIGURE" })], [scopeItem({ tags: "ux" })]);
    const r4 = out.find((i) => i.originKey.endsWith(":R4"));
    expect(r4).toBeDefined();
    expect(r4!.workstreamKey).toBe("SOLUTION_ADOPTION");
  });

  it("does not fire without the tag", () => {
    const out = run([decision({ decision: "CONFIGURE" })], [scopeItem({ tags: null })]);
    expect(out.filter((i) => i.originKey.endsWith(":R4"))).toHaveLength(0);
  });

  it("does not fire on DEFER, because nothing visible changes this release", () => {
    const out = run([decision({ decision: "DEFER" })], [scopeItem({ tags: "ux" })]);
    expect(out.filter((i) => i.originKey.endsWith(":R4"))).toHaveLength(0);
  });

  it("does not fire on ADOPT, which changes nothing at all", () => {
    const out = run([decision({ decision: "ADOPT" })], [scopeItem({ tags: "ux" })]);
    expect(out.filter((i) => i.originKey.endsWith(":R4"))).toHaveLength(0);
  });

  it("reads the tag out of a comma-separated list, case-insensitively", () => {
    const out = run([decision({ decision: "CONFIGURE" })], [scopeItem({ tags: "payroll, UX , legal" })]);
    expect(out.filter((i) => i.originKey.endsWith(":R4"))).toHaveLength(1);
  });
});

describe("R5 — an open question is tracked whatever the decision", () => {
  it("fires even on ADOPT, which generates no build work", () => {
    const out = run(
      [decision({ decision: "ADOPT", openQuestion: "Who approves permissions after go-live?" })],
      [scopeItem()]
    );
    // A question that blocks sign-off is not build work. Letting it vanish
    // because the decision happened to be "adopt" is how a gate gets signed
    // over an unanswered question.
    expect(out).toHaveLength(1);
    expect(out[0].originKey).toBe("rule:dec-1:R5");
    expect(out[0].targetPhaseKey).toBe("EXPLORE");
    expect(out[0].workstreamKey).toBe("PROJECT_MANAGEMENT");
  });

  it("carries the question owner", () => {
    const out = run(
      [decision({ openQuestion: "Which countries first?", questionOwnerId: "user-7" })],
      [scopeItem()]
    );
    expect(out.find((i) => i.originKey.endsWith(":R5"))!.ownerId).toBe("user-7");
  });

  it("ignores whitespace that is not a question", () => {
    const out = run([decision({ decision: "ADOPT", openQuestion: "   " })], [scopeItem()]);
    expect(out).toHaveLength(0);
  });

  it("truncates a long question into a readable title", () => {
    const long = "x".repeat(300);
    const out = run([decision({ decision: "ADOPT", openQuestion: long })], [scopeItem()]);
    expect(out[0].title.length).toBeLessThan(120);
  });
});

describe("R0 — a module out of scope generates nothing", () => {
  it("produces no items, not even hidden ones", () => {
    const out = run(
      [decision({ decision: "EXTEND", openQuestion: "Anything?", deltas: [delta()] })],
      [scopeItem({ moduleId: OTHER_MODULE })],
      [MODULE]
    );
    // Absent, not merely filtered: a project measured against scope it is not
    // doing reads as behind when it is not.
    expect(out).toHaveLength(0);
  });

  it("still produces them once the module is switched in", () => {
    const items = [scopeItem({ moduleId: OTHER_MODULE })];
    const d = [decision({ decision: "EXTEND", deltas: [delta()] })];
    expect(run(d, items, [MODULE])).toHaveLength(0);
    // The accept case, so the test above cannot pass because of a typo in the
    // module id.
    expect(run(d, items, [MODULE, OTHER_MODULE]).length).toBeGreaterThan(0);
  });

  it("skips a decision whose scope item no longer exists", () => {
    // The catalogue can be re-authored under a project; a decision pointing at
    // something gone must not crash generation.
    expect(run([decision({ scopeItemId: "vanished" })], [scopeItem()])).toHaveLength(0);
  });
});

describe("Identity is stable, not positional", () => {
  it("keys an item by what produced it", () => {
    const out = run([decision({ decision: "EXTEND", deltas: [delta({ id: "dl-9" })] })], [scopeItem()]);
    expect(out.map((i) => i.originKey).sort()).toEqual(["delta:dl-9", "rule:dec-1:R2"]);
  });

  it("does not renumber existing items when a new decision is added", () => {
    const first = decision({ id: "dec-b", deltas: [delta({ id: "dl-b" })] });
    const before = run([first], [scopeItem()]);

    // A decision that sorts EARLIER than the existing one. A positional
    // scheme would shift every id after it; this is the failure the reference
    // design had, and it contradicted its own stated principle.
    const earlier = decision({ id: "dec-a", scopeItemId: "si-2", deltas: [delta({ id: "dl-a" })] });
    const after = run([earlier, first], [scopeItem(), scopeItem({ id: "si-2", code: "SI-02" })]);

    const beforeKey = before[0].originKey;
    expect(after.map((i) => i.originKey)).toContain(beforeKey);
    expect(new Set(after.map((i) => i.originKey)).size).toBe(after.length);
  });

  it("produces the same plan twice for the same input", () => {
    const input = () =>
      run(
        [decision({ decision: "INTEGRATE", openQuestion: "Which feed?", deltas: [delta()] })],
        [scopeItem({ tags: "ux" })]
      );
    expect(input()).toEqual(input());
  });
});

describe("Rules combine", () => {
  it("fires every applicable rule on one decision", () => {
    const out = run(
      [
        decision({
          decision: "INTEGRATE",
          openQuestion: "Which provider?",
          deltas: [delta(), delta({ id: "dl-2" })],
        }),
      ],
      [scopeItem({ tags: "ux" })]
    );
    // two deltas (R1) + R3 + R4 + R5
    expect(out).toHaveLength(5);
    expect(out.filter((i) => i.automatic)).toHaveLength(3);
    expect(new Set(out.map((i) => i.originKey)).size).toBe(5);
  });
});

describe("Fit-to-standard task status", () => {
  /**
   * All six, named individually.
   *
   * A table-driven test over ACTIVATE_DECISIONS would be shorter and would
   * also pass if the map and the expectation were generated from the same
   * mistaken idea. These are written out so the file states the intended
   * mapping in a form a reader can check against the specification without
   * running anything.
   */
  it.each([
    ["ADOPT", "DONE"],
    ["DEFER", "DONE"],
    ["OUT_OF_SCOPE", "DONE"],
    ["CONFIGURE", "BACKLOG"],
    ["EXTEND", "BACKLOG"],
    ["INTEGRATE", "BACKLOG"],
  ])("maps %s to %s", (decisionValue, expected) => {
    expect(taskStatusForDecision(decisionValue)).toBe(expected);
    expect(ACTIVATE_DECISION_TASK_STATUS[decisionValue as ActivateDecisionValue]).toBe(expected);
  });

  it("covers every decision in the vocabulary, with nothing extra", () => {
    // The map and the list of decisions must not drift apart: a seventh
    // decision added without a status here would otherwise fall through to
    // the "unrecognised" path and silently be treated as unsettled.
    expect(Object.keys(ACTIVATE_DECISION_TASK_STATUS).sort()).toEqual([...ACTIVATE_DECISIONS].sort());
    for (const s of Object.values(ACTIVATE_DECISION_TASK_STATUS)) {
      expect(ACTIVATE_TASK_STATUSES).toContain(s);
    }
  });

  it("says nothing at all about an item nobody has decided", () => {
    // Not BACKLOG: an item the workshop has not reached yet is not work
    // somebody committed to, and counting it as such would inflate every
    // "outstanding build" figure by the size of the untouched catalogue.
    expect(taskStatusForDecision(null)).toBeNull();
    expect(taskStatusForDecision(undefined)).toBeNull();
    expect(taskStatusForDecision("")).toBeNull();
  });

  it("returns null for a decision it has never heard of", () => {
    // A value outside the six is a bug to surface, not to guess at.
    expect(taskStatusForDecision("MAYBE")).toBeNull();
    expect(taskStatusForDecision("adopt")).toBeNull(); // case matters; the stored values are upper
  });

  it("is carried on every planned item, including the automatic ones", () => {
    const out = run(
      [
        decision({
          decision: "INTEGRATE",
          openQuestion: "Which provider?",
          deltas: [delta()],
        }),
      ],
      [scopeItem({ tags: "ux" })]
    );
    expect(out.length).toBeGreaterThan(1);
    for (const item of out) expect(item.decisionTaskStatus).toBe("BACKLOG");
  });

  /**
   * The case that makes the two concepts worth keeping apart.
   *
   * A deferred item is settled — there is nothing left to decide — and the
   * thing agreed is still real work, filed into Run. If these two ever get
   * derived from one another, one of them breaks: either deferred items come
   * back as outstanding fit-to-standard work, or agreed scope vanishes from
   * the board.
   */
  it("marks a deferred item DONE while still generating its work", () => {
    const out = run([decision({ decision: "DEFER", deltas: [delta()] })], [scopeItem()]);
    expect(out).toHaveLength(1);
    expect(out[0].decisionTaskStatus).toBe("DONE");
    expect(out[0].targetPhaseKey).toBe("RUN");
  });

  it("marks an open question from a settled decision DONE, and still tracks it", () => {
    // R5 fires on ADOPT, which generates no build work. The action exists;
    // the scope item it hangs off is finished. Both are true at once.
    const out = run(
      [decision({ decision: "ADOPT", openQuestion: "Who owns the exception list?" })],
      [scopeItem()]
    );
    expect(out).toHaveLength(1);
    expect(out[0].originKey).toBe("rule:dec-1:R5");
    expect(out[0].decisionTaskStatus).toBe("DONE");
  });

  it("treats a decision outside the vocabulary as unsettled, not as done", () => {
    // Legacy or imported rows. Erring towards BACKLOG keeps the item on
    // somebody's list; erring towards DONE would remove it from every view
    // that would have prompted a human to look at it.
    const out = run(
      [decision({ decision: "LEGACY_VALUE", openQuestion: "Still relevant?" })],
      [scopeItem()]
    );
    expect(out).toHaveLength(1);
    expect(out[0].decisionTaskStatus).toBe("BACKLOG");
  });
});
