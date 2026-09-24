"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Search, Filter, CheckCircle2, ChevronDown, Trash2, ExternalLink } from "lucide-react";
import { Panel, PanelHeader, Btn, Pill, Note, Stat, Meter, EmptyState, GateBadge, fieldClass, FieldLabel } from "./ui";
import { isCriterionSettled } from "@/lib/activate-phase-completion";

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
  /**
   * Whether to render the gate panel.
   *
   * False inside Phases and gates, which already shows the gate with its
   * full lifecycle — raise, approve, waive — beside the phase summary. Two
   * gate panels on one screen would be the same rows twice, and a person
   * would reasonably wonder which one counted.
   */
  showGate?: boolean;
  onOpenIssue?: (issueId: string) => void;
  onChanged?: () => void;
  /**
   * The phase's totals, reported after every load.
   *
   * The page above needs them to say whether the phase is finished, and it
   * would otherwise fetch the same worksheet a second time — two requests
   * for one answer, and two chances to disagree about it. The phase key
   * travels with the numbers so a caller can tell whose totals these are;
   * during a phase switch the old ones are still in hand.
   */
  onCounts?: (counts: {
    phaseKey: string;
    deliverableCount: number;
    tasksTotal: number;
    tasksComplete: number;
    criteriaTotal: number;
    criteriaSettled: number;
  }) => void;
}

/**
 * A gate whose sign-off is in progress must not have its QUESTIONS changed —
 * criteria cannot be added or removed once it is raised.
 */
const GATE_QUESTIONS_FROZEN = new Set(["RAISED", "APPROVED"]);

/**
 * ANSWERS are a different matter. Marking a criterion met, or not met, is
 * what a reviewer does while a gate is raised, and an approval is now
 * refused while anything is unsettled — so recording a finding blocks the
 * sign-off, which is what recording it was for. Only an approved gate is
 * closed to answers, being a finished record.
 */
const GATE_ANSWERS_FROZEN = new Set(["APPROVED"]);

export function ActivateWorksheet({
  projectId,
  phaseKey,
  phases,
  onPhaseChange,
  canManageDeliverables,
  canManageGates,
  showGate = true,
  onOpenIssue,
  onChanged,
  onCounts,
}: ActivateWorksheetProps) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<Worksheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTask, setNewTask] = useState<Record<string, string>>({});
  const [newDeliverable, setNewDeliverable] = useState("");
  const [newDeliverableWs, setNewDeliverableWs] = useState("");
  const [newCriterion, setNewCriterion] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkstream, setSelectedWorkstream] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "INCOMPLETE" | "COMPLETED">("ALL");

  const base = `/api/projects/${projectId}/activate/phases/${phaseKey}/worksheet`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(base);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load the worksheet.");
      setSheet(data.worksheet);
      const criteria = data.worksheet.gate?.criteria ?? [];
      onCounts?.({
        phaseKey,
        deliverableCount: data.worksheet.deliverableCount,
        tasksTotal: data.worksheet.tasksTotal,
        tasksComplete: data.worksheet.tasksComplete,
        criteriaTotal: criteria.length,
        criteriaSettled: criteria.filter((c: { status: string }) => isCriterionSettled(c.status))
          .length,
      });
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Could not load the worksheet.");
    } finally {
      setLoading(false);
    }
  }, [base, phaseKey, onCounts]);

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
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
        Loading the worksheet…
      </div>
    );
  }

  if (!sheet) {
    return (
      <div className="p-6 text-center">
        <p role="alert" className="text-sm text-destructive">
          {error ?? "This phase has no worksheet."}
        </p>
      </div>
    );
  }

  const questionsFrozen = sheet.gate ? GATE_QUESTIONS_FROZEN.has(sheet.gate.status) : false;
  const answersFrozen = sheet.gate ? GATE_ANSWERS_FROZEN.has(sheet.gate.status) : false;

  return (
    <div className="space-y-4">
      <div aria-live="polite" className="min-h-[1rem]">
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>

      {phases.length > 0 && (
      <>
      {/* Which phase's worksheet. Here rather than only on the phase rail,
          because the worksheet is where somebody works through a phase and
          sending them to another tab to change it is a detour. */}
      <div className="flex items-center gap-2">
        <label
          htmlFor="worksheet-phase"
          className="text-[11px] font-semibold text-muted-foreground"
        >
          Phase
        </label>
        <select
          id="worksheet-phase"
          value={phaseKey}
          onChange={(e) => onPhaseChange(e.target.value)}
          className="text-xs rounded-lg border border-border bg-card px-2 py-1.5"
        >
          {phases.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      </>
      )}

      {/* 70/30 on desktop, stacked on a phone — the gate and the workstream
          summary read as context beside the work, not as separate pages. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] gap-4 items-start">
        {/* Deliverables and tasks ---------------------------------------- */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-bold text-foreground tracking-tight">
                Deliverables & Workstreams
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {sheet.deliverableCount} deliverables · {sheet.tasksComplete} of {sheet.tasksTotal} checklist tasks completed
                {sheet.unlistedCount > 0 && ` · ${sheet.unlistedCount} additional linked items`}
              </p>
            </div>

            {/* Quick Filter Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative min-w-[160px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  aria-label="Filter deliverables"
                  type="text"
                  placeholder="Filter deliverables…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs pl-8 pr-2.5 py-1.5 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                />
              </div>

              <select
                aria-label="Filter by workstream"
                value={selectedWorkstream}
                onChange={(e) => setSelectedWorkstream(e.target.value)}
                className="text-xs rounded-lg border border-border bg-card px-2 py-1.5 text-foreground"
              >
                <option value="ALL">All Workstreams</option>
                {sheet.workstreams.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.deliverableCount})
                  </option>
                ))}
              </select>

              <div className="flex rounded-lg border border-border p-0.5 bg-muted/30 text-[10px] font-semibold">
                {(["ALL", "INCOMPLETE", "COMPLETED"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setStatusFilter(mode)}
                    className={`px-2 py-1 rounded-md transition-colors ${
                      statusFilter === mode
                        ? "bg-card text-foreground shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {mode === "ALL" ? "All" : mode === "INCOMPLETE" ? "Open" : "Done"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {sheet.tasksTotal > 0 && (
            <div className="bg-card p-3 rounded-xl border border-border/80">
              <Meter value={sheet.tasksComplete} total={sheet.tasksTotal} showLabel height="h-2" />
            </div>
          )}

          {/* Deliverables Cards List */}
          <div className="space-y-2.5">
            {sheet.deliverables
              .filter((d) => {
                if (selectedWorkstream !== "ALL" && d.workstreamId !== selectedWorkstream) return false;
                if (statusFilter === "COMPLETED" && d.tasksTotal > 0 && d.tasksComplete < d.tasksTotal) return false;
                if (statusFilter === "INCOMPLETE" && d.tasksTotal > 0 && d.tasksComplete === d.tasksTotal) return false;
                if (searchQuery.trim()) {
                  const q = searchQuery.toLowerCase();
                  return (
                    d.name.toLowerCase().includes(q) ||
                    (d.phaseCode && d.phaseCode.toLowerCase().includes(q)) ||
                    d.issueKey.toLowerCase().includes(q)
                  );
                }
                return true;
              })
              .map((d) => {
                const isAllTasksDone = d.tasksTotal > 0 && d.tasksComplete === d.tasksTotal;

                return (
                  <article
                    key={d.linkId}
                    className={`p-4 rounded-xl border transition-all duration-150 ${
                      isAllTasksDone
                        ? "bg-card/60 border-emerald-500/20 shadow-2xs"
                        : "bg-card border-border/80 shadow-2xs hover:border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0 mt-0.5">
                          {d.phaseCode ?? "D-—"}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => onOpenIssue?.(d.issueId)}
                              className="text-xs sm:text-sm font-bold text-foreground text-left hover:text-primary transition-colors inline-flex items-center gap-1 group"
                              title={`Open ${d.issueKey}`}
                            >
                              <span>{d.name}</span>
                              <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors opacity-70" />
                            </button>
                            <span className="text-[10px] font-mono text-muted-foreground font-semibold">
                              {d.issueKey}
                            </span>
                          </div>

                          <div className="flex items-center gap-2.5 mt-1 text-[11px] text-muted-foreground flex-wrap">
                            <span className="inline-flex items-center gap-1 text-foreground font-medium">
                              {d.workstreamName ?? "Unassigned Workstream"}
                            </span>
                            <span>•</span>
                            <span className={isAllTasksDone ? "text-emerald-600 dark:text-emerald-400 font-semibold" : ""}>
                              {d.tasksComplete} of {d.tasksTotal} tasks verified
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
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
                          className="text-[11px] rounded-lg border border-border bg-card px-2 py-1 max-w-[8.5rem] truncate"
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
                            className="p-1 rounded-md text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                            title="Remove from phase"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Subtask Checklist */}
                    {d.tasks.length > 0 && (
                      <ul className="mt-3 space-y-1.5 pt-2.5 border-t border-border/40 pl-2">
                        {d.tasks.map((t) => (
                          <li key={t.id} className="flex items-center gap-2 group">
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
                              className="rounded border-border text-primary focus:ring-primary w-3.5 h-3.5"
                            />
                            <label
                              htmlFor={`task-${t.id}`}
                              className={`text-xs flex-1 min-w-0 cursor-pointer ${
                                t.isCompleted
                                  ? "line-through text-muted-foreground/80"
                                  : "text-foreground"
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
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-muted-foreground hover:text-rose-500 text-[10px]"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {canManageDeliverables && (
                      <form
                        className="flex gap-2 mt-2.5 pt-2 border-t border-border/40 pl-2"
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
                        <input
                          id={`newtask-${d.linkId}`}
                          aria-label={`New task in ${d.name}`}
                          value={newTask[d.linkId] ?? ""}
                          onChange={(e) => setNewTask((s) => ({ ...s, [d.linkId]: e.target.value }))}
                          placeholder={`Add a verification step or deliverable subtask…`}
                          className="flex-1 text-xs rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                        />
                        <Btn
                          type="submit"
                          disabled={busy || !(newTask[d.linkId] ?? "").trim()}
                          variant="secondary"
                          size="sm"
                        >
                          <Plus className="w-3 h-3" />
                          Add Step
                        </Btn>
                      </form>
                    )}
                  </article>
                );
              })}

            {sheet.deliverables.length === 0 && (
              <EmptyState title={`No deliverables in ${sheet.phaseName} yet`}>
                A deliverable is one numbered line of this phase&apos;s plan with its own task checklist.
              </EmptyState>
            )}
          </div>

          {/* Add deliverable --------------------------------------------- */}
          {canManageDeliverables && (
            <form
              className="mt-3 rounded-2xl border border-dashed border-border p-4 space-y-2"
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
              <h4 className="text-[11px] font-bold text-foreground">
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
                className="w-full text-xs rounded-lg border border-border bg-muted px-2 py-2"
              />
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="new-deliverable-ws">
                  Workstream for the new deliverable
                </label>
                <select
                  id="new-deliverable-ws"
                  value={newDeliverableWs}
                  onChange={(e) => setNewDeliverableWs(e.target.value)}
                  className="flex-1 text-xs rounded-lg border border-border bg-card px-2 py-2"
                >
                  <option value="">No workstream</option>
                  {sheet.workstreams.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <Btn
                  type="submit"
                  disabled={busy || newDeliverable.trim().length < 3}
                  variant="primary"
                >
                  Add deliverable
                </Btn>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Code is assigned automatically from this phase&apos;s sequence.
              </p>
            </form>
          )}
        </section>

        {/* Gate and workstreams ------------------------------------------ */}
        <div className="space-y-4">
          {showGate && sheet.gate && (
            <section className="bg-card rounded-2xl border border-border/80 p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-border/40">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                    {sheet.gate.code}
                  </span>
                  <h3 className="text-sm font-bold text-foreground">
                    {sheet.gate.name}
                  </h3>
                </div>
                <GateBadge status={sheet.gate.status} />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-muted-foreground font-medium">Criteria settled:</span>
                  <span className="font-bold text-foreground font-mono">
                    {sheet.gate.criteriaMet} / {sheet.gate.criteriaTotal}
                  </span>
                </div>
                <Meter value={sheet.gate.criteriaMet} total={sheet.gate.criteriaTotal} height="h-1.5" />
              </div>

              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {sheet.gate.criteriaMet === sheet.gate.criteriaTotal
                  ? "✓ All gate criteria verified. Proceed to the top governance panel to raise for sign-off."
                  : "Criteria are required verification artifacts. Checking an item records completion."}
              </p>

              <ul className="mt-2 space-y-2 divide-y divide-border/30">
                {sheet.gate.criteria.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 pt-2 first:pt-0 group">
                    <input
                      type="checkbox"
                      id={`crit-${c.id}`}
                      aria-label={`${c.criterion} — mark met`}
                      checked={c.met}
                      disabled={!canManageGates || answersFrozen || busy}
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
                      className="mt-0.5 rounded border-border text-primary focus:ring-primary w-3.5 h-3.5"
                    />
                    <label
                      htmlFor={`crit-${c.id}`}
                      className={`text-xs flex-1 min-w-0 cursor-pointer ${
                        c.met ? "text-foreground font-medium" : "text-muted-foreground"
                      }`}
                    >
                      {c.criterion}
                      {c.status === "WAIVED" && (
                        <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 border border-amber-500/30">
                          WAIVED
                        </span>
                      )}
                    </label>
                    {canManageGates && !questionsFrozen && (
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
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-muted-foreground hover:text-rose-500"
                        title="Remove criterion"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {canManageGates && !questionsFrozen && (
                <form
                  className="flex gap-2 mt-3 pt-2 border-t border-border/40"
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
                  <input
                    aria-label="New gate criterion"
                    id="new-criterion"
                    value={newCriterion}
                    onChange={(e) => setNewCriterion(e.target.value)}
                    placeholder="Add custom criterion…"
                    className="flex-1 text-xs rounded-lg border border-border bg-muted/40 px-2 py-1.5 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  />
                  <Btn
                    type="submit"
                    disabled={busy || newCriterion.trim().length < 3}
                    variant="secondary"
                    size="sm"
                  >
                    <Plus className="w-3 h-3" /> Add
                  </Btn>
                </form>
              )}
            </section>
          )}

          <section className="bg-card rounded-2xl border border-border/80 p-4 shadow-xs">
            <h3 className="text-sm font-bold text-foreground mb-1">
              Workstreams Distribution
            </h3>
            <p className="text-[11px] text-muted-foreground mb-3">
              Deliverables allocated by functional discipline
            </p>

            <ul className="divide-y divide-border/40">
              {sheet.workstreams
                .filter((w) => w.deliverableCount > 0)
                .map((w) => (
                  <li key={w.id} className="flex items-center justify-between py-2">
                    <span className="text-xs text-foreground font-medium">{w.name}</span>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-muted text-foreground">
                      {w.deliverableCount} {w.deliverableCount === 1 ? "item" : "items"}
                    </span>
                  </li>
                ))}
              {sheet.workstreams.every((w) => w.deliverableCount === 0) && (
                <li className="text-xs text-muted-foreground py-2 text-center">
                  No deliverables assigned to workstreams yet.
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
