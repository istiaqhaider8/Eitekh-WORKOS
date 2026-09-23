"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Search, CheckCircle2, Sparkles, Filter } from "lucide-react";
import { Panel, PanelHeader, Btn, Pill, Note, Stat, Meter, EmptyState, fieldClass, FieldLabel } from "./ui";

/**
 * The fit-to-standard workshop.
 *
 * A scope item is the unit of the CONVERSATION, a decision is the unit of the
 * RECORD, and a delta is the unit of WORK. The screen is arranged that way on
 * purpose: the catalogue on the left is what a workshop walks through, and the
 * editor on the right is what it produces.
 *
 * WHY THE DECISION SAVES AS ONE REQUEST
 *
 * The outcome, the reasoning and the deltas go together. Saving them
 * separately would let a decision sit on screen beside deltas that contradict
 * it, in front of the people who just agreed something else. So the editor
 * holds a local draft and the Save button sends the whole thing.
 *
 * WHY THE DRAFT IS LOCAL
 *
 * A workshop is a conversation. Typing into a rationale and having each
 * keystroke hit the server would mean a half-written sentence is what a
 * colleague sees on their screen, and what the optimistic-locking check
 * compares against. The draft stays here until somebody has finished
 * speaking.
 */

const DECISIONS = [
  { value: "ADOPT", label: "Adopt standard", hint: "No change. The standard process is accepted." },
  { value: "CONFIGURE", label: "Configure", hint: "Standard capability, tailored by configuration." },
  { value: "EXTEND", label: "Extend", hint: "A custom field, object or code is required." },
  { value: "INTEGRATE", label: "Integrate", hint: "Needs an interface to another system." },
  { value: "DEFER", label: "Defer", hint: "Agreed, but not in this release." },
  { value: "OUT_OF_SCOPE", label: "Out of scope", hint: "Excluded. Logged as an exclusion." },
] as const;

/** Decisions that produce build work, and therefore accept deltas. */
const GENERATES = new Set(["CONFIGURE", "EXTEND", "INTEGRATE", "DEFER"]);

/**
 * What each decision means for the scope item's own task status.
 *
 * Kept as a client-side copy of one specific kind: it must match
 * ACTIVATE_DECISION_TASK_STATUS in src/lib/activate-generation.ts, and a unit
 * test compares the two so a change in one that is not made in the other
 * fails the build rather than showing a person the wrong badge. The copy
 * exists because the editor shows the consequence of a decision BEFORE it is
 * saved, when there is no server answer to display.
 *
 * DEFER is DONE here and still generates work, which is not a contradiction:
 * the conversation is finished, the thing agreed goes to the Run phase.
 */
const TASK_STATUS: Record<string, "DONE" | "BACKLOG"> = {
  ADOPT: "DONE",
  DEFER: "DONE",
  OUT_OF_SCOPE: "DONE",
  CONFIGURE: "BACKLOG",
  EXTEND: "BACKLOG",
  INTEGRATE: "BACKLOG",
};

/** The badge for a task status, or nothing at all while it is undecided. */
function TaskStatusBadge({ status }: { status: "DONE" | "BACKLOG" | null | undefined }) {
  if (!status) return null;
  const done = status === "DONE";
  return (
    <span
      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
        done
          ? "border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40"
          : "border-border text-muted-foreground"
      }`}
    >
      {done ? "Done" : "Backlog"}
    </span>
  );
}

const BUILD_TYPES = [
  "CONFIGURATION",
  "BUSINESS_RULE",
  "WORKFLOW",
  "REPORT",
  "INTERFACE",
  "CONVERSION",
  "ENHANCEMENT",
  "FORM",
] as const;
const PRIORITIES = ["MUST", "SHOULD", "COULD", "WONT"] as const;
const SIZES = ["S", "M", "L", "XL"] as const;

const label = (v: string) => v.replace(/_/g, " ").toLowerCase();

interface DeltaDraft {
  id?: string;
  title: string;
  buildType: string;
  priority: string;
  size: string;
  note?: string | null;
}

interface DecisionRecord {
  id: string;
  decision: string;
  status: string;
  rationale: string | null;
  openQuestion: string | null;
  version: number;
  deltas: Array<DeltaDraft & { id: string }>;
}

interface ScopeItem {
  id: string;
  code: string;
  name: string;
  workstreamKey: string;
  tags: string[];
  moduleId: string;
  inScope: boolean;
  /** True for an item this project added. Only those may be edited or removed. */
  custom: boolean;
  decision: DecisionRecord | null;
  /** DONE, BACKLOG, or null while undecided. Derived by the API. */
  taskStatus: "DONE" | "BACKLOG" | null;
}

interface ModuleView {
  moduleId: string;
  key: string;
  name: string;
  inScope: boolean;
  waveNumber: number | null;
  scopeItemCount: number;
}

interface WorkstreamView {
  key: string;
  name: string;
}

/** The sentinel the API uses for items filed under no template module. */
const CUSTOM_MODULE_ID = "__custom__";

/**
 * Add a scope item the catalogue does not have.
 *
 * Every real programme meets something the standard catalogue never named — a
 * works council agreement, a regulator's report, a process the business will
 * not give up. Without this the workshop stalls on exactly the items that
 * matter most, and the conversation moves to a spreadsheet nobody else can
 * see.
 *
 * No code field: the API generates it. A decision log cites a scope item by
 * its code, so two people adding items in the same workshop must not be able
 * to produce two items answering to the same one.
 */
function AddScopeItemForm({
  projectId,
  modules,
  workstreams,
  onAdded,
  onError,
}: {
  projectId: string;
  modules: ModuleView[];
  workstreams: WorkstreamView[];
  onAdded: (id: string) => void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [workstreamKey, setWorkstreamKey] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [userFacing, setUserFacing] = useState(false);
  const [saving, setSaving] = useState(false);

  // A template module only. The project's own grouping is the empty choice,
  // and it is not a module the API would accept by id.
  const targetModules = modules.filter((m) => m.moduleId !== CUSTOM_MODULE_ID);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !workstreamKey || saving) return;
    setSaving(true);
    onError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/activate/scope-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          workstreamKey,
          moduleId: moduleId || null,
          userFacing,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError(data?.error || `That could not be added (${res.status}).`);
        return;
      }
      setName("");
      setUserFacing(false);
      setOpen(false);
      onAdded(data?.scopeItem?.id ?? "");
    } catch {
      onError("The request could not be sent.");
    } finally {
      setSaving(false);
    }
  };

  if (workstreams.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setWorkstreamKey((k) => k || workstreams[0].key);
          setOpen(true);
        }}
        className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-border text-foreground"
      >
        <Plus className="w-3 h-3" aria-hidden="true" />
        Add scope item
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-border p-3 space-y-2"
    >
      <h4 className="text-[11px] font-bold text-foreground">
        A scope item of your own
      </h4>
      <div>
        <label
          htmlFor="activate-custom-name"
          className="block text-[11px] font-semibold text-muted-foreground mb-1"
        >
          What the business needs
        </label>
        <input
          id="activate-custom-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={3}
          maxLength={200}
          placeholder="Named the way the business says it, not the way the system does."
          className="w-full text-xs rounded-lg border border-border bg-card px-2 py-1.5"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label
            htmlFor="activate-custom-workstream"
            className="block text-[11px] font-semibold text-muted-foreground mb-1"
          >
            Workstream
          </label>
          <select
            id="activate-custom-workstream"
            value={workstreamKey}
            onChange={(e) => setWorkstreamKey(e.target.value)}
            className="w-full text-[11px] rounded-lg border border-border bg-card px-1.5 py-1.5"
          >
            {workstreams.map((w) => (
              <option key={w.key} value={w.key}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="activate-custom-module"
            className="block text-[11px] font-semibold text-muted-foreground mb-1"
          >
            Module
          </label>
          <select
            id="activate-custom-module"
            value={moduleId}
            onChange={(e) => setModuleId(e.target.value)}
            className="w-full text-[11px] rounded-lg border border-border bg-card px-1.5 py-1.5"
          >
            <option value="">Custom scope</option>
            {targetModules.map((m) => (
              <option key={m.moduleId} value={m.moduleId}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="activate-custom-userfacing"
          type="checkbox"
          checked={userFacing}
          onChange={(e) => setUserFacing(e.target.checked)}
          className="rounded border-border"
        />
        <label
          htmlFor="activate-custom-userfacing"
          className="text-[11px] text-muted-foreground"
        >
          Employees or managers will see this change
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Btn
          type="submit"
          disabled={saving || !name.trim()}
          variant="primary"
        >
          {saving ? "Adding…" : "Add item"}
        </Btn>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onError(null);
          }}
          className="px-2 py-1.5 text-[11px] font-semibold rounded-lg border border-border"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export interface ActivateWorkshopProps {
  projectId: string;
  canManageModules: boolean;
  canDecide: boolean;
  onChanged?: () => void;
}

export function ActivateWorkshop({
  projectId,
  canManageModules,
  canDecide,
  onChanged,
}: ActivateWorkshopProps) {
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<ModuleView[]>([]);
  const [items, setItems] = useState<ScopeItem[]>([]);
  const [workstreams, setWorkstreams] = useState<WorkstreamView[]>([]);
  /**
   * The methodologies this organisation could seed from. Only ever used by
   * the empty state below — a workshop with a catalogue has no question to
   * ask about templates.
   */
  const [templates, setTemplates] = useState<
    Array<{ id: string; name: string; variant: string | null; version: number; builtIn?: boolean }>
  >([]);
  const [switching, setSwitching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    decision: string;
    status: string;
    rationale: string;
    openQuestion: string;
    deltas: DeltaDraft[];
    version?: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<"ALL" | "UNDECIDED" | "DECIDED">("ALL");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/activate/scope-items`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load the catalogue.");
      setModules(Array.isArray(data.modules) ? data.modules : []);
      setItems(Array.isArray(data.scopeItems) ? data.scopeItems : []);
      setWorkstreams(Array.isArray(data.workstreams) ? data.workstreams : []);
      // Fetched only when the catalogue came back empty, because that is
      // the only place the answer is used and every other visit would be
      // a request whose result is thrown away.
      if (!Array.isArray(data.scopeItems) || data.scopeItems.length === 0) {
        try {
          const t = await fetch(`/api/projects/${projectId}/activate/templates`);
          const tb = await t.json();
          setTemplates(Array.isArray(tb.templates) ? tb.templates : []);
        } catch {
          // A missing template list costs the offer below, not the screen.
          setTemplates([]);
        }
      }
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Could not load the catalogue.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  /** Open a scope item, seeding the editor from whatever is recorded. */
  const open = (item: ScopeItem) => {
    setSelectedId(item.id);
    setMessage(null);
    setDraft({
      decision: item.decision?.decision ?? "",
      status: item.decision?.status ?? "DRAFT",
      rationale: item.decision?.rationale ?? "",
      openQuestion: item.decision?.openQuestion ?? "",
      deltas: (item.decision?.deltas ?? []).map((d) => ({ ...d })),
      version: item.decision?.version,
    });
  };

  const save = async () => {
    if (!selected || !draft || !draft.decision) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/activate/decisions/${selected.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: draft.decision,
            status: draft.status,
            rationale: draft.rationale || null,
            openQuestion: draft.openQuestion || null,
            // Deltas are only meaningful for a decision that produces work;
            // sending them on ADOPT would record work nobody agreed to.
            deltas: GENERATES.has(draft.decision)
              ? draft.deltas.filter((d) => d.title.trim()).map((d) => ({
                  id: d.id,
                  title: d.title.trim(),
                  buildType: d.buildType,
                  priority: d.priority,
                  size: d.size,
                }))
              : [],
            version: draft.version,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The API writes its refusals to be read by a person — a stale version
        // says so plainly — so show what it said.
        setError(data?.error || `That did not save (${res.status}).`);
        return;
      }
      /**
       * Say what happened to the board, not just that the save worked.
       *
       * The card is created or re-filed as a side effect of saving, and a
       * side effect nobody is told about is one people discover by noticing
       * a board they did not expect. The case that most needs saying is
       * `leave_alone`: the decision changed, somebody had already moved the
       * card, and it was deliberately not dragged back.
       */
      const card = data?.card;
      if (card?.action === "created") {
        setMessage(`Decision saved. ${card.issueKey} added to the board in ${card.statusName}.`);
      } else if (card?.action === "move") {
        setMessage(`Decision saved. ${card.issueKey} moved to ${card.statusName}.`);
      } else if (card?.action === "leave_alone") {
        setMessage(
          `Decision saved. ${card.issueKey} was left in ${card.statusName} — somebody moved it, ` +
            `so it was not moved back.`
        );
      } else {
        setMessage("Decision saved.");
      }
      await load();
      onChanged?.();
      if (data?.decision) {
        setDraft((d) => (d ? { ...d, version: data.decision.version } : d));
      }
    } catch {
      setError("The request could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * A newly added item opens straight into the editor, with the blank draft
   * `open` would have produced. Somebody adds an item because they are about
   * to decide it, and making them find it again in the list is a step that
   * exists only because the code did not do it for them.
   */
  const afterAdd = async (id: string) => {
    await load();
    onChanged?.();
    setMessage("Scope item added.");
    if (id) {
      setSelectedId(id);
      setDraft({ decision: "", status: "DRAFT", rationale: "", openQuestion: "", deltas: [] });
    }
  };

  /**
   * Remove an item this project added.
   *
   * The confirmation is here rather than in the API because the API's own
   * refusal — a decision already exists — is the case that actually needs
   * protecting, and it cannot be answered by clicking through a dialog.
   */
  const remove = async (item: ScopeItem) => {
    if (!window.confirm(`Remove ${item.code} — ${item.name}?`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/activate/scope-items/${item.id}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `That could not be removed (${res.status}).`);
        return;
      }
      setSelectedId(null);
      setDraft(null);
      setMessage(`${item.code} removed.`);
      await load();
      onChanged?.();
    } catch {
      setError("The request could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  const toggleModule = async (m: ModuleView) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/activate/modules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleId: m.moduleId, inScope: !m.inScope }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data?.error || "Could not change that module.");
      else {
        await load();
        onChanged?.();
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
        Loading the catalogue…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            This methodology has no scope items yet.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            A fit-to-standard workshop needs a catalogue to walk through. This
            project was started on a methodology that carries phases, gates and
            workstreams but no product scope — so there is nothing here to
            decide on yet.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {/* The add form is offered here too. A project whose template shipped
            empty is the one that most needs a way to write its own list, and
            sending it away to edit a template it may not administer would
            leave it with nothing to do on this screen. */}
        {/**
          * Switching methodology, offered only when there is one to switch
          * to and only to somebody who may change the project's setup.
          *
          * Re-seeding keeps the phases, the gates, their sign-off history
          * and every deliverable already linked — it adds the catalogue
          * rather than starting the project again. The sentence says so,
          * because a button that silently rebuilds a running project is one
          * nobody should press on trust.
          */}
        {canManageModules && templates.length > 1 && (
          <div className="text-left border border-border rounded-xl p-3 space-y-2">
            <p className="text-[11px] font-semibold text-foreground">
              Use a methodology that ships a catalogue
            </p>
            <p className="text-[10px] text-muted-foreground">
              Your phases, gates, sign-offs and deliverables are kept. Only the
              scope-item catalogue changes.
            </p>
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={switching}
                  onClick={async () => {
                    setSwitching(true);
                    setError(null);
                    try {
                      const res = await fetch(`/api/projects/${projectId}/activate`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ enabled: true, templateId: t.id }),
                      });
                      const body = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setError(body?.error || "That methodology could not be applied.");
                        return;
                      }
                      await load();
                      onChanged?.();
                    } finally {
                      setSwitching(false);
                    }
                  }}
                  className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-border hover:bg-muted disabled:opacity-50"
                >
                  {t.name}
                  {t.variant ? ` — ${t.variant}` : ""}
                </button>
              ))}
            </div>
          </div>
        )}
        {canDecide && (
          <div className="text-left">
            <AddScopeItemForm
              projectId={projectId}
              modules={modules}
              workstreams={workstreams}
              onAdded={afterAdd}
              onError={setError}
            />
          </div>
        )}
      </div>
    );
  }

  const inScopeItems = items.filter((i) => i.inScope);
  const decided = inScopeItems.filter((i) => i.decision?.decision).length;
  // Counted from the API's own field. "Decided" alone hides the difference
  // between a workshop that settled things and one that queued up build work.
  const settled = inScopeItems.filter((i) => i.taskStatus === "DONE").length;
  const queued = inScopeItems.filter((i) => i.taskStatus === "BACKLOG").length;

  return (
    <div className="space-y-4">
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

      {/* Modules ---------------------------------------------------------- */}
      <section className="bg-card rounded-2xl border border-border p-4">
        <h3 className="text-sm font-bold text-foreground">Modules in scope</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          A module switched out stops being counted and stops generating work.
          A project measured against scope it is not doing reads as behind when
          it is not.
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          {modules.map((m) => (
            <button
              key={m.moduleId}
              type="button"
              disabled={busy || !canManageModules}
              aria-pressed={m.inScope}
              aria-label={`${m.name}: ${m.inScope ? "in scope" : "out of scope"}. ${
                canManageModules ? "Activate to switch." : ""
              }`}
              onClick={() => toggleModule(m)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-full border transition-colors disabled:opacity-60 ${
                m.inScope
                  ? "border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40"
                  : "border-border text-muted-foreground"
              }`}
            >
              {m.name}
              <span className="ml-1.5 font-mono text-[10px] opacity-70">{m.scopeItemCount}</span>
              {m.waveNumber !== null && (
                <span className="ml-1.5 text-[10px] opacity-70">wave {m.waveNumber}</span>
              )}
            </button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4 items-start">
        {/* Scope items -------------------------------------------------- */}
        {/* Scope items -------------------------------------------------- */}
        <section className="bg-card rounded-2xl border border-border shadow-xs overflow-hidden">
          <div className="p-4 pb-3 border-b border-border/40 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground tracking-tight">Scope Items Catalog</h3>
                <span className="text-[11px] text-muted-foreground mt-0.5 block">
                  {decided} of {inScopeItems.length} decided · {settled} done, {queued} queued for build
                </span>
              </div>
              {canDecide && (
                <AddScopeItemForm
                  projectId={projectId}
                  modules={modules}
                  workstreams={workstreams}
                  onAdded={afterAdd}
                  onError={setError}
                />
              )}
            </div>

            {/* Scope Items Search & Filter */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Filter scope items by name or code…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs pl-8 pr-2.5 py-1.5 rounded-lg border border-border bg-muted/30 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                />
              </div>

              <div className="flex rounded-lg border border-border p-0.5 bg-muted/40 text-[10px] font-semibold shrink-0">
                {(["ALL", "UNDECIDED", "DECIDED"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDecisionFilter(mode)}
                    className={`px-2 py-1 rounded-md transition-colors ${
                      decisionFilter === mode
                        ? "bg-card text-foreground shadow-2xs font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {mode === "ALL" ? "All" : mode === "UNDECIDED" ? "Open" : "Decided"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <ul className="lg:max-h-[60vh] lg:overflow-y-auto divide-y divide-border/60">
            {inScopeItems
              .filter((i) => {
                if (decisionFilter === "UNDECIDED" && i.decision?.decision) return false;
                if (decisionFilter === "DECIDED" && !i.decision?.decision) return false;
                if (searchQuery.trim()) {
                  const q = searchQuery.toLowerCase();
                  return (
                    i.name.toLowerCase().includes(q) ||
                    i.code.toLowerCase().includes(q) ||
                    i.workstreamKey.toLowerCase().includes(q)
                  );
                }
                return true;
              })
              .map((i) => {
                const d = i.decision?.decision;
                const isSelected = selectedId === i.id;

                return (
                  <li key={i.id}>
                    <button
                      type="button"
                      aria-current={isSelected}
                      onClick={() => open(i)}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-2.5 transition-colors ${
                        isSelected
                          ? "bg-primary/10 border-l-3 border-l-primary font-medium"
                          : "hover:bg-muted/40"
                      }`}
                    >
                      <span className="font-mono text-[10px] font-bold text-muted-foreground min-w-[4.25rem]">
                        {i.code}
                      </span>
                      <span className="text-xs text-foreground flex-1 min-w-0 truncate">
                        {i.name}
                        {i.custom && (
                          <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
                            Custom
                          </span>
                        )}
                        {i.tags.includes("ux") && (
                          <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                            UX Impact
                          </span>
                        )}
                      </span>
                      {d ? (
                        <span className="flex items-center gap-1.5 shrink-0">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            d === "ADOPT"
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                              : d === "CONFIGURE"
                                ? "bg-blue-500/10 text-blue-600 border-blue-500/30"
                                : d === "EXTEND"
                                  ? "bg-purple-500/10 text-purple-600 border-purple-500/30"
                                  : d === "INTEGRATE"
                                    ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                                    : "bg-muted text-muted-foreground border-border"
                          }`}>
                            {label(d)}
                          </span>
                          <TaskStatusBadge status={i.taskStatus} />
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground shrink-0 font-medium">
                          Undecided
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>

        {/* Decision editor ---------------------------------------------- */}
        <section className="bg-card rounded-2xl border border-border p-5 shadow-xs">
          {!selected || !draft ? (
            <p className="text-xs text-muted-foreground py-10 text-center">
              Choose a scope item from the catalog on the left to record its fit-to-standard outcome.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2 pb-3 border-b border-border/40">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-primary px-2 py-0.5 rounded bg-primary/10">
                      {selected.code}
                    </span>
                    <h3 className="text-sm font-bold text-foreground">
                      {selected.name}
                    </h3>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Workstream: <strong className="text-foreground">{label(selected.workstreamKey)}</strong>
                  </p>
                </div>
                {selected.custom && canDecide && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(selected)}
                    aria-label={`Remove ${selected.code}`}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-rose-300 dark:border-rose-900 text-rose-600 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Delete Item
                  </button>
                )}
              </div>

              <fieldset disabled={!canDecide || busy} className="space-y-3.5 disabled:opacity-70">
                <legend className="sr-only">Decision for {selected.code}</legend>

                <div>
                  <FieldLabel>Workshop Agreement / Decision</FieldLabel>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {DECISIONS.map((d) => {
                      const isChosen = draft.decision === d.value;
                      return (
                        <button
                          key={d.value}
                          type="button"
                          aria-pressed={isChosen}
                          title={d.hint}
                          onClick={() => setDraft({ ...draft, decision: d.value })}
                          className={`p-2.5 rounded-xl border text-left transition-all duration-150 ${
                            isChosen
                              ? "border-primary bg-primary/10 ring-1 ring-primary/30 shadow-2xs"
                              : "border-border/80 bg-muted/20 hover:bg-muted/50"
                          }`}
                        >
                          <span className={`block text-xs font-bold ${isChosen ? "text-primary" : "text-foreground"}`}>
                            {d.label}
                          </span>
                          <span className="block text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                            {d.hint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* The consequence, shown before Save rather than discovered
                    after it. Adopt, Defer and Out of scope settle the item;
                    the other three commit somebody to building something. */}
                {draft.decision && (
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <TaskStatusBadge status={TASK_STATUS[draft.decision]} />
                    {TASK_STATUS[draft.decision] === "DONE"
                      ? draft.decision === "DEFER"
                        ? "Settles this scope item. Anything you record below is still created, in the Run phase."
                        : "Settles this scope item. Nothing is left to build."
                      : "Leaves this scope item in the backlog until the work below is delivered."}
                  </p>
                )}

                <div>
                  <label
                    htmlFor="activate-rationale"
                    className="block text-[11px] font-semibold text-muted-foreground mb-1"
                  >
                    Why the organisation landed here
                  </label>
                  <textarea
                    id="activate-rationale"
                    rows={3}
                    value={draft.rationale}
                    onChange={(e) => setDraft({ ...draft, rationale: e.target.value })}
                    placeholder="Written for someone who was not in the room."
                    className="w-full text-xs rounded-lg border border-border bg-card px-2 py-1.5"
                  />
                </div>

                <div>
                  <label
                    htmlFor="activate-question"
                    className="block text-[11px] font-semibold text-muted-foreground mb-1"
                  >
                    Open question
                  </label>
                  <input
                    id="activate-question"
                    value={draft.openQuestion}
                    onChange={(e) => setDraft({ ...draft, openQuestion: e.target.value })}
                    placeholder="Anything blocking sign-off. It becomes a tracked action."
                    className="w-full text-xs rounded-lg border border-border bg-card px-2 py-1.5"
                  />
                </div>

                {GENERATES.has(draft.decision) ? (
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <h4 className="text-[11px] font-bold text-foreground">
                        Deltas
                      </h4>
                      <span className="text-[10px] text-muted-foreground">each becomes one backlog item</span>
                    </div>
                    {draft.deltas.map((d, idx) => (
                      <div
                        key={d.id ?? `new-${idx}`}
                        className="rounded-xl border border-border p-2 space-y-2"
                      >
                        <div className="flex gap-2">
                          {/* An explicit aria-label rather than a paired
                              <label htmlFor>: the id is a template literal,
                              and a name only a running browser could resolve
                              is one nobody can verify from the source. */}
                          <input
                            aria-label={`What differs from standard, delta ${idx + 1}`}
                            value={d.title}
                            onChange={(e) => {
                              const next = [...draft.deltas];
                              next[idx] = { ...d, title: e.target.value };
                              setDraft({ ...draft, deltas: next });
                            }}
                            placeholder="What differs from standard, and what has to be built"
                            className="flex-1 text-xs rounded-lg border border-border bg-card px-2 py-1.5"
                          />
                          <button
                            type="button"
                            aria-label={`Remove delta ${idx + 1}`}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                deltas: draft.deltas.filter((_, j) => j !== idx),
                              })
                            }
                            className="px-2 rounded-lg border border-border text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {[
                            { key: "buildType" as const, opts: BUILD_TYPES, name: "Build type" },
                            { key: "priority" as const, opts: PRIORITIES, name: "Priority" },
                            { key: "size" as const, opts: SIZES, name: "Size" },
                          ].map((f) => (
                            <div key={f.key}>
                              <label
                                className="sr-only"
                                htmlFor={`delta-${f.key}-${idx}`}
                              >{`${f.name} for delta ${idx + 1}`}</label>
                              <select
                                id={`delta-${f.key}-${idx}`}
                                aria-label={`${f.name} for delta ${idx + 1}`}
                                value={d[f.key]}
                                onChange={(e) => {
                                  const next = [...draft.deltas];
                                  next[idx] = { ...d, [f.key]: e.target.value };
                                  setDraft({ ...draft, deltas: next });
                                }}
                                className="w-full text-[11px] rounded-lg border border-border bg-card px-1.5 py-1"
                              >
                                {f.opts.map((o) => (
                                  <option key={o} value={o}>
                                    {label(o)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          deltas: [
                            ...draft.deltas,
                            { title: "", buildType: "CONFIGURATION", priority: "SHOULD", size: "M" },
                          ],
                        })
                      }
                      className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-border"
                    >
                      <Plus className="w-3 h-3" aria-hidden="true" />
                      Add delta
                    </button>
                  </div>
                ) : draft.decision ? (
                  <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
                    {draft.decision === "ADOPT"
                      ? "Adopting standard generates no build work. The decision itself is the record, and it is what protects the timeline."
                      : "An exclusion generates no build work. It is logged so it cannot quietly return during Realize."}
                  </p>
                ) : null}

                <div className="flex items-center gap-2 pt-1">
                  <label className="sr-only" htmlFor="activate-decision-status">
                    Decision status
                  </label>
                  <select
                    id="activate-decision-status"
                    value={draft.status}
                    onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                    className="text-[11px] rounded-lg border border-border bg-card px-2 py-1"
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="AGREED">Agreed and signed</option>
                  </select>
                  <Btn
                    type="button"
                    disabled={!draft.decision || busy}
                    onClick={save}
                    variant="primary"
                  >
                    {busy ? "Saving…" : "Save decision"}
                  </Btn>
                </div>
              </fieldset>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default ActivateWorkshop;
