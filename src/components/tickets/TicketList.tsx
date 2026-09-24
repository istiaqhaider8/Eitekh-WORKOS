"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  Filter,
  Plus,
  Tag,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  User,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";

interface TicketListProps {
  tickets: any[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  searchQuery: string;
  selectedStatus: string;
  selectedCategory: string;
  selectedPriority: string;
  onSearchChange: (query: string) => void;
  onStatusChange: (status: string) => void;
  onCategoryChange: (category: string) => void;
  onPriorityChange: (priority: string) => void;
  onPageChange: (newPage: number) => void;
  onSelectTicket: (ticketId: string) => void;
  onOpenCreateModal: () => void;
  canCreateTicket?: boolean;
}

const STATUS_TABS = [
  { id: "ALL", label: "All Tickets" },
  { id: "NEW", label: "New" },
  { id: "UNDER_REVIEW", label: "Under Review" },
  { id: "PENDING_INFO", label: "Pending Info" },
  { id: "CONVERTED", label: "Approved / Converted" },
  { id: "REJECTED", label: "Rejected" },
  { id: "CLOSED", label: "Closed" },
];

export function TicketList({
  tickets,
  total,
  page,
  totalPages,
  loading,
  searchQuery,
  selectedStatus,
  selectedCategory,
  selectedPriority,
  onSearchChange,
  onStatusChange,
  onCategoryChange,
  onPriorityChange,
  onPageChange,
  onSelectTicket,
  onOpenCreateModal,
  canCreateTicket = true,
}: TicketListProps) {
  const getStatusBadge = (status: string) => {
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

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "URGENT":
        return "text-red-700 dark:text-red-400 font-bold";
      case "HIGH":
        return "text-amber-700 dark:text-amber-400 font-semibold";
      case "MEDIUM":
        return "text-blue-700 dark:text-blue-400 font-medium";
      default:
        return "text-slate-500 dark:text-slate-400";
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-2xs">
        <div className="flex-1 flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative min-w-[240px] flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search by ticket key, title, or client..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-slate-400"
            />
          </div>

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="ALL">All Categories</option>
            <option value="BUG_REPORT">Bug Report</option>
            <option value="FEATURE_REQUEST">Feature Request</option>
            <option value="SUPPORT">Support</option>
            <option value="GENERAL">General</option>
            <option value="CHANGE_REQUEST">Change Request</option>
          </select>

          {/* Priority Filter */}
          <select
            value={selectedPriority}
            onChange={(e) => onPriorityChange(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="ALL">All Priorities</option>
            <option value="URGENT">Urgent</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>

        {/* Raise Ticket Button */}
        {canCreateTicket && (
          <button
            onClick={onOpenCreateModal}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Raise Ticket</span>
          </button>
        )}
      </div>

      {/* Status Filter Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-slate-200/80 dark:border-slate-800/80 text-xs">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onStatusChange(tab.id)}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap cursor-pointer ${
              selectedStatus === tab.id
                ? "bg-slate-900 text-white dark:bg-blue-600 dark:text-white"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tickets Table / List */}
      <div className="bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span>Loading tickets...</span>
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto text-xl font-bold">
              🎫
            </div>
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-200">No tickets found</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {searchQuery || selectedStatus !== "ALL" || selectedCategory !== "ALL" || selectedPriority !== "ALL"
                  ? "Try adjusting your search criteria or filters."
                  : "No tickets have been raised for this project yet."}
              </p>
            </div>
            {canCreateTicket && (
              <button
                onClick={onOpenCreateModal}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer shadow-xs mt-2"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Raise First Ticket</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 font-semibold">
                  <th className="py-3 px-4">Ticket</th>
                  <th className="py-3 px-4">Subject</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Raised By</th>
                  <th className="py-3 px-4">Assigned Manager</th>
                  <th className="py-3 px-4">Task Link</th>
                  <th className="py-3 px-4 text-right">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {tickets.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => onSelectTicket(t.id)}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-900/40 cursor-pointer transition-colors group"
                  >
                    {/* Ticket Key */}
                    <td className="py-3 px-4 font-mono font-bold text-blue-600 dark:text-blue-400">
                      {t.ticketKey}
                    </td>

                    {/* Title */}
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white max-w-xs truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {t.title}
                    </td>

                    {/* Category */}
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-medium">
                        {t.category}
                      </span>
                    </td>

                    {/* Priority */}
                    <td className="py-3 px-4">
                      <span className={getPriorityBadge(t.priority)}>
                        {t.priority}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${getStatusBadge(
                          t.status
                        )}`}
                      >
                        {t.status}
                      </span>
                    </td>

                    {/* Raised By */}
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                      {t.createdBy
                        ? `${t.createdBy.firstName || ""} ${t.createdBy.lastName || ""}`.trim() || t.createdBy.email
                        : "—"}
                    </td>

                    {/* Assigned Manager */}
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                      {t.assignedManager ? (
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {`${t.assignedManager.firstName || ""} ${t.assignedManager.lastName || ""}`.trim() || t.assignedManager.email}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Unassigned</span>
                      )}
                    </td>

                    {/* Task Link */}
                    <td className="py-3 px-4">
                      {(t.convertedIssue || t.convertedIssueKey) ? (
                        <span className="inline-flex items-center gap-1 font-mono font-semibold px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[11px] border border-emerald-200 dark:border-emerald-800/60">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span>{t.convertedIssue?.issueKey || t.convertedIssueKey}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">—</span>
                      )}
                    </td>

                    {/* Created At */}
                    <td className="py-3 px-4 text-right text-slate-400 text-[11px] whitespace-nowrap">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 text-xs text-slate-500 dark:text-slate-400">
            <span>
              Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total} tickets
            </span>
            <div className="flex items-center gap-1.5">
              <button
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
                className="p-1 rounded-lg border border-slate-200 dark:border-slate-800 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 font-medium">
                Page {page} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
                className="p-1 rounded-lg border border-slate-200 dark:border-slate-800 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
