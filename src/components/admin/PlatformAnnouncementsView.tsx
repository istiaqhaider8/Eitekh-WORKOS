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
} from "lucide-react";
import { showSuccess, showError } from "@/lib/toast";

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
    expiresAt: "",
  });

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
          expiresAt: "",
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
            <Megaphone className="w-5 h-5 text-indigo-600" />
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
                expiresAt: "",
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
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-600" : ""}`} />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center justify-between gap-3 bg-white dark:bg-slate-900/80 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-700 dark:text-slate-300 w-full sm:w-80">
          <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
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
                    ? "border-rose-500/50 bg-rose-950/20"
                    : isWarning
                    ? "border-amber-500/50 bg-amber-950/20"
                    : "border-indigo-500/30"
                  : "border-slate-200 dark:border-slate-800 opacity-60"
              }`}
            >
              <div className="space-y-1.5 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      isCritical
                        ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                        : isWarning
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        : "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                    }`}
                  >
                    {item.severity}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      item.isActive ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {item.isActive ? "ACTIVE" : "INACTIVE"}
                  </span>
                  <span className="text-[11px] text-slate-600 dark:text-slate-400">Audience: {item.targetAudience}</span>
                  <span className="text-[11px] text-slate-500">
                    · {new Date(item.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{item.title}</h3>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{item.message}</p>
                {item.expiresAt && (
                  <p className="text-[10px] text-slate-500 flex items-center gap-1">
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
                      : "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 hover:bg-emerald-500/20"
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
                      expiresAt: item.expiresAt ? item.expiresAt.split(".")[0] : "",
                    });
                    setShowEditModal(true);
                  }}
                  className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-indigo-300 hover:bg-slate-100 dark:bg-slate-800 rounded transition-colors cursor-pointer"
                  title="Edit Announcement"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    setActiveItem(item);
                    setShowDeleteModal(true);
                  }}
                  className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 rounded transition-colors cursor-pointer"
                  title="Delete Announcement"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && !loading && (
          <div className="text-center py-12 bg-white dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 text-xs">
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
                <Megaphone className="w-4 h-4 text-indigo-600" />
                Publish Global Announcement
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200">
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
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Target Audience</label>
                  <select
                    value={form.targetAudience}
                    onChange={(e) => setForm({ ...form, targetAudience: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  >
                    <option value="ALL">All Platform Users</option>
                    <option value="ORGS">Organization Admins</option>
                    <option value="USERS">Regular Members Only</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="activeBanner"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="rounded border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-indigo-600"
                />
                <label htmlFor="activeBanner" className="text-slate-700 dark:text-slate-300">
                  Broadcast immediately (Active)
                </label>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200"
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
                <Edit2 className="w-4 h-4 text-indigo-600" />
                Edit Announcement
              </h3>
              <button onClick={() => setShowEditModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200">
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
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Target Audience</label>
                  <select
                    value={form.targetAudience}
                    onChange={(e) => setForm({ ...form, targetAudience: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  >
                    <option value="ALL">All Platform Users</option>
                    <option value="ORGS">Organization Admins</option>
                    <option value="USERS">Regular Members Only</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="editActiveBanner"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="rounded border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-indigo-600"
                />
                <label htmlFor="editActiveBanner" className="text-slate-700 dark:text-slate-300">
                  Active broadcast
                </label>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200"
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
          <div className="bg-white dark:bg-slate-900 border border-rose-900/60 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-500/20 text-rose-600 rounded-lg">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Delete Announcement</h3>
                <p className="text-xs text-rose-600">Irreversible Action</p>
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
                className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs"
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
