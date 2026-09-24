"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowRight,
  UserCheck,
  MessageSquare,
  Lock,
  ExternalLink,
  Loader2,
  Calendar,
  Send,
  History,
  Shield,
  Tag,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";

interface TicketDetailModalProps {
  ticketId: string | null;
  projectId: string;
  currentUser: any;
  projectMembers?: any[];
  isOpen: boolean;
  onClose: () => void;
  onTicketUpdated?: (updatedTicket: any) => void;
  onNavigateToIssue?: (issueId: string) => void;
}

export function TicketDetailModal({
  ticketId,
  projectId,
  currentUser,
  projectMembers = [],
  isOpen,
  onClose,
  onTicketUpdated,
  onNavigateToIssue,
}: TicketDetailModalProps) {
  const [ticketData, setTicketData] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tab State
  const [activeTab, setActiveTab] = useState<"discussion" | "history">("discussion");

  // Status Action Form State
  const [actionType, setActionType] = useState<"APPROVE" | "REJECT" | "REQUEST_INFO" | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);

  // Manager Assignment State
  const [isAssigning, setIsAssigning] = useState(false);

  // Comment State
  const [newComment, setNewComment] = useState("");
  const [isInternalComment, setIsInternalComment] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);

  // Fetch ticket details
  const fetchDetails = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/tickets/${ticketId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load ticket details");

      setTicketData(data.ticket);
      setComments(data.comments || []);
      setHistory(data.history || []);
    } catch (err: any) {
      setError(err.message || "Failed to fetch ticket");
    } finally {
      setLoading(false);
    }
  }, [projectId, ticketId]);

  useEffect(() => {
    let ignore = false;
    if (isOpen && ticketId) {
      fetch(`/api/projects/${projectId}/tickets/${ticketId}`)
        .then((res) => res.json())
        .then((data) => {
          if (!ignore) {
            if (data.error) setError(data.error);
            else {
              setTicketData(data.ticket);
              setComments(data.comments || []);
              setHistory(data.history || []);
            }
            setLoading(false);
          }
        })
        .catch((err: any) => {
          if (!ignore) {
            setError(err.message || "Failed to fetch ticket");
            setLoading(false);
          }
        });
    }
    return () => {
      ignore = true;
    };
  }, [isOpen, ticketId, projectId]);

  if (!isOpen || !ticketId) return null;

  const isClient = currentUser?.userType === "CLIENT";
  const userRole = currentUser?.role || "VIEWER";
  const canManage = !isClient && (userRole === "PROJECT_ADMIN" || userRole === "PROJECT_MANAGER" || currentUser?.isSuperAdmin);
  const canApprove = canManage;
  const canReject = canManage;
  const canSeeInternalNotes = !isClient;

  // Handle status transitions
  const handleTransition = async (targetStatus: string, note?: string, reason?: string) => {
    setIsActionSubmitting(true);
    setError(null);
    try {
      const payload: any = {
        status: targetStatus,
        version: ticketData?.version,
      };
      if (note) payload.note = note;
      if (reason) payload.rejectionReason = reason;

      const res = await fetch(`/api/projects/${projectId}/tickets/${ticketId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to transition ticket status");
      }

      setTicketData(data.ticket);
      setActionType(null);
      setActionNote("");
      setRejectionReason("");
      await fetchDetails();

      if (onTicketUpdated) onTicketUpdated(data.ticket);
    } catch (err: any) {
      setError(err.message || "Transition failed");
    } finally {
      setIsActionSubmitting(false);
    }
  };

  // Handle assigning ticket manager
  const handleAssignManager = async (managerId: string) => {
    setIsAssigning(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/tickets/${ticketId}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignedManagerId: managerId || null,
          version: ticketData?.version,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to assign ticket manager");

      setTicketData(data.ticket);
      await fetchDetails();
      if (onTicketUpdated) onTicketUpdated(data.ticket);
    } catch (err: any) {
      setError(err.message || "Assignment failed");
    } finally {
      setIsAssigning(false);
    }
  };

  // Handle posting a comment
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setSubmittingComment(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/tickets/${ticketId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: newComment.trim(),
          isInternal: isInternalComment && canSeeInternalNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to post comment");

      setComments((prev) => [...prev, data.comment]);
      setNewComment("");
      setIsInternalComment(false);
    } catch (err: any) {
      setError(err.message || "Failed to add comment");
    } finally {
      setSubmittingComment(false);
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "NEW":
        return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/50";
      case "UNDER_REVIEW":
        return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/50";
      case "PENDING_INFO":
        return "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-900/50";
      case "APPROVED":
      case "CONVERTED":
        return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/50";
      case "REJECTED":
        return "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900/50";
      case "CLOSED":
        return "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="w-full max-w-4xl bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-detail-title"
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold px-2.5 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-lg">
              {ticketData?.ticketKey || "..."}
            </span>
            <div className={`px-2.5 py-0.5 rounded-full border text-[11px] font-semibold tracking-wide ${statusColor(ticketData?.status || "NEW")}`}>
              {ticketData?.status || "LOADING"}
            </div>
            {ticketData?.priority && (
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                • Priority: <strong className="text-slate-800 dark:text-slate-200">{ticketData.priority}</strong>
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Main Content Container */}
        {loading && !ticketData ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-slate-400 text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              <span>Loading ticket details...</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
            {/* Left Column: Details, Converted Issue Banner, Discussion & Timeline */}
            <div className="flex-1 flex flex-col overflow-y-auto border-r border-slate-200 dark:border-slate-800 p-6 space-y-6">
              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl flex items-start gap-2.5 text-xs text-red-600 dark:text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Title & Created By */}
              <div>
                <h1 id="ticket-detail-title" className="text-lg font-bold text-slate-900 dark:text-white leading-snug">
                  {ticketData?.title}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    Raised by{" "}
                    <strong className="text-slate-700 dark:text-slate-200">
                      {ticketData?.createdBy?.firstName || ""} {ticketData?.createdBy?.lastName || ""} ({ticketData?.createdBy?.email})
                    </strong>
                  </span>
                  <span>•</span>
                  <span>{new Date(ticketData?.createdAt).toLocaleDateString()}</span>
                  {ticketData?.dueDate && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                        <Calendar className="w-3.5 h-3.5" />
                        Target: {new Date(ticketData.dueDate).toLocaleDateString()}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Converted Issue Banner */}
              {(ticketData?.convertedIssue || ticketData?.convertedIssueKey) && (
                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-emerald-900 dark:text-emerald-300">
                        Converted into Project Task on Kanban Board
                      </div>
                      <div className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                        Issue Key: <span className="font-mono font-semibold">{ticketData.convertedIssue?.issueKey || ticketData.convertedIssueKey}</span>
                        {ticketData.convertedIssue?.status && (
                          <span className="ml-2 px-2 py-0.5 bg-emerald-200/60 dark:bg-emerald-900/60 rounded text-[10px] font-medium text-emerald-900 dark:text-emerald-200">
                            {ticketData.convertedIssue.status.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {onNavigateToIssue && (ticketData.convertedIssue?.id || ticketData.convertedIssueId) && (
                    <button
                      onClick={() => onNavigateToIssue(ticketData.convertedIssue?.id || ticketData.convertedIssueId)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <span>View Task</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              {/* Rejection Alert Banner */}
              {ticketData?.status === "REJECTED" && (
                <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl flex items-start gap-3">
                  <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold text-rose-900 dark:text-rose-300">
                      Ticket Rejected
                    </div>
                    <div className="text-xs text-rose-700 dark:text-rose-400 mt-1">
                      {ticketData.rejectionReason || "No explicit reason was documented."}
                    </div>
                  </div>
                </div>
              )}

              {/* Description Body */}
              <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200/80 dark:border-slate-800/80 rounded-xl p-4">
                <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                  Description
                </h3>
                <div className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {ticketData?.description || "No description provided."}
                </div>
              </div>

              {/* Resolution Note if present */}
              {ticketData?.resolutionNote && (
                <div className="bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/70 dark:border-blue-900/40 rounded-xl p-3.5">
                  <h4 className="text-xs font-semibold text-blue-900 dark:text-blue-300 mb-1">
                    Approval / Resolution Note
                  </h4>
                  <p className="text-xs text-blue-800 dark:text-blue-200">
                    {ticketData.resolutionNote}
                  </p>
                </div>
              )}

              {/* Tabs: Discussion vs History */}
              <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-6 pt-2">
                <button
                  onClick={() => setActiveTab("discussion")}
                  className={`pb-2.5 text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer ${
                    activeTab === "discussion"
                      ? "text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Discussion & Notes ({comments.length})</span>
                </button>
                <button
                  onClick={() => setActiveTab("history")}
                  className={`pb-2.5 text-xs font-semibold transition-colors flex items-center gap-2 cursor-pointer ${
                    activeTab === "history"
                      ? "text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  <span>Status History ({history.length})</span>
                </button>
              </div>

              {/* Discussion Tab Content */}
              {activeTab === "discussion" && (
                <div className="space-y-4">
                  {comments.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-400">
                      No comments or notes yet. Start the conversation below.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {comments.map((c) => (
                        <div
                          key={c.id}
                          className={`p-3.5 rounded-xl border text-xs leading-relaxed ${
                            c.isInternal
                              ? "bg-amber-50/50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/40"
                              : "bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                {c.author ? `${c.author.firstName || ""} ${c.author.lastName || ""}`.trim() || c.author.email : "Team Member"}
                              </span>
                              {c.isInternal && (
                                <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 font-semibold text-[10px] flex items-center gap-1">
                                  <Lock className="w-3 h-3" />
                                  Internal Note
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400">
                              {new Date(c.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <div className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                            {c.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add Comment Box */}
                  <form onSubmit={handleAddComment} className="pt-2">
                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-900/80">
                      <textarea
                        id="ticket-comment-textarea"
                        aria-label="Write a comment or internal note"
                        rows={3}
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder={
                          isInternalComment
                            ? "Write an internal staff note (never visible to client)..."
                            : "Write a public response or update..."
                        }
                        className="w-full p-3 bg-transparent text-xs text-slate-900 dark:text-white focus:outline-none placeholder:text-slate-400 resize-none leading-relaxed"
                      />
                      <div className="flex items-center justify-between px-3 py-2 border-t border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/40">
                        {canSeeInternalNotes ? (
                          <label htmlFor="ticket-internal-note-checkbox" className="flex items-center gap-2 cursor-pointer text-xs text-slate-600 dark:text-slate-300 select-none">
                            <input
                              id="ticket-internal-note-checkbox"
                              aria-label="Internal Staff Note"
                              type="checkbox"
                              checked={isInternalComment}
                              onChange={(e) => setIsInternalComment(e.target.checked)}
                              className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                            />
                            <span className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                              <Lock className="w-3 h-3" />
                              Internal Staff Note
                            </span>
                          </label>
                        ) : <div />}

                        <button
                          type="submit"
                          disabled={submittingComment || !newComment.trim()}
                          className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                        >
                          {submittingComment ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Send className="w-3.5 h-3.5" />
                          )}
                          <span>Post</span>
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              )}

              {/* History Tab Content */}
              {activeTab === "history" && (
                <div className="space-y-3">
                  {history.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-400">
                      No status transitions recorded yet.
                    </div>
                  ) : (
                    <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
                      {history.map((h) => (
                        <div key={h.id} className="relative text-xs">
                          <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-blue-600 ring-4 ring-white dark:ring-[#0c1322]" />
                          <div className="flex items-center gap-2 font-medium">
                            <span className="text-slate-800 dark:text-slate-200">
                              {h.changedBy ? `${h.changedBy.firstName || ""} ${h.changedBy.lastName || ""}`.trim() : "System"}
                            </span>
                            <span className="text-slate-400">changed status</span>
                            {h.fromStatus && (
                              <>
                                <span className="font-semibold text-slate-600 dark:text-slate-300">{h.fromStatus}</span>
                                <ArrowRight className="w-3 h-3 text-slate-400" />
                              </>
                            )}
                            <span className="font-semibold text-blue-600 dark:text-blue-400">{h.toStatus}</span>
                          </div>
                          {h.note && (
                            <p className="mt-1 text-slate-500 dark:text-slate-400 italic">
                              &ldquo;{h.note}&rdquo;
                            </p>
                          )}
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {new Date(h.createdAt).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right Column: Actions & Metadata Controls */}
            <div className="w-full md:w-80 p-6 bg-slate-50/70 dark:bg-slate-900/40 flex flex-col justify-between space-y-6">
              <div className="space-y-6">
                {/* Manager Assignment */}
                <div>
                  <label htmlFor="ticket-manager-select" className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                    Ticket Manager
                  </label>
                  {canManage ? (
                    <select
                      id="ticket-manager-select"
                      aria-label="Ticket Manager"
                      value={ticketData?.assignedManagerId || ""}
                      onChange={(e) => handleAssignManager(e.target.value)}
                      disabled={isAssigning}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
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
                  ) : (
                    <div className="text-xs text-slate-700 dark:text-slate-300 font-medium p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                      {ticketData?.assignedManager
                        ? `${ticketData.assignedManager.firstName || ""} ${ticketData.assignedManager.lastName || ""}`.trim() || ticketData.assignedManager.email
                        : "Unassigned"}
                    </div>
                  )}
                </div>

                {/* Workflow Status Actions Box */}
                <div>
                  <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3">
                    Workflow Actions
                  </h3>

                  {/* Actions for Manager/Admin */}
                  {canManage && (
                    <div className="space-y-2">
                      {ticketData?.status === "NEW" && (
                        <button
                          onClick={() => handleTransition("UNDER_REVIEW")}
                          disabled={isActionSubmitting}
                          className="w-full py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs"
                        >
                          <Clock className="w-3.5 h-3.5" />
                          <span>Start Review</span>
                        </button>
                      )}

                      {ticketData?.status === "UNDER_REVIEW" && (
                        <>
                          <button
                            onClick={() => setActionType("APPROVE")}
                            disabled={isActionSubmitting}
                            className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Approve & Convert to Task</span>
                          </button>

                          <button
                            onClick={() => setActionType("REQUEST_INFO")}
                            disabled={isActionSubmitting}
                            className="w-full py-2 px-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs"
                          >
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Request Client Info</span>
                          </button>

                          <button
                            onClick={() => setActionType("REJECT")}
                            disabled={isActionSubmitting}
                            className="w-full py-2 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Reject Ticket</span>
                          </button>
                        </>
                      )}

                      {ticketData?.status === "PENDING_INFO" && (
                        <button
                          onClick={() => handleTransition("UNDER_REVIEW", "Manager resumed review")}
                          disabled={isActionSubmitting}
                          className="w-full py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Resume Review</span>
                        </button>
                      )}

                      {(ticketData?.status === "CONVERTED" || ticketData?.status === "REJECTED") && (
                        <div className="p-3 bg-slate-200/50 dark:bg-slate-800/50 rounded-xl text-center text-xs text-slate-500 dark:text-slate-400">
                          This ticket is in a final state ({ticketData?.status}).
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions for Client */}
                  {isClient && (
                    <div>
                      {ticketData?.status === "PENDING_INFO" ? (
                        <button
                          onClick={() => handleTransition("UNDER_REVIEW", "Client provided required information")}
                          disabled={isActionSubmitting}
                          className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Submit Info & Return to Review</span>
                        </button>
                      ) : (
                        <div className="p-3 bg-slate-200/50 dark:bg-slate-800/50 rounded-xl text-center text-xs text-slate-500 dark:text-slate-400">
                          Awaiting review by the project ticket management team.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Sub-form Modal for Approval Note / Rejection Reason */}
                {actionType && (
                  <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {actionType === "APPROVE" && "Approve & Convert"}
                        {actionType === "REJECT" && "Reject Ticket"}
                        {actionType === "REQUEST_INFO" && "Request More Details"}
                      </span>
                      <button
                        onClick={() => setActionType(null)}
                        aria-label="Close action panel"
                        className="text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {actionType === "REJECT" ? (
                      <div>
                        <label htmlFor="ticket-rejection-reason-textarea" className="block text-[11px] font-semibold text-rose-600 dark:text-rose-400 mb-1">
                          Rejection Reason <span className="text-red-500">*</span>
                        </label>
                        <textarea
                          id="ticket-rejection-reason-textarea"
                          aria-label="Rejection Reason"
                          rows={3}
                          value={rejectionReason}
                          onChange={(e) => setRejectionReason(e.target.value)}
                          placeholder="State why this ticket is declined (required)..."
                          className="w-full p-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-500"
                        />
                      </div>
                    ) : (
                      <div>
                        <label htmlFor="ticket-action-note-textarea" className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Note (Optional)
                        </label>
                        <textarea
                          id="ticket-action-note-textarea"
                          aria-label="Action Note"
                          rows={3}
                          value={actionNote}
                          onChange={(e) => setActionNote(e.target.value)}
                          placeholder={
                            actionType === "APPROVE"
                              ? "Optional instructions for the engineering team..."
                              : "Describe what information is needed from the client..."
                          }
                          className="w-full p-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setActionType(null)}
                        className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (actionType === "APPROVE") {
                            handleTransition("APPROVED", actionNote);
                          } else if (actionType === "REJECT") {
                            handleTransition("REJECTED", undefined, rejectionReason);
                          } else if (actionType === "REQUEST_INFO") {
                            handleTransition("PENDING_INFO", actionNote);
                          }
                        }}
                        disabled={isActionSubmitting || (actionType === "REJECT" && !rejectionReason.trim())}
                        className={`px-3 py-1 text-xs font-semibold text-white rounded-lg transition-colors cursor-pointer ${
                          actionType === "APPROVE"
                            ? "bg-emerald-600 hover:bg-emerald-700"
                            : actionType === "REJECT"
                            ? "bg-rose-600 hover:bg-rose-700"
                            : "bg-purple-600 hover:bg-purple-700"
                        }`}
                      >
                        {isActionSubmitting ? "Processing..." : "Confirm"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Metadata Summary Card */}
              <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-2 text-xs text-slate-500 dark:text-slate-400">
                <div className="flex justify-between">
                  <span>Category</span>
                  <strong className="text-slate-800 dark:text-slate-200 font-semibold">{ticketData?.category}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Priority</span>
                  <strong className="text-slate-800 dark:text-slate-200 font-semibold">{ticketData?.priority}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Created</span>
                  <span>{new Date(ticketData?.createdAt).toLocaleDateString()}</span>
                </div>
                {ticketData?.convertedAt && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                    <span>Converted</span>
                    <span>{new Date(ticketData.convertedAt).toLocaleDateString()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
