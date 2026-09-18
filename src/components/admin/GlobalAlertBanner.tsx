'use client';

import React from 'react';
import { AlertTriangle, ShieldAlert, AlertCircle, Users, CheckCircle2, ArrowRight } from 'lucide-react';

interface AlertItem {
  id: string;
  type: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  description: string;
  targetTab: string;
}

interface GlobalAlertBannerProps {
  alerts: AlertItem[];
  onNavigateTab: (tab: string) => void;
}

export function GlobalAlertBanner({ alerts, onNavigateTab }: GlobalAlertBannerProps) {
  if (!alerts || alerts.length === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 flex items-center justify-between text-xs dark:bg-emerald-950/40 dark:border-emerald-800">
        <div className="flex items-center gap-2.5 text-emerald-700 font-medium dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 dark:text-emerald-400" />
          <span>All platform subsystems operational. No critical security, synchronization, or background job alerts detected.</span>
        </div>
        <span className="text-[11px] text-emerald-500/80 font-mono">100% OPERATIONAL</span>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
          </span>
          <h3 className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            Action Required ({alerts.length})
          </h3>
        </div>
        <span className="text-[11px] text-slate-600 dark:text-slate-400">Immediate attention recommended</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {alerts.map((alert) => {
          const isCritical = alert.severity === 'CRITICAL';
          return (
            <div
              key={alert.id}
              onClick={() => onNavigateTab(alert.targetTab)}
              className={`cursor-pointer p-3 rounded-lg border transition-all duration-200 flex flex-col justify-between hover:scale-[1.01] ${
                isCritical
                  ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 hover:border-rose-200 dark:hover:border-rose-800'
                  : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 hover:border-amber-200 dark:hover:border-amber-800'
              } dark:border-rose-800 dark:border-amber-800`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  {isCritical ? (
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-600 shrink-0 dark:text-rose-400" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 dark:text-amber-400" />
                  )}
                  <span
                    className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                      isCritical ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300' : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {alert.severity}
                  </span>
                </div>
                <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200 line-clamp-1">{alert.title}</h4>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">{alert.description}</p>
              </div>

              <div className="pt-2 flex items-center justify-between text-[11px] font-medium text-blue-600 group-hover:text-blue-700 dark:hover:text-blue-400 dark:group-hover:text-blue-400">
                <span>Resolve in {alert.targetTab.toUpperCase()}</span>
                <ArrowRight className="w-3 h-3" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}