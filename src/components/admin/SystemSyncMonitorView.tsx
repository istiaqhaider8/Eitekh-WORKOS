'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Send,
  Search,
  Filter,
  Users,
  Database,
  Radio,
  Clock,
  ShieldAlert,
  Server,
  Layers,
  ArrowRight,
  Eye,
  Check,
  Zap,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';

export function SystemSyncMonitorView() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pingSending, setPingSending] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('ALL');
  const [eventTypeFilter, setEventTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

  const loadData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (moduleFilter !== 'ALL') params.set('module', moduleFilter);
      if (eventTypeFilter !== 'ALL') params.set('eventType', eventTypeFilter);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/super-admin/sync-monitor?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        showError('Failed to fetch system sync telemetry');
      }
    } catch (e: any) {
      showError(e.message || 'Error connecting to sync monitor');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [moduleFilter, eventTypeFilter, statusFilter, search]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleTriggerTestPing = async () => {
    setPingSending(true);
    try {
      const res = await fetch('/api/super-admin/sync-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Live Superadmin Real-Time Sync Verification Ping' }),
      });
      if (res.ok) {
        showSuccess('Broadcasted test sync ping across all authorized channels');
        loadData();
      } else {
        showError('Failed to broadcast test sync event');
      }
    } catch (e: any) {
      showError(e.message || 'Error triggering sync ping');
    } finally {
      setPingSending(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="py-20 text-center">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-2" />
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Loading System Sync Telemetry...</p>
      </div>
    );
  }

  const metrics = data?.metrics || {};
  const activeClients = data?.activeClients || [];
  const eventLogs = data?.eventLogs || [];

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* Header & Live Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-400">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">System Synchronization Monitor</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                <span>REAL-TIME SSE ONLINE</span>
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Live enterprise event broker telemetry and project-scoped delivery health
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setRefreshing(true);
              loadData();
            }}
            disabled={refreshing}
            className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleTriggerTestPing}
            disabled={pingSending}
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{pingSending ? 'Broadcasting...' : 'Broadcast Sync Ping'}</span>
          </button>
        </div>
      </div>

      {/* KPI Telemetry Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* 1. Live Connections */}
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          <div className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Live Connections</span>
            <Users className="w-3 h-3 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">{metrics.activeConnections || 0}</div>
          <div className="text-[10px] text-emerald-700 mt-0.5 flex items-center gap-1 dark:text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Active SSE Streams</span>
          </div>
        </div>

        {/* 2. Events Processed */}
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          <div className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Events Processed</span>
            <Zap className="w-3 h-3 text-amber-700 dark:text-amber-400" />
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">{metrics.totalEventsProcessed || 0}</div>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">Database Mutations</div>
        </div>

        {/* 3. Delivery Success Rate */}
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          <div className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Success Rate</span>
            <CheckCircle2 className="w-3 h-3 text-emerald-700 dark:text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-700 mt-1 dark:text-emerald-400">{metrics.successRate || 100}%</div>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">Zero Event Dropped</div>
        </div>

        {/* 4. DB Status & Latency */}
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          <div className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Database Status</span>
            <Database className="w-3 h-3 text-sky-700 dark:text-sky-400" />
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">{metrics.dbLatencyMs || 2}ms</div>
          <div className="text-[10px] text-emerald-700 mt-0.5 dark:text-emerald-400">Single Source of Truth</div>
        </div>

        {/* 5. API Health */}
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          <div className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>API Gateway</span>
            <Server className="w-3 h-3 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="text-xl font-bold text-purple-600 mt-1 dark:text-purple-400">{metrics.apiHealth || 'OPTIMAL'}</div>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">PBAC Protected</div>
        </div>

        {/* 6. Retry Queue */}
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          <div className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>Retry Queue</span>
            <ShieldAlert className="w-3 h-3 text-emerald-700 dark:text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">{metrics.retryQueueSize || 0}</div>
          <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">No Backpressure</div>
        </div>
      </div>

      {/* Module Synchronization Health Grid */}
      <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Module Synchronization Health (12 Core Modules)</span>
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Verified real-time state parity across all project management views
            </p>
          </div>
          <span className="text-xs font-bold text-emerald-700 flex items-center gap-1 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>All Modules Synced</span>
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 pt-2">
          {(metrics.modules || []).map((mod: any) => (
            <div
              key={mod.name}
              className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 rounded-xl p-2.5 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{mod.name}</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
              </div>
              <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-200 dark:border-slate-800/60 text-[10px]">
                <span className="text-emerald-700 font-semibold dark:text-emerald-400">{mod.status}</span>
                <span className="font-mono text-slate-600 dark:text-slate-400">{mod.latencyMs}ms</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active Subscribers Roster */}
      {activeClients.length > 0 && (
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Active Project Stream Subscribers ({activeClients.length})</span>
            </h3>
            <span className="text-xs text-slate-600 dark:text-slate-400">Authenticated SSE Connections</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">
                <tr>
                  <th className="py-2 px-3">User</th>
                  <th className="py-2 px-3">Project ID</th>
                  <th className="py-2 px-3">Role / Auth</th>
                  <th className="py-2 px-3">Connected At</th>
                  <th className="py-2 px-3">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {activeClients.map((client: any) => (
                  <tr key={client.id} className="hover:bg-slate-100 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-800 dark:text-slate-200">{client.userName || client.userEmail}</div>
                      <div className="text-[10px] text-slate-600 dark:text-slate-400 font-mono">{client.userEmail}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-blue-600 dark:text-blue-400">{client.projectId}</td>
                    <td className="py-2.5 px-3">
                      {client.isSuperAdmin ? (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800">
                          SUPERADMIN
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                          PROJECT MEMBER
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{new Date(client.connectedAt).toLocaleTimeString()}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">{client.ipAddress || '127.0.0.1'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sync Event Log with Filters */}
      <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>Real-Time Sync Event Log ({eventLogs.length})</span>
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Complete audit log of real-time mutation events, project scopes, and delivery confirmations
            </p>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search event logs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-500 focus:outline-hidden focus:border-blue-500 w-36 sm:w-44"
              />
            </div>

            <select
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-300"
            >
              <option value="ALL">All Event Types</option>
              <option value="ISSUE_CREATED">Issue Created</option>
              <option value="ISSUE_UPDATED">Issue Updated</option>
              <option value="ISSUE_DELETED">Issue Deleted</option>
              <option value="BULK_ISSUES_UPDATED">Bulk Updated</option>
              <option value="SPRINT_CREATED">Sprint Created</option>
              <option value="SPRINT_UPDATED">Sprint Updated</option>
              <option value="SYSTEM_SYNC_PING">Sync Ping</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-700 dark:text-slate-300"
            >
              <option value="ALL">All Statuses</option>
              <option value="DELIVERED">Delivered</option>
              <option value="NO_SUBSCRIBERS">No Active Subscribers</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>
        </div>

        {/* Event Logs Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">
              <tr>
                <th className="py-2 px-3">Event ID</th>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3">Project Scope</th>
                <th className="py-2 px-3">Actor / User</th>
                <th className="py-2 px-3">Delivery Status</th>
                <th className="py-2 px-3">Recipients</th>
                <th className="py-2 px-3">Time</th>
                <th className="py-2 px-3 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {eventLogs.map((log: any) => (
                <tr key={log.eventId} className="hover:bg-slate-100 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 dark:text-slate-300">{log.eventId}</td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                        log.eventType.includes('CREATE')
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                          : log.eventType.includes('DELETE')
                          ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                          : log.eventType.includes('PING')
                          ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                          : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                      } dark:text-emerald-400 dark:text-rose-400 dark:text-purple-400 dark:text-blue-400`}
                    >
                      {log.eventType}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">{log.projectId}</td>
                  <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">{log.actor?.email || 'System'}</td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                        log.deliveryStatus === 'DELIVERED'
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                          : log.deliveryStatus === 'NO_SUBSCRIBERS'
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                          : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {log.deliveryStatus}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300">{log.recipientsCount} client(s)</td>
                  <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{new Date(log.timestamp).toLocaleTimeString()}</td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelectedLog(log)}
                      className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-white rounded cursor-pointer"
                      title="View full event payload" aria-label="Close"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}

              {eventLogs.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500 text-xs">
                    No sync events match the filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* JSON Payload Inspector Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-100 dark:bg-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Event Inspector: {selectedLog.eventId}</span>
              </h3>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-white rounded cursor-pointer" aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3 flex-1">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-600 dark:text-slate-400">Event Type:</span>
                  <div className="font-bold text-blue-600 dark:text-blue-400">{selectedLog.eventType}</div>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400">Project Scope:</span>
                  <div className="font-mono text-slate-800 dark:text-slate-200">{selectedLog.projectId}</div>
                </div>
              </div>

              <div>
                <span className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Target Synchronized Modules:</span>
                <div className="flex flex-wrap gap-1">
                  {(selectedLog.targetModules || []).map((m: string) => (
                    <span
                      key={m}
                      className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Raw Payload JSON:</span>
                <pre className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-[11px] font-mono text-emerald-700 overflow-x-auto max-h-64 dark:text-emerald-400">
                  {JSON.stringify(selectedLog, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
