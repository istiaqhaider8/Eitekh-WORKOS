'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  History,
  Search,
  Filter,
  Shield,
  KeyRound,
  Users,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Clock,
  User,
  ArrowRight,
  X,
  FileCode,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';

interface AuditTabProps {
  orgId: string;
}

export function AuditTab({ orgId }: AuditTabProps) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        orgId,
        search,
        action: actionFilter,
        limit: '100',
      });

      const res = await fetch(`/api/pbac/audit?${query.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setLogs(json.logs || []);
      }
    } catch (e) {
      showError('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [orgId, search, actionFilter]);

  useEffect(() => {
    loadLogs();
    const handleUpdate = () => {
      loadLogs();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pbac:updated', handleUpdate);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pbac:updated', handleUpdate);
      }
    };
  }, [loadLogs]);

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="bg-white dark:bg-slate-900/80 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Immutable Access Governance & PBAC Audit Ledger ({logs.length})
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Cryptographic ledger tracking all role creations, permissions updates, user role bindings, and bulk modifications.
          </p>
        </div>

        <button
          onClick={loadLogs}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-600 dark:text-indigo-400' : ''}`} />
          <span>Refresh Ledger</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by administrator, user, role name, or action..."
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Action:</span>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="bg-transparent text-slate-700 dark:text-slate-300 font-semibold outline-none cursor-pointer"
            >
              <option value="all" className="bg-white dark:bg-slate-900">All Governance Actions</option>
              <option value="ROLE_CREATED" className="bg-white dark:bg-slate-900">ROLE_CREATED</option>
              <option value="ROLE_UPDATED" className="bg-white dark:bg-slate-900">ROLE_UPDATED</option>
              <option value="ROLE_CLONED" className="bg-white dark:bg-slate-900">ROLE_CLONED</option>
              <option value="ROLE_ACTIVATED" className="bg-white dark:bg-slate-900">ROLE_ACTIVATED</option>
              <option value="ROLE_DEACTIVATED" className="bg-white dark:bg-slate-900">ROLE_DEACTIVATED</option>
              <option value="ROLE_DELETED" className="bg-white dark:bg-slate-900">ROLE_DELETED</option>
              <option value="USER_ADDED_TO_ROLE" className="bg-white dark:bg-slate-900">USER_ADDED_TO_ROLE</option>
              <option value="USER_REMOVED_FROM_ROLE" className="bg-white dark:bg-slate-900">USER_REMOVED_FROM_ROLE</option>
              <option value="BULK_USERS_ADDED_TO_ROLE" className="bg-white dark:bg-slate-900">BULK_USERS_ADDED_TO_ROLE</option>
              <option value="USER_ROLES_UPDATED" className="bg-white dark:bg-slate-900">USER_ROLES_UPDATED</option>
            </select>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 uppercase tracking-wider text-[10px]">
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300 min-w-[140px]">Timestamp</th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300 min-w-[160px]">Administrator</th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300 min-w-[160px]">Action Type</th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300 min-w-[200px]">Entity / Target</th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300 min-w-[100px]">Status</th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500 dark:text-slate-400">
                    Loading audit ledger...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500 dark:text-slate-400">
                    No audit records found matching your filters.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors">
                    <td className="p-3 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>

                    <td className="p-3">
                      <div className="font-bold text-slate-800 dark:text-slate-200">{log.actorName}</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">{log.actorEmail}</div>
                    </td>

                    <td className="p-3">
                      <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono font-semibold rounded text-[10px] dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800">
                        {log.action}
                      </span>
                    </td>

                    <td className="p-3">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{log.entityName || log.entityId}</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Type: {log.entityType}</div>
                    </td>

                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800">
                        {log.status}
                      </span>
                    </td>

                    <td className="p-3 text-right">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 rounded text-xs font-medium border border-slate-300 dark:border-slate-700"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <History className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Audit Event Details
              </h4>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[10px]">Action</span>
                  <strong className="text-indigo-700 font-mono dark:text-indigo-400">{selectedLog.action}</strong>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[10px]">Timestamp</span>
                  <span className="text-slate-700 dark:text-slate-300 font-mono">{new Date(selectedLog.createdAt).toISOString()}</span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[10px]">Administrator</span>
                  <span className="text-slate-800 dark:text-slate-200">{selectedLog.actorName} ({selectedLog.actorEmail})</span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[10px]">Entity Target</span>
                  <span className="text-slate-800 dark:text-slate-200">{selectedLog.entityName}</span>
                </div>
              </div>

              <div>
                <span className="text-slate-600 dark:text-slate-400 font-bold block mb-1">State Payloads:</span>
                <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-700 dark:text-slate-300 max-h-60 overflow-y-auto space-y-2">
                  {selectedLog.previousState && (
                    <div>
                      <span className="text-amber-700 font-bold block dark:text-amber-400">{"// Previous State:"}</span>
                      <pre>{JSON.stringify(selectedLog.previousState, null, 2)}</pre>
                    </div>
                  )}
                  {selectedLog.newState && (
                    <div>
                      <span className="text-emerald-700 font-bold block dark:text-emerald-400">{"// New State:"}</span>
                      <pre>{JSON.stringify(selectedLog.newState, null, 2)}</pre>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-right">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
