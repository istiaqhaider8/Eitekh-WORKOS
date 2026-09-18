'use client';

import React, { useState, useEffect } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Server,
  Database,
  Cpu,
  Zap,
  Clock,
  ShieldCheck,
  Search,
  Filter,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';

export function PlatformHealthView() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const loadHealth = async () => {
    try {
      const res = await fetch('/api/super-admin/health');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        showError('Failed to fetch platform health metrics');
      }
    } catch (e: any) {
      showError(e.message || 'Error checking platform health');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadHealth();
    const interval = setInterval(loadHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleManualProbe = () => {
    setRefreshing(true);
    loadHealth().then(() => showSuccess('Subsystem health probe completed'));
  };

  if (loading && !data) {
    return (
      <div className="py-20 text-center">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-2" />
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Probing 16 Platform Subsystems...</p>
      </div>
    );
  }

  const subsystems: any[] = data?.subsystems || [];
  const hostStats = data?.hostStats || {};

  const filteredSubsystems = subsystems.filter((s) => {
    if (categoryFilter !== 'ALL' && s.category !== categoryFilter) return false;
    if (search.trim() && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const categories = ['ALL', ...Array.from(new Set(subsystems.map((s) => s.category)))];

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Server className="w-5 h-5 text-indigo-600" />
            Platform Subsystem Health Center
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Real-time latency, availability, error telemetry, and diagnostic probes across all 16 core engines.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800/80 rounded-lg border border-slate-300 dark:border-slate-700 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-slate-700 dark:text-slate-300 font-medium">Status: {data?.overallStatus || 'Operational'}</span>
          </div>
          <button
            onClick={handleManualProbe}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Run Deep Probe</span>
          </button>
        </div>
      </div>

      {/* Host Diagnostics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl space-y-1">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Host Platform</span>
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{hostStats.platform} ({hostStats.arch})</div>
          <p className="text-[10px] text-slate-500">Node.js Next.js Runtime</p>
        </div>
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl space-y-1">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Host Memory</span>
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {hostStats.freeMemoryMb} MB free / {hostStats.totalMemoryMb} MB
          </div>
          <p className="text-[10px] text-slate-500">Physical Host Memory</p>
        </div>
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl space-y-1">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Host CPU Cores</span>
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{hostStats.cpuCount} Cores</div>
          <p className="text-[10px] text-slate-500">Hardware threading</p>
        </div>
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl space-y-1">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">System Uptime</span>
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {Math.floor((hostStats.uptimeSeconds || 0) / 3600)}h {Math.floor(((hostStats.uptimeSeconds || 0) % 3600) / 60)}m
          </div>
          <p className="text-[10px] text-slate-500">Continuous operation</p>
        </div>
      </div>

      {/* Filter & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200 dark:border-slate-800/80">
        <div className="flex items-center gap-2 w-full sm:w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300">
          <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <input
            type="text"
            placeholder="Search subsystems..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none w-full text-slate-800 dark:text-slate-200 placeholder-slate-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors shrink-0 ${
                categoryFilter === cat
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:bg-slate-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* 16 Subsystems Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
        {filteredSubsystems.map((sub) => {
          const isOperational = sub.status === 'Operational';
          const isDegraded = sub.status === 'Degraded';
          const isWarning = sub.status === 'Warning';
          const isCritical = sub.status === 'Critical';

          return (
            <div
              key={sub.id}
              className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:border-slate-700 rounded-xl p-4 flex flex-col justify-between space-y-3 transition-all duration-200 shadow-sm"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wider block">
                      {sub.category}
                    </span>
                    <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">{sub.name}</h3>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${
                      isOperational
                        ? 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20'
                        : isDegraded
                        ? 'bg-amber-500/10 text-amber-700 border border-amber-500/20'
                        : isWarning
                        ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                        : 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isOperational ? 'bg-emerald-400' : isDegraded ? 'bg-amber-400' : isWarning ? 'bg-orange-400' : 'bg-rose-400'
                      }`}
                    ></span>
                    {sub.status}
                  </span>
                </div>

                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">{sub.details}</p>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80 grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <span className="text-slate-500 block">Response Time</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{sub.responseTimeMs} ms</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Availability</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{sub.availabilityPct}%</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Throughput</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{sub.requestsPerMin} req/min</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Error Rate</span>
                  <span className={`font-semibold ${sub.errorRatePct > 0 ? 'text-amber-700' : 'text-slate-800 dark:text-slate-200'}`}>
                    {sub.errorRatePct.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}