/**
 * Turning fit-to-standard decisions into work.
 *
 * WHY THIS IS A PURE FUNCTION
 *
 * `planBacklog` takes decisions and the modules in scope and returns what
 * should exist. It touches no database, so every rule can be tested on its
 * own, and a project manager asking "why is this item here" gets an answer
 * from `originKey` rather than from somebody's memory. The route that writes
 * the rows is a separate, boring thing.
 *
 * WHY THE KEYS ARE NOT POSITIONAL
 *
 * Each planned item carries an `originKey` derived from what produced it —
 * a delta id, or a decision id plus the rule that fired. The reference design
 * this was compared against numbered its items BL-001, BL-002 in iteration
 * order, so recording one more decision renumbered everything after it. That
 * breaks the moment anyone cites an item in a meeting or diffs two exports,
 * and it contradicted that same document's own insistence on stable ids.
 *
 * Stable keys also make generation idempotent for free: the column is unique,
 * so running it twice converges instead of duplicating.
 *
 * WHICH RULES CARRY JUDGEMENT
 *
 * R1 is bookkeeping — an authored delta is work somebody already identified.
 * R2, R3 and R4 are the ones that add items people forget, and each exists
 * because of a specific way programmes go wrong. They are stated as rules
 * rather than left to a checklist precisely so they cannot be skipped on the
 * day everyone is busy.
 */

/** The six outcomes of a fit-to-standard conversation. */
export const ACTIVATE_DECISIONS = [
  "ADOPT",
  "CONFIGURE",
  "EXTEND",
  "INTEGRATE",
  "DEFER",
  "OUT_OF_SCOPE",
] as const;
export type ActivateDecisionValue = (typeof ACTIVATE_DECISIONS)[number];

/** Decisions that produce build work. ADOPT and OUT_OF_SCOPE produce none. */
const GENERATES = new Set<string>(["CONFIGURE", "EXTEND", "INTEGRATE", "DEFER"]);

export const ACTIVATE_BUILD_TYPES = [
  "CONFIGURATION",
  "BUSINESS_RULE",
  "WORKFLOW",
  "REPORT",
  "INTERFACE",
  "CONVERSION",
  "ENHANCEMENT",
  "FORM",
] as const;

export const ACTIVATE_PRIORITIES = ["MUST", "SHOULD", "COULD", "WONT"] as const;
export const ACTIVATE_SIZES = ["S", "M", "L", "XL"] as const;
export const ACTIVATE_DECISION_STATUSES = ["DRAFT", "AGREED"] as const;

/** The default build type for a decision that generates work. */
const DEFAULT_BUILD_TYPE: Record<string, string> = {
  CONFIGURE: "CONFIGURATION",
  EXTEND: "ENHANCEMENT",
  INTEGRATE: "INTERFACE",
  DEFER: "CONFIGURATION",
};

export interface ScopeItemInput {
  id: string;
  code: string;
  name: string;
  workstreamKey: string;
  /** Comma-separated. `ux` means employees or managers see the change. */
  tags: string | null;
  moduleId: string;
}

export interface DeltaInput {
  id: string;
  title: string;
  buildType: string;
  priority: string;
  size: string;
  ownerId: string | null;
  targetPhaseKey: string | null;
  note: string | null;
}

export interface DecisionInput {
  id: string;
  scopeItemId: string;
  decision: string;
  openQuestion: string | null;
  questionOwnerId: string | null;
  deltas: DeltaInput[];
}

export interface PlannedItem {
  /** Stable identity: what produced this, not where it landed in a list. */
  originKey: string;
  title: string;
  buildType: string;
  priority: string;
  size: string;
  ownerId: string | null;
  workstreamKey: string;
  targetPhaseKey: string;
  scopeItemId: string;
  scopeItemCode: string;
  decisionId: string;
  decision: string;
  /** False for an authored delta, true for one a rule added. */
  automatic: boolean;
  note: string | null;
}

export interface PlanInput {
  decisions: DecisionInput[];
  scopeItems: Map<string, ScopeItemInput>;
  /** Module ids the project is doing. A module not here generates nothing. */
  modulesInScope: Set<string>;
}

const hasTag = (tags: string | null, tag: string) =>
  (tags || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .includes(tag);

export function planBacklog(input: PlanInput): PlannedItem[] {
  const out: PlannedItem[] = [];

  // Sorted so the output order is deterministic. Order is presentation only —
  // identity lives in originKey — but a stable order makes two runs diffable.
  const decisions = [...input.decisions].sort((a, b) => a.id.localeCompare(b.id));

  for (const d of decisions) {
    const si = input.scopeItems.get(d.scopeItemId);
    if (!si) continue;

    /**
     * R0 — a module the project is not doing generates nothing at all.
     *
     * Not merely hidden: absent. A project measured against scope it is not
     * doing reads as behind when it is not, which is how a status report
     * starts lying.
     */
    if (!input.modulesInScope.has(si.moduleId)) continue;

    const generates = GENERATES.has(d.decision);
    const ux = hasTag(si.tags, "ux");

    // R1 — every authored delta becomes one item.
    if (generates) {
      for (const dl of d.deltas) {
        out.push({
          originKey: `delta:${dl.id}`,
          title: dl.title,
          buildType: dl.buildType || DEFAULT_BUILD_TYPE[d.decision] || "CONFIGURATION",
          priority: dl.priority,
          size: dl.size,
          ownerId: dl.ownerId,
          workstreamKey: si.workstreamKey,
          // A deferred item lands in Run rather than Realize: it was agreed,
          // just not for this release, and putting it in Realize would make
          // the phase look behind for work nobody intends to do yet.
          targetPhaseKey: d.decision === "DEFER" ? "RUN" : dl.targetPhaseKey || "REALIZE",
          scopeItemId: si.id,
          scopeItemCode: si.code,
          decisionId: d.id,
          decision: d.decision,
          automatic: false,
          note: dl.note,
        });
      }
    }

    /**
     * R2 — anything extended has to be re-proved at every vendor release.
     *
     * Extensions are what break when the vendor ships. Without a standing
     * regression scenario the breakage is found by a user, in production,
     * months later.
     */
    if (d.decision === "EXTEND") {
      out.push({
        originKey: `rule:${d.id}:R2`,
        title: `Upgrade regression scenario — ${si.name}`,
        buildType: "CONFIGURATION",
        priority: "MUST",
        size: "S",
        ownerId: null,
        workstreamKey: "TESTING",
        targetPhaseKey: "REALIZE",
        scopeItemId: si.id,
        scopeItemCode: si.code,
        decisionId: d.id,
        decision: d.decision,
        automatic: true,
        note: "Extensions are what break when the vendor releases. This joins the permanent regression pack.",
      });
    }

    /**
     * R3 — an interface with no defined failure path is not designed.
     *
     * The question this item forces: who is told when it fails, and what
     * happens to the data in the meantime.
     */
    if (d.decision === "INTEGRATE") {
      out.push({
        originKey: `rule:${d.id}:R3`,
        title: `Error handling and monitoring — ${si.name}`,
        buildType: "INTERFACE",
        priority: "MUST",
        size: "S",
        ownerId: null,
        workstreamKey: "INTEGRATION",
        targetPhaseKey: "REALIZE",
        scopeItemId: si.id,
        scopeItemCode: si.code,
        decisionId: d.id,
        decision: d.decision,
        automatic: true,
        note: "Who is told when this fails, and what happens to the data in the meantime.",
      });
    }

    /**
     * R4 — a change people can see needs a change item, or adoption suffers.
     *
     * Not fired for DEFER, because nothing visible changes this release.
     */
    if (generates && ux && d.decision !== "DEFER") {
      out.push({
        originKey: `rule:${d.id}:R4`,
        title: `Change and training — ${si.name}`,
        buildType: "CONFIGURATION",
        priority: "SHOULD",
        size: "S",
        ownerId: null,
        workstreamKey: "SOLUTION_ADOPTION",
        targetPhaseKey: "REALIZE",
        scopeItemId: si.id,
        scopeItemCode: si.code,
        decisionId: d.id,
        decision: d.decision,
        automatic: true,
        note: "Employee or manager facing. Adoption is where programmes lose their benefits case.",
      });
    }

    /**
     * R5 — an open question becomes a tracked action, WHATEVER the decision.
     *
     * Including on ADOPT and OUT_OF_SCOPE, which generate no build work. A
     * question that blocks sign-off is not build work, and letting it
     * disappear because the decision happened to be "adopt" is exactly how a
     * gate gets signed over an unanswered question.
     */
    if (d.openQuestion && d.openQuestion.trim()) {
      out.push({
        originKey: `rule:${d.id}:R5`,
        title: `Open question — ${d.openQuestion.trim().slice(0, 80)}`,
        buildType: "CONFIGURATION",
        priority: "MUST",
        size: "S",
        ownerId: d.questionOwnerId,
        workstreamKey: "PROJECT_MANAGEMENT",
        targetPhaseKey: "EXPLORE",
        scopeItemId: si.id,
        scopeItemCode: si.code,
        decisionId: d.id,
        decision: d.decision,
        automatic: true,
        note: "Blocks design sign-off for this scope item.",
      });
    }
  }

  return out;
}
