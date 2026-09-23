"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Sparkles, CheckCircle2, Layers } from "lucide-react";
import { Panel, PanelHeader, Btn, Pill, Note, Stat, Meter, EmptyState, fieldClass, FieldLabel } from "./ui";

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
  /** The board column this item will be created in. */
  issueStatus: "DONE" | "BACKLOG";
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
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
        Working out the backlog…
      </div>
    );
  }

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

      <section className="bg-card rounded-2xl border border-border shadow-xs overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-border/40">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                <Layers className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-foreground">
                Generated Backlog Queue
              </h3>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {items.length} items derived from workshop decisions · {items.length - pending} synced to board · {pending} pending creation
            </p>
          </div>
          {canGenerate && (
            <Btn
              type="button"
              disabled={busy || pending === 0}
              onClick={generate}
              variant="primary"
              size="md"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {busy
                ? "Creating Issues…"
                : pending === 0
                  ? "All Synchronized"
                  : `Create ${pending} Project Issue${pending === 1 ? "" : "s"}`}
            </Btn>
          )}
        </div>

        {items.length === 0 ? (
          <p className="px-5 py-8 text-xs text-muted-foreground text-center">
            No work is implied yet. Record a decision that departs from standard in the Fit-to-Standard workshop to preview generated backlog issues.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">
                Backlog items implied by the current fit-to-standard decisions
              </caption>
              <thead>
                <tr className="text-left text-[10px] uppercase font-bold tracking-wider text-muted-foreground bg-muted/20 border-b border-border">
                  <th scope="col" className="px-4 py-3">Work Item</th>
                  <th scope="col" className="px-3 py-3">Type</th>
                  <th scope="col" className="px-2 py-3">Priority</th>
                  <th scope="col" className="px-2 py-3">Size</th>
                  <th scope="col" className="px-2 py-3">Target Phase</th>
                  <th scope="col" className="px-3 py-3">Initial Status</th>
                  <th scope="col" className="px-4 py-3">Linked Board Issue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {items.map((b) => (
                  <tr
                    key={b.originKey}
                    className="hover:bg-muted/30 transition-colors align-middle"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">
                        {b.title}
                        {b.automatic && (
                          <span
                            className="ml-2 text-[9px] font-bold px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                            title={b.note ?? "Added by an automated methodology rule"}
                          >
                            AUTO-RULE
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono mt-0.5 flex items-center gap-1.5">
                        <span className="font-bold text-foreground/80">{b.scopeItemCode}</span>
                        <span>•</span>
                        <span className="capitalize">{label(b.decision)}</span>
                        {b.decisionTaskStatus === "DONE" && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            • Decision Agreed
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                        {label(b.buildType)}
                      </span>
                    </td>
                    <td className="px-2 py-3 font-semibold text-muted-foreground">
                      {label(b.priority)}
                    </td>
                    <td className="px-2 py-3 font-mono font-bold text-foreground">
                      {b.size}
                    </td>
                    <td className="px-2 py-3 text-muted-foreground font-medium">
                      {label(b.targetPhaseKey)}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          b.issueStatus === "DONE"
                            ? "border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {b.issueStatus === "DONE" ? "Done" : "Backlog"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {b.issue ? (
                        <button
                          type="button"
                          onClick={() => onOpenIssue?.(b.issue!.id)}
                          className="font-mono text-[11px] font-bold text-primary hover:underline"
                        >
                          {b.issue.issueKey}
                        </button>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic">
                          Queued (Click Create)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-card rounded-2xl border border-border p-4">
        <h3 className="text-sm font-bold text-foreground">Why items appear</h3>
        <dl className="mt-2 space-y-1.5">
          {[
            ["Delta", "Every difference you record on a non-standard decision becomes one item."],
            ["Extend", "An extension adds a regression scenario, because extensions are what break at a vendor release."],
            ["Integrate", "An interface adds an error handling and monitoring item. One with no defined failure path is not designed."],
            ["User facing", "A change people can see adds a change and training item."],
            ["Question", "An open question becomes a tracked action that blocks design sign-off."],
            ["Out of scope", "A module switched out generates nothing and is not counted."],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-1 sm:grid-cols-[6.5rem_1fr] gap-1 sm:gap-2">
              <dt className="text-[11px] font-bold text-foreground">{k}</dt>
              <dd className="text-[11px] text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

export default ActivateBacklog;
