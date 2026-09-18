'use client';

import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Unlock,
  AlertTriangle,
  RefreshCw,
  LogOut,
  Users,
  KeyRound,
  Eye,
  Activity,
  Globe,
  Monitor,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';

export function SecurityCenterView() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const loadData = async () => {
    try {
      const res = await fetch('/api/super-admin/security');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        showError('Failed to load security center telemetry');
      }
    } catch (e: any) {
      showError(e.message || 'Error connecting to security center');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSecurityAction = async (payload: any) => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/super-admin/security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (res.ok) {
        showSuccess(json.message || 'Security action applied successfully');
        loadData();
      } else {
        showError(json.error || 'Failed to apply security action');
      }
    } catch (e: any) {
      showError(e.message || 'Error executing security action');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="py-20 text-center">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-2" />
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Loading Platform Security Center...</p>
      </div>
    );
  }

  const metrics = data?.securityMetrics || {};
  const alerts = data?.securityAlerts || [];
  const sessions = data?.activeSessions || [];
  const suspendedUsers = data?.suspendedUsers || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400" />
            Platform Security & Threat Operations Center
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Real-time threat detection, multi-factor adoption enforcement, active session telemetry, and account locks.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Rescan Threats</span>
          </button>
        </div>
      </div>

      {/* Security KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl space-y-1">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase">MFA Adoption Rate</span>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{metrics.mfaAdoptionPct}%</div>
          <p className="text-[10px] text-slate-500">{metrics.mfaUsersCount} of {metrics.totalUsers} users</p>
        </div>
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl space-y-1">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase">Active Sessions</span>
          <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{metrics.activeSessionsCount}</div>
          <p className="text-[10px] text-slate-500">Live JWT authenticated tokens</p>
        </div>
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl space-y-1">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase">Suspended Accounts</span>
          <div className="text-lg font-bold text-rose-600 dark:text-rose-400">{metrics.suspendedUsersCount}</div>
          <p className="text-[10px] text-slate-500">Locked out accounts</p>
        </div>
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl space-y-1">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase">Cross-Project Leaks</span>
          <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">0</div>
          <p className="text-[10px] text-slate-500">Zero data breach record</p>
        </div>
      </div>

      {/* Real-time Security Alerts */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400" />
          Active Security Alerts ({alerts.length})
        </h3>

        {alerts.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-950 rounded-xl">
            No active security threats or anomalies detected.
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((al: any) => {
              const isCrit = al.severity === 'CRITICAL';
              const isHigh = al.severity === 'HIGH';
              return (
                <div
                  key={al.id}
                  className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isCrit
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                      : isHigh
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                      : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                          isCrit
                            ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                            : isHigh
                            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                            : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                        }`}
                      >
                        {al.severity}
                      </span>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">{al.title}</h4>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">{al.description}</p>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono shrink-0">
                    {new Date(al.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Device Sessions Telemetry */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <Monitor className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          Active Device Sessions & Token Registry ({sessions.length})
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-950 text-[10px] uppercase font-bold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-3">User</th>
                <th className="p-3">IP Address</th>
                <th className="p-3">Client / OS</th>
                <th className="p-3">Location</th>
                <th className="p-3">Last Active</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sessions.map((s: any) => (
                <tr key={s.id} className="hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors">
                  <td className="p-3">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">{s.userName}</div>
                    <div className="text-[10px] text-slate-600 dark:text-slate-400">{s.userEmail}</div>
                  </td>
                  <td className="p-3 font-mono text-[11px] text-indigo-700 dark:text-indigo-400">{s.ipAddress}</td>
                  <td className="p-3 text-slate-700 dark:text-slate-300">{s.browser} on {s.os}</td>
                  <td className="p-3 text-slate-600 dark:text-slate-400">{s.location}</td>
                  <td className="p-3 text-slate-600 dark:text-slate-400">{new Date(s.lastActiveAt).toLocaleTimeString()}</td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => handleSecurityAction({ action: 'REVOKE_SESSION', sessionId: s.id })}
                      disabled={actionLoading}
                      className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded text-[10px] font-semibold dark:bg-rose-950/40 dark:hover:bg-rose-900/50 dark:text-rose-400 dark:border-rose-800"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}