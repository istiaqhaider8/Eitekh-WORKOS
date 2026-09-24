"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Ticket,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  TrendingUp,
  Users,
  Layers,
  ArrowRight,
  Loader2,
  RefreshCw,
  PieChart,
  BarChart3,
  Award,
  Zap,
} from "lucide-react";

interface TicketDashboardProps {
  projectId: string;
  onSelectStatusFilter?: (status: string) => void;
  onSelectTicket?: (ticketId: string) => void;
}

export function TicketDashboard({
  projectId,
  onSelectStatusFilter,
  onSelectTicket,
}: TicketDashboardProps) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/tickets/dashboard`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load ticket dashboard stats");
      setStats(data.stats);
    } catch (err: any) {
      setError(err.message || "Error fetching dashboard");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchDashboardStats();
  }, [fetchDashboardStats]);

  if (loading && !stats) {
    return (
      <div className="p-16 flex flex-col items-center justify-center gap-3 text-xs text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        <span>Loading ticket metrics and manager workload...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-2xl text-xs text-red-600 dark:text-red-400 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
        <button
          onClick={fetchDashboardStats}
          className="px-3 py-1.5 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-colors cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const {
    totalTickets = 0,
    newTickets = 0,
    underReviewTickets = 0,
    pendingInfoTickets = 0,
    approvedTickets = 0,
    rejectedTickets = 0,
    closedTickets = 0,
    activeConvertedTasks = 0,
    completedConvertedTasks = 0,
    categoryDistribution = [],
    managerStats = [],
  } = stats || {};

  const pendingApprovals = underReviewTickets + pendingInfoTickets;
  const resolvedTotal = approvedTickets + rejectedTickets + closedTickets;
  const resolutionRatePercent = totalTickets > 0 ? Math.round((resolvedTotal / totalTickets) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header with Refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            <span>Ticket Operations & Conversion Metrics</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time pipeline of client tickets, manager reviews, and Kanban task conversions.
          </p>
        </div>
        <button
          onClick={fetchDashboardStats}
          className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          title="Refresh dashboard"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* 6 KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {/* Total Tickets */}
        <div
          onClick={() => onSelectStatusFilter && onSelectStatusFilter("ALL")}
          className="bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-2xs hover:border-blue-400 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Total Tickets</span>
            <Ticket className="w-4 h-4 text-blue-600 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{totalTickets}</div>
          <div className="text-[11px] text-slate-400 mt-1">All time raised</div>
        </div>

        {/* New Tickets */}
        <div
          onClick={() => onSelectStatusFilter && onSelectStatusFilter("NEW")}
          className="bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-2xs hover:border-blue-400 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">New</span>
            <Clock className="w-4 h-4 text-blue-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{newTickets}</div>
          <div className="text-[11px] text-slate-400 mt-1">Awaiting initial review</div>
        </div>

        {/* Pending Approvals */}
        <div
          onClick={() => onSelectStatusFilter && onSelectStatusFilter("UNDER_REVIEW")}
          className="bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-2xs hover:border-amber-400 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Pending Approvals</span>
            <AlertCircle className="w-4 h-4 text-amber-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{pendingApprovals}</div>
          <div className="text-[11px] text-slate-400 mt-1">
            {underReviewTickets} review, {pendingInfoTickets} info
          </div>
        </div>

        {/* Approved / Converted */}
        <div
          onClick={() => onSelectStatusFilter && onSelectStatusFilter("CONVERTED")}
          className="bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-2xs hover:border-emerald-400 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Approved</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{approvedTickets}</div>
          <div className="text-[11px] text-slate-400 mt-1">Converted to Kanban tasks</div>
        </div>

        {/* Rejected Tickets */}
        <div
          onClick={() => onSelectStatusFilter && onSelectStatusFilter("REJECTED")}
          className="bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-2xs hover:border-rose-400 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Rejected</span>
            <XCircle className="w-4 h-4 text-rose-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">{rejectedTickets}</div>
          <div className="text-[11px] text-slate-400 mt-1">Declined with reason</div>
        </div>

        {/* Active Tasks on Board */}
        <div className="bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-2xs group">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Active Tasks</span>
            <Layers className="w-4 h-4 text-indigo-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{activeConvertedTasks}</div>
          <div className="text-[11px] text-slate-400 mt-1">
            {completedConvertedTasks} done on board
          </div>
        </div>
      </div>

      {/* Middle Section: Resolution Rate & Category Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Resolution Rate Card */}
        <div className="bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Resolution Rate
              </span>
              <Award className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-slate-900 dark:text-white">{resolutionRatePercent}%</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">of total requests resolved</span>
            </div>
            {/* Progress Bar */}
            <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full mt-3 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(resolutionRatePercent, 100)}%` }}
              />
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Resolved: <strong className="text-slate-800 dark:text-slate-200">{resolvedTotal}</strong></span>
            <span>Active Queue: <strong className="text-amber-600 dark:text-amber-400">{newTickets + pendingApprovals}</strong></span>
          </div>
        </div>

        {/* Status Pipeline Visualizer */}
        <div className="bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-2xs">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              Status Pipeline Breakdown
            </span>
            <Zap className="w-4 h-4 text-blue-500" />
          </div>
          <div className="space-y-2.5 text-xs">
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                New Submissions
              </span>
              <span className="font-semibold text-slate-900 dark:text-white">{newTickets}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                Under Triage & Review
              </span>
              <span className="font-semibold text-slate-900 dark:text-white">{underReviewTickets}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                Awaiting Client Information
              </span>
              <span className="font-semibold text-slate-900 dark:text-white">{pendingInfoTickets}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                Approved & Converted
              </span>
              <span className="font-semibold text-slate-900 dark:text-white">{approvedTickets}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                Rejected
              </span>
              <span className="font-semibold text-slate-900 dark:text-white">{rejectedTickets}</span>
            </div>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-2xs">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              Category Distribution
            </span>
            <PieChart className="w-4 h-4 text-purple-500" />
          </div>
          {categoryDistribution.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">No category data yet</div>
          ) : (
            <div className="space-y-2 text-xs">
              {categoryDistribution.map((cat: any) => (
                <div key={cat.category} className="flex items-center justify-between py-1 border-b border-slate-50 dark:border-slate-800/40 last:border-0">
                  <span className="text-slate-600 dark:text-slate-300 font-medium">
                    {cat.category}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                    {cat.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Manager Workload & Performance Table */}
      <div className="bg-white dark:bg-[#0c1322] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-2xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600" />
              <span>Ticket Manager Workload & Turnaround Performance</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Performance metrics for project team members managing incoming client tickets.
            </p>
          </div>
        </div>

        {managerStats.length === 0 ? (
          <div className="text-center py-10 text-xs text-slate-400">
            No tickets have been assigned to managers yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 text-slate-500 dark:text-slate-400 font-semibold">
                  <th className="py-2.5 px-4">Ticket Manager</th>
                  <th className="py-2.5 px-4">Email</th>
                  <th className="py-2.5 px-4">Active Queue</th>
                  <th className="py-2.5 px-4">Resolved / Converted</th>
                  <th className="py-2.5 px-4">Avg Turnaround</th>
                  <th className="py-2.5 px-4 text-right">Workload Load</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {managerStats.map((m: any) => (
                  <tr key={m.managerId} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/30">
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                      {m.name}
                    </td>
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                      {m.email}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 text-[11px] font-semibold border border-amber-200 dark:border-amber-900/40">
                        {m.activeTickets} active
                      </span>
                    </td>
                    <td className="py-3 px-4 font-medium text-emerald-600 dark:text-emerald-400">
                      {m.resolvedTickets} resolved
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {m.avgResolutionHours > 0 ? `${m.avgResolutionHours} hrs` : "—"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          m.activeTickets > 5
                            ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400"
                            : m.activeTickets > 2
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                        }`}
                      >
                        {m.activeTickets > 5 ? "HEAVY" : m.activeTickets > 2 ? "MODERATE" : "NORMAL"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
