"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

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
        className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
      >
        <Plus className="w-3 h-3" aria-hidden="true" />
        Add scope item
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2"
    >
      <h4 className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
        A scope item of your own
      </h4>
      <div>
        <label
          htmlFor="activate-custom-name"
          className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
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
          className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label
            htmlFor="activate-custom-workstream"
            className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
          >
            Workstream
          </label>
          <select
            id="activate-custom-workstream"
            value={workstreamKey}
            onChange={(e) => setWorkstreamKey(e.target.value)}
            className="w-full text-[11px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-1.5"
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
            className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
          >
            Module
          </label>
          <select
            id="activate-custom-module"
            value={moduleId}
            onChange={(e) => setModuleId(e.target.value)}
            className="w-full text-[11px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-1.5"
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
          className="rounded border-slate-300 dark:border-slate-700"
        />
        <label
          htmlFor="activate-custom-userfacing"
          className="text-[11px] text-slate-600 dark:text-slate-400"
        >
          Employees or managers will see this change
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 disabled:opacity-40"
        >
          {saving ? "Adding…" : "Add item"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onError(null);
          }}
          className="px-2 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-300 dark:border-slate-700"
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

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/activate/scope-items`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load the catalogue.");
      setModules(Array.isArray(data.modules) ? data.modules : []);
      setItems(Array.isArray(data.scopeItems) ? data.scopeItems : []);
      setWorkstreams(Array.isArray(data.workstreams) ? data.workstreams : []);
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
      setMessage("Decision saved.");
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
      <div className="flex items-center justify-center py-16 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
        Loading the catalogue…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center space-y-3">
        <div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            This methodology has no scope items yet.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            A fit-to-standard workshop needs a catalogue to walk through. Load a
            content pack, add items to the methodology template — or start
            listing what this project needs.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {/* The add form is offered here too. A project whose template shipped
            empty is the one that most needs a way to write its own list, and
            sending it away to edit a template it may not administer would
            leave it with nothing to do on this screen. */}
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

  return (
    <div className="space-y-4">
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

      {/* Modules ---------------------------------------------------------- */}
      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Modules in scope</h3>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
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
                  : "border-slate-300 dark:border-slate-700 text-slate-400 dark:text-slate-500"
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
        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <div className="flex items-baseline justify-between p-4 pb-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Scope items</h3>
            <span className="text-[11px] text-slate-500">
              {decided} of {inScopeItems.length} decided
            </span>
          </div>
          {canDecide && (
            <div className="px-4 pb-2">
              <AddScopeItemForm
                projectId={projectId}
                modules={modules}
                workstreams={workstreams}
                onAdded={afterAdd}
                onError={setError}
              />
            </div>
          )}
          <ul className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {inScopeItems.map((i) => {
              const d = i.decision?.decision;
              return (
                <li key={i.id}>
                  <button
                    type="button"
                    aria-current={selectedId === i.id}
                    onClick={() => open(i)}
                    className={`w-full text-left px-4 py-2 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                      selectedId === i.id ? "bg-slate-50 dark:bg-slate-800/60" : ""
                    }`}
                  >
                    <span className="font-mono text-[10px] text-slate-400 min-w-[4.5rem]">
                      {i.code}
                    </span>
                    <span className="text-xs text-slate-800 dark:text-slate-200 flex-1 min-w-0 truncate">
                      {i.name}
                      {i.custom && (
                        <span className="ml-1.5 text-[10px] text-slate-400">added here</span>
                      )}
                      {i.tags.includes("ux") && (
                        <span className="ml-1.5 text-[10px] text-slate-400">seen by users</span>
                      )}
                    </span>
                    {d ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                        {label(d)}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400">not decided</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Decision editor ---------------------------------------------- */}
        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          {!selected || !draft ? (
            <p className="text-xs text-slate-500 py-6 text-center">
              Choose a scope item to record its decision.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {selected.code} — {selected.name}
                  </h3>
                  <p className="text-[11px] text-slate-500">{label(selected.workstreamKey)}</p>
                </div>
                {/* Only an item this project added. A template item is one row
                    read by every project seeded from that template, so there
                    is no version of removing it that affects only this one. */}
                {selected.custom && canDecide && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(selected)}
                    aria-label={`Remove ${selected.code}`}
                    className="shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-red-600 disabled:opacity-40"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                    Remove
                  </button>
                )}
              </div>

              <fieldset disabled={!canDecide || busy} className="space-y-3 disabled:opacity-70">
                <legend className="sr-only">Decision for {selected.code}</legend>

                <div className="flex flex-wrap gap-1.5">
                  {DECISIONS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      aria-pressed={draft.decision === d.value}
                      title={d.hint}
                      onClick={() => setDraft({ ...draft, decision: d.value })}
                      className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border text-left ${
                        draft.decision === d.value
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300"
                          : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>

                <div>
                  <label
                    htmlFor="activate-rationale"
                    className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
                  >
                    Why the organisation landed here
                  </label>
                  <textarea
                    id="activate-rationale"
                    rows={3}
                    value={draft.rationale}
                    onChange={(e) => setDraft({ ...draft, rationale: e.target.value })}
                    placeholder="Written for someone who was not in the room."
                    className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5"
                  />
                </div>

                <div>
                  <label
                    htmlFor="activate-question"
                    className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
                  >
                    Open question
                  </label>
                  <input
                    id="activate-question"
                    value={draft.openQuestion}
                    onChange={(e) => setDraft({ ...draft, openQuestion: e.target.value })}
                    placeholder="Anything blocking sign-off. It becomes a tracked action."
                    className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5"
                  />
                </div>

                {GENERATES.has(draft.decision) ? (
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <h4 className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                        Deltas
                      </h4>
                      <span className="text-[10px] text-slate-400">each becomes one backlog item</span>
                    </div>
                    {draft.deltas.map((d, idx) => (
                      <div
                        key={d.id ?? `new-${idx}`}
                        className="rounded-xl border border-slate-200 dark:border-slate-800 p-2 space-y-2"
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
                            className="flex-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5"
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
                            className="px-2 rounded-lg border border-slate-300 dark:border-slate-700 text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
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
                                className="w-full text-[11px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-1.5 py-1"
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
                      className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700"
                    >
                      <Plus className="w-3 h-3" aria-hidden="true" />
                      Add delta
                    </button>
                  </div>
                ) : draft.decision ? (
                  <p className="text-[11px] text-slate-500 border-t border-slate-200 dark:border-slate-800 pt-2">
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
                    className="text-[11px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1"
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="AGREED">Agreed and signed</option>
                  </select>
                  <button
                    type="button"
                    disabled={!draft.decision || busy}
                    onClick={save}
                    className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 disabled:opacity-40"
                  >
                    {busy ? "Saving…" : "Save decision"}
                  </button>
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
