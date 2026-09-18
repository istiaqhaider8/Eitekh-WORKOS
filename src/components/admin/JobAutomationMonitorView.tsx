'use client';

import React, { useState, useEffect } from 'react';
import {
  Clock,
  Zap,
  Mail,
  Webhook,
  RefreshCw,
  Play,
  CheckCircle2,
  AlertTriangle,
  Send,
  Calendar,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';

export function JobAutomationMonitorView() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const res = await fetch('/api/super-admin/jobs');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        showError('Failed to load job monitor data');
      }
    } catch (e: any) {
      showError(e.message || 'Error connecting to job monitor');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleTriggerTask = async (taskId: string) => {
    setTriggeringId(taskId);
    try {
      const res = await fetch('/api/super-admin/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'TRIGGER_RECURRING_TASK', taskId }),
      });
      const json = await res.json();
      if (res.ok) {
        showSuccess(json.message || 'Task triggered successfully');
        loadData();
      } else {
        showError(json.error || 'Failed to trigger task');
      }
    } catch (e: any) {
      showError(e.message || 'Error triggering recurring task');
    } finally {
      setTriggeringId(null);
    }
  };

  const handleRetryEmail = async (emailLogId: string) => {
    try {
      const res = await fetch('/api/super-admin/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'RETRY_EMAIL', emailLogId }),
      });
      const json = await res.json();
      if (res.ok) {
        showSuccess(json.message || 'Email re-dispatched');
        loadData();
      } else {
        showError(json.error || 'Failed to retry email');
      }
    } catch (e: any) {
      showError(e.message || 'Error retrying email');
    }
  };

  if (loading && !data) {
    return (
      <div className="py-20 text-center">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-2" />
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Loading Job & Automation Monitor...</p>
      </div>
    );
  }

  const summary = data?.jobSummary || {};
  const recurringTasks = data?.recurringTasks || [];
  const automationRules = data?.automationRules || [];
  const emailLogs = data?.emailLogs || [];
  const webhooks = data?.webhooks || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-600" />
            Background Job, Schedulers & Automation Monitor
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Monitor recurring tasks, trigger cron jobs manually, manage automation rule listeners, and retry failed dispatches.
          </p>
        </div>

        <button
          onClick={loadData}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-medium border border-slate-300 dark:border-slate-700"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Queues</span>
        </button>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl space-y-1">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase">Recurring Tasks</span>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{summary.activeRecurringTasks} / {summary.totalRecurringTasks}</div>
          <p className="text-[10px] text-slate-500">Active schedulers</p>
        </div>
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl space-y-1">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase">Automation Rules</span>
          <div className="text-lg font-bold text-indigo-600">{summary.activeAutomationRules} / {summary.totalAutomationRules}</div>
          <p className="text-[10px] text-slate-500">Active trigger listeners</p>
        </div>
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl space-y-1">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase">Webhooks Configured</span>
          <div className="text-lg font-bold text-purple-600">{summary.activeWebhooks} / {summary.totalWebhooks}</div>
          <p className="text-[10px] text-slate-500">Outbound dispatchers</p>
        </div>
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl space-y-1">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase">Email Deliveries</span>
          <div className="text-lg font-bold text-emerald-700">{summary.deliveredEmailDispatches}</div>
          <p className="text-[10px] text-slate-500">{summary.failedEmailDispatches} failures logged</p>
        </div>
      </div>

      {/* Recurring Tasks Grid */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-indigo-600" />
          Recurring Tasks & Schedulers ({recurringTasks.length})
        </h3>

        {recurringTasks.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-950 rounded-xl">
            No recurring tasks configured across projects.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {recurringTasks.map((t: any) => (
              <div key={t.id} className="bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 flex flex-col justify-between">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-indigo-600 uppercase">{t.project?.key || 'PROJECT'}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}>
                      {t.isActive ? 'ACTIVE' : 'PAUSED'}
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">{t.project?.name}</h4>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 font-mono">Cron: {t.scheduleCron}</div>
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">
                    Last Run: {t.lastRunAt ? new Date(t.lastRunAt).toLocaleDateString() : 'Never'}
                  </span>
                  <button
                    onClick={() => handleTriggerTask(t.id)}
                    disabled={triggeringId === t.id}
                    className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-semibold disabled:opacity-50"
                  >
                    <Play className="w-3 h-3" />
                    <span>{triggeringId === t.id ? 'Running...' : 'Run Now'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Email Queue & Dispatch Failures */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <Mail className="w-4 h-4 text-indigo-600" />
          Email Dispatch Logs & Retry Queue ({emailLogs.length})
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-950 text-[10px] uppercase font-bold text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-3">To Recipient</th>
                <th className="p-3">Subject</th>
                <th className="p-3">Template</th>
                <th className="p-3">Status</th>
                <th className="p-3">Timestamp</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {emailLogs.map((e: any) => (
                <tr key={e.id} className="hover:bg-slate-100 dark:bg-slate-800/40">
                  <td className="p-3 font-medium text-slate-800 dark:text-slate-200">{e.to}</td>
                  <td className="p-3 text-slate-700 dark:text-slate-300">{e.subject}</td>
                  <td className="p-3 font-mono text-[10px] text-indigo-700">{e.templateKey || 'CUSTOM'}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        e.status === 'SENT' || e.status === 'MOCKED'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {e.status}
                    </span>
                  </td>
                  <td className="p-3 text-slate-600 dark:text-slate-400">{new Date(e.createdAt).toLocaleTimeString()}</td>
                  <td className="p-3 text-right">
                    {e.status === 'FAILED' && (
                      <button
                        onClick={() => handleRetryEmail(e.id)}
                        className="px-2 py-0.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded text-[10px] font-semibold"
                      >
                        Retry
                      </button>
                    )}
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