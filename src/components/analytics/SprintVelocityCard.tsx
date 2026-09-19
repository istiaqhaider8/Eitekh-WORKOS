'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Zap,
  TrendingUp,
  Flame,
  Calendar,
  Layers,
  CheckCircle2,
  Clock,
  AlertCircle,
  HelpCircle,
  Download,
  Filter,
  BarChart2,
  ChevronRight,
  Info,
  Users,
  Target,
  FileSpreadsheet,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';
import { ProjectVelocityResult, SprintVelocitySummary } from '@/lib/velocity-engine';

interface SprintVelocityCardProps {
  projectId: string;
  projectName?: string;
  teams?: any[];
  selectedTeamId?: string;
  onSelectIssue?: (issue: any) => void;
  onOpenDrillDown?: (data: {
    title: string;
    subtitle?: string;
    category?: string;
    metricLabel?: string;
    issues: any[];
  }) => void;
}

export function SprintVelocityCard({
  projectId,
  projectName = 'Project',
  teams = [],
  selectedTeamId,
  onSelectIssue,
  onOpenDrillDown,
}: SprintVelocityCardProps) {
  const [data, setData] = useState<ProjectVelocityResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [sprintLimit, setSprintLimit] = useState<number>(5);
  const [teamFilter, setTeamFilter] = useState<string>(selectedTeamId || 'ALL');

  useEffect(() => {
    if (selectedTeamId !== undefined) {
      setTeamFilter(selectedTeamId);
    }
  }, [selectedTeamId]);

  const fetchVelocity = async () => {
    if (!projectId || projectId === 'default') return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL(`/api/projects/${projectId}/velocity`, window.location.origin);
      if (teamFilter && teamFilter !== 'ALL') url.searchParams.set('teamId', teamFilter);
      url.searchParams.set('limit', sprintLimit.toString());
      url.searchParams.set('includeActive', 'true');

      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to load velocity metrics');
      }
      const json = await res.json();
      if (json.velocity) {
        setData(json.velocity);
      }
    } catch (err: any) {
      console.error('Error fetching velocity:', err);
      setError(err.message || 'Failed to load velocity');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVelocity();
  }, [projectId, teamFilter, sprintLimit]);

  const historicalSprints = data?.historicalSprints || [];
  const currentSprint = data?.currentSprint;
  const forecast = data?.forecast;

  // Max value for chart Y-axis scale
  const maxChartValue = useMemo(() => {
    if (!historicalSprints.length) return 20;
    const maxVal = Math.max(
      ...historicalSprints.map((s) => Math.max(s.plannedPoints, s.completedPoints)),
      data?.averageVelocity || 0,
      15
    );
    return Math.ceil(maxVal * 1.15);
  }, [historicalSprints, data?.averageVelocity]);

  const handleExportCsv = () => {
    const url = `/api/projects/${projectId}/reports/download?reportType=sprint-velocity&format=csv${
      teamFilter !== 'ALL' ? `&teamId=${teamFilter}` : ''
    }`;
    window.open(url, '_blank');
    showSuccess('Velocity CSV export initiated');
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xs space-y-6 text-slate-900 dark:text-slate-100">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-800/60 shadow-2xs">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold">Sprint Velocity & Capacity Planning</h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                Team Delivery Metric
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Completed story points per completed sprint to measure commitment reliability and delivery pace.
            </p>
          </div>
        </div>

        {/* Filters & Export Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Team Filter */}
          {teams.length > 0 && (
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 outline-none cursor-pointer"
            >
              <option value="ALL">All Squads / Teams</option>
              {teams.map((t: any) => (
                <option key={t.id} value={t.id}>
                  Team: {t.name}
                </option>
              ))}
            </select>
          )}

          {/* Sprints Range Selector */}
          <select
            value={sprintLimit}
            onChange={(e) => setSprintLimit(Number(e.target.value))}
            className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 outline-none cursor-pointer"
          >
            <option value={3}>Last 3 Sprints</option>
            <option value={5}>Last 5 Sprints</option>
            <option value={10}>Last 10 Sprints</option>
            <option value={20}>All Completed</option>
          </select>

          {/* CSV Export */}
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl transition-colors cursor-pointer shadow-2xs"
            title="Download Velocity Report as CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="py-12 flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 space-y-2">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs">Calculating sprint velocity metrics...</p>
        </div>
      ) : error ? (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
          <span>{error}</span>
        </div>
      ) : (
        <>
          {/* 2. Executive Velocity KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Average Velocity */}
            <div className="p-4 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-900/40 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-indigo-700 dark:text-indigo-300 text-xs font-semibold">
                <span>Average Velocity</span>
                <Zap className="w-4 h-4 text-indigo-500" />
              </div>
              <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
                {data?.averageVelocity || 0} <span className="text-xs font-bold text-slate-500 dark:text-slate-400">pts / sprint</span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Across {historicalSprints.length} completed {historicalSprints.length === 1 ? 'sprint' : 'sprints'}
              </p>
            </div>

            {/* Rolling 3-Sprint Average */}
            <div className="p-4 rounded-2xl bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-blue-700 dark:text-blue-300 text-xs font-semibold">
                <span>Rolling 3-Sprint Avg</span>
                <TrendingUp className="w-4 h-4 text-blue-500" />
              </div>
              <div className="text-2xl font-black text-blue-600 dark:text-blue-400">
                {data?.rolling3SprintAverage || 0} <span className="text-xs font-bold text-slate-500 dark:text-slate-400">pts</span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Recent 3-iteration throughput pace
              </p>
            </div>

            {/* Rolling 5-Sprint Average */}
            <div className="p-4 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-900/40 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                <span>Rolling 5-Sprint Avg</span>
                <BarChart2 className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                {data?.rolling5SprintAverage || 0} <span className="text-xs font-bold text-slate-500 dark:text-slate-400">pts</span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Mid-term velocity baseline
              </p>
            </div>

            {/* Backlog Forecast */}
            <div className="p-4 rounded-2xl bg-purple-50/50 dark:bg-purple-950/30 border border-purple-200/60 dark:border-purple-900/40 space-y-1 shadow-2xs">
              <div className="flex items-center justify-between text-purple-700 dark:text-purple-300 text-xs font-semibold">
                <span>Backlog Forecast</span>
                <Target className="w-4 h-4 text-purple-500" />
              </div>
              <div className="text-2xl font-black text-purple-600 dark:text-purple-400">
                {forecast?.estimatedSprintsNeeded !== null ? (
                  <>
                    ~{forecast?.estimatedSprintsNeeded}{' '}
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400">sprints</span>
                  </>
                ) : (
                  <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">Needs Velocity</span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate" title={`${forecast?.totalBacklogPoints || 0} remaining backlog pts`}>
                To clear {forecast?.totalBacklogPoints || 0} backlog points
              </p>
            </div>
          </div>

          {/* 3. Current Active Sprint Section (Segregated from Historical Velocity) */}
          {currentSprint && (
            <div className="p-4 sm:p-5 rounded-2xl bg-amber-50/40 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/50 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200">
                    Active Sprint: {currentSprint.name}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-amber-200/70 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">
                    Current Progress (Not in Historical Avg)
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  {currentSprint.completedPoints} of {currentSprint.plannedPoints} pts completed ({currentSprint.completionRate}%)
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-3 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${currentSprint.completionRate}%` }}
                  title={`Completed: ${currentSprint.completedPoints} pts`}
                />
                <div
                  className="h-full bg-blue-500 transition-all duration-500"
                  style={{
                    width: `${
                      currentSprint.plannedPoints > 0
                        ? Math.min(100 - currentSprint.completionRate, Math.round((currentSprint.inProgressPoints / currentSprint.plannedPoints) * 100))
                        : 0
                    }%`,
                  }}
                  title={`In Progress: ${currentSprint.inProgressPoints} pts`}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
                <div>
                  <span className="text-slate-500 dark:text-slate-400 text-[11px] block">Planned Scope</span>
                  <strong className="font-bold text-slate-800 dark:text-slate-200">{currentSprint.plannedPoints} pts</strong>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 text-[11px] block">Delivered So Far</span>
                  <strong className="font-bold text-emerald-600 dark:text-emerald-400">{currentSprint.completedPoints} pts</strong>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 text-[11px] block">Remaining In Flight</span>
                  <strong className="font-bold text-amber-600 dark:text-amber-400">{currentSprint.remainingPoints} pts</strong>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 text-[11px] block">Tasks Completed</span>
                  <strong className="font-bold text-slate-800 dark:text-slate-200">
                    {currentSprint.completedIssues} / {currentSprint.totalIssues}
                    {currentSprint.unestimatedCompletedIssues > 0 && (
                      <span className="ml-1 text-[10px] text-amber-600 font-normal">
                        ({currentSprint.unestimatedCompletedIssues} unestimated)
                      </span>
                    )}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* 4. Historical Sprint Velocity Chart */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <span>Historical Sprint Velocity</span>
                  <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                    (Planned vs. Delivered Story Points)
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Bars indicate planned capacity vs actual delivered points. Red line indicates average team velocity.
                </p>
              </div>

              {/* Chart Legend */}
              <div className="flex items-center gap-3 text-xs font-medium text-slate-600 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-xs bg-slate-300 dark:bg-slate-700" />
                  <span>Planned</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-xs bg-indigo-600" />
                  <span>Delivered Velocity</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-rose-500" />
                  <span>Avg ({data?.averageVelocity} pts)</span>
                </span>
              </div>
            </div>

            {/* Visual Bar Chart */}
            {historicalSprints.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-800 rounded-xl">
                No completed sprints recorded yet. Sprints will appear here once marked as completed.
              </div>
            ) : (
              <div className="relative pt-6 pb-2">
                {/* Average Velocity Line Indicator */}
                {data?.averageVelocity && data.averageVelocity > 0 && (
                  <div
                    className="absolute left-0 right-0 border-b-2 border-dashed border-rose-500/80 z-10 pointer-events-none flex items-center justify-end pr-2"
                    style={{
                      bottom: `${Math.min(95, Math.max(5, (data.averageVelocity / maxChartValue) * 100))}%`,
                    }}
                  >
                    <span className="text-[9px] font-bold bg-rose-500 text-white px-1.5 py-0.2 rounded shadow-2xs">
                      Avg: {data.averageVelocity} pts
                    </span>
                  </div>
                )}

                {/* Sprints Bars Grid */}
                <div className="h-52 w-full flex items-end justify-around border-b border-l border-slate-200 dark:border-slate-800 px-2 sm:px-6 gap-3 sm:gap-6">
                  {historicalSprints.map((s) => {
                    const plannedHeight = Math.max(4, Math.round((s.plannedPoints / maxChartValue) * 100));
                    const deliveredHeight = Math.max(4, Math.round((s.completedPoints / maxChartValue) * 100));

                    return (
                      <div
                        key={s.id}
                        onClick={() => {
                          if (onOpenDrillDown) {
                            onOpenDrillDown({
                              title: `Sprint Velocity: ${s.name}`,
                              subtitle: `Planned: ${s.plannedPoints} pts | Completed Velocity: ${s.completedPoints} pts (${s.completionRate}%)`,
                              category: 'Sprint Velocity',
                              metricLabel: `${s.completedPoints} pts delivered`,
                              issues: [],
                            });
                          }
                        }}
                        className="flex-1 max-w-[80px] flex flex-col items-center gap-1.5 h-full justify-end group cursor-pointer"
                        title={`${s.name}\nPlanned: ${s.plannedPoints} pts\nDelivered Velocity: ${s.completedPoints} pts\nCompletion: ${s.completionRate}%\nCompleted Tasks: ${s.completedIssues}`}
                      >
                        {/* Values above bars */}
                        <div className="flex items-center gap-1 text-[10px] font-bold">
                          <span className="text-slate-500 dark:text-slate-400 group-hover:text-slate-600 transition-colors">
                            {s.plannedPoints}
                          </span>
                          <span className="text-indigo-600 dark:text-indigo-400">
                            {s.completedPoints}
                          </span>
                        </div>

                        {/* Dual Bars (Planned vs Completed) */}
                        <div className="w-full flex items-end justify-center gap-1 h-full max-h-[85%]">
                          {/* Planned Bar */}
                          <div
                            className="w-1/2 rounded-t bg-slate-200 dark:bg-slate-700/80 group-hover:bg-slate-300 dark:group-hover:bg-slate-600 transition-all duration-300"
                            style={{ height: `${plannedHeight}%` }}
                          />
                          {/* Delivered Velocity Bar */}
                          <div
                            className="w-1/2 rounded-t bg-indigo-600 group-hover:bg-indigo-500 shadow-xs transition-all duration-300"
                            style={{ height: `${deliveredHeight}%` }}
                          />
                        </div>

                        {/* Sprint Name Label */}
                        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate max-w-[70px] text-center group-hover:text-indigo-600">
                          {s.name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 5. Historical Sprints Data Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">Sprint Performance & Completion Breakdown</h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {historicalSprints.length} {historicalSprints.length === 1 ? 'Sprint' : 'Sprints'} tracked
              </span>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider select-none">
                    <th className="py-2.5 px-3">Sprint</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 hidden sm:table-cell">Duration</th>
                    <th className="py-2.5 px-3 text-right">Planned</th>
                    <th className="py-2.5 px-3 text-right">Delivered (Velocity)</th>
                    <th className="py-2.5 px-3 text-center">Completion %</th>
                    <th className="py-2.5 px-3 text-center hidden md:table-cell">Tasks (Done/Total)</th>
                    <th className="py-2.5 px-3 text-center hidden lg:table-cell">Unestimated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                  {historicalSprints.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500 dark:text-slate-400 italic">
                        No completed sprint velocity data yet. Complete a sprint to track historical throughput.
                      </td>
                    </tr>
                  ) : (
                    historicalSprints.map((s) => (
                      <tr
                        key={s.id}
                        className="hover:bg-indigo-50/30 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                          {s.name}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60">
                            {s.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 text-[11px] hidden sm:table-cell">
                          {s.startDate && s.endDate ? (
                            <span>
                              {new Date(s.startDate).toLocaleDateString()} – {new Date(s.endDate).toLocaleDateString()}
                            </span>
                          ) : (
                            <span className="text-slate-500 dark:text-slate-400 italic">Dates not set</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                          {s.plannedPoints} pts
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-indigo-600 dark:text-indigo-400">
                          {s.completedPoints} pts
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              s.completionRate >= 90
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : s.completionRate >= 70
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            }`}
                          >
                            {s.completionRate}%
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center font-mono text-slate-600 dark:text-slate-400 hidden md:table-cell">
                          {s.completedIssues} / {s.totalIssues}
                        </td>
                        <td className="py-2.5 px-3 text-center hidden lg:table-cell">
                          {s.unestimatedCompletedIssues > 0 ? (
                            <span className="text-amber-600 dark:text-amber-400 font-semibold text-[11px]">
                              {s.unestimatedCompletedIssues} task{s.unestimatedCompletedIssues === 1 ? '' : 's'}
                            </span>
                          ) : (
                            <span className="text-slate-500 dark:text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 6. Planning Advisory Notice */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 flex items-start gap-2.5 text-xs text-slate-500 dark:text-slate-400">
            <Info className="w-4 h-4 shrink-0 text-indigo-500 mt-0.5" />
            <div>
              <strong className="text-slate-700 dark:text-slate-300">Delivery Velocity Guidance:</strong>{' '}
              Sprint velocity is a team capacity planning aid designed to forecast future iteration throughput. Velocity is not intended as an individual productivity metric or scorecard.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
