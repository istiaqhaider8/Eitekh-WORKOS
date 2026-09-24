"use client";

import React, { useState } from "react";
import { X, AlertCircle, Loader2, Send, Tag, AlertTriangle, Calendar, UserCheck } from "lucide-react";

interface ClientTicketCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectMembers?: any[];
  onTicketCreated?: (ticket: any) => void;
}

const CATEGORIES = [
  { value: "GENERAL", label: "General Inquiry", desc: "General support question or request" },
  { value: "BUG_REPORT", label: "Bug Report", desc: "Something is broken or not behaving as expected" },
  { value: "FEATURE_REQUEST", label: "Feature Request", desc: "Suggest a new capability or improvement" },
  { value: "SUPPORT", label: "Technical Support", desc: "Assistance with system operations or data" },
  { value: "CHANGE_REQUEST", label: "Change Request", desc: "Modification to agreed scope or specifications" },
];

const PRIORITIES = [
  { value: "LOW", label: "Low", color: "text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-400" },
  { value: "MEDIUM", label: "Medium", color: "text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400" },
  { value: "HIGH", label: "High", color: "text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400" },
  { value: "URGENT", label: "Urgent", color: "text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400" },
];

export function ClientTicketCreateModal({
  isOpen,
  onClose,
  projectId,
  projectMembers = [],
  onTicketCreated,
}: ClientTicketCreateModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("GENERAL");
  const [priority, setPriority] = useState("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [assignedManagerId, setAssignedManagerId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || title.trim().length < 3) {
      setError("Please provide a descriptive ticket title (at least 3 characters).");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload: any = {
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        priority,
      };

      if (assignedManagerId) {
        payload.assignedManagerId = assignedManagerId;
      }

      if (dueDate) {
        payload.dueDate = new Date(dueDate).toISOString();
      }

      const res = await fetch(`/api/projects/${projectId}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create ticket");
      }

      // Reset form
      setTitle("");
      setDescription("");
      setCategory("GENERAL");
      setPriority("MEDIUM");
      setDueDate("");
      setAssignedManagerId("");

      if (onTicketCreated) {
        onTicketCreated(data);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred while raising the ticket.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="w-full max-w-xl bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
              🎫
            </div>
            <div>
              <h2 id="ticket-modal-title" className="text-base font-bold text-slate-900 dark:text-white">
                Raise New Ticket
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Submit an inquiry, bug report, or request for the project team to review.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl flex items-start gap-2.5 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Ticket Title */}
          <div>
            <label htmlFor="ticket-title-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Ticket Subject / Title <span className="text-red-500">*</span>
            </label>
            <input
              id="ticket-title-input"
              aria-label="Ticket Subject / Title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Navigation dropdown closes prematurely on mobile"
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-slate-400"
              maxLength={255}
            />
          </div>

          {/* Category & Priority Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Category */}
            <div>
              <label htmlFor="ticket-category-select" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-slate-400" />
                  Category
                </span>
              </label>
              <select
                id="ticket-category-select"
                aria-label="Category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div>
              <label htmlFor="ticket-priority-select" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-slate-400" />
                  Urgency / Priority
                </span>
              </label>
              <select
                id="ticket-priority-select"
                aria-label="Urgency / Priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Target Date & Assigned Manager Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Due Date (Optional) */}
            <div>
              <label htmlFor="ticket-due-date-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  Target Date / Deadline (Optional)
                </span>
              </label>
              <input
                id="ticket-due-date-input"
                aria-label="Target Date / Deadline (Optional)"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
              />
            </div>

            {/* Task Assigned Manager (Optional) */}
            <div>
              <label htmlFor="ticket-assigned-manager-select" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                  Task Assigned Manager (Optional)
                </span>
              </label>
              <select
                id="ticket-assigned-manager-select"
                aria-label="Task Assigned Manager"
                value={assignedManagerId}
                onChange={(e) => setAssignedManagerId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
              >
                <option value="">Unassigned</option>
                {projectMembers.map((m) => {
                  const mId = m.userId || m.id || m.user?.id;
                  const name = `${m.user?.firstName || m.firstName || ""} ${m.user?.lastName || m.lastName || ""}`.trim();
                  const email = m.user?.email || m.email || "";
                  return (
                    <option key={mId} value={mId}>
                      {name ? `${name} (${email})` : email || mId}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="ticket-description-input" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Description & Specifics
            </label>
            <textarea
              id="ticket-description-input"
              aria-label="Description & Specifics"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide steps to reproduce, expected behavior, context, or any helpful URLs..."
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-slate-400 resize-none leading-relaxed"
            />
          </div>

          {/* Action buttons */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-all shadow-xs flex items-center gap-2 cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Submit Ticket</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
