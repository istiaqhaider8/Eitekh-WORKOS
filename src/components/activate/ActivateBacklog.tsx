"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * The backlog the current decisions imply, and the button that makes it real.
 *
 * WHY THERE IS A PREVIEW AT ALL
 *
 * Generation creates issues on the shared board. An issue is not free to
 * withdraw once someone has commented on it or pulled it into a sprint, so
 * the list of what WOULD be created is shown first and creating it is a
 * deliberate act. A fit-to-standard workshop is exactly where people change
 * their minds mid-sentence.
 *
 * WHY EACH ROW SAYS WHY IT EXISTS
 *
 * Items marked `auto` were added by a rule rather than typed by anyone — a
 * regression scenario because something is being extended, an error-handling
 * item because something is being integrated, a change-and-training item
 * because employees will see the difference. A project manager who cannot
 * find out why an item appeared will delete it, and those three are precisely
 * the ones programmes forget.
 */

interface BacklogItem {
  originKey: string;
  title: string;
  buildType: string;
  priority: string;
  size: string;
  workstreamKey: string;
  targetPhaseKey: string;
  scopeItemCode: string;
  decision: string;
  /**
   * The status of the scope item this came from — NOT of the issue it
   * becomes. Generated work always starts in the project's Backlog; this says
   * whether the fit-to-standard conversation behind it is settled, which is
   * DONE for anything deferred.
   */
  decisionTaskStatus: "DONE" | "BACKLOG";
  automatic: boolean;
  note: string | null;
  issue: { id: string; issueKey: string } | null;
}

export interface ActivateBacklogProps {
  projectId: string;
  canGenerate: boolean;
  onOpenIssue?: (issueId: string) => void;
  onGenerated?: () => void;
}

const label = (v: string) => v.replace(/_/g, " ").toLowerCase();

export function ActivateBacklog({
  projectId,
  canGenerate,
  onOpenIssue,
  onGenerated,
}: ActivateBacklogProps) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/activate/backlog`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load the backlog.");
      setItems(Array.isArray(data.items) ? data.items : []);
      setPending(data.pending ?? 0);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Could not load the backlog.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/activate/backlog`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `That did not work (${res.status}).`);
        return;
      }
      setMessage(
        data.created === 0
          ? "Nothing new to create — every item already exists."
          : `Created ${data.created} issue${data.created === 1 ? "" : "s"}.`
      );
      await load();
      onGenerated?.();
    } catch {
      setError("The request could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
        Working out the backlog…
      </div>
    );
  }

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

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Backlog from decisions
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {items.length} item{items.length === 1 ? "" : "s"} implied ·{" "}
              {items.length - pending} already created · {pending} not yet
            </p>
          </div>
          {canGenerate && (
            <button
              type="button"
              disabled={busy || pending === 0}
              onClick={generate}
              className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 disabled:opacity-40"
            >
              {busy
                ? "Creating…"
                : pending === 0
                  ? "Nothing to create"
                  : `Create ${pending} issue${pending === 1 ? "" : "s"}`}
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <p className="px-4 pb-5 text-xs text-slate-500">
            No work is implied yet. Record a decision that departs from the
            standard, and it will appear here before anything is created.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">
                Backlog items implied by the current fit-to-standard decisions
              </caption>
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <th scope="col" className="px-4 py-2 font-semibold">Item</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Type</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Pri</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Size</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Phase</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Issue</th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <tr
                    key={b.originKey}
                    className="border-b border-slate-100 dark:border-slate-800/70 align-top"
                  >
                    <td className="px-4 py-2">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {b.title}
                      </span>
                      {b.automatic && (
                        <span
                          className="ml-1.5 text-[9px] font-bold px-1 py-px rounded border border-slate-300 dark:border-slate-700 text-slate-500"
                          title={b.note ?? "Added by a generation rule"}
                        >
                          AUTO
                        </span>
                      )}
                      <span className="block text-[10px] text-slate-400 font-mono">
                        {b.scopeItemCode} · {label(b.decision)}
                        {/* Reads "defer · scope item done" — the pairing that
                            would otherwise look like a mistake on the board:
                            settled decision, real work still to do. */}
                        {b.decisionTaskStatus === "DONE" && (
                          <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                            · scope item done
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-400">
                      {label(b.buildType)}
                    </td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-400">
                      {label(b.priority)}
                    </td>
                    <td className="px-2 py-2 font-mono text-slate-600 dark:text-slate-400">
                      {b.size}
                    </td>
                    <td className="px-2 py-2 text-slate-600 dark:text-slate-400">
                      {label(b.targetPhaseKey)}
                    </td>
                    <td className="px-2 py-2">
                      {b.issue ? (
                        <button
                          type="button"
                          onClick={() => onOpenIssue?.(b.issue!.id)}
                          className="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {b.issue.issueKey}
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-400">not created</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Why items appear</h3>
        <dl className="mt-2 space-y-1.5">
          {[
            ["Delta", "Every difference you record on a non-standard decision becomes one item."],
            ["Extend", "An extension adds a regression scenario, because extensions are what break at a vendor release."],
            ["Integrate", "An interface adds an error handling and monitoring item. One with no defined failure path is not designed."],
            ["User facing", "A change people can see adds a change and training item."],
            ["Question", "An open question becomes a tracked action that blocks design sign-off."],
            ["Out of scope", "A module switched out generates nothing and is not counted."],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-2">
              <dt className="text-[11px] font-bold text-slate-700 dark:text-slate-300">{k}</dt>
              <dd className="text-[11px] text-slate-500 dark:text-slate-400">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

export default ActivateBacklog;
