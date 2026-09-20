"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Circle,
  CircleDashed,
  Loader2,
  ShieldCheck,
  SlashIcon,
  TriangleAlert,
} from "lucide-react";

/**
 * SAP Activate — the phase workspace, including the Explore fit-to-standard view.
 *
 * WHY THIS WHOLE FILE IS LOADED ON DEMAND
 *
 * `/projects/[id]` is the heaviest route in the app and sits at 772 kB against
 * a 760 kB budget, passing only on the ±5% tolerance. There is roughly 26 kB
 * of headroom for every future feature combined, so an Activate tab that
 * shipped on first load would spend a meaningful part of it on a methodology
 * most projects do not run. ProjectClient imports this with `next/dynamic` and
 * `ssr: false`, exactly as the seven non-default views are imported, so a
 * project that never opens the tab downloads none of it.
 *
 * Nothing here is imported at module scope except React and icons that the
 * page already ships. Adding a charting or date library to this file would
 * quietly undo the budget, which is why the dates are formatted by hand.
 *
 * ACCESSIBILITY
 *
 * The phase rail is a real tablist: `role="tablist"` with arrow-key movement
 * and a roving tabindex, so a keyboard user reaches the six phases with two
 * keys rather than six tab stops. Every icon-only control carries an
 * `aria-label`, every select carries an explicit `aria-label`, and the panel announces
 * changes through `aria-live` rather than relying on the user noticing a
 * colour change.
 */

const PHASE_ORDER = ["DISCOVER", "PREPARE", "EXPLORE", "REALIZE", "DEPLOY", "RUN"] as const;

const FIT_GAP_CHOICES = [
  { value: "", label: "Not assessed" },
  { value: "FIT", label: "Fit — standard covers it" },
  { value: "GAP", label: "Gap — needs work" },
  { value: "ACCEPTED_GAP", label: "Accepted gap — living with it" },
] as const;

interface Criterion {
  id: string;
  criterion: string;
  status: string;
  evidenceRef: string | null;
}

interface Gate {
  id: string;
  name: string;
  isMandatory: boolean;
  status: string;
  criteria: Criterion[];
}

interface Phase {
  id: string;
  key: string;
  name: string;
  status: string;
  startDate: string | null;
  targetDate: string | null;
  ownerId: string | null;
  version: number;
  gates: Gate[];
  _count?: { deliverables: number };
}

interface Deliverable {
  id: string;
  isMandatory: boolean;
  fitGapStatus: string | null;
  issue: {
    id: string;
    issueKey: string;
    title: string;
    status: { name: string } | null;
  };
  workstream: { id: string; name: string } | null;
}

export interface ActivateWorkspaceProps {
  projectId: string;
  /** PBAC keys the current user holds. Empty means "unknown", which is treated
   *  as permitted — the API is the real gate, and disabling every control on a
   *  fetch hiccup would be worse than letting the server say no. */
  capabilities?: string[];
  /** Opens an issue in the existing detail modal, so a deliverable is one
   *  click from the work rather than a dead end. */
  onOpenIssue?: (issueId: string) => void;
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  // Hand-rolled rather than pulling in a date library: see the note above about
  // the 26 kB of headroom this page has left.
  return d.toISOString().slice(0, 10);
}

const statusTone: Record<string, string> = {
  NOT_STARTED: "text-slate-500 dark:text-slate-400",
  IN_PROGRESS: "text-blue-600 dark:text-blue-400",
  COMPLETED: "text-emerald-600 dark:text-emerald-400",
  SKIPPED: "text-slate-400 dark:text-slate-500",
};

export function ActivateWorkspace({
  projectId,
  capabilities = [],
  onOpenIssue,
}: ActivateWorkspaceProps) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("EXPLORE");
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [loadedPhaseId, setLoadedPhaseId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const can = useCallback(
    (key: string) => capabilities.length === 0 || capabilities.includes(key),
    [capabilities]
  );

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/activate`);
      if (!res.ok) throw new Error("Could not load the Activate profile.");
      const data = await res.json();
      setEnabled(Boolean(data.enabled));
      setPhases(Array.isArray(data.phases) ? data.phases : []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Could not load the Activate profile.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const selected = phases.find((p) => p.key === selectedKey) || phases[0];

  const loadDeliverables = useCallback(
    async (targetPhaseId: string, isCurrent: () => boolean = () => true) => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/activate/deliverables?phaseId=${encodeURIComponent(targetPhaseId)}&limit=200`
        );
        const data = await res.json();
        if (!isCurrent()) return;
        setDeliverables(res.ok && Array.isArray(data.deliverables) ? data.deliverables : []);
      } catch {
        if (isCurrent()) setDeliverables([]);
      } finally {
        // Recording WHICH phase the rows belong to, rather than flipping a
        // separate loading boolean, means "is this list stale" is derived from
        // the data instead of tracked alongside it — so the two cannot
        // disagree, and there is no flag left set by an aborted request.
        if (isCurrent()) setLoadedPhaseId(targetPhaseId);
      }
    },
    [projectId]
  );

  /**
   * Load the selected phase's deliverables, and ignore a response that arrives
   * after the user has moved on.
   *
   * Without the cancellation flag, clicking through the six phases quickly
   * leaves the slowest request to land last, so the panel ends up showing
   * another phase's deliverables under this phase's heading. That is the kind
   * of bug that looks like a data error rather than a race.
   */
  const phaseId = selected?.id;
  useEffect(() => {
    if (!enabled || !phaseId) return;
    let cancelled = false;
    void loadDeliverables(phaseId, () => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [enabled, phaseId, loadDeliverables]);

  /** One place for every mutation, so no call site forgets to surface a refusal. */
  const send = useCallback(
    async (label: string, url: string, init: RequestInit, after?: () => Promise<void>) => {
      setBusy(label);
      setError(null);
      setMessage(null);
      try {
        const res = await fetch(url, {
          method: init.method || "POST",
          headers: { "Content-Type": "application/json" },
          body: init.body,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // The API's refusals are written to be read by a person — a gate
          // names the criteria still outstanding, and separation of duties
          // says why. Showing `data.error` rather than a generic failure is
          // the whole reason those messages were written that way.
          setError(data?.error || `That did not work (${res.status}).`);
          return false;
        }
        setMessage(`${label} done.`);
        if (after) await after();
        return true;
      } catch {
        setError("The request could not be sent.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") {
      return;
    }
    e.preventDefault();
    const last = phases.length - 1;
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? last
          : e.key === "ArrowRight"
            ? Math.min(last, index + 1)
            : Math.max(0, index - 1);
    setSelectedKey(phases[next].key);
    tabRefs.current[next]?.focus();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
        Loading Activate…
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-lg w-full text-center space-y-4 bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-300 dark:border-slate-800">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Run this project with SAP Activate
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Enabling seeds the six phases, their quality gates and the default
            workstreams. Nothing already in the project changes, and turning it
            off later keeps every decision on record.
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Aligned with the published SAP Activate methodology. Not certified
            by or affiliated with SAP.
          </p>
          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {can("activate:manage_phases") ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                send(
                  "Enable Activate",
                  `/api/projects/${projectId}/activate`,
                  { method: "POST", body: JSON.stringify({ enabled: true }) },
                  loadProfile
                )
              }
              className="px-4 py-2 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Enabling…" : "Enable Activate"}
            </button>
          ) : (
            <p className="text-xs text-slate-500">
              Ask a project administrator to enable it.
            </p>
          )}
        </div>
      </div>
    );
  }

  const gate = selected?.gates?.[0];
  const outstanding = gate
    ? gate.criteria.filter((c) => c.status !== "MET" && c.status !== "WAIVED")
    : [];

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
      {/* Phase rail ------------------------------------------------------- */}
      <div
        role="tablist"
        aria-label="Activate phases"
        className="flex items-stretch gap-2 overflow-x-auto no-scrollbar pb-1"
      >
        {phases.map((p, i) => {
          const isSelected = selected?.key === p.key;
          return (
            <button
              key={p.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              id={`activate-tab-${p.key}`}
              aria-selected={isSelected}
              aria-controls="activate-phase-panel"
              tabIndex={isSelected ? 0 : -1}
              onKeyDown={(e) => onTabKeyDown(e, i)}
              onClick={() => setSelectedKey(p.key)}
              className={`min-w-[140px] text-left px-3 py-2 rounded-xl border transition-colors shrink-0 ${
                isSelected
                  ? "bg-white dark:bg-slate-800 border-blue-400 dark:border-blue-600"
                  : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-white dark:hover:bg-slate-800"
              }`}
            >
              <span className="block text-[10px] font-mono text-slate-400">
                {String(PHASE_ORDER.indexOf(p.key as (typeof PHASE_ORDER)[number]) + 1).padStart(2, "0")}
              </span>
              <span className="block text-xs font-bold text-slate-900 dark:text-white">{p.name}</span>
              <span className={`block text-[10px] font-semibold ${statusTone[p.status] || ""}`}>
                {p.status.replace("_", " ").toLowerCase()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Live region: refusals from the API are the useful part of this UI. */}
      <div aria-live="polite" className="min-h-[1rem]">
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {!error && message && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">{message}</p>
        )}
      </div>

      {selected && (
        <div
          id="activate-phase-panel"
          role="tabpanel"
          aria-labelledby={`activate-tab-${selected.key}`}
          className="space-y-5"
        >
          {/* Phase summary ------------------------------------------------ */}
          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">{selected.name}</h2>
                <p className="text-[11px] text-slate-500">
                  {fmtDate(selected.startDate)} → {fmtDate(selected.targetDate)}
                </p>
              </div>
              {can("activate:manage_phases") && selected.status !== "IN_PROGRESS" && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    send(
                      "Start phase",
                      `/api/projects/${projectId}/activate/phases/${selected.id}`,
                      { method: "PATCH", body: JSON.stringify({ status: "IN_PROGRESS" }) },
                      loadProfile
                    )
                  }
                  className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  Mark in progress
                </button>
              )}
            </div>
          </section>

          {/* Quality gate ------------------------------------------------- */}
          {gate && (
            <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-slate-400" aria-hidden="true" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{gate.name}</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {gate.status}
                </span>
              </div>

              <ul className="space-y-1.5">
                {gate.criteria.map((c) => {
                  const met = c.status === "MET";
                  const waived = c.status === "WAIVED";
                  const Icon = met ? CheckCircle2 : waived ? SlashIcon : Circle;
                  return (
                    <li key={c.id} className="flex items-center gap-2">
                      <Icon
                        className={`w-3.5 h-3.5 shrink-0 ${
                          met
                            ? "text-emerald-600"
                            : waived
                              ? "text-amber-500"
                              : "text-slate-300 dark:text-slate-600"
                        }`}
                        aria-hidden="true"
                      />
                      <span className="text-xs text-slate-700 dark:text-slate-300 flex-1">
                        {c.criterion}
                      </span>
                      <span className="sr-only">{c.status}</span>
                      {can("activate:manage_gates") && gate.status !== "APPROVED" && (
                        <span className="flex gap-1">
                          <button
                            type="button"
                            disabled={busy !== null || met}
                            aria-label={`Mark "${c.criterion}" met`}
                            onClick={() =>
                              send(
                                "Criterion",
                                `/api/projects/${projectId}/activate/gates/${gate.id}/criteria/${c.id}`,
                                { method: "PATCH", body: JSON.stringify({ status: "MET" }) },
                                loadProfile
                              )
                            }
                            className="text-[10px] font-bold px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40"
                          >
                            Met
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null || waived}
                            aria-label={`Waive "${c.criterion}"`}
                            onClick={() =>
                              send(
                                "Criterion",
                                `/api/projects/${projectId}/activate/gates/${gate.id}/criteria/${c.id}`,
                                { method: "PATCH", body: JSON.stringify({ status: "WAIVED" }) },
                                loadProfile
                              )
                            }
                            className="text-[10px] font-bold px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40"
                          >
                            Waive
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>

              {outstanding.length > 0 && (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                  <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
                  <span>
                    {outstanding.length} criteri{outstanding.length === 1 ? "on" : "a"} still to
                    settle before this gate can be raised.
                  </span>
                </p>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {can("activate:manage_gates") && gate.status !== "RAISED" && gate.status !== "APPROVED" && (
                  <button
                    type="button"
                    disabled={busy !== null || outstanding.length > 0}
                    onClick={() =>
                      send(
                        "Raise gate",
                        `/api/projects/${projectId}/activate/gates/${gate.id}/raise`,
                        { method: "POST", body: JSON.stringify({}) },
                        loadProfile
                      )
                    }
                    className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 disabled:opacity-40"
                  >
                    Raise for sign-off
                  </button>
                )}
                {can("activate:sign_off_gate") && gate.status === "RAISED" && (
                  <>
                    {/* The server refuses the raiser's own approval with a 403
                        that explains itself. Hiding the button for the raiser
                        would be guessing at who they are from the client; the
                        refusal is shown instead, which is honest and keeps the
                        control server-side where it belongs. */}
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        send(
                          "Approve gate",
                          `/api/projects/${projectId}/activate/gates/${gate.id}/approvals`,
                          { method: "POST", body: JSON.stringify({ decision: "APPROVED" }) },
                          loadProfile
                        )
                      }
                      className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-emerald-600 text-white disabled:opacity-40"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        send(
                          "Reject gate",
                          `/api/projects/${projectId}/activate/gates/${gate.id}/approvals`,
                          { method: "POST", body: JSON.stringify({ decision: "REJECTED" }) },
                          loadProfile
                        )
                      }
                      className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-red-300 text-red-600 disabled:opacity-40"
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            </section>
          )}

          {/* Deliverables / fit-to-standard ------------------------------- */}
          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {selected.key === "EXPLORE" ? "Fit-to-standard" : "Deliverables"}
            </h3>
            {selected.key === "EXPLORE" && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Classify each item against the standard solution. An accepted gap
                is a decision somebody made, and a gate review reads it
                differently from one still waiting on a workshop.
              </p>
            )}

            {phaseId !== loadedPhaseId ? (
              <p className="text-xs text-slate-500 py-4">Loading deliverables…</p>
            ) : deliverables.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">
                No issues are linked to this phase yet.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {deliverables.map((d) => (
                  <li key={d.id} className="py-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenIssue?.(d.issue.id)}
                      className="text-[11px] font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {d.issue.issueKey}
                    </button>
                    <span className="text-xs text-slate-700 dark:text-slate-300 flex-1 min-w-[12rem] truncate">
                      {d.issue.title}
                    </span>
                    {d.workstream && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                        {d.workstream.name}
                      </span>
                    )}
                    {/* An explicit aria-label rather than a paired
                        <label htmlFor>: the id here is a template literal, and
                        a name that only a running browser could resolve is one
                        a static check cannot verify — so it would be reported
                        as unnamed and, more to the point, nobody could tell
                        from the source whether it was really named. */}
                    <select
                      aria-label={`Fit-to-standard outcome for ${d.issue.issueKey}`}
                      value={d.fitGapStatus || ""}
                      disabled={busy !== null || !can("activate:manage_deliverables")}
                      onChange={(e) => {
                        const value = e.target.value || null;
                        send(
                          "Classification",
                          `/api/projects/${projectId}/activate/deliverables/${d.id}`,
                          { method: "PATCH", body: JSON.stringify({ fitGapStatus: value }) },
                          async () => {
                            if (selected?.id) await loadDeliverables(selected.id);
                          }
                        );
                      }}
                      className="text-[11px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 disabled:opacity-50"
                    >
                      {FIT_GAP_CHOICES.map((c) => (
                        <option key={c.value || "none"} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!gate && (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <CircleDashed className="w-3.5 h-3.5" aria-hidden="true" />
              This phase has no gate configured.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default ActivateWorkspace;
