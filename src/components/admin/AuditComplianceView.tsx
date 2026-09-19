'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  History,
  Search,
  Filter,
  Download,
  RefreshCw,
  Eye,
  FileText,
  Shield,
  Clock,
  User,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertOctagon,
  Info,
  Copy,
  Check,
  Layers,
  Globe,
  Calendar,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Activity,
  Radio,
  SlidersHorizontal,
} from 'lucide-react';
import { showSuccess, showError, showInfo } from '@/lib/toast';

interface AuditLogItem {
  id: string;
  action: string;
  targetResource: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  avatarUrl?: string | null;
  orgId?: string;
  ipAddress: string;
  createdAt: string;
  category: string;
  severity: 'INFO' | 'NOTICE' | 'WARNING' | 'CRITICAL';
  status: 'SUCCESS' | 'FAILURE';
  changes?: any;
  previousState?: any;
  newState?: any;
  details?: any;
}

interface AuditStats {
  totalEvents: number;
  todayEvents: number;
  criticalEvents: number;
}

const CATEGORIES = [
  { id: 'ALL', label: 'All Events' },
  { id: 'AUTH', label: 'Auth & Sessions' },
  { id: 'PBAC', label: 'PBAC & Roles' },
  { id: 'PROJECT', label: 'Projects' },
  { id: 'ISSUE', label: 'Issues & Tasks' },
  { id: 'SECURITY', label: 'Security' },
  { id: 'CACHE', label: 'System Cache' },
  { id: 'SETTINGS', label: 'Settings' },
  { id: 'SYSTEM', label: 'System Ops' },
];

const SEVERITIES = [
  { id: 'ALL', label: 'All Severities' },
  { id: 'INFO', label: 'Info' },
  { id: 'NOTICE', label: 'Notice' },
  { id: 'WARNING', label: 'Warning' },
  { id: 'CRITICAL', label: 'Critical' },
];

export function AuditComplianceView() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [stats, setStats] = useState<AuditStats>({ totalEvents: 0, todayEvents: 0, criticalEvents: 0 });
  const [actionTypes, setActionTypes] = useState<{ action: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Live Auto-Refresh
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Inspector Modal
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const loadLogs = useCallback(
    async (isBackground = false) => {
      if (!isBackground) setLoading(true);
      else setRefreshing(true);

      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set('search', search.trim());
        if (categoryFilter !== 'ALL') params.set('category', categoryFilter);
        if (severityFilter !== 'ALL') params.set('severity', severityFilter);
        if (actionFilter !== 'ALL') params.set('action', actionFilter);
        params.set('page', String(page));
        params.set('limit', String(limit));

        const res = await fetch(`/api/super-admin/audit-logs?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setLogs(data.logs || []);
          setTotalCount(data.totalCount || 0);
          setTotalPages(data.totalPages || 1);
          if (data.stats) setStats(data.stats);
          if (data.actionTypes) setActionTypes(data.actionTypes);
        } else {
          showError('Failed to retrieve audit events');
        }
      } catch (e: any) {
        showError(e.message || 'Error fetching audit logs');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [search, categoryFilter, severityFilter, actionFilter, page, limit]
  );

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Live Auto-Refresh (every 10s)
  useEffect(() => {
    if (autoRefresh) {
      autoRefreshTimerRef.current = setInterval(() => {
        loadLogs(true);
      }, 30000);
    } else {
      if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
    }
    return () => {
      if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
    };
  }, [autoRefresh, loadLogs]);

  const handleExport = (format: 'csv' | 'json') => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (categoryFilter !== 'ALL') params.set('category', categoryFilter);
    if (severityFilter !== 'ALL') params.set('severity', severityFilter);
    if (actionFilter !== 'ALL') params.set('action', actionFilter);
    params.set('export', format);

    window.open(`/api/super-admin/audit-logs?${params.toString()}`, '_blank');
    showSuccess(`Generating and downloading ${format.toUpperCase()} compliance audit report...`);
  };

  const copyLogJson = () => {
    if (!selectedLog) return;
    navigator.clipboard.writeText(JSON.stringify(selectedLog, null, 2));
    setCopiedId(true);
    showSuccess('Audit record JSON copied to clipboard');
    setTimeout(() => setCopiedId(false), 2000);
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800">
            <AlertOctagon className="w-3 h-3" />
            CRITICAL
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
            <AlertTriangle className="w-3 h-3" />
            WARNING
          </span>
        );
      case 'NOTICE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
            <Info className="w-3 h-3" />
            NOTICE
          </span>
        );
      case 'INFO':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
            <Info className="w-3 h-3" />
            INFO
          </span>
        );
    }
  };

  const getCategoryBadge = (category: string) => {
    const colors: Record<string, string> = {
      AUTH: 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800',
      PBAC: 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800',
      PROJECT: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800',
      ISSUE: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800',
      SECURITY: 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800',
      CACHE: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
      SETTINGS: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800',
      SYSTEM: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700',
    };
    const style = colors[category] || 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700';
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${style}`}>
        {category}
      </span>
    );
  };

  // Compute unique active actors from current logs
  const activeActorsCount = new Set(logs.map((l) => l.actorEmail || l.actorId)).size;

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white dark:bg-slate-900/80 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shadow-inner dark:bg-indigo-950/40 dark:border-indigo-800 dark:text-indigo-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
                Unified Audit Ledger & Compliance Engine
                {autoRefresh && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 animate-pulse dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    LIVE STREAMING
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Cryptographically tracked, immutable record of all lifecycle events, security mutations, PBAC modifications, and data access.
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Live stream toggle */}
          <button
            onClick={() => {
              setAutoRefresh(!autoRefresh);
              showInfo(!autoRefresh ? 'Live audit auto-refresh enabled (10s)' : 'Live auto-refresh paused');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              autoRefresh
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${autoRefresh ? 'text-emerald-700 dark:text-emerald-300 animate-pulse' : ''}`} />
            <span>{autoRefresh ? 'Live Active' : 'Live Stream'}</span>
          </button>

          {/* Export CSV */}
          <button
            onClick={() => handleExport('csv')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-700 shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>CSV</span>
          </button>

          {/* Export JSON */}
          <button
            onClick={() => handleExport('json')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-700 shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            <span>JSON</span>
          </button>

          {/* Refresh Button */}
          <button
            onClick={() => loadLogs(false)}
            disabled={loading || refreshing}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-sm transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-0.5">
              Total Logged Events
            </span>
            <span className="text-2xl font-black text-slate-900 dark:text-slate-100">
              {stats.totalEvents.toLocaleString()}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 dark:bg-indigo-950/40 dark:border-indigo-800 dark:text-indigo-400">
            <History className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-0.5">
              Today's Activity
            </span>
            <span className="text-2xl font-black text-emerald-700 dark:text-emerald-400">
              {stats.todayEvents.toLocaleString()}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-400">
            <Activity className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-0.5">
              Critical & High Risk
            </span>
            <span className="text-2xl font-black text-rose-600 dark:text-rose-400">
              {stats.criticalEvents.toLocaleString()}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-400">
            <AlertOctagon className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-0.5">
              Active Actors (Page)
            </span>
            <span className="text-2xl font-black text-cyan-700 dark:text-cyan-400">
              {activeActorsCount}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-cyan-50 border border-cyan-200 flex items-center justify-center text-cyan-700 dark:bg-cyan-950/40 dark:border-cyan-800 dark:text-cyan-400">
            <User className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Category Pills Navigation */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {CATEGORIES.map((cat) => {
          const isActive = categoryFilter === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => {
                setCategoryFilter(cat.id);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white dark:bg-slate-900/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Search */}
        <div className="flex items-center gap-2 w-full md:w-96 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-700 dark:text-slate-300 focus-within:border-indigo-200 transition-colors">
          <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="Search action, target resource, user, IP, or details..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="bg-transparent border-none outline-none w-full text-slate-800 dark:text-slate-200 placeholder-slate-500"
          />
          {search && (
            <button
              onClick={() => {
                setSearch('');
                setPage(1);
              }}
              className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filters Group */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Severity Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5">
            <Shield className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
            <select
              value={severityFilter}
              onChange={(e) => {
                setSeverityFilter(e.target.value);
                setPage(1);
              }}
              className="bg-transparent border-none outline-none text-xs text-slate-800 dark:text-slate-200 cursor-pointer"
            >
              {SEVERITIES.map((s) => (
                <option key={s.id} value={s.id} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Action Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 max-w-[200px]">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="bg-transparent border-none outline-none text-xs text-slate-800 dark:text-slate-200 cursor-pointer truncate"
            >
              <option value="ALL" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                All Actions ({totalCount})
              </option>
              {actionTypes.map((a) => (
                <option key={a.action} value={a.action} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                  {a.action} ({a.count})
                </option>
              ))}
            </select>
          </div>

          {/* Rows per page */}
          <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
            <span>Show:</span>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-800 dark:text-slate-200 outline-none"
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Audit Ledger Table */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-950/90 text-[10px] uppercase font-bold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 tracking-wider">
              <tr>
                <th className="p-3.5">Timestamp</th>
                <th className="p-3.5">Category</th>
                <th className="p-3.5">Severity</th>
                <th className="p-3.5">Action</th>
                <th className="p-3.5">Actor</th>
                <th className="p-3.5">Target Resource</th>
                <th className="p-3.5">IP Address</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans">
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-12 text-center text-slate-500 dark:text-slate-400">
                    <RefreshCw className="w-7 h-7 animate-spin mx-auto text-indigo-600 mb-2 dark:text-indigo-400" />
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">Loading audit ledger entries...</p>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-12 text-center text-slate-500 dark:text-slate-400">
                    <History className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                    <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">No matching audit records found</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Try adjusting your search query, category, or severity filter.</p>
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const date = new Date(log.createdAt);
                  const isSuccess = log.status === 'SUCCESS';

                  return (
                    <tr key={log.id} className="hover:bg-slate-100 dark:hover:bg-slate-800/40 transition-colors">
                      {/* Timestamp */}
                      <td className="p-3.5 text-slate-600 dark:text-slate-400 text-[11px] whitespace-nowrap font-mono">
                        <div className="flex flex-col">
                          <span className="text-slate-800 dark:text-slate-200 font-semibold">{date.toLocaleTimeString()}</span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400">{date.toLocaleDateString()}</span>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="p-3.5 whitespace-nowrap">{getCategoryBadge(log.category)}</td>

                      {/* Severity */}
                      <td className="p-3.5 whitespace-nowrap">{getSeverityBadge(log.severity)}</td>

                      {/* Action */}
                      <td className="p-3.5 whitespace-nowrap">
                        <span className="inline-block font-mono font-bold text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 px-2 py-0.5 rounded text-[11px]">
                          {log.action}
                        </span>
                      </td>

                      {/* Actor */}
                      <td className="p-3.5">
                        <div className="flex items-center gap-2 max-w-[180px]">
                          <div className="w-6 h-6 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center text-[10px] font-bold text-indigo-700 shrink-0 overflow-hidden dark:bg-indigo-950/40 dark:border-indigo-800 dark:text-indigo-400">
                            {log.avatarUrl ? (
                              <img src={log.avatarUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              (log.actorName || log.actorEmail || 'U').charAt(0).toUpperCase()
                            )}
                          </div>
                          <div className="truncate">
                            <span className="font-semibold text-slate-800 dark:text-slate-200 block truncate text-[11px]" title={log.actorName}>
                              {log.actorName || 'System'}
                            </span>
                            {log.actorEmail && (
                              <span className="text-[10px] text-slate-600 dark:text-slate-400 block truncate" title={log.actorEmail}>
                                {log.actorEmail}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Target Resource */}
                      <td className="p-3.5 max-w-[200px]">
                        <span
                          className="font-mono text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded block truncate dark:text-indigo-400 dark:bg-indigo-950/40 dark:border-indigo-800"
                          title={log.targetResource}
                        >
                          {log.targetResource}
                        </span>
                      </td>

                      {/* IP Address */}
                      <td className="p-3.5 text-slate-600 dark:text-slate-400 text-[11px] font-mono whitespace-nowrap">
                        {log.ipAddress || '127.0.0.1'}
                      </td>

                      {/* Status */}
                      <td className="p-3.5 whitespace-nowrap">
                        {isSuccess ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            SUCCESS
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 dark:text-rose-400">
                            <XCircle className="w-3.5 h-3.5" />
                            FAILED
                          </span>
                        )}
                      </td>

                      {/* Inspect */}
                      <td className="p-3.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 hover:text-white rounded-lg text-[11px] font-semibold border border-slate-300 dark:border-slate-700 transition-colors shadow-sm"
                        >
                          <Eye className="w-3 h-3 inline mr-1 text-indigo-600 dark:text-indigo-400" />
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-3.5 bg-slate-50 dark:bg-slate-950/80 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span>
              Showing <strong className="text-slate-800 dark:text-slate-200">{logs.length > 0 ? (page - 1) * limit + 1 : 0}</strong> to{' '}
              <strong className="text-slate-800 dark:text-slate-200">{Math.min(page * limit, totalCount)}</strong> of{' '}
              <strong className="text-slate-800 dark:text-slate-200">{totalCount.toLocaleString()}</strong> events
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage(1)}
              disabled={page <= 1}
              className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-300 rounded disabled:opacity-40 disabled:hover:bg-white transition-colors"
            >
              First
            </button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-300 rounded disabled:opacity-40 disabled:hover:bg-white transition-colors flex items-center gap-0.5"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </button>
            <span className="px-2 text-slate-700 dark:text-slate-300 font-semibold font-mono">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-300 rounded disabled:opacity-40 disabled:hover:bg-white transition-colors flex items-center gap-0.5"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
              className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-300 rounded disabled:opacity-40 disabled:hover:bg-white transition-colors"
            >
              Last
            </button>
          </div>
        </div>
      </div>

      {/* Audit Detail & Visual Diff Inspector Drawer/Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 dark:bg-indigo-950/40 dark:border-indigo-800 dark:text-indigo-400">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    Audit Event Inspector
                    <span className="font-mono text-xs font-semibold text-indigo-600 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded dark:text-indigo-400">
                      {selectedLog.action}
                    </span>
                  </h3>
                  <span className="text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                    ID: {selectedLog.id} • {new Date(selectedLog.createdAt).toISOString()}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={copyLogJson}
                  className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded text-xs font-medium border border-slate-300 dark:border-slate-700 transition-colors"
                >
                  {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedId ? 'Copied' : 'Copy JSON'}</span>
                </button>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-sm px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(90vh-120px)]">
              {/* Metadata Cards Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400 block mb-1">Category</span>
                  {getCategoryBadge(selectedLog.category)}
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400 block mb-1">Severity</span>
                  {getSeverityBadge(selectedLog.severity)}
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400 block mb-1">Execution Status</span>
                  {selectedLog.status === 'SUCCESS' ? (
                    <span className="font-bold text-emerald-700 flex items-center gap-1 dark:text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" /> SUCCESS
                    </span>
                  ) : (
                    <span className="font-bold text-rose-600 flex items-center gap-1 dark:text-rose-400">
                      <XCircle className="w-3.5 h-3.5" /> FAILED
                    </span>
                  )}
                </div>
                <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800/80">
                  <span className="text-slate-500 dark:text-slate-400 block mb-1">Source IP</span>
                  <span className="font-mono text-slate-800 dark:text-slate-200">{selectedLog.ipAddress || '127.0.0.1'}</span>
                </div>
              </div>

              {/* Actor & Target Resource */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800/80 space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                    Authenticated Actor
                  </span>
                  <div className="flex items-center gap-2.5 pt-1">
                    <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center font-bold text-indigo-700 shrink-0 dark:bg-indigo-950/40 dark:border-indigo-800 dark:text-indigo-400">
                      {selectedLog.actorName?.charAt(0) || 'U'}
                    </div>
                    <div>
                      <span className="font-bold text-slate-900 dark:text-slate-100 block text-xs">{selectedLog.actorName || 'System'}</span>
                      <span className="text-slate-600 dark:text-slate-400 font-mono text-[11px] block">{selectedLog.actorEmail}</span>
                      <span className="text-slate-600 font-mono text-[10px] block">UID: {selectedLog.actorId}</span>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800/80 space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                    Target Resource Identifier
                  </span>
                  <div className="pt-1">
                    <span className="font-mono text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded block break-all dark:text-indigo-400 dark:bg-indigo-950/40 dark:border-indigo-800">
                      {selectedLog.targetResource}
                    </span>
                    {selectedLog.orgId && (
                      <span className="text-slate-500 dark:text-slate-400 text-[10px] font-mono mt-1 block">
                        Tenant Org: {selectedLog.orgId}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Visual Change / Diff Inspector (if previousState or newState or changes exist) */}
              {(selectedLog.previousState || selectedLog.newState || selectedLog.changes) && (
                <div className="p-3.5 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800/80 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      Visual Mutation Diff (Before vs After)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Previous State */}
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg dark:bg-rose-950/40 dark:border-rose-800">
                      <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-rose-200 dark:border-rose-800">
                        <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400">Previous State</span>
                      </div>
                      <pre className="text-[11px] font-mono text-rose-700 overflow-x-auto max-h-40 leading-relaxed dark:text-rose-400">
                        {selectedLog.previousState
                          ? JSON.stringify(selectedLog.previousState, null, 2)
                          : 'None (Created / Initial)'}
                      </pre>
                    </div>

                    {/* New State */}
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg dark:bg-emerald-950/40 dark:border-emerald-800">
                      <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-emerald-200 dark:border-emerald-800">
                        <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">New State</span>
                      </div>
                      <pre className="text-[11px] font-mono text-emerald-700 overflow-x-auto max-h-40 leading-relaxed dark:text-emerald-400">
                        {selectedLog.newState
                          ? JSON.stringify(selectedLog.newState, null, 2)
                          : selectedLog.changes
                          ? JSON.stringify(selectedLog.changes, null, 2)
                          : 'None (Deleted)'}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {/* Raw JSON Payload */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
                  Complete Structured Details Payload
                </span>
                <pre className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-indigo-700 font-mono text-xs overflow-x-auto max-h-60 leading-relaxed dark:text-indigo-400">
                  {JSON.stringify(selectedLog.details || {}, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
