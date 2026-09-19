"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Megaphone,
  Plus,
  Search,
  Edit2,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  X,
  Clock,
  Radio,
  Bell,
  Eye,
  Users2,
  Target,
} from "lucide-react";
import { showSuccess, showError } from "@/lib/toast";

/** The seven targeting dimensions, in the order the picker shows them. */
const TARGET_KINDS = [
  { kind: "PROJECT", label: "Projects" },
  { kind: "USER_TYPE", label: "User type" },
  { kind: "PROJECT_ROLE", label: "Project role" },
  { kind: "TEAM", label: "Teams" },
  { kind: "ORG", label: "Organizations" },
  { kind: "ORG_ROLE", label: "Org role" },
  { kind: "USER", label: "Individual users" },
] as const;

type TargetRule = { kind: string; value: string };

/**
 * Audience selection.
 *
 * Whatever this produces is re-validated and re-resolved server-side by
 * lib/announcement-targeting.ts — the picker chooses an audience, it does not
 * enforce one.
 */
function AudienceBuilder({
  audienceMode,
  matchMode,
  targets,
  options,
  onChange,
}: {
  audienceMode: string;
  matchMode: string;
  targets: TargetRule[];
  options: Record<string, Array<{ value: string; label: string; count: number }>>;
  onChange: (patch: { audienceMode?: string; matchMode?: string; targets?: TargetRule[] }) => void;
}) {
  const [openKind, setOpenKind] = useState<string>("PROJECT");
  const [filter, setFilter] = useState("");

  const has = (kind: string, value: string) => targets.some((t) => t.kind === kind && t.value === value);
  const toggle = (kind: string, value: string) => {
    onChange({
      targets: has(kind, value)
        ? targets.filter((t) => !(t.kind === kind && t.value === value))
        : [...targets, { kind, value }],
    });
  };
  const countFor = (kind: string) => targets.filter((t) => t.kind === kind).length;
  const usedKinds = [...new Set(targets.map((t) => t.kind))];

  const list = (options[openKind] || []).filter((o) =>
    !filter.trim() ? true : o.label.toLowerCase().includes(filter.trim().toLowerCase())
  );

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
      <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-semibold">
        <Users2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
        <span>Audience</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            checked={audienceMode === "ALL"}
            onChange={() => onChange({ audienceMode: "ALL" })}
            className="text-indigo-600"
          />
          <span className="text-slate-700 dark:text-slate-300">Everyone on the platform</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            checked={audienceMode === "FILTERED"}
            onChange={() => onChange({ audienceMode: "FILTERED" })}
            className="text-indigo-600"
          />
          <span className="text-slate-700 dark:text-slate-300">Only a targeted audience</span>
        </label>
      </div>

      {audienceMode === "FILTERED" && (
        <div className="space-y-2 pt-1">
          {/* How kinds combine. Within one kind the values are always OR. */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-slate-600 dark:text-slate-400">Combine the groups below with</span>
            <select
              value={matchMode}
              onChange={(e) => onChange({ matchMode: e.target.value })}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 text-slate-800 dark:text-slate-200 outline-none"
            >
              <option value="ANY">ANY — reach a user matching any group</option>
              <option value="ALL">ALL — only users matching every group</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-1">
            {TARGET_KINDS.map((k) => {
              const n = countFor(k.kind);
              const active = openKind === k.kind;
              return (
                <button
                  key={k.kind}
                  type="button"
                  onClick={() => { setOpenKind(k.kind); setFilter(""); }}
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                    active
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                  }`}
                >
                  {k.label}
                  {n > 0 && (
                    <span className={`ml-1 ${active ? "text-indigo-100" : "text-indigo-600 dark:text-indigo-400"}`}>
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {(options[openKind] || []).length > 8 && (
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter this list..."
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-1.5 text-[11px] text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500"
            />
          )}

          <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            {list.length === 0 ? (
              <div className="p-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
                {(options[openKind] || []).length === 0 ? "Nothing to target here yet." : "No match."}
              </div>
            ) : (
              list.map((o) => (
                <label
                  key={o.value}
                  className="flex items-center gap-2 p-1.5 text-[11px] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <input
                    type="checkbox"
                    checked={has(openKind, o.value)}
                    onChange={() => toggle(openKind, o.value)}
                    className="rounded text-indigo-600"
                  />
                  <span className="text-slate-700 dark:text-slate-300 truncate flex-1">{o.label}</span>
                  <span className="text-slate-500 dark:text-slate-400 tabular-nums">{o.count}</span>
                </label>
              ))
            )}
          </div>

          {targets.length > 0 ? (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {targets.map((t) => (
                <span
                  key={`${t.kind}:${t.value}`}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[10px] font-semibold"
                >
                  {t.kind.replace(/_/g, " ")}:{" "}
                  {(options[t.kind] || []).find((o) => o.value === t.value)?.label || t.value}
                  <button type="button" onClick={() => toggle(t.kind, t.value)} className="cursor-pointer">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              No audience selected yet — a targeted announcement with no groups reaches nobody.
            </p>
          )}

          {matchMode === "ALL" && usedKinds.length > 1 && (
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Reaches only users matching <strong>all</strong> of: {usedKinds.map((k) => k.replace(/_/g, " ").toLowerCase()).join(" + ")}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function PlatformAnnouncementsView() {
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [activeItem, setActiveItem] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    title: "",
    message: "",
    severity: "INFO",
    targetAudience: "ALL",
    isActive: true,
    startsAt: "",
    expiresAt: "",
    audienceMode: "ALL",
    matchMode: "ANY",
    targets: [] as TargetRule[],
    broadcast: false,
  });

  const [audienceOptions, setAudienceOptions] = useState<Record<string, Array<{ value: string; label: string; count: number }>>>({});

  // Loaded once: the picker's options come from live data, so it cannot offer a
  // project that the create endpoint would then reject.
  useEffect(() => {
    fetch("/api/super-admin/announcements/audience")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.options && setAudienceOptions(d.options))
      .catch(() => {});
  }, []);

  const loadAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/super-admin/announcements");
      if (res.ok) {
        const data = await res.json();
        setAnnouncements(data.announcements || []);
      }
    } catch (err: any) {
      console.error(err);
      showError("Failed to load platform announcements");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnnouncements();
  }, [loadAnnouncements]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.message.trim()) {
      showError("Title and message are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/super-admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || "Announcement published successfully");
        setShowCreateModal(false);
        setForm({
          title: "",
          message: "",
          severity: "INFO",
          targetAudience: "ALL",
          isActive: true,
          startsAt: "",
          expiresAt: "",
          audienceMode: "ALL",
          matchMode: "ANY",
          targets: [],
          broadcast: false,
        });
        loadAnnouncements();
      } else {
        showError(data.error || "Failed to publish announcement");
      }
    } catch (err: any) {
      showError(err.message || "Error publishing announcement");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeItem) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/super-admin/announcements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeItem.id,
          ...form,
          startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || "Announcement updated successfully");
        setShowEditModal(false);
        setActiveItem(null);
        loadAnnouncements();
      } else {
        showError(data.error || "Failed to update announcement");
      }
    } catch (err: any) {
      showError(err.message || "Error updating announcement");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (item: any) => {
    try {
      const res = await fetch("/api/super-admin/announcements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          isActive: !item.isActive,
        }),
      });
      if (res.ok) {
        showSuccess(`Announcement set to ${!item.isActive ? "ACTIVE" : "INACTIVE"}`);
        loadAnnouncements();
      } else {
        showError("Failed to update announcement status");
      }
    } catch (err: any) {
      showError(err.message || "Error updating status");
    }
  };

  const handleDelete = async () => {
    if (!activeItem) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/super-admin/announcements?id=${activeItem.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || "Announcement deleted successfully");
        setShowDeleteModal(false);
        setActiveItem(null);
        loadAnnouncements();
      } else {
        showError(data.error || "Failed to delete announcement");
      }
    } catch (err: any) {
      showError(err.message || "Error deleting announcement");
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = announcements.filter((a) => {
    return (
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.message.toLowerCase().includes(search.toLowerCase()) ||
      a.severity.toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Global Platform Announcements & Broadcasts
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Publish system banners, maintenance windows, downtime alerts, and feature releases across all tenants.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setForm({
                title: "",
                message: "",
                severity: "INFO",
                targetAudience: "ALL",
                isActive: true,
                startsAt: "",
                expiresAt: "",
                audienceMode: "ALL",
                matchMode: "ANY",
                targets: [],
                broadcast: false,
              });
              setShowCreateModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Publish Announcement</span>
          </button>
          <button
            onClick={loadAnnouncements}
            className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg border border-slate-300 dark:border-slate-700 cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-600 dark:text-indigo-400" : ""}`} />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center justify-between gap-3 bg-white dark:bg-slate-900/80 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-700 dark:text-slate-300 w-full sm:w-80">
          <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="Search announcements..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none w-full text-slate-800 dark:text-slate-200 placeholder-slate-500"
          />
        </div>
        <span className="text-[11px] text-slate-600 dark:text-slate-400">{filtered.length} total announcements</span>
      </div>

      {/* Announcements List */}
      <div className="space-y-3">
        {filtered.map((item) => {
          const isCritical = item.severity === "CRITICAL";
          const isWarning = item.severity === "WARNING";
          return (
            <div
              key={item.id}
              className={`bg-white dark:bg-slate-900/90 border rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all ${
                item.isActive
                  ? isCritical
                    ? "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40"
                    : isWarning
                    ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40"
                    : "border-indigo-200 dark:border-indigo-800"
                  : "border-slate-200 dark:border-slate-800 opacity-60"
              }`}
            >
              <div className="space-y-1.5 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      isCritical
                        ? "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                        : isWarning
                        ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                        : "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                    } dark:text-rose-400 dark:text-amber-400 dark:text-indigo-400`}
                  >
                    {item.severity}
                  </span>
                  {/* Lifecycle, derived server-side from isActive plus the
                      schedule, so SCHEDULED becomes ACTIVE and then EXPIRED on
                      its own. `isActive` alone could not tell those apart. */}
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      item.status === "ACTIVE"
                        ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                        : item.status === "SCHEDULED"
                          ? "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300"
                          : item.status === "EXPIRED"
                            ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {item.status || (item.isActive ? "ACTIVE" : "DRAFT")}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400">
                    <Target className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                    {item.audienceMode === "FILTERED"
                      ? `${(item.targets || []).length} rule${(item.targets || []).length === 1 ? "" : "s"}` +
                        ((item.targets || []).length > 1 ? ` · match ${item.matchMode || "ANY"}` : "")
                      : "Everyone"}
                  </span>
                  {item.audienceMode === "FILTERED" && (item.targets || []).length > 0 && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-md">
                      {[...new Set((item.targets || []).map((t: any) => t.kind))]
                        .map((k: any) => String(k).replace(/_/g, " ").toLowerCase())
                        .join(", ")}
                    </span>
                  )}
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    · {new Date(item.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{item.title}</h3>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{item.message}</p>
                {item.expiresAt && (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Expires: {new Date(item.expiresAt).toLocaleString()}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                <button
                  onClick={() => handleToggleStatus(item)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    item.isActive
                      ? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-200"
                      : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                  }`}
                >
                  {item.isActive ? "Deactivate" : "Activate"}
                </button>
                <button
                  onClick={() => {
                    setActiveItem(item);
                    setForm({
                      title: item.title,
                      message: item.message,
                      severity: item.severity,
                      targetAudience: item.targetAudience,
                      isActive: item.isActive,
                      startsAt: item.startsAt ? String(item.startsAt).split(".")[0] : "",
                      expiresAt: item.expiresAt ? String(item.expiresAt).split(".")[0] : "",
                      // Hydrate the saved audience so opening Edit shows what is
                      // actually stored. Without this the builder would come up
                      // empty and saving would wipe the audience.
                      audienceMode: item.audienceMode || "ALL",
                      matchMode: item.matchMode || "ANY",
                      targets: (item.targets || []).map((t: any) => ({ kind: t.kind, value: t.value })),
                      // Editing must not silently re-notify everyone.
                      broadcast: false,
                    });
                    setShowEditModal(true);
                  }}
                  className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-indigo-800 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                  title="Edit Announcement"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    setActiveItem(item);
                    setShowDeleteModal(true);
                  }}
                  className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-rose-600 hover:bg-rose-100 rounded transition-colors cursor-pointer dark:hover:bg-rose-900/50"
                  title="Delete Announcement"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && !loading && (
          <div className="text-center py-12 bg-white dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-xs">
            No system announcements recorded.
          </div>
        )}
      </div>

      {/* Modal: Create Announcement */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Publish Global Announcement
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Scheduled System Maintenance"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Message Content *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Describe the platform alert or release..."
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Severity</label>
                  <select
                    value={form.severity}
                    onChange={(e) => setForm({ ...form, severity: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  >
                    <option value="INFO">INFO (Blue/Cyan)</option>
                    <option value="WARNING">WARNING (Amber)</option>
                    <option value="CRITICAL">CRITICAL (Red)</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Label</label>
                  <select
                    value={form.targetAudience}
                    onChange={(e) => setForm({ ...form, targetAudience: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                    title="A descriptive label only. Who actually receives this is set under Audience below."
                  >
                    <option value="ALL">All Platform Users</option>
                    <option value="ORGS">Organization Admins</option>
                    <option value="USERS">Regular Members Only</option>
                  </select>
                </div>
              </div>

              {/* Publish window. Leaving "Starts" empty publishes immediately;
                  leaving "Expires" empty means it never expires. */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">
                    Starts <span className="text-slate-500 dark:text-slate-400">(blank = now)</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">
                    Expires <span className="text-slate-500 dark:text-slate-400">(blank = never)</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={form.expiresAt}
                    onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  />
                </div>
              </div>

              <AudienceBuilder
                audienceMode={form.audienceMode}
                matchMode={form.matchMode}
                targets={form.targets}
                options={audienceOptions}
                onChange={(patch) => setForm({ ...form, ...patch })}
              />

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="activeBanner"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="rounded border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-indigo-600 dark:text-indigo-400"
                />
                <label htmlFor="activeBanner" className="text-slate-700 dark:text-slate-300">
                  Published (visible once the start time passes)
                </label>
              </div>

              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id="broadcastNotify"
                  checked={form.broadcast}
                  onChange={(e) => setForm({ ...form, broadcast: e.target.checked })}
                  className="mt-0.5 rounded border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-indigo-600"
                />
                <label htmlFor="broadcastNotify" className="text-slate-700 dark:text-slate-300">
                  Also send a notification
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                    Goes only to the audience selected above — resolved server-side, not to everyone.
                  </span>
                </label>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {submitting ? "Publishing..." : "Publish Banner"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Announcement */}
      {showEditModal && activeItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Edit Announcement
              </h3>
              <button onClick={() => setShowEditModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEdit} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Title *</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Message Content *</label>
                <textarea
                  rows={3}
                  required
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Severity</label>
                  <select
                    value={form.severity}
                    onChange={(e) => setForm({ ...form, severity: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  >
                    <option value="INFO">INFO</option>
                    <option value="WARNING">WARNING</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Label</label>
                  <select
                    value={form.targetAudience}
                    onChange={(e) => setForm({ ...form, targetAudience: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                    title="A descriptive label only. Who actually receives this is set under Audience below."
                  >
                    <option value="ALL">All Platform Users</option>
                    <option value="ORGS">Organization Admins</option>
                    <option value="USERS">Regular Members Only</option>
                  </select>
                </div>
              </div>

              {/* Publish window. Leaving "Starts" empty publishes immediately;
                  leaving "Expires" empty means it never expires. */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">
                    Starts <span className="text-slate-500 dark:text-slate-400">(blank = now)</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">
                    Expires <span className="text-slate-500 dark:text-slate-400">(blank = never)</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={form.expiresAt}
                    onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  />
                </div>
              </div>

              <AudienceBuilder
                audienceMode={form.audienceMode}
                matchMode={form.matchMode}
                targets={form.targets}
                options={audienceOptions}
                onChange={(patch) => setForm({ ...form, ...patch })}
              />

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="editActiveBanner"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="rounded border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-indigo-600 dark:text-indigo-400"
                />
                <label htmlFor="editActiveBanner" className="text-slate-700 dark:text-slate-300">
                  Active broadcast
                </label>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Confirmation */}
      {showDeleteModal && activeItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 border border-rose-200 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl dark:border-rose-800">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-50 text-rose-600 rounded-lg dark:bg-rose-950/40 dark:text-rose-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Delete Announcement</h3>
                <p className="text-xs text-rose-600 dark:text-rose-400">Irreversible Action</p>
              </div>
            </div>

            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              Are you sure you want to permanently delete announcement{" "}
              <strong className="text-white">"{activeItem.title}"</strong>?
            </p>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={submitting}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs disabled:opacity-50"
              >
                {submitting ? "Deleting..." : "Permanently Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
