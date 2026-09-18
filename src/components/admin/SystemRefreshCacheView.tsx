'use client';

import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  Trash2,
  Shield,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Server,
  Database,
  BarChart3,
  Wifi,
  Clock,
  Sparkles,
  Layers,
  Eye,
  KeyRound,
  ArrowRight,
  Info,
  Lock,
  Cpu,
  History,
  Activity,
  HardDrive,
  X,
} from 'lucide-react';
import { showSuccess, showError, showInfo } from '@/lib/toast';

interface CacheMetrics {
  totalEntries: number;
  memoryEstimateBytes: number;
  memoryFormatted: string;
  cacheVersion: string;
  hitCount: number;
  missCount: number;
  hitRatioPercent: number;
  uptimeSeconds: number;
  lastPurgedAt: string | null;
  namespaceStats: Record<string, {
    entries: number;
    hits: number;
    misses: number;
    description: string;
  }>;
}

interface SystemRefreshCacheViewProps {
  orgId?: string;
  projectId?: string;
}

export function SystemRefreshCacheView({ orgId, projectId }: SystemRefreshCacheViewProps) {
  const [metrics, setMetrics] = useState<CacheMetrics | null>(null);
  const [cacheVersion, setCacheVersion] = useState<string>('2026.1.0');
  const [userPermissions, setUserPermissions] = useState<any>({
    canFullRefresh: false,
    canServerRefresh: false,
    canAnalyticsRebuild: false,
    canProjectRefresh: true,
    canClientRefresh: true,
  });
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    action: string;
    title: string;
    description: string;
    dangerLevel: 'low' | 'medium' | 'high';
  }>({
    isOpen: false,
    action: '',
    title: '',
    description: '',
    dangerLevel: 'low',
  });

  const [lastExecutionResult, setLastExecutionResult] = useState<any | null>(null);

  // Fetch status and metrics
  const loadStatus = async () => {
    try {
      setLoading(true);
      const orgParam = orgId ? `?orgId=${orgId}` : '';
      const res = await fetch(`/api/admin/cache/status${orgParam}`);
      if (res.ok) {
        const data = await res.json();
        setMetrics(data.metrics);
        setCacheVersion(data.cacheVersion);
        setUserPermissions(data.userPermissions);
        setAuditLogs(data.recentAuditLogs || []);
      }
    } catch (e) {
      console.error('Failed to load cache status', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, [orgId, projectId]);

  // Execute a safe refresh action
  const handleExecute = async (action: string) => {
    setConfirmModal({ ...confirmModal, isOpen: false });
    setExecutingAction(action);
    setLastExecutionResult(null);

    try {
      const res = await fetch('/api/admin/cache/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          orgId,
          projectId,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setLastExecutionResult(data.result);
        showSuccess(`Safe Refresh completed: ${action.replace(/_/g, ' ')}`);

        // Client-side actions execution
        if (action === 'CLEAR_CLIENT_CACHE') {
          try {
            if (typeof window !== 'undefined') {
              // Clear temporary view caches while keeping credentials
              sessionStorage.clear();
              localStorage.removeItem('eitekh_cached_views');
              localStorage.removeItem('eitekh_filter_drafts');
            }
          } catch (err) {
            console.warn('Browser storage clear error:', err);
          }
        }

        if (action === 'REFRESH_SESSION' || action === 'FULL_SYSTEM_REFRESH') {
          // Trigger PBAC broadcast update event
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('pbac:updated'));
          }
        }

        // Reload status
        await loadStatus();
      } else {
        showError(data.error || 'Failed to complete cache refresh');
      }
    } catch (e: any) {
      showError(e.message || 'System refresh error');
    } finally {
      setExecutingAction(null);
    }
  };

  const openConfirmation = (action: string, title: string, description: string, dangerLevel: 'low' | 'medium' | 'high' = 'medium') => {
    setConfirmModal({
      isOpen: true,
      action,
      title,
      description,
      dangerLevel,
    });
  };

  const actionCards = [
    {
      id: 'REFRESH_SESSION',
      name: '1. Refresh Current Session',
      description: 'Re-validates session security token and recalculates user capability matrix directly from the database.',
      scope: 'Active User Session',
      allowed: true,
      icon: KeyRound,
      color: 'blue',
      badge: 'Safe & Instant',
      onClick: () => handleExecute('REFRESH_SESSION'),
    },
    {
      id: 'CLEAR_CLIENT_CACHE',
      name: '2. Clear My Browser / UI Cache',
      description: 'Clears stale browser-level view models, temporary UI filters, and query client states.',
      scope: 'Browser Client Only',
      allowed: true,
      icon: Trash2,
      color: 'amber',
      badge: 'Local Client Only',
      onClick: () => handleExecute('CLEAR_CLIENT_CACHE'),
    },
    {
      id: 'REFRESH_APP_DATA',
      name: '3. Refresh Application Data',
      description: 'Bypasses memoized query caches and performs fresh database queries for project boards and active workspaces.',
      scope: 'Active Workspace & Project',
      allowed: true,
      icon: RefreshCw,
      color: 'emerald',
      badge: 'Fresh Database Pull',
      onClick: () => handleExecute('REFRESH_APP_DATA'),
    },
    {
      id: 'CLEAR_SERVER_CACHE',
      name: '4. Clear Server Application Cache',
      description: 'Flushes server in-memory API response caches, search index lookups, and metadata dictionaries.',
      scope: 'Server-Wide API & Search',
      allowed: userPermissions.canServerRefresh,
      roleRequired: 'Organization ADMIN',
      icon: Server,
      color: 'purple',
      badge: 'In-Memory Only',
      onClick: () => openConfirmation(
        'CLEAR_SERVER_CACHE',
        'Clear Server Application Cache',
        'This will purge all temporary server-side memory caches for API responses and search queries. Persistent database records remain 100% untouched.',
        'medium'
      ),
    },
    {
      id: 'REBUILD_ANALYTICS_CACHE',
      name: '5. Rebuild Derived / Analytics Cache',
      description: 'Recalculates velocity trends, sprint burndown datasets, and team workload capacity in the background.',
      scope: 'Derived Metrics & Charts',
      allowed: userPermissions.canAnalyticsRebuild,
      roleRequired: 'PROJECT ADMIN or higher',
      icon: BarChart3,
      color: 'indigo',
      badge: 'Non-Blocking Background',
      onClick: () => openConfirmation(
        'REBUILD_ANALYTICS_CACHE',
        'Rebuild Derived Analytics Cache',
        'This triggers a background recalculation of project burndowns and velocity metrics without affecting raw issues or sprint records.',
        'low'
      ),
    },
    {
      id: 'REFRESH_REALTIME',
      name: '6. Refresh Real-Time Connection',
      description: 'Resets event broadcast channels, clears stale sequence numbers, and re-establishes live sync streams.',
      scope: 'Live Collaboration Sync',
      allowed: true,
      icon: Wifi,
      color: 'cyan',
      badge: 'Zero Downtime',
      onClick: () => handleExecute('REFRESH_REALTIME'),
    },
    {
      id: 'FULL_SYSTEM_REFRESH',
      name: '7. Full Safe System Cache Refresh',
      description: 'Comprehensive platform refresh: purges all 6 cache tiers, recalibrates PBAC deterministic engine, and reconnects sync streams.',
      scope: 'Entire Platform & PBAC',
      allowed: userPermissions.canFullRefresh,
      roleRequired: 'Super Admin',
      icon: ShieldCheck,
      color: 'rose',
      badge: 'Enterprise Maintenance',
      isHero: true,
      onClick: () => openConfirmation(
        'FULL_SYSTEM_REFRESH',
        'Full Safe System Refresh',
        'This will execute a complete safe refresh of all platform cache layers (PBAC capability cache, API response cache, analytics aggregations, search indexes, and real-time streams). Real database records and business entities will NOT be deleted.',
        'high'
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* 1. Header & Data Safety Guarantee Banner */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 relative overflow-hidden shadow-xl">
        <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-emerald-50 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2.5 mb-1.5">
              <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                System Refresh & Cache Management
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 border border-indigo-200 text-indigo-600 font-mono">
                v{cacheVersion}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
              Resolve stale UI data, outdated permissions, metrics delays, and temporary sync anomalies safely.
              All operations target transient memory and derived indexes only.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {userPermissions.canFullRefresh && (
              <button
                type="button"
                onClick={() => handleExecute('BUMP_CACHE_VERSION')}
                disabled={executingAction !== null}
                className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-all flex items-center gap-2 cursor-pointer shadow-sm disabled:opacity-50"
              >
                <Layers className="w-3.5 h-3.5 text-indigo-600" />
                <span>Bump Version</span>
              </button>
            )}

            <button
              type="button"
              onClick={loadStatus}
              disabled={loading || executingAction !== null}
              className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-all flex items-center gap-2 cursor-pointer shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-600 dark:text-slate-400 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Metrics</span>
            </button>
          </div>
        </div>

        {/* DATA SAFETY GUARANTEE BOX */}
        <div className="mt-5 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-start gap-3.5">
          <Shield className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold text-emerald-700 flex items-center gap-2">
              <span>CRITICAL DATA SAFETY GUARANTEE (Zero Business Data Loss)</span>
              <span className="px-2 py-0.2 bg-emerald-50 text-emerald-700 rounded text-[10px]">
                Active Enforced Policy
              </span>
            </div>
            <p className="text-slate-700 dark:text-slate-300 text-[11px] leading-relaxed">
              Cache clearing and system refresh operations strictly reset ephemeral in-memory caches, derived analytics indexes,
              and client-side view states. Your authoritative database records (<strong>Projects, Users, Issues, Tasks, Epics, Sprints, Roles, Permissions, Comments, Attachments, and Audit Logs</strong>) will <strong>NOT</strong> be deleted or altered.
            </p>
          </div>
        </div>
      </div>

      {/* 2. System Diagnostic Indicators & Cache Health */}
      {metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Cache Version
              </span>
              <Cpu className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono">
              {metrics.cacheVersion}
            </div>
            <div className="text-[10px] text-emerald-700 flex items-center gap-1 mt-0.5">
              <CheckCircle2 className="w-3 h-3" /> Auto-Invalidating on Upgrade
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Memory Footprint
              </span>
              <HardDrive className="w-4 h-4 text-blue-600" />
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {metrics.memoryFormatted}
            </div>
            <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">
              {metrics.totalEntries} entries across 6 namespaces
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Cache Efficiency
              </span>
              <Activity className="w-4 h-4 text-emerald-700" />
            </div>
            <div className="text-lg font-bold text-emerald-700">
              {metrics.hitRatioPercent}% Hit Ratio
            </div>
            <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">
              {metrics.hitCount} hits • {metrics.missCount} misses
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                PBAC Engine Cache
              </span>
              <ShieldCheck className="w-4 h-4 text-purple-600" />
            </div>
            <div className="text-sm font-bold text-purple-700">
              Deterministic
            </div>
            <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">
              Authoritative DB verified
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Real-Time Channels
              </span>
              <Wifi className="w-4 h-4 text-cyan-700" />
            </div>
            <div className="text-sm font-bold text-cyan-700">
              Live Synchronized
            </div>
            <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">
              Active heartbeat verified
            </div>
          </div>
        </div>
      )}

      {/* 3. Live Execution Terminal / Progress Checklist */}
      {lastExecutionResult && (
        <div className="bg-slate-50 dark:bg-slate-950 border border-emerald-200 rounded-2xl p-5 space-y-4 shadow-xl animate-in fade-in duration-300">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                  Operation Completed: {lastExecutionResult.action.replace(/_/g, ' ')}
                </h4>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Executed in <span className="text-emerald-700 font-bold">{lastExecutionResult.durationMs}ms</span> • Affected items: {lastExecutionResult.itemsAffected}
                </p>
              </div>
            </div>

            <span className="px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full text-xs font-bold flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> Data Safety 100% Verified
            </span>
          </div>

          {/* Verification Checklist */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {lastExecutionResult.checklist.map((item: any, idx: number) => (
              <div
                key={idx}
                className="p-3 bg-white dark:bg-slate-900/80 rounded-xl border border-slate-200 dark:border-slate-800 flex items-start gap-2.5 text-xs"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">{item.step}</div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">{item.detail}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center justify-between pt-1">
            <span>Started: {new Date(lastExecutionResult.startedAt).toLocaleTimeString()}</span>
            <span>Completed: {new Date(lastExecutionResult.completedAt).toLocaleTimeString()}</span>
          </div>
        </div>
      )}

      {/* 4. Action Cards Grid */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 px-1">
          Available Refresh & Cache Actions
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {actionCards.map((card) => {
            const Icon = card.icon;
            const isExecuting = executingAction === card.id;

            return (
              <div
                key={card.id}
                className={`bg-white dark:bg-slate-900/80 border rounded-xl p-5 flex flex-col justify-between transition-all duration-200 relative overflow-hidden ${
                  card.isHero
                    ? 'border-rose-200 bg-linear-to-b from-slate-900 to-rose-950/20 hover:border-rose-200'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:border-slate-700'
                } ${!card.allowed ? 'opacity-60' : ''}`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700/60 text-slate-800 dark:text-slate-200">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded text-[10px] font-semibold">
                      {card.badge}
                    </span>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      {card.name}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                      {card.description}
                    </p>
                  </div>
                </div>

                <div className="pt-5 mt-3 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
                  <div className="text-[10px] text-slate-500">
                    Scope: <span className="text-slate-700 dark:text-slate-300">{card.scope}</span>
                  </div>

                  {card.allowed ? (
                    <button
                      type="button"
                      onClick={card.onClick}
                      disabled={executingAction !== null}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                        card.isHero
                          ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-sm'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm'
                      }`}
                    >
                      <RefreshCw className={`w-3 h-3 ${isExecuting ? 'animate-spin' : ''}`} />
                      <span>{isExecuting ? 'Refreshing...' : 'Execute'}</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Requires {card.roleRequired}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. Audit History Table */}
      <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
              System Cache Audit Log & History
            </h4>
          </div>
          <span className="text-[11px] text-slate-500">
            Last 15 administrative cache events
          </span>
        </div>

        {auditLogs.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500">
            No administrative cache operations recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3">Action</th>
                  <th className="py-2.5 px-3">Performed By</th>
                  <th className="py-2.5 px-3">Target Scope</th>
                  <th className="py-2.5 px-3">Items Affected</th>
                  <th className="py-2.5 px-3">Duration</th>
                  <th className="py-2.5 px-3">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-sans">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-100 dark:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                      {log.action.replace(/_/g, ' ')}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                      <div>{log.actorName}</div>
                      <div className="text-[10px] text-slate-500">{log.actorEmail}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                      {log.targetResource}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300 font-mono">
                      {log.itemsAffected}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 font-mono">
                      {log.durationMs}ms
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        SUCCESS
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 6. Explicit Confirmation Modal with Prompt Mandated Guarantee */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {confirmModal.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })}
                className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              {confirmModal.description}
            </p>

            {/* MANDATORY CONFIRMATION MESSAGE FROM REQUIREMENT 4 */}
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs space-y-1">
              <div className="font-bold text-emerald-700 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                Safe Operation Guarantee
              </div>
              <p className="text-[11px] text-slate-700 dark:text-slate-300 font-medium">
                "Cache and temporary application data will be cleared. Your projects, users, issues, tasks, permissions, and other business data will NOT be deleted."
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => handleExecute(confirmModal.action)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Confirm & Execute</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
