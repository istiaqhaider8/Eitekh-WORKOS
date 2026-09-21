"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";

/**
 * One phase's implementation worksheet: its deliverables, their task
 * checklists, the quality gate and what each workstream is carrying.
 *
 * EVERY NUMBER ON THIS SCREEN IS DERIVED
 *
 * "7 deliverables · 4 of 25 tasks complete", each card's "0/4 tasks", the
 * gate's "0/7" and the per-workstream counts are all computed from the rows
 * the server returned. None of them is stored or passed in, so ticking a
 * task updates every one of them at once and they cannot disagree with each
 * other or with the database.
 *
 * WHY IT RELOADS AFTER EVERY MUTATION RATHER THAN PATCHING LOCAL STATE
 *
 * The counts, the codes and the gate all move together, and a partial local
 * update is how a screen ends up showing 4 of 25 next to a list containing
 * twenty-six things. The requests are small and the reload is one query set;
 * correctness is worth more here than saving a round trip. It also means a
 * server refusal — a locked gate, a permission — leaves the screen showing
 * what is actually true rather than an optimistic lie.
 */

interface Task {
  id: string;
  title: string;
  isCompleted: boolean;
}

interface Deliverable {
  linkId: string;
  issueId: string;
  issueKey: string;
  phaseCode: string | null;
  name: string;
  workstreamId: string | null;
  workstreamName: string | null;
  tasks: Task[];
  tasksTotal: number;
  tasksComplete: number;
}

interface Gate {
  id: string;
  code: string;
  name: string;
  status: string;
  criteria: Array<{ id: string; criterion: string; status: string; met: boolean }>;
  criteriaTotal: number;
  criteriaMet: number;
}

interface Worksheet {
  phaseId: string;
  phaseKey: string;
  phaseName: string;
  deliverables: Deliverable[];
  deliverableCount: number;
  unlistedCount: number;
  tasksTotal: number;
  tasksComplete: number;
  gate: Gate | null;
  workstreams: Array<{ id: string; key: string; name: string; deliverableCount: number }>;
}

export interface ActivateWorksheetProps {
  projectId: string;
  phaseKey: string;
  /** Every phase, so the worksheet can be switched without leaving it. */
  phases: Array<{ key: string; name: string }>;
  onPhaseChange: (key: string) => void;
  canManageDeliverables: boolean;
  canManageGates: boolean;
  onOpenIssue?: (issueId: string) => void;
  onChanged?: () => void;
}

/** A gate whose sign-off is in progress must not have its questions edited. */
const GATE_LOCKED = new Set(["RAISED", "APPROVED"]);

export function ActivateWorksheet({
  projectId,
  phaseKey,
  phases,
  onPhaseChange,
  canManageDeliverables,
  canManageGates,
  onOpenIssue,
  onChanged,
}: ActivateWorksheetProps) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<Worksheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTask, setNewTask] = useState<Record<string, string>>({});
  const [newDeliverable, setNewDeliverable] = useState("");
  const [newDeliverableWs, setNewDeliverableWs] = useState("");
  const [newCriterion, setNewCriterion] = useState("");

  const base = `/api/projects/${projectId}/activate/phases/${phaseKey}/worksheet`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(base);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load the worksheet.");
      setSheet(data.worksheet);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Could not load the worksheet.");
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  /** Every mutation goes through here: one place that reports refusals. */
  const mutate = async (url: string, init: RequestInit, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The API writes its refusals to be read by a person — a locked gate
        // says what to do about it — so show what it said.
        setError(data?.error || `${failure} (${res.status}).`);
        return false;
      }
      await load();
      onChanged?.();
      return true;
    } catch {
      setError("The request could not be sent.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
        Loading the worksheet…
      </div>
    );
  }

  if (!sheet) {
    return (
      <div className="p-6 text-center">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error ?? "This phase has no worksheet."}
        </p>
      </div>
    );
  }

  const gateLocked = sheet.gate ? GATE_LOCKED.has(sheet.gate.status) : false;

  return (
    <div className="space-y-4">
      <div aria-live="polite" className="min-h-[1rem]">
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      {/* Which phase's worksheet. Here rather than only on the phase rail,
          because the worksheet is where somebody works through a phase and
          sending them to another tab to change it is a detour. */}
      <div className="flex items-center gap-2">
        <label
          htmlFor="worksheet-phase"
          className="text-[11px] font-semibold text-slate-600 dark:text-slate-400"
        >
          Phase
        </label>
        <select
          id="worksheet-phase"
          value={phaseKey}
          onChange={(e) => onPhaseChange(e.target.value)}
          className="text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5"
        >
          {phases.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* 70/30 on desktop, stacked on a phone — the gate and the workstream
          summary read as context beside the work, not as separate pages. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] gap-4 items-start">
        {/* Deliverables and tasks ---------------------------------------- */}
        <section>
          <div className="flex items-baseline gap-2 flex-wrap mb-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Deliverables and tasks
            </h3>
            <span className="text-[11px] text-slate-500">
              {sheet.deliverableCount} deliverable{sheet.deliverableCount === 1 ? "" : "s"} ·{" "}
              {sheet.tasksComplete} of {sheet.tasksTotal} task
              {sheet.tasksTotal === 1 ? "" : "s"} complete
            </span>
            {/* Disclosed, not listed and not hidden: work genuinely in this
                phase that is not a numbered line of its plan — a decision
                card, an issue adopted from the board. */}
            {sheet.unlistedCount > 0 && (
              <span className="text-[11px] text-slate-400">
                · {sheet.unlistedCount} more linked to this phase without a worksheet code
              </span>
            )}
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
            {sheet.deliverables.length === 0 && (
              <p className="text-xs text-slate-500 p-6 text-center">
                No deliverables in {sheet.phaseName} yet.
              </p>
            )}

            {sheet.deliverables.map((d) => (
              <article key={d.linkId} className="p-4">
                <div className="flex items-start gap-3">
                  <span className="font-mono text-[10px] text-slate-400 pt-1 min-w-[2.5rem]">
                    {d.phaseCode ?? "—"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenIssue?.(d.issueId)}
                      className="text-sm font-bold text-slate-900 dark:text-white text-left hover:underline"
                      title={`Open ${d.issueKey}`}
                    >
                      {d.name}
                    </button>
                    <p className="text-[11px] text-slate-500">
                      {d.workstreamName ?? "No workstream"} · {d.tasksComplete}/{d.tasksTotal}{" "}
                      tasks
                    </p>
                  </div>

                  <label className="sr-only" htmlFor={`ws-${d.linkId}`}>
                    Workstream for {d.name}
                  </label>
                  <select
                    id={`ws-${d.linkId}`}
                    aria-label={`Workstream for ${d.name}`}
                    value={d.workstreamId ?? ""}
                    disabled={!canManageDeliverables || busy}
                    onChange={(e) =>
                      mutate(
                        `/api/projects/${projectId}/activate/deliverables/${d.linkId}`,
                        {
                          method: "PATCH",
                          body: JSON.stringify({ workstreamId: e.target.value || null }),
                        },
                        "That workstream could not be set"
                      )
                    }
                    className="text-[11px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-1 max-w-[9rem]"
                  >
                    <option value="">No workstream</option>
                    {sheet.workstreams.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>

                  {canManageDeliverables && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Remove ${d.phaseCode ?? d.issueKey} from ${sheet.phaseName}? ` +
                              `${d.issueKey} stays on the board.`
                          )
                        )
                          return;
                        mutate(
                          `/api/projects/${projectId}/activate/deliverables/${d.linkId}`,
                          { method: "DELETE" },
                          "That could not be removed"
                        );
                      }}
                      className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <ul className="mt-2 space-y-1 pl-[3.25rem]">
                  {d.tasks.map((t) => (
                    <li key={t.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`task-${t.id}`}
                        aria-label={`${t.title} — mark complete`}
                        checked={t.isCompleted}
                        disabled={!canManageDeliverables || busy}
                        onChange={(e) =>
                          mutate(
                            `/api/subtasks/${t.id}`,
                            {
                              method: "PATCH",
                              body: JSON.stringify({ isCompleted: e.target.checked }),
                            },
                            "That task could not be updated"
                          )
                        }
                        className="rounded border-slate-300 dark:border-slate-700"
                      />
                      <label
                        htmlFor={`task-${t.id}`}
                        className={`text-xs flex-1 min-w-0 ${
                          t.isCompleted
                            ? "line-through text-slate-400"
                            : "text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {t.title}
                      </label>
                      {canManageDeliverables && (
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`Remove task: ${t.title}`}
                          onClick={() =>
                            mutate(
                              `/api/subtasks/${t.id}`,
                              { method: "DELETE" },
                              "That task could not be removed"
                            )
                          }
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-500"
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>

                {canManageDeliverables && (
                  <form
                    className="flex gap-2 mt-2 pl-[3.25rem]"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const title = (newTask[d.linkId] ?? "").trim();
                      if (!title) return;
                      const ok = await mutate(
                        `/api/issues/${d.issueId}/subtasks`,
                        { method: "POST", body: JSON.stringify({ title }) },
                        "That task could not be added"
                      );
                      if (ok) setNewTask((s) => ({ ...s, [d.linkId]: "" }));
                    }}
                  >
                    <label className="sr-only" htmlFor={`newtask-${d.linkId}`}>
                      New task in {d.name}
                    </label>
                    <input
                      id={`newtask-${d.linkId}`}
                      aria-label={`New task in ${d.name}`}
                      value={newTask[d.linkId] ?? ""}
                      onChange={(e) => setNewTask((s) => ({ ...s, [d.linkId]: e.target.value }))}
                      placeholder={`New task in ${d.name}`}
                      className="flex-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5"
                    />
                    <button
                      type="submit"
                      disabled={busy || !(newTask[d.linkId] ?? "").trim()}
                      className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40"
                    >
                      Add
                    </button>
                  </form>
                )}
              </article>
            ))}
          </div>

          {/* Add deliverable --------------------------------------------- */}
          {canManageDeliverables && (
            <form
              className="mt-3 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-4 space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newDeliverable.trim()) return;
                const ok = await mutate(
                  base,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      name: newDeliverable.trim(),
                      workstreamId: newDeliverableWs || null,
                    }),
                  },
                  "That deliverable could not be added"
                );
                if (ok) setNewDeliverable("");
              }}
            >
              <h4 className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                New deliverable in {sheet.phaseName}
              </h4>
              <label className="sr-only" htmlFor="new-deliverable-name">
                Deliverable name
              </label>
              <input
                id="new-deliverable-name"
                value={newDeliverable}
                onChange={(e) => setNewDeliverable(e.target.value)}
                placeholder="Deliverable name"
                minLength={3}
                maxLength={200}
                className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-2"
              />
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="new-deliverable-ws">
                  Workstream for the new deliverable
                </label>
                <select
                  id="new-deliverable-ws"
                  value={newDeliverableWs}
                  onChange={(e) => setNewDeliverableWs(e.target.value)}
                  className="flex-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-2"
                >
                  <option value="">No workstream</option>
                  {sheet.workstreams.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={busy || newDeliverable.trim().length < 3}
                  className="px-3 py-2 text-[11px] font-bold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 disabled:opacity-40"
                >
                  Add deliverable
                </button>
              </div>
              <p className="text-[10px] text-slate-500">
                Code is assigned automatically from this phase&apos;s sequence.
              </p>
            </form>
          )}
        </section>

        {/* Gate and workstreams ------------------------------------------ */}
        <div className="space-y-4">
          {sheet.gate && (
            <section className="bg-white dark:bg-slate-900 rounded-2xl border-l-4 border-l-slate-800 dark:border-l-slate-300 border border-slate-200 dark:border-slate-800 p-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">
                Quality gate
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[11px] text-slate-400">{sheet.gate.code}</span>
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  {sheet.gate.name}
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                  {sheet.gate.criteriaMet}/{sheet.gate.criteriaTotal}
                </span>
              </div>
              {/* Said plainly, because a full checklist is the most likely
                  moment for somebody to assume the gate is passed. It is
                  not: a gate is passed by a person signing it. */}
              <p className="text-[10px] text-slate-500 mt-1">
                {sheet.gate.criteriaMet === sheet.gate.criteriaTotal
                  ? "Every criterion is settled. The gate still has to be raised and approved."
                  : "Criteria are evidence. Raising and approving the gate is separate."}
                {gateLocked && ` This gate is ${sheet.gate.status.toLowerCase()}, so its criteria are frozen.`}
              </p>

              <ul className="mt-3 space-y-2">
                {sheet.gate.criteria.map((c) => (
                  <li key={c.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id={`crit-${c.id}`}
                      aria-label={`${c.criterion} — mark met`}
                      checked={c.met}
                      disabled={!canManageGates || gateLocked || busy}
                      onChange={(e) =>
                        mutate(
                          `/api/projects/${projectId}/activate/gates/${sheet.gate!.id}/criteria/${c.id}`,
                          {
                            method: "PATCH",
                            body: JSON.stringify({ status: e.target.checked ? "MET" : "PENDING" }),
                          },
                          "That criterion could not be updated"
                        )
                      }
                      className="mt-0.5 rounded border-slate-300 dark:border-slate-700"
                    />
                    <label
                      htmlFor={`crit-${c.id}`}
                      className="text-xs flex-1 min-w-0 text-slate-700 dark:text-slate-300"
                    >
                      {c.criterion}
                      {c.status === "WAIVED" && (
                        <span className="ml-1 text-[10px] text-amber-600">waived</span>
                      )}
                    </label>
                    {canManageGates && !gateLocked && (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Remove criterion: ${c.criterion}`}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Remove this criterion from ${sheet.gate!.name}?\n\n` +
                                `Waiving it keeps it visible on the gate. Removing it does not.`
                            )
                          )
                            return;
                          mutate(
                            `/api/projects/${projectId}/activate/gates/${sheet.gate!.id}/criteria/${c.id}`,
                            { method: "DELETE" },
                            "That criterion could not be removed"
                          );
                        }}
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-lg border border-slate-300 dark:border-slate-700 text-red-600"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {canManageGates && !gateLocked && (
                <form
                  className="flex gap-2 mt-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!newCriterion.trim()) return;
                    const ok = await mutate(
                      `/api/projects/${projectId}/activate/gates/${sheet.gate!.id}/criteria`,
                      { method: "POST", body: JSON.stringify({ criterion: newCriterion.trim() }) },
                      "That criterion could not be added"
                    );
                    if (ok) setNewCriterion("");
                  }}
                >
                  <label className="sr-only" htmlFor="new-criterion">
                    New gate criterion
                  </label>
                  <input
                    id="new-criterion"
                    value={newCriterion}
                    onChange={(e) => setNewCriterion(e.target.value)}
                    placeholder="New gate criterion"
                    className="flex-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5"
                  />
                  <button
                    type="submit"
                    disabled={busy || newCriterion.trim().length < 3}
                    className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-40"
                  >
                    <Plus className="w-3 h-3 inline" aria-hidden="true" /> Add
                  </button>
                </form>
              )}
            </section>
          )}

          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">
              Workstreams in this phase
            </h3>
            {/* Only the ones carrying something. A list of every workstream
                with ten zeroes says less than the three that matter. */}
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {sheet.workstreams
                .filter((w) => w.deliverableCount > 0)
                .map((w) => (
                  <li key={w.id} className="flex items-center justify-between py-1.5">
                    <span className="text-xs text-slate-700 dark:text-slate-300">{w.name}</span>
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      {w.deliverableCount}
                    </span>
                  </li>
                ))}
              {sheet.workstreams.every((w) => w.deliverableCount === 0) && (
                <li className="text-xs text-slate-500 py-2">
                  Nothing assigned to a workstream yet.
                </li>
              )}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

export default ActivateWorksheet;
