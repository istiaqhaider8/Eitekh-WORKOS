'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Search,
  Download,
  Copy,
  Check,
  ArrowUpDown,
  ExternalLink,
  Layers,
  Clock,
  CheckCircle2,
  Hash,
  Filter,
  FileSpreadsheet,
  FileCode,
  Calendar,
  AlertCircle
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';

export interface AnalyticsDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  category?: string;
  metricLabel?: string;
  percentage?: string | number;
  projectName?: string;
  timePeriod?: string;
  filtersApplied?: Record<string, string>;
  issues: any[];
  onSelectIssue?: (issue: any) => void;
}

export function AnalyticsDrillDownModal({
  isOpen,
  onClose,
  title,
  subtitle,
  category,
  metricLabel,
  percentage,
  projectName,
  timePeriod,
  filtersApplied,
  issues = [],
  onSelectIssue,
}: AnalyticsDrillDownModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [sortField, setSortField] = useState<'key' | 'title' | 'priority' | 'status' | 'points' | 'dueDate'>('key');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [copied, setCopied] = useState(false);
  const pageSize = 10;

  // Listen for Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset pagination when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedStatus]);

  // Unique statuses in this issue set
  const uniqueStatuses = useMemo(() => {
    const set = new Set<string>();
    issues.forEach(i => {
      if (i.status?.name) set.add(i.status.name);
    });
    return Array.from(set);
  }, [issues]);

  // Summary Metrics
  const summary = useMemo(() => {
    const totalCount = issues.length;
    const totalPoints = issues.reduce((sum, i) => sum + (Number(i.estimatePoints) || 0), 0);
    const totalHours = issues.reduce((sum, i) => sum + (Number(i.estimateHours) || 0), 0);
    const completedCount = issues.filter(
      i => i.status?.category === 'DONE' || i.status?.name?.toLowerCase().includes('done')
    ).length;
    const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    return {
      totalCount,
      totalPoints,
      totalHours,
      completedCount,
      completionRate,
    };
  }, [issues]);

  // Filtered & Sorted issues
  const processedIssues = useMemo(() => {
    let result = [...issues];

    if (selectedStatus !== 'ALL') {
      result = result.filter(i => i.status?.name === selectedStatus);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i =>
        i.issueKey?.toLowerCase().includes(q) ||
        i.title?.toLowerCase().includes(q) ||
        i.assignee?.firstName?.toLowerCase().includes(q) ||
        i.assignee?.lastName?.toLowerCase().includes(q) ||
        i.status?.name?.toLowerCase().includes(q) ||
        i.priority?.toLowerCase().includes(q) ||
        i.issueType?.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      switch (sortField) {
        case 'key':
          valA = a.keyNumber || a.issueKey || '';
          valB = b.keyNumber || b.issueKey || '';
          break;
        case 'title':
          valA = a.title?.toLowerCase() || '';
          valB = b.title?.toLowerCase() || '';
          break;
        case 'priority': {
          const rank: Record<string, number> = { CRITICAL: 5, HIGHEST: 4, HIGH: 3, MEDIUM: 2, LOW: 1, LOWEST: 0 };
          valA = rank[a.priority] ?? 1;
          valB = rank[b.priority] ?? 1;
          break;
        }
        case 'status':
          valA = a.status?.name?.toLowerCase() || '';
          valB = b.status?.name?.toLowerCase() || '';
          break;
        case 'points':
          valA = Number(a.estimatePoints) || 0;
          valB = Number(b.estimatePoints) || 0;
          break;
        case 'dueDate':
          valA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
          valB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
          break;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [issues, searchQuery, selectedStatus, sortField, sortDirection]);

  // Paginated issues
  const paginatedIssues = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return processedIssues.slice(start, start + pageSize);
  }, [processedIssues, currentPage]);

  const totalPages = Math.max(1, Math.ceil(processedIssues.length / pageSize));

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    if (!issues.length) {
      showError('No data to export');
      return;
    }
    const headers = ['Key', 'Title', 'Type', 'Status', 'Priority', 'Assignee', 'Estimate Points', 'Estimate Hours', 'Due Date', 'Created At'];
    const rows = issues.map(i => [
      '"' + (i.issueKey || '') + '"',
      '"' + (i.title || '').replace(/"/g, '""') + '"',
      '"' + (i.issueType || 'TASK') + '"',
      '"' + (i.status?.name || '') + '"',
      '"' + (i.priority || '') + '"',
      '"' + (i.assignee ? (i.assignee.firstName + ' ' + (i.assignee.lastName || '')).trim() : 'Unassigned') + '"',
      i.estimatePoints ?? '',
      i.estimateHours ?? '',
      '"' + (i.dueDate ? new Date(i.dueDate).toISOString().split('T')[0] : '') + '"',
      '"' + (i.createdAt ? new Date(i.createdAt).toISOString().split('T')[0] : '') + '"',
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', (title.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'analytics') + '_underlying_data.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showSuccess('CSV exported successfully');
  };

  // Export JSON
  const handleExportJSON = () => {
    if (!issues.length) {
      showError('No data to export');
      return;
    }
    const exportData = {
      metric: title,
      category,
      metricLabel,
      percentage,
      projectName,
      timePeriod,
      filtersApplied,
      summary,
      recordCount: issues.length,
      timestamp: new Date().toISOString(),
      issues: issues.map(i => ({
        key: i.issueKey,
        title: i.title,
        type: i.issueType,
        status: i.status?.name,
        statusCategory: i.status?.category,
        priority: i.priority,
        assignee: i.assignee ? (i.assignee.firstName + ' ' + (i.assignee.lastName || '')).trim() : null,
        estimatePoints: i.estimatePoints,
        estimateHours: i.estimateHours,
        dueDate: i.dueDate,
        createdAt: i.createdAt,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', (title.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'analytics') + '_data.json');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showSuccess('JSON exported successfully');
  };

  // Copy TSV to clipboard
  const handleCopyTSV = () => {
    if (!issues.length) {
      showError('No data to copy');
      return;
    }
    const headers = ['Key', 'Title', 'Type', 'Status', 'Priority', 'Assignee', 'Points', 'Due Date'];
    const rows = issues.map(i => [
      i.issueKey || '',
      i.title || '',
      i.issueType || '',
      i.status?.name || '',
      i.priority || '',
      i.assignee ? (i.assignee.firstName + ' ' + (i.assignee.lastName || '')).trim() : 'Unassigned',
      i.estimatePoints ?? '',
      i.dueDate ? new Date(i.dueDate).toISOString().split('T')[0] : '',
    ]);

    const tsv = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      setCopied(true);
      showSuccess('Data copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="drilldown-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-5xl max-h-[90vh] flex flex-col bg-card border border-border rounded-xl shadow-2xl overflow-hidden text-foreground">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-border bg-muted/20">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                Data Details & Drill-Down
              </span>
              {category && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground border border-border">
                  {category}
                </span>
              )}
              {projectName && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
                  Project: {projectName}
                </span>
              )}
              {percentage !== undefined && percentage !== null && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  {typeof percentage === 'number' ? percentage + '%' : percentage}
                </span>
              )}
            </div>
            <h2 id="drilldown-modal-title" className="text-xl font-bold tracking-tight">
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>

          <button
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Metric KPI Overview Banner */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-muted/40 border-b border-border">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
            <div className="p-2 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Hash className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Matching Issues</p>
              <p className="text-lg font-bold">{summary.totalCount}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
            <div className="p-2 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Total Story Points</p>
              <p className="text-lg font-bold">{summary.totalPoints} pts</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
            <div className="p-2 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Estimated Hours</p>
              <p className="text-lg font-bold">{summary.totalHours} hrs</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
            <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Completed / Done</p>
              <p className="text-lg font-bold">
                {summary.completedCount} <span className="text-xs text-muted-foreground font-normal">({summary.completionRate}%)</span>
              </p>
            </div>
          </div>
        </div>

        {/* Filter & Action Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 border-b border-border bg-card">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search issues, keys, assignees..."
                className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg bg-background border border-border focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>

            {uniqueStatuses.length > 1 && (
              <div className="relative min-w-[130px]">
                <select
                  value={selectedStatus}
                  onChange={e => setSelectedStatus(e.target.value)}
                  className="w-full py-1.5 px-2.5 text-sm rounded-lg bg-background border border-border focus:ring-2 focus:ring-primary focus:outline-none text-foreground"
                >
                  <option value="ALL">All Statuses</option>
                  {uniqueStatuses.map(st => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Export & Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              disabled={issues.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted transition-colors disabled:opacity-50"
              title="Export as CSV"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
              <span>CSV</span>
            </button>

            <button
              onClick={handleExportJSON}
              disabled={issues.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted transition-colors disabled:opacity-50"
              title="Export as JSON"
            >
              <FileCode className="w-3.5 h-3.5 text-blue-500" />
              <span>JSON</span>
            </button>

            <button
              onClick={handleCopyTSV}
              disabled={issues.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted transition-colors disabled:opacity-50"
              title="Copy table to clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Drill-Down Table */}
        <div className="flex-1 overflow-auto max-h-[440px] relative bg-white dark:bg-slate-950">
          {processedIssues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <Layers className="w-10 h-10 text-muted-foreground/40 mb-3" />
              <p className="font-semibold text-sm text-foreground">No underlying issues found</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                {issues.length === 0
                  ? 'There are no active issues associated with this specific metric data point.'
                  : 'No issues match your current search and filter criteria.'}
              </p>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 sticky top-0 z-20 shadow-xs">
                    <th
                      className="py-3 px-4 font-bold text-slate-700 dark:text-slate-200 cursor-pointer hover:text-primary transition select-none sticky top-0 bg-slate-100 dark:bg-slate-900 z-20"
                      onClick={() => handleSort('key')}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Key</span>
                        <ArrowUpDown className="w-3 h-3 text-muted-foreground opacity-70" />
                      </div>
                    </th>
                    <th
                      className="py-3 px-4 font-bold text-slate-700 dark:text-slate-200 cursor-pointer hover:text-primary transition select-none sticky top-0 bg-slate-100 dark:bg-slate-900 z-20 min-w-[180px]"
                      onClick={() => handleSort('title')}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Title</span>
                        <ArrowUpDown className="w-3 h-3 text-muted-foreground opacity-70" />
                      </div>
                    </th>
                    <th className="py-3 px-4 font-bold text-slate-700 dark:text-slate-200 sticky top-0 bg-slate-100 dark:bg-slate-900 z-20">Type</th>
                    <th
                      className="py-3 px-4 font-bold text-slate-700 dark:text-slate-200 cursor-pointer hover:text-primary transition select-none sticky top-0 bg-slate-100 dark:bg-slate-900 z-20"
                      onClick={() => handleSort('status')}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Status</span>
                        <ArrowUpDown className="w-3 h-3 text-muted-foreground opacity-70" />
                      </div>
                    </th>
                    <th
                      className="py-3 px-4 font-bold text-slate-700 dark:text-slate-200 cursor-pointer hover:text-primary transition select-none sticky top-0 bg-slate-100 dark:bg-slate-900 z-20"
                      onClick={() => handleSort('priority')}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Priority</span>
                        <ArrowUpDown className="w-3 h-3 text-muted-foreground opacity-70" />
                      </div>
                    </th>
                    <th className="py-3 px-4 font-bold text-slate-700 dark:text-slate-200 sticky top-0 bg-slate-100 dark:bg-slate-900 z-20">Assignee</th>
                    <th
                      className="py-3 px-4 font-bold text-slate-700 dark:text-slate-200 text-right cursor-pointer hover:text-primary transition select-none sticky top-0 bg-slate-100 dark:bg-slate-900 z-20"
                      onClick={() => handleSort('points')}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <span>Points</span>
                        <ArrowUpDown className="w-3 h-3 text-muted-foreground opacity-70" />
                      </div>
                    </th>
                    <th
                      className="py-3 px-4 font-bold text-slate-700 dark:text-slate-200 cursor-pointer hover:text-primary transition select-none sticky top-0 bg-slate-100 dark:bg-slate-900 z-20"
                      onClick={() => handleSort('dueDate')}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Due Date</span>
                        <ArrowUpDown className="w-3 h-3 text-muted-foreground opacity-70" />
                      </div>
                    </th>
                    <th className="py-3 px-4 font-bold text-slate-700 dark:text-slate-200 text-right sticky top-0 bg-slate-100 dark:bg-slate-900 z-20">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 bg-white dark:bg-slate-950">
                {paginatedIssues.map(issue => {
                  const priorityColor =
                    issue.priority === 'CRITICAL' ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' :
                    issue.priority === 'HIGH' || issue.priority === 'HIGHEST' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' :
                    issue.priority === 'MEDIUM' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' :
                    'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20';

                  const statusColor =
                    issue.status?.category === 'DONE' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' :
                    issue.status?.category === 'IN_PROGRESS' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' :
                    'bg-muted text-muted-foreground border-border';

                  return (
                    <tr
                      key={issue.id}
                      onClick={() => onSelectIssue && onSelectIssue(issue)}
                      className={'hover:bg-muted/50 transition-colors ' + (onSelectIssue ? 'cursor-pointer group' : '')}
                    >
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-primary">
                        {issue.issueKey}
                      </td>
                      <td className="py-3 px-4 font-medium max-w-xs truncate">
                        <span className="group-hover:text-primary transition-colors">
                          {issue.title}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs text-muted-foreground uppercase font-semibold">
                          {issue.issueType || 'TASK'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={'inline-block px-2 py-0.5 rounded text-xs font-medium border ' + statusColor}>
                          {issue.status?.name || 'Unknown'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={'inline-block px-2 py-0.5 rounded text-xs font-medium border ' + priorityColor}>
                          {issue.priority}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {issue.assignee ? (
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-primary/20 text-primary font-bold text-[10px] flex items-center justify-center">
                              {issue.assignee.firstName?.[0] || 'U'}
                            </div>
                            <span className="text-xs text-foreground truncate">
                              {issue.assignee.firstName} {issue.assignee.lastName}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs font-semibold">
                        {issue.estimatePoints ? issue.estimatePoints + ' pts' : '-'}
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">
                        {issue.dueDate ? new Date(issue.dueDate).toLocaleDateString() : '-'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {onSelectIssue && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectIssue(issue);
                            }}
                            className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                            title="Open issue details"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>

        {/* Footer & Pagination */}
        <div className="flex items-center justify-between p-4 border-t border-border bg-muted/20 text-xs text-muted-foreground">
          <div>
            Showing <span className="font-semibold text-foreground">{processedIssues.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}</span> to{' '}
            <span className="font-semibold text-foreground">{Math.min(currentPage * pageSize, processedIssues.length)}</span> of{' '}
            <span className="font-semibold text-foreground">{processedIssues.length}</span> issues
            {issues.length !== processedIssues.length && (
              <span className="ml-1">(filtered from {issues.length})</span>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-2.5 py-1 rounded border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="px-2">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-2.5 py-1 rounded border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
