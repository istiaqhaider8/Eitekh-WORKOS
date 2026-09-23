"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleDashed,
  Loader2,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { ActivateWorkshop } from "./ActivateWorkshop";
import { ActivateBacklog } from "./ActivateBacklog";
import { ActivateWorksheet } from "./ActivateWorksheet";
import { isPhaseWorkComplete, phaseIncompleteReason } from "@/lib/activate-phase-completion";
import { Panel, PanelHeader, Btn, Pill, Note, Stat, EmptyState, fieldClass, FieldLabel } from "./ui";

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

/**
 * The six fit-to-standard outcomes, the same vocabulary the decision model
 * uses. It was three values until increment 10 — GAP collapsed tailoring,
 * building custom and integrating, which are the three cases that produce
 * completely different downstream work.
 */
const FIT_GAP_CHOICES = [
  { value: "", label: "Not assessed" },
  { value: "ADOPT", label: "Adopt — standard covers it" },
  { value: "CONFIGURE", label: "Configure — tailored by config" },
  { value: "EXTEND", label: "Extend — custom build needed" },
  { value: "INTEGRATE", label: "Integrate — needs an interface" },
  { value: "DEFER", label: "Defer — agreed, not this release" },
  { value: "OUT_OF_SCOPE", label: "Out of scope — excluded" },
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

interface PhaseReadiness {
  phaseId: string;
  key: string;
  total: number;
  mandatory: number;
  done: number;
  mandatoryDone: number;
  gaps: number;
  unassessed: number;
  readyToRaise: boolean;
  gate: { criteriaTotal: number; criteriaSettled: number; outstanding: string[] } | null;
}

interface Blocker {
  linkId: string;
  issueId: string;
  issueKey: string;
  title: string;
  statusName: string | null;
}

interface Readiness {
  enabled: boolean;
  phases: PhaseReadiness[];
  deployBlockers: Blocker[];
  deployBlockerTotal: number;
}

interface TemplateOption {
  id: string;
  name: string;
  variant: string | null;
  version: number;
  description: string | null;
  builtIn: boolean;
  phaseCount: number;
}


interface Deliverable {
  id: string;
  isMandatory: boolean;
  /** The worksheet code, or null for an issue merely linked to the phase. */
  phaseCode: string | null;
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
  NOT_STARTED: "text-muted-foreground",
  IN_PROGRESS: "text-blue-600 dark:text-blue-400",
  COMPLETED: "text-emerald-600 dark:text-emerald-400",
  SKIPPED: "text-muted-foreground",
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
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  /**
   * The selected phase's totals, as the worksheet last reported them.
   *
   * Null until it has loaded — an empty phase and an unloaded one both look
   * like zero, and only one of them is finished. The phase key is kept with
   * them so the previous phase's numbers cannot be read as this one's during
   * a switch.
   */
  const [worksheetCounts, setWorksheetCounts] = useState<{
    phaseKey: string;
    deliverableCount: number;
    tasksTotal: number;
    tasksComplete: number;
    criteriaTotal: number;
    criteriaSettled: number;
  } | null>(null);
  const [section, setSection] = useState<"phases" | "workshop" | "backlog">(
    "phases"
  );
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [chosenTemplate, setChosenTemplate] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const can = useCallback(
    (key: string) => capabilities.length === 0 || capabilities.includes(key),
    [capabilities]
  );

  /**
   * Profile and readiness are fetched together.
   *
   * Readiness is derived entirely from the phases, gates and deliverables the
   * profile already describes, so fetching it separately would let the two
   * disagree on screen — a gate showing every criterion met beside a readiness
   * panel still counting one outstanding, because they were read a second
   * apart. One round of fetching, one refresh after every mutation.
   */
  const loadProfile = useCallback(async () => {
    try {
      const [profileRes, readinessRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/activate`),
        fetch(`/api/projects/${projectId}/activate/readiness`),
      ]);
      if (!profileRes.ok) throw new Error("Could not load the Activate profile.");
      const data = await profileRes.json();
      setEnabled(Boolean(data.enabled));
      setPhases(Array.isArray(data.phases) ? data.phases : []);
      // Readiness is reporting, not governance: if it fails, the gates and
      // criteria are still usable, so it degrades to absent rather than
      // taking the screen down with it.
      setReadiness(readinessRes.ok ? await readinessRes.json() : null);

      /**
       * The template list is only needed on the enable screen, so it is
       * fetched only when Activate is off. Asking for it on every load of an
       * already-running project would be a request whose answer nobody looks
       * at.
       */
      if (!data.enabled) {
        const tplRes = await fetch(`/api/projects/${projectId}/activate/templates`);
        if (tplRes.ok) {
          const tpl = await tplRes.json();
          const list: TemplateOption[] = Array.isArray(tpl.templates) ? tpl.templates : [];
          setTemplates(list);
          setChosenTemplate((c) => c || list[0]?.id || "");
        }
      }
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

  /* Stable, so the worksheet's loader is not a new function every render. */
  const handleWorksheetCounts = useCallback(
    (c: {
      phaseKey: string;
      deliverableCount: number;
      tasksTotal: number;
      tasksComplete: number;
      criteriaTotal: number;
      criteriaSettled: number;
    }) => setWorksheetCounts(c),
    []
  );

  const loadDeliverables = useCallback(
    async (targetPhaseId: string, isCurrent: () => boolean = () => true) => {
      try {
        const delRes = await fetch(
          `/api/projects/${projectId}/activate/deliverables?phaseId=${encodeURIComponent(targetPhaseId)}&limit=200`
        );
        const data = await delRes.json();
        if (!isCurrent()) return;
        setDeliverables(delRes.ok && Array.isArray(data.deliverables) ? data.deliverables : []);
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
  const phaseKey = selected?.key;
  useEffect(() => {
    if (!enabled || !phaseId) return;
    let cancelled = false;
    void loadDeliverables(phaseId, () => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [enabled, phaseId, phaseKey, loadDeliverables]);

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
      <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
        Loading Activate…
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-lg w-full text-center space-y-4 bg-card p-8 rounded-2xl border border-border">
          <h2 className="text-base font-bold text-foreground">
            Run this project with SAP Activate
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Enabling seeds the six phases, their quality gates and the default
            workstreams. Nothing already in the project changes, and turning it
            off later keeps every decision on record.
          </p>
          <p className="text-[11px] text-muted-foreground">
            Aligned with the published SAP Activate methodology. Not certified
            by or affiliated with SAP.
          </p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {can("activate:manage_phases") ? (
            <div className="space-y-3">
              {/**
               * The template picker only appears when there is a choice.
               *
               * Most projects will have exactly one — the built-in
               * methodology — and offering a dropdown with a single option
               * asks a question whose answer nobody can get wrong, which is
               * a question not worth asking.
               */}
              {templates.length > 1 && (
                <div className="text-left">
                  <label
                    htmlFor="activate-template"
                    className="block text-[11px] font-semibold text-muted-foreground mb-1"
                  >
                    Methodology
                  </label>
                  <select
                    id="activate-template"
                    value={chosenTemplate}
                    onChange={(e) => setChosenTemplate(e.target.value)}
                    className="w-full text-xs rounded-lg border border-border bg-card px-2 py-1.5"
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.variant ? ` — ${t.variant}` : ""} (v{t.version}
                        {t.builtIn ? ", built in" : ""})
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    A project keeps the version it was started on. Improving a
                    methodology later never rewrites a running plan.
                  </p>
                </div>
              )}
              <Btn
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  send(
                    "Enable Activate",
                    `/api/projects/${projectId}/activate`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        enabled: true,
                        ...(chosenTemplate ? { templateId: chosenTemplate } : {}),
                      }),
                    },
                    loadProfile
                  )
                }
                variant="primary" size="md"
              >
                {busy ? "Enabling…" : "Enable Activate"}
              </Btn>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Ask a project administrator to enable it.
            </p>
          )}
        </div>
      </div>
    );
  }

  const gate = selected?.gates?.[0];
  /** The readiness row for whichever phase is on screen, if it was fetched. */
  const phaseReadiness = readiness?.phases.find((p) => p.key === selected?.key) ?? null;
  const outstanding = gate
    ? gate.criteria.filter((c) => c.status !== "MET" && c.status !== "WAIVED")
    : [];

  /**
   * Is this phase's work finished?
   *
   * Only the counts belonging to the phase on screen count; during a switch
   * the previous phase's are still held, and they would otherwise light up
   * the button on a phase nobody has looked at yet.
   *
   * A phase with no tasks and no criteria is not "complete", it is empty —
   * hence the two > 0 tests. Answering yes there would put a finished badge
   * on every phase of a new project.
   */
  /**
   * The phase before this one, and whether its gate was ever signed.
   *
   * Nothing stops a project starting Realize while Explore's gate sits open,
   * and nothing should: a hard block would be wrong for the real projects
   * that overlap phases deliberately, and for the ones that adopt this tool
   * halfway through. But a gate that can be walked past in silence is not
   * performing the one job it has. So the phase says it, where the person
   * walking past is standing.
   *
   * Only IN_PROGRESS and COMPLETED phases are warned about. A phase nobody
   * has started yet is not running ahead of anything.
   */
  const selectedIndex = selected ? phases.findIndex((p) => p.key === selected.key) : -1;
  // The API returns phases in methodology order — the same order the rail
  // above renders them in — so the one before this is the one before it here.
  const previousPhase = selectedIndex > 0 ? phases[selectedIndex - 1] : null;
  const previousGate = previousPhase?.gates?.[0] ?? null;
  const runningAheadOfGate =
    previousGate !== null &&
    previousGate.status !== "APPROVED" &&
    (selected?.status === "IN_PROGRESS" || selected?.status === "COMPLETED");

  const counts = worksheetCounts?.phaseKey === selected?.key ? worksheetCounts : null;
  const allComplete = isPhaseWorkComplete(counts);
  const incompleteReason = phaseIncompleteReason(counts);

  /**
   * The root carries no `overflow-y-auto`, deliberately.
   *
   * The page's `<main>` is already `flex-1 flex flex-col overflow-y-auto`
   * and is the scroll container for every view. A second one here made this
   * view a scrolling box INSIDE a scrolling page: the panel took whatever
   * height flex gave it, its content scrolled within that, and the rest of
   * the window sat empty below it with a stubby second scrollbar on the
   * right. Scrolling then moved whichever container the pointer happened to
   * be over, and the bottom of a long phase could not be reached at all
   * once the outer scroll had bottomed out.
   *
   * Every other full-page view — Workload, Board, List — is a plain
   * `flex-1` child that grows and lets `main` do the scrolling. This one
   * now matches them.
   */
  return (
    <div className="flex-1 p-4 sm:p-6 space-y-5">
      {/**
       * Three sections, not three routes.
       *
       * Phases, the workshop and the backlog are one feature seen from three
       * angles, and switching between them must not cost a page load in the
       * middle of a workshop. They are also all inside the lazily-loaded
       * Activate chunk, so a project that never opens the tab downloads none
       * of it.
       */}
      <div
        role="tablist"
        aria-label="Activate sections"
        className="flex gap-1 border-b border-border overflow-x-auto no-scrollbar"
      >
        {(
          [
            ["phases", "Phases and gates"],
            ["workshop", "Fit-to-standard"],
            ["backlog", "Backlog"],
          ] as const
        ).map(([key, text]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={section === key}
            onClick={() => setSection(key)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-md ${
              section === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            {text}
          </button>
        ))}
      </div>

      {section === "workshop" && (
        <ActivateWorkshop
          projectId={projectId}
          canManageModules={can("activate:manage_phases")}
          canDecide={can("activate:manage_deliverables")}
          onChanged={loadProfile}
        />
      )}

      {section === "backlog" && (
        <ActivateBacklog
          projectId={projectId}
          canGenerate={can("activate:manage_deliverables")}
          onOpenIssue={onOpenIssue}
          onGenerated={loadProfile}
        />
      )}

      {section !== "phases" ? null : (
      <>
      {/* Phase rail ------------------------------------------------------- */}
      <div
        role="tablist"
        aria-label="Activate phases"
        className="flex items-stretch gap-2 overflow-x-auto no-scrollbar pb-1 snap-x snap-mandatory"
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
              className={`min-w-[148px] snap-start text-left px-3 py-2.5 rounded-xl border transition-all shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isSelected
                  ? "bg-card border-primary ring-1 ring-primary/30 shadow-sm"
                  : "bg-muted/40 border-border hover:bg-card hover:border-border"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-mono text-muted-foreground">
                  {String(PHASE_ORDER.indexOf(p.key as (typeof PHASE_ORDER)[number]) + 1).padStart(2, "0")}
                </span>
                {/* The gate at a glance. Marked aria-hidden and given a
                    title rather than a label: the gate status is already
                    announced in words further down this card, and saying
                    it twice is noise to a screen reader. */}
                {p.gates?.[0] && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      p.gates[0].status === "APPROVED"
                        ? "bg-emerald-500"
                        : p.gates[0].status === "REJECTED"
                          ? "bg-rose-500"
                          : p.gates[0].status === "RAISED"
                            ? "bg-amber-500"
                            : "bg-transparent"
                    }`}
                    title={`Gate ${p.gates[0].status.toLowerCase()}`}
                    aria-hidden="true"
                  />
                )}
              </span>
              <span className="block text-xs font-bold text-foreground mt-0.5">{p.name}</span>
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
          <p role="alert" className="text-xs text-destructive">
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
          <section className="bg-card rounded-2xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-bold text-foreground">
                    {selected.name}
                  </h2>
                  {selected.status === "COMPLETED" ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                      COMPLETED
                    </span>
                  ) : (
                    allComplete && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40">
                        ALL COMPLETE
                      </span>
                    )
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {fmtDate(selected.startDate)} → {fmtDate(selected.targetDate)}
                </p>
                {/* The two numbers the badge is made of. Without them a
                    greyed-out button is a puzzle: it is these that say
                    whether three tasks or one criterion is in the way. */}
                {counts && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {counts.tasksComplete} of {counts.tasksTotal} task
                    {counts.tasksTotal === 1 ? "" : "s"} · {counts.criteriaSettled} of{" "}
                    {counts.criteriaTotal} criteri{counts.criteriaTotal === 1 ? "on" : "a"} settled
                  </p>
                )}
              </div>
              {can("activate:manage_phases") && selected.status !== "IN_PROGRESS" && (
                <Btn
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
                  variant="secondary"
                >
                  Mark in progress
                </Btn>
              )}
              {/* Completing a phase is a DECISION, not an arithmetic
                  consequence of the last tick. The button enables once the
                  evidence is in; somebody still presses it, and the gate is
                  still raised and signed separately by someone else. That
                  separation is the whole point of a gate, and a checklist
                  auto-approving one would quietly remove it. */}
              {can("activate:manage_phases") && selected.status !== "COMPLETED" && (
                <Btn
                  type="button"
                  disabled={busy !== null || !allComplete}
                  title={
                    allComplete
                      ? "Closes the phase. It does not sign the quality gate — that stays a separate approval."
                      : `Available once every task is complete and every gate criterion is settled — ${incompleteReason}`
                  }
                  onClick={() =>
                    send(
                      "Complete phase",
                      `/api/projects/${projectId}/activate/phases/${selected.id}`,
                      { method: "PATCH", body: JSON.stringify({ status: "COMPLETED" }) },
                      loadProfile
                    )
                  }
                  variant="primary"
                >
                  Mark complete
                </Btn>
              )}
            </div>

            {/* Said here rather than enforced: see the note on
                runningAheadOfGate. It is a caution, not a refusal. */}
            {runningAheadOfGate && previousPhase && (
              <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg px-2.5 py-1.5">
                {previousPhase.name}&apos;s quality gate is{" "}
                {previousGate?.status === "REJECTED" ? "rejected" : "not signed off"}. This
                phase is running ahead of it.
              </p>
            )}
          </section>

          {/* Deploy readiness / Run hypercare ----------------------------- */}
          {(selected.key === "DEPLOY" || selected.key === "RUN") && phaseReadiness && (
            <Panel className="space-y-3">
              <PanelHeader
                title={selected.key === "DEPLOY" ? "Go-live readiness" : "Hypercare"}
                description={
                  selected.key === "DEPLOY"
                    ? "What has to be true before go-live. This reports; it does not approve — the gate below is where a person signs."
                    : "Continuous improvement runs inside this phase rather than after it, so these are the items still open in Run."
                }
              />

              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  {
                    label: "Deliverables done",
                    value: `${phaseReadiness.done} / ${phaseReadiness.total}`,
                    tone: undefined,
                  },
                  {
                    label: "Mandatory done",
                    value: `${phaseReadiness.mandatoryDone} / ${phaseReadiness.mandatory}`,
                    tone: undefined,
                  },
                  {
                    label: "Criteria settled",
                    tone: undefined,
                    value: phaseReadiness.gate
                      ? `${phaseReadiness.gate.criteriaSettled} / ${phaseReadiness.gate.criteriaTotal}`
                      : "—",
                  },
                  {
                    label: "Open gaps",
                    value: String(phaseReadiness.gaps),
                    // Coloured only when there is something to see; a zero
                    // in amber would be a false alarm every time.
                    tone: phaseReadiness.gaps > 0 ? ("warning" as const) : undefined,
                  },
                ].map((s) => (
                  <Stat key={s.label} label={s.label} value={s.value} tone={s.tone} />
                ))}
              </dl>

              <Note tone={phaseReadiness.readyToRaise ? "success" : "warning"}>
                {phaseReadiness.readyToRaise
                  ? "Ready to raise for sign-off."
                  : "Not ready to raise yet."}
              </Note>

              {selected.key === "DEPLOY" && readiness && readiness.deployBlockerTotal > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-bold text-foreground">
                    Mandatory deliverables still open ({readiness.deployBlockerTotal})
                  </h4>
                  <ul className="space-y-1">
                    {readiness.deployBlockers.map((b) => (
                      <li key={b.linkId} className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenIssue?.(b.issueId)}
                          className="text-[11px] font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {b.issueKey}
                        </button>
                        <span className="text-xs text-foreground flex-1 min-w-[10rem] truncate">
                          {b.title}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {b.statusName || "no status"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {readiness.deployBlockerTotal > readiness.deployBlockers.length && (
                    <p className="text-[11px] text-muted-foreground">
                      Showing the first {readiness.deployBlockers.length}. The count above is the
                      whole set.
                    </p>
                  )}
                </div>
              )}
            </Panel>
          )}

          {/* Quality gate ------------------------------------------------- */}
          {gate && (
            <section className="bg-card rounded-2xl border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-sm font-bold text-foreground">{gate.name}</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {gate.status}
                </span>
              </div>

              {/* The criteria themselves are listed by the worksheet below,
                  where they can be ticked, added and removed. This panel
                  keeps the part the worksheet has no business doing: the
                  gate's lifecycle. Listing them in both places would be the
                  same rows twice, and a person would reasonably ask which
                  one counted. */}
              <p className="text-[11px] text-muted-foreground">
                {gate.criteria.filter((c) => c.status === "MET" || c.status === "WAIVED").length} of{" "}
                {gate.criteria.length} criteri{gate.criteria.length === 1 ? "on" : "a"} settled.
                Tick them in the worksheet below; sign-off happens here.
              </p>

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
                  <Btn
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
                    variant="primary"
                  >
                    Raise for sign-off
                  </Btn>
                )}
                {can("activate:sign_off_gate") && gate.status === "RAISED" && (
                  <>
                    {/* The server refuses the raiser's own approval with a 403
                        that explains itself. Hiding the button for the raiser
                        would be guessing at who they are from the client; the
                        refusal is shown instead, which is honest and keeps the
                        control server-side where it belongs. */}
                    <Btn
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
                      variant="success"
                    >
                      Approve
                    </Btn>
                    <Btn
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
                      variant="danger"
                    >
                      Reject
                    </Btn>
                  </>
                )}
              </div>
            </section>
          )}


          {/* The phase worksheet ------------------------------------------
              The same component the Worksheet tab renders, with its own gate
              panel switched off: this page already shows the gate with its
              full lifecycle just above, and two gate panels on one screen
              would be the same rows twice.

              It replaces a flat list of linked issues. The list could not
              show a deliverable's tasks, its code or what each workstream
              was carrying, all of which this phase's plan is actually made
              of. */}
          <ActivateWorksheet
            projectId={projectId}
            phaseKey={selected.key}
            /* No phase selector: the rail above this is the phase picker. */
            phases={[]}
            onPhaseChange={setSelectedKey}
            canManageDeliverables={can("activate:manage_deliverables")}
            canManageGates={can("activate:manage_gates")}
            /* The gate IS shown here: its criteria, with the checkboxes and
               the add and remove controls. The panel above keeps the
               lifecycle — raising and signing off — which is a different
               act from recording evidence. */
            showGate
            onOpenIssue={onOpenIssue}
            onCounts={handleWorksheetCounts}
            onChanged={() => {
              loadProfile();
              setLoadedPhaseId(null);
            }}
          />

          {/* Issues linked to the phase that are NOT worksheet lines --------
              A generated fit-to-standard card, an issue adopted from the
              board. Shown only when there are some, because an empty panel
              headed "other issues" invites the question of what is missing.

              This is also the only place a classification can be set by
              hand, which is why the list survives rather than being
              replaced outright. */}
          {phaseId === loadedPhaseId &&
            deliverables.filter((d) => !d.phaseCode).length > 0 && (
              <section className="bg-card rounded-2xl border border-border p-4 space-y-3">
                <h3 className="text-sm font-bold text-foreground">
                  {selected.key === "EXPLORE" ? "Fit-to-standard" : "Also linked to this phase"}
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  {selected.key === "EXPLORE"
                    ? "Classify each item against the standard solution. An accepted gap is a decision somebody made, and a gate review reads it differently from one still waiting on a workshop."
                    : "Issues linked to this phase without a worksheet code — generated work, or an issue adopted from the board."}
                </p>
            {phaseId !== loadedPhaseId ? (
              <p className="text-xs text-muted-foreground py-4">Loading deliverables…</p>
            ) : deliverables.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4">
                No issues are linked to this phase yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {deliverables.map((d) => (
                  <li key={d.id} className="py-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenIssue?.(d.issue.id)}
                      className="text-[11px] font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {d.issue.issueKey}
                    </button>
                    <span className="text-xs text-foreground flex-1 min-w-[12rem] truncate">
                      {d.issue.title}
                    </span>
                    {d.workstream && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
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
                      className="text-[11px] rounded-lg border border-border bg-card px-2 py-1 disabled:opacity-50"
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
            )}

          {!gate && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <CircleDashed className="w-3.5 h-3.5" aria-hidden="true" />
              This phase has no gate configured.
            </p>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}

export default ActivateWorkspace;
