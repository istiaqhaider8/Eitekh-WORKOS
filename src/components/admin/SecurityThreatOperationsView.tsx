'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Search,
  Filter,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  Lock,
  Unlock,
  Activity,
  FileText,
  User,
  Building2,
  FolderGit2,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';

export function SecurityThreatOperationsView() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selectedThreat, setSelectedThreat] = useState<any | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');

  const loadThreats = useCallback(async () => {
    try {
      const res = await fetch(`/api/super-admin/security-threats?status=${statusFilter}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        showError('Failed to load security threats');
      }
    } catch (e: any) {
      showError(e.message || 'Error connecting to threat operations');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadThreats();
    const interval = setInterval(loadThreats, 30000);
    return () => clearInterval(interval);
  }, [loadThreats]);

  const handleUpdateStatus = async (threatId: string, newStatus: string) => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/super-admin/security-threats', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threatId, status: newStatus, note: resolutionNote.trim() }),
      });
      const json = await res.json();
      if (res.ok) {
        showSuccess(`Threat status updated to ${newStatus}`);
        setResolutionNote('');
        setSelectedThreat(null);
        loadThreats();
      } else {
        showError(json.error || 'Failed to update threat status');
      }
    } catch (e: any) {
      showError(e.message || 'Error updating threat');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="py-20 text-center">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-2" />
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Loading Threat Operations Center...</p>
      </div>
    );
  }

  const scoreCard = data?.scoreCard || {
    score: 100,
    status: 'SECURE',
    currentRiskLevel: 'MINIMAL',
    openThreats: 0,
    criticalIssues: 0,
    highIssues: 0,
    resolvedToday: 0,
  };
  const threats = data?.threats || [];
  const isolationViolations = data?.isolationViolations || [];

  const filteredThreats = threats.filter((t: any) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.description.toLowerCase().includes(q) ||
      t.resource.toLowerCase().includes(q) ||
      t.eventType.toLowerCase().includes(q) ||
      (t.userEmail && t.userEmail.toLowerCase().includes(q))
    );
  });

  const isSecure = scoreCard.status === 'SECURE';
  const isAttention = scoreCard.status === 'ATTENTION_REQUIRED';
  const isHighRisk = scoreCard.status === 'HIGH_RISK';
  const isCritical = scoreCard.status === 'CRITICAL';

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-rose-600" />
            Platform Security & Threat Operations Center
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Continuous event-driven threat detection, real-time risk scoring, cross-project isolation monitoring, and incident lifecycle queue.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadThreats}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Rescan Threats</span>
          </button>
        </div>
      </div>

      {/* Platform Security Score Card */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/80 pb-4">
          <div className="flex items-center gap-4">
            <div
              className={`w-16 h-16 rounded-2xl flex items-center justify-center font-extrabold text-2xl border shadow-inner ${
                isSecure
                  ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
                  : isAttention
                  ? 'bg-amber-500/10 text-amber-700 border-amber-500/30'
                  : isHighRisk
                  ? 'bg-orange-500/10 text-orange-400 border-orange-500/30'
                  : 'bg-rose-500/10 text-rose-600 border-rose-500/30'
              }`}
            >
              {scoreCard.score}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Platform Security Score</h3>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider border ${
                    isSecure
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : isAttention
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      : isHighRisk
                      ? 'bg-orange-500/20 text-orange-300 border-orange-500/30'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                  }`}
                >
                  {scoreCard.status.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Current Risk Level: <span className="font-semibold text-slate-800 dark:text-slate-200">{scoreCard.currentRiskLevel}</span> (Evaluated from live PBAC, MFA, and audit conditions)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6 text-xs">
            <div>
              <span className="text-slate-500 block text-[11px]">Open Threats</span>
              <span className="text-base font-bold text-slate-900 dark:text-slate-100">{scoreCard.openThreats}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Critical Issues</span>
              <span className="text-base font-bold text-rose-600">{scoreCard.criticalIssues}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">High Issues</span>
              <span className="text-base font-bold text-amber-700">{scoreCard.highIssues}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Resolved Today</span>
              <span className="text-base font-bold text-emerald-700">{scoreCard.resolvedToday}</span>
            </div>
          </div>
        </div>

        {/* Secondary Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
          <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 text-[10px] uppercase font-semibold">MFA Adoption</span>
            <div className="font-bold text-slate-800 dark:text-slate-200">{scoreCard.mfaAdoptionPct}%</div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 text-[10px] uppercase font-semibold">Active Sessions</span>
            <div className="font-bold text-indigo-600">{scoreCard.activeSessions}</div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 text-[10px] uppercase font-semibold">Suspended Users</span>
            <div className="font-bold text-rose-600">{scoreCard.suspendedUsers}</div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 text-[10px] uppercase font-semibold">PBAC Violations (24h)</span>
            <div className="font-bold text-emerald-700">{scoreCard.pbacViolations24h}</div>
          </div>
        </div>
      </div>

      {/* Cross-Project Isolation Monitor */}
      {isolationViolations.length > 0 && (
        <div className="bg-rose-950/20 border border-rose-500/30 rounded-xl p-4 space-y-3 shadow-md">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-rose-300">
              Cross-Project Isolation Intrusion Stream (Strict PBAC Enforced)
            </h3>
          </div>
          <div className="space-y-2">
            {isolationViolations.map((v: any) => (
              <div key={v.id} className="p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-rose-500/20 flex items-center justify-between text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-rose-500/20 text-rose-300 rounded font-bold text-[10px] uppercase">
                      BLOCKED & PREVENTED
                    </span>
                    <span className="text-slate-800 dark:text-slate-200 font-semibold">{v.userEmail}</span>
                    <span className="text-slate-600 dark:text-slate-400">attempted unauthorized {v.actionType}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono">
                    Attempted Project: <span className="text-indigo-300">{v.attemptedProjectId}</span> | IP: {v.ipAddress || '127.0.0.1'}
                  </p>
                </div>
                <span className="text-[10px] text-slate-500 font-mono">{new Date(v.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Threat Operations Queue */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700" />
            Active Threats & Security Incidents ({filteredThreats.length})
          </h3>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1 text-xs">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Filter threats..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent border-none outline-none text-slate-800 dark:text-slate-200 placeholder-slate-500 w-36"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-700 dark:text-slate-300 outline-none"
            >
              <option value="ALL">All Statuses</option>
              <option value="OPEN">Open</option>
              <option value="INVESTIGATING">Investigating</option>
              <option value="MITIGATED">Mitigated</option>
              <option value="RESOLVED">Resolved</option>
              <option value="FALSE_POSITIVE">False Positive</option>
            </select>
          </div>
        </div>

        {filteredThreats.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-950 rounded-xl">
            No active security threats in queue matching criteria.
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredThreats.map((t: any) => {
              const isCrit = t.severity === 'CRITICAL';
              const isHigh = t.severity === 'HIGH';
              const isMed = t.severity === 'MEDIUM';

              return (
                <div
                  key={t.id}
                  className={`p-4 rounded-xl border transition-all duration-150 flex flex-col justify-between space-y-3 ${
                    isCrit
                      ? 'bg-rose-950/20 border-rose-500/30'
                      : isHigh
                      ? 'bg-amber-950/20 border-amber-500/30'
                      : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded border ${
                            isCrit
                              ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                              : isHigh
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                              : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                          }`}
                        >
                          {t.severity}
                        </span>
                        <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-[10px] font-bold">
                          {t.status}
                        </span>
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{t.eventType}</span>
                      </div>
                      <p className="text-xs text-slate-700 dark:text-slate-300">{t.description}</p>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 space-x-2">
                        <span>Resource: <span className="text-indigo-300 font-mono">{t.resource}</span></span>
                        <span>•</span>
                        <span>Rule: <span className="text-slate-700 dark:text-slate-300">{t.detectionRule}</span></span>
                      </div>
                    </div>

                    <div className="text-right space-y-2 shrink-0">
                      <span className="text-[10px] text-slate-500 font-mono block">
                        {new Date(t.detectedAt).toLocaleString()}
                      </span>
                      <button
                        onClick={() => setSelectedThreat(t)}
                        className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-semibold shadow-xs"
                      >
                        Inspect Incident
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Incident Detail Drawer Modal */}
      {selectedThreat && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-2xl w-full p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-rose-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Incident Detail: {selectedThreat.id}
                </h3>
              </div>
              <button onClick={() => setSelectedThreat(null)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">
                Close
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                <div>
                  <span className="text-slate-500 block">Severity</span>
                  <span className="font-bold text-rose-600">{selectedThreat.severity}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Status</span>
                  <span className="font-bold text-indigo-600">{selectedThreat.status}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Target Resource</span>
                  <span className="text-slate-800 dark:text-slate-200 font-mono">{selectedThreat.resource}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Detection Time</span>
                  <span className="text-slate-700 dark:text-slate-300">{new Date(selectedThreat.detectedAt).toLocaleString()}</span>
                </div>
              </div>

              <div>
                <span className="text-slate-600 dark:text-slate-400 block font-semibold mb-1">Recommended Action</span>
                <p className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300 leading-relaxed">
                  {selectedThreat.recommendedAction}
                </p>
              </div>

              {/* Timeline */}
              <div>
                <span className="text-slate-600 dark:text-slate-400 block font-semibold mb-1">Incident Timeline</span>
                <div className="space-y-1.5 p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg max-h-36 overflow-y-auto">
                  {selectedThreat.timeline.map((item: any, idx: number) => (
                    <div key={idx} className="flex items-start gap-2 text-[11px]">
                      <Clock className="w-3.5 h-3.5 text-indigo-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="text-slate-600 dark:text-slate-400 font-mono text-[10px]">
                          [{new Date(item.timestamp).toLocaleTimeString()}]
                        </span>{' '}
                        <span className="text-slate-700 dark:text-slate-300">{item.note}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Status Update Form */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <span className="text-slate-600 dark:text-slate-400 block font-semibold">Update Incident State</span>
                <input
                  type="text"
                  placeholder="Optional resolution or investigation note..."
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => handleUpdateStatus(selectedThreat.id, 'INVESTIGATING')}
                    disabled={actionLoading}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded font-semibold text-[11px]"
                  >
                    Set Investigating
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(selectedThreat.id, 'MITIGATED')}
                    disabled={actionLoading}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-semibold text-[11px]"
                  >
                    Set Mitigated
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(selectedThreat.id, 'RESOLVED')}
                    disabled={actionLoading}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold text-[11px]"
                  >
                    Mark Resolved
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(selectedThreat.id, 'FALSE_POSITIVE')}
                    disabled={actionLoading}
                    className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded font-semibold text-[11px]"
                  >
                    False Positive
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}