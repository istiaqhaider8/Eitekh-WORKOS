/**
 * The methodology's own content: 57 deliverables, 213 tasks, 48 criteria.
 *
 * This is the data every new project is now seeded from, and data is where a
 * silent mistake survives longest — a duplicated deliverable name or a
 * workstream key with a typo produces a plan that looks fine and files work
 * in the wrong place. None of that is caught by types, so it is caught here.
 */

import { ACTIVATE_PHASE_CONTENT, contentTotals } from "@/lib/activate-template-content";
import { ACTIVATE_PHASES, ACTIVATE_WORKSTREAMS } from "@/lib/activate";

const KEYS = ["DISCOVER", "PREPARE", "EXPLORE", "REALIZE", "DEPLOY", "RUN"];

describe("The methodology content", () => {
  it("covers all six phases and invents none", () => {
    expect(Object.keys(ACTIVATE_PHASE_CONTENT).sort()).toEqual([...KEYS].sort());
  });

  it("carries the plan the reference project was built from", () => {
    // Pinned so a careless edit to a 700-line data file is visible as a
    // number rather than as a diff nobody reads to the end of.
    expect(contentTotals()).toEqual({ deliverables: 57, tasks: 213, criteria: 48 });
  });

  it("gives every phase deliverables, and every deliverable tasks", () => {
    for (const key of KEYS) {
      const phase = ACTIVATE_PHASE_CONTENT[key];
      expect({ key, deliverables: phase.deliverables.length > 0 }).toEqual({
        key,
        deliverables: true,
      });
      for (const d of phase.deliverables) {
        // A deliverable with no checklist cannot be progressed, and the
        // worksheet's "0 of 0 tasks" is the one state that reads as finished
        // while nothing has been done.
        expect({ phase: key, name: d.name, tasks: d.tasks.length > 0 }).toEqual({
          phase: key,
          name: d.name,
          tasks: true,
        });
      }
    }
  });

  it("files every deliverable under a workstream the methodology has", () => {
    const known = new Set(ACTIVATE_WORKSTREAMS.map((w) => w.key));
    const unknown: string[] = [];
    for (const key of KEYS) {
      for (const d of ACTIVATE_PHASE_CONTENT[key].deliverables) {
        if (!known.has(d.workstreamKey)) unknown.push(`${key}: ${d.name} -> ${d.workstreamKey}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("does not repeat a deliverable name within a phase", () => {
    // The seeder skips a deliverable whose name already exists in the phase,
    // so a duplicate here would silently produce one fewer than intended.
    for (const key of KEYS) {
      const names = ACTIVATE_PHASE_CONTENT[key].deliverables.map((d) => d.name);
      expect({ key, unique: new Set(names).size }).toEqual({ key, unique: names.length });
    }
  });

  it("does not repeat a task within a deliverable, or a criterion within a gate", () => {
    for (const key of KEYS) {
      for (const d of ACTIVATE_PHASE_CONTENT[key].deliverables) {
        expect({ d: d.name, unique: new Set(d.tasks).size }).toEqual({
          d: d.name,
          unique: d.tasks.length,
        });
      }
      const c = ACTIVATE_PHASE_CONTENT[key].gate.criteria;
      expect({ key, unique: new Set(c).size }).toEqual({ key, unique: c.length });
    }
  });

  it("has no blank or untrimmed text anywhere", () => {
    const bad: string[] = [];
    const check = (where: string, v: string) => {
      if (v.trim().length === 0 || v !== v.trim()) bad.push(`${where}: ${JSON.stringify(v)}`);
    };
    for (const key of KEYS) {
      const phase = ACTIVATE_PHASE_CONTENT[key];
      check(`${key} gate name`, phase.gate.name);
      phase.gate.criteria.forEach((c, i) => check(`${key} criterion ${i}`, c));
      for (const d of phase.deliverables) {
        check(`${key} deliverable`, d.name);
        d.tasks.forEach((t, i) => check(`${key} ${d.name} task ${i}`, t));
      }
    }
    expect(bad).toEqual([]);
  });

  it("is the single source of the built-in gates", () => {
    // Two copies of a gate's criteria is how a project ends up being asked
    // questions the methodology no longer contains.
    for (const p of ACTIVATE_PHASES) {
      expect({ key: p.key, name: p.gate.name, criteria: p.gate.criteria }).toEqual({
        key: p.key,
        name: ACTIVATE_PHASE_CONTENT[p.key].gate.name,
        criteria: ACTIVATE_PHASE_CONTENT[p.key].gate.criteria,
      });
    }
  });
});
