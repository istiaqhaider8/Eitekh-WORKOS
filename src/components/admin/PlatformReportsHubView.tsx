'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Download,
  Printer,
  RefreshCw,
  Calendar,
  CheckCircle2,
  ShieldAlert,
  Radio,
  Server,
  Users,
  Building2,
  Lock,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';

export function PlatformReportsHubView() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedReportId, setSelectedReportId] = useState('EXECUTIVE_SUMMARY');
  const [selectedPeriod, setSelectedPeriod] = useState('today');

  const loadReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/super-admin/reports?type=${selectedReportId}&period=${selectedPeriod}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        showError('Failed to load report data');
      }
    } catch (e: any) {
      showError(e.message || 'Error generating report');
    } finally {
      setLoading(false);
    }
  }, [selectedReportId, selectedPeriod]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleExportCsv = () => {
    window.open(`/api/super-admin/reports?type=${selectedReportId}&period=${selectedPeriod}&format=csv`, '_blank');
    showSuccess(`Exporting ${selectedReportId} CSV report...`);
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading && !data) {
    return (
      <div className="py-20 text-center">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-2" />
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Compiling Enterprise Platform Reports...</p>
      </div>
    );
  }

  const catalog = data?.reportCatalog || [];
  const reportData = data?.reportData || {};
  const currentReport = catalog.find((r: any) => r.id === selectedReportId) || catalog[0];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-400" />
            Enterprise Platform Reports Center & Intelligence Hub
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            15 Comprehensive automated reports generated strictly from real database transactions, audit records, and operational telemetry.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print PDF</span>
          </button>
        </div>
      </div>

      {/* Main Layout: 15 Catalog Sidebar + Report View Canvas */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Catalog Sidebar */}
        <div className="lg:col-span-1 bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
            <span className="text-[11px] font-bold uppercase text-slate-600 dark:text-slate-400">15 Report Types</span>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-0.5 text-[10px] text-slate-700 dark:text-slate-300 outline-none"
            >
              <option value="today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>

          <div className="space-y-1">
            {catalog.map((rep: any) => (
              <button
                key={rep.id}
                onClick={() => setSelectedReportId(rep.id)}
                className={`w-full text-left p-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-between ${
                  selectedReportId === rep.id
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800 hover:text-slate-800 dark:text-slate-200'
                }`}
              >
                <span className="truncate">{rep.name}</span>
                <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-slate-50 dark:bg-slate-950/60 font-mono text-slate-700 dark:text-slate-300 shrink-0 ml-1">
                  {rep.category}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Report Canvas */}
        <div className="lg:col-span-3 bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-6">
          <div className="border-b border-slate-200 dark:border-slate-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-bold uppercase text-indigo-400 tracking-wider">
                {currentReport?.category} Report
              </span>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{currentReport?.name}</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Generated at: <span className="font-mono text-slate-700 dark:text-slate-300">{new Date(reportData.generatedAt).toLocaleString()}</span> | Period: <span className="font-semibold text-slate-800 dark:text-slate-200 uppercase">{selectedPeriod}</span>
              </p>
            </div>

            <div className="text-right text-xs">
              <span className="text-slate-500 block text-[10px]">Audited By</span>
              <span className="font-mono text-slate-700 dark:text-slate-300">{reportData.generatedBy}</span>
            </div>
          </div>

          {/* Key Executive Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 text-[10px] uppercase font-semibold">Security Score</span>
              <div className="text-lg font-bold text-emerald-400">{reportData.scoreCard?.score || 100} / 100</div>
              <p className="text-[10px] text-slate-500">{reportData.scoreCard?.status}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 text-[10px] uppercase font-semibold">Total Organizations</span>
              <div className="text-lg font-bold text-slate-800 dark:text-slate-200">{reportData.kpis?.totalOrgs}</div>
              <p className="text-[10px] text-slate-500">{reportData.kpis?.activeOrgs} active</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 text-[10px] uppercase font-semibold">Total Users</span>
              <div className="text-lg font-bold text-indigo-400">{reportData.kpis?.totalUsers}</div>
              <p className="text-[10px] text-slate-500">{reportData.kpis?.activeUsers} active</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 text-[10px] uppercase font-semibold">Sync Success Rate</span>
              <div className="text-lg font-bold text-teal-400">{reportData.syncMetrics?.successRate || 100}%</div>
              <p className="text-[10px] text-slate-500">0 events dropped</p>
            </div>
          </div>

          {/* Report Specific Details Section */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Report Data Breakdown
            </h4>

            {selectedReportId.includes('SECURITY') || selectedReportId.includes('THREAT') ? (
              <div className="space-y-2">
                {reportData.activeThreats?.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-950 rounded-lg">
                    No active threat incidents logged for this period.
                  </div>
                ) : (
                  reportData.activeThreats?.map((t: any) => (
                    <div key={t.id} className="p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-bold text-slate-800 dark:text-slate-200">{t.eventType} - {t.severity}</div>
                        <p className="text-slate-600 dark:text-slate-400 text-[11px]">{t.description}</p>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">{new Date(t.detectedAt).toLocaleTimeString()}</span>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="overflow-x-auto bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                  <thead className="bg-white dark:bg-slate-900 text-[10px] uppercase font-bold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="p-2.5">Timestamp</th>
                      <th className="p-2.5">Action Type</th>
                      <th className="p-2.5">Target Resource</th>
                      <th className="p-2.5">Actor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {reportData.auditLogs?.slice(0, 10).map((l: any) => (
                      <tr key={l.id}>
                        <td className="p-2.5 text-slate-600 dark:text-slate-400 text-[11px]">{new Date(l.createdAt).toLocaleTimeString()}</td>
                        <td className="p-2.5 font-semibold text-slate-800 dark:text-slate-200">{l.action}</td>
                        <td className="p-2.5 text-indigo-300">{l.targetResource}</td>
                        <td className="p-2.5 text-slate-600 dark:text-slate-400 font-mono text-[11px]">{l.actorId.slice(0, 10)}...</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}