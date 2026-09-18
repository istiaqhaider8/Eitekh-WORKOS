"use client";

import React, { useState, useRef } from "react";
import { Download, Upload, X, CheckCircle2, AlertTriangle, SkipForward, Loader2, FileText } from "lucide-react";
import { showSuccess, showError } from "@/lib/toast";

type ImportKind = "tasks" | "members";

interface RowResult {
  row: number;
  outcome: "created" | "skipped" | "failed";
  subject: string;
  reason?: string;
  createdKey?: string;
}

interface Summary {
  mode: "validate" | "import";
  total: number;
  created: number;
  skipped: number;
  failed: number;
  results: RowResult[];
}

interface BulkImportModalProps {
  projectId: string;
  projectKey?: string;
  /** Which tab to open on. Both are always available inside the modal. */
  initialKind?: ImportKind;
  onClose: () => void;
  /** Called after a successful import so the caller can refresh its data. */
  onImported: () => void;
}

export function BulkImportModal({
  projectId,
  projectKey,
  initialKind = "tasks",
  onClose,
  onImported,
}: BulkImportModalProps) {
  const [kind, setKind] = useState<ImportKind>(initialKind);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Summary | null>(null);
  const [result, setResult] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<"idle" | "validating" | "importing" | "template">("idle");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const endpoint = kind === "tasks" ? `/api/projects/${projectId}/import` : `/api/projects/${projectId}/members/bulk`;

  // Switching tab invalidates anything already staged — a members file must
  // never be submitted to the tasks endpoint.
  const switchKind = (next: ImportKind) => {
    if (next === kind) return;
    setKind(next);
    setCsvText("");
    setFileName("");
    setPreview(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const downloadTemplate = async () => {
    setBusy("template");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/import/template?type=${kind}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Could not download the template (${res.status}).`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectKey || "project"}-${kind}-template.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showSuccess("Template downloaded");
    } catch (e) {
      setError("Could not download the template.");
    } finally {
      setBusy("idle");
    }
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(null);
    setResult(null);
    setError(null);
    setFileName(file.name);
    const text = await file.text();
    setCsvText(text);
  };

  const send = async (mode: "validate" | "import") => {
    if (!csvText.trim()) {
      setError("Choose a CSV file first.");
      return;
    }
    setBusy(mode === "validate" ? "validating" : "importing");
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvData: csvText, mode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Request failed (${res.status}).`);
        return;
      }
      if (mode === "validate") {
        setPreview(body);
        setResult(null);
      } else {
        setResult(body);
        setPreview(null);
        if (body.created > 0) {
          showSuccess(`Imported ${body.created} ${kind === "tasks" ? "task(s)" : "member(s)"}`);
          onImported();
        } else {
          showError("Nothing was imported — see the results below.");
        }
      }
    } catch (e) {
      setError("Network error while contacting the server.");
    } finally {
      setBusy("idle");
    }
  };

  const active = result || preview;

  const outcomeStyle = (o: RowResult["outcome"]) =>
    o === "created"
      ? "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/50"
      : o === "skipped"
      ? "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/50"
      : "text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/50";

  const OutcomeIcon = ({ o }: { o: RowResult["outcome"] }) =>
    o === "created" ? (
      <CheckCircle2 className="w-3.5 h-3.5" />
    ) : o === "skipped" ? (
      <SkipForward className="w-3.5 h-3.5" />
    ) : (
      <AlertTriangle className="w-3.5 h-3.5" />
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Bulk Upload</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3">
          {(["tasks", "members"] as ImportKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => switchKind(k)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                kind === k
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300"
                  : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              {k === "tasks" ? "Tasks" : "Project Members"}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {kind === "tasks"
              ? "Download the template, fill in one task per row, then upload it. The template lists the statuses, sprints, epics and assignees this project accepts."
              : "Download the template, list one email per row, then upload it. Users must already exist and belong to this project's organization — bulk upload never creates accounts or sends invitations."}
          </p>

          {/* Step 1 — template */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={downloadTemplate}
              disabled={busy !== "idle"}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              {busy === "template" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span>Download Template</span>
            </button>

            <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
              <FileText className="w-3.5 h-3.5" />
              <span>{fileName || "Choose CSV file"}</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={onFilePicked}
                className="hidden"
              />
            </label>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          {/* Step 2 — actions */}
          {csvText && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => send("validate")}
                disabled={busy !== "idle"}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 disabled:opacity-50 cursor-pointer"
              >
                {busy === "validating" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Validate &amp; Preview</span>
              </button>

              {/* Import is deliberately gated behind a preview: the user must
                  see what will happen before anything is written. */}
              <button
                type="button"
                onClick={() => send("import")}
                disabled={busy !== "idle" || !preview || preview.created === 0}
                title={
                  !preview
                    ? "Run Validate & Preview first"
                    : preview.created === 0
                    ? "No valid rows to import"
                    : undefined
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {busy === "importing" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Import {preview && preview.created > 0 ? `${preview.created} row(s)` : ""}</span>
              </button>
            </div>
          )}

          {/* Results */}
          {active && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-200">
                  {active.mode === "validate" ? "Preview" : "Import result"}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 font-semibold">
                  {active.mode === "validate" ? `${active.created} will be created` : `${active.created} created`}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 font-semibold">
                  {active.skipped} skipped
                </span>
                <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 font-semibold">
                  {active.failed} failed
                </span>
                <span className="text-slate-400">of {active.total} rows</span>
              </div>

              {active.mode === "validate" && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Nothing has been saved yet. Review the rows below, then choose Import.
                </p>
              )}

              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {active.results.map((r) => (
                    <div key={`${r.row}-${r.subject}`} className="flex items-start gap-2 px-3 py-2 text-xs">
                      <span className="font-mono text-slate-400 shrink-0 w-10">#{r.row}</span>
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold shrink-0 ${outcomeStyle(
                          r.outcome
                        )}`}
                      >
                        <OutcomeIcon o={r.outcome} />
                        {r.outcome}
                      </span>
                      <span className="font-medium text-slate-700 dark:text-slate-200 truncate max-w-[14rem]" title={r.subject}>
                        {r.createdKey ? `${r.createdKey} — ` : ""}
                        {r.subject}
                      </span>
                      {r.reason && <span className="text-slate-500 dark:text-slate-400 flex-1">{r.reason}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            {result ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
