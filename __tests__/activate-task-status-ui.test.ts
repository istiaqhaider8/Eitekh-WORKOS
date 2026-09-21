/**
 * The workshop's copy of the task-status map, pinned to the library's.
 *
 * WHY THERE IS A COPY AT ALL
 *
 * The decision editor shows what a decision will mean BEFORE it is saved.
 * At that moment there is no server answer to display — the user has clicked
 * "Extend" and nothing has been written — so the component has to know the
 * mapping itself. Everywhere the server HAS answered, the component renders
 * the API's `taskStatus` field rather than recomputing it.
 *
 * WHY THIS TEST
 *
 * A duplicated lookup table is a drift waiting to happen, and the way anyone
 * finds out is a badge that disagrees with a report. Reading the component's
 * source and comparing it entry by entry with
 * `ACTIVATE_DECISION_TASK_STATUS` turns that drift into a failing build
 * instead. It is a source-level test on purpose: rendering the component
 * would need React and a DOM to check a constant.
 */

import { readFileSync } from "node:fs";
import {
  ACTIVATE_DECISION_TASK_STATUS,
  ACTIVATE_DECISIONS,
} from "@/lib/activate-generation";

const SOURCE = readFileSync("src/components/activate/ActivateWorkshop.tsx", "utf8");

/** The `TASK_STATUS` literal as the component declares it. */
function uiMap(): Record<string, string> {
  const start = SOURCE.indexOf("const TASK_STATUS");
  if (start < 0) throw new Error("TASK_STATUS was not found in ActivateWorkshop.tsx");
  const open = SOURCE.indexOf("{", start);
  const close = SOURCE.indexOf("};", open);
  if (open < 0 || close < 0) throw new Error("TASK_STATUS literal could not be read");
  const block = SOURCE.slice(open, close);

  const out: Record<string, string> = {};
  for (const m of block.matchAll(/([A-Z_]+)\s*:\s*"(DONE|BACKLOG)"/g)) out[m[1]] = m[2];
  return out;
}

describe("The workshop's task-status map", () => {
  it("agrees with the library map on every decision", () => {
    expect(uiMap()).toEqual(ACTIVATE_DECISION_TASK_STATUS);
  });

  it("covers all six decisions and invents none", () => {
    // Asserted separately from the equality above so a failure says which of
    // the two problems it is: a missing decision, or an extra one.
    expect(Object.keys(uiMap()).sort()).toEqual([...ACTIVATE_DECISIONS].sort());
  });

  it("renders the decided list from the API field, not from its own map", () => {
    // The badge in the scope-item list must come from the server's answer.
    // If this ever reads TASK_STATUS[i.decision] instead, the list can
    // disagree with the backlog and the readiness figures, which is exactly
    // the failure the shared map exists to prevent.
    expect(SOURCE).toContain("<TaskStatusBadge status={i.taskStatus} />");
  });
});
