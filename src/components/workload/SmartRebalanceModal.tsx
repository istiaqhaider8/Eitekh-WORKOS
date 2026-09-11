'use client';

import React, { useState, useMemo } from 'react';
import {
  X,
  Sparkles,
  ArrowRight,
  Check,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Users,
  User,
  Zap,
} from 'lucide-react';

export interface SmartRebalanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedIssues: any[];
  allMembers: any[];
  metricUnit: 'PTS' | 'HOURS' | 'COUNT';
  unitLabel: string;
  getPriorityColor?: (priority: string) => string;
  onConfirmReassign: (issueIds: string[], targetAssigneeId: string | null) => Promise<void>;
}

export function SmartRebalanceModal({
  isOpen,
  onClose,
  selectedIssues = [],
  allMembers = [],
  metricUnit = 'PTS',
  unitLabel = 'pts',
  getPriorityColor = () => '#3b82f6',
  onConfirmReassign,
}: SmartRebalanceModalProps) {
  const [targetAssigneeId, setTargetAssigneeId] = useState<string | null>('UNASSIGNED');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Calculate metric value of an issue
  const getIssueVal = (issue: any) => {
    if (metricUnit === 'COUNT') return 1;
    if (metricUnit === 'HOURS') return Math.max(0, Number(issue.estimateHours || issue.remainingHours || 0));
    return Math.max(0, Number(issue.estimatePoints || 0));
  };

  const totalShiftedWeight = useMemo(() => {
    return selectedIssues.reduce((sum, i) => sum + getIssueVal(i), 0);
  }, [selectedIssues, metricUnit]);

  // Determine health tier from utilization percentage
  const getHealthInfo = (pct: number) => {
    if (pct > 120) {
      return {
        label: 'Critical',
        color: 'text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/80 border-rose-200 dark:border-rose-900',
        badge: 'bg-rose-500 text-white',
      };
    }
    if (pct > 100) {
      return {
        label: 'Overloaded',
        color: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/80 border-amber-200 dark:border-amber-900',
        badge: 'bg-amber-500 text-white',
      };
    }
    if (pct >= 80) {
      return {
        label: 'Healthy',
        color: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/80 border-emerald-200 dark:border-emerald-900',
        badge: 'bg-emerald-500 text-white',
      };
    }
    if (pct > 0) {
      return {
        label: 'Available',
        color: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/80 border-blue-200 dark:border-blue-900',
        badge: 'bg-blue-500 text-white',
      };
    }
    return {
      label: 'No Allocation',
      color: 'text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700',
      badge: 'bg-slate-400 text-white',
    };
  };

  // Identify distinct source members whose issues are being moved
  const sourceMembersAnalysis = useMemo(() => {
    const map = new Map<string, { member: any; shiftedVal: number; count: number }>();

    selectedIssues.forEach((issue) => {
      const srcId = issue.assigneeId || issue.assignee?.id || 'UNASSIGNED';
      if (srcId !== 'UNASSIGNED') {
        const found = allMembers.find((m) => m.id === srcId);
        if (found) {
          if (!map.has(srcId)) {
            map.set(srcId, { member: found, shiftedVal: 0, count: 0 });
          }
          const entry = map.get(srcId)!;
          entry.shiftedVal += getIssueVal(issue);
          entry.count += 1;
        }
      }
    });

    return Array.from(map.values()).map((entry) => {
      const { member, shiftedVal, count } = entry;
      const curVal = member.totalVal || 0;
      const cap = member.capacity || 1;
      const beforePct = Math.round((curVal / cap) * 100);

      // If this member happens to also be the target, net is 0
      const isAlsoTarget = targetAssigneeId === member.id;
      const newVal = isAlsoTarget ? curVal : Math.max(0, curVal - shiftedVal);
      const afterPct = Math.round((newVal / cap) * 100);

      return {
        member,
        shiftedVal,
        count,
        beforeVal: curVal,
        newVal,
        capacity: cap,
        beforePct,
        afterPct,
        beforeHealth: getHealthInfo(beforePct),
        afterHealth: getHealthInfo(afterPct),
      };
    });
  }, [selectedIssues, allMembers, targetAssigneeId, metricUnit]);

  // Target member analysis
  const targetMemberAnalysis = useMemo(() => {
    if (!targetAssigneeId || targetAssigneeId === 'UNASSIGNED') return null;

    const target = allMembers.find((m) => m.id === targetAssigneeId);
    if (!target) return null;

    // Sum weights of selected issues that do NOT already belong to target
    const incomingWeight = selectedIssues
      .filter((i) => (i.assigneeId || i.assignee?.id) !== target.id)
      .reduce((sum, i) => sum + getIssueVal(i), 0);

    const curVal = target.totalVal || 0;
    const cap = target.capacity || 1;
    const beforePct = Math.round((curVal / cap) * 100);
    const newVal = curVal + incomingWeight;
    const afterPct = Math.round((newVal / cap) * 100);

    return {
      member: target,
      incomingWeight,
      beforeVal: curVal,
      newVal,
      capacity: cap,
      beforePct,
      afterPct,
      beforeHealth: getHealthInfo(beforePct),
      afterHealth: getHealthInfo(afterPct),
    };
  }, [targetAssigneeId, allMembers, selectedIssues, metricUnit]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      const issueIds = selectedIssues.map((i) => i.id);
      const finalTargetId = targetAssigneeId === 'UNASSIGNED' ? null : targetAssigneeId;
      await onConfirmReassign(issueIds, finalTargetId);
      onClose();
    } catch {
      // Handled by parent toast
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-card border border-border w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-muted/40 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                Smart Workload Rebalancing
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  {selectedIssues.length} {selectedIssues.length === 1 ? 'Task' : 'Tasks'} Selected
                </span>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Simulate before and after capacity utilization before committing assignments to the database.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Target Assignee Selector */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-primary" />
              <span>Select Destination Assignee:</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Unassigned Pool Option */}
              <div
                onClick={() => setTargetAssigneeId('UNASSIGNED')}
                className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                  targetAssigneeId === 'UNASSIGNED'
                    ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/30 ring-1 ring-amber-500'
                    : 'border-border bg-card hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 font-bold text-xs flex items-center justify-center">
                    ?
                  </div>
                  <div>
                    <p className="text-xs font-bold text-foreground">Unassigned Pool</p>
                    <p className="text-[10px] text-muted-foreground">Release tasks for general pickup</p>
                  </div>
                </div>
                {targetAssigneeId === 'UNASSIGNED' && (
                  <Check className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                )}
              </div>

              {/* Roster Members */}
              {allMembers.map((member) => {
                const isSelected = targetAssigneeId === member.id;
                const curPct = Math.round(((member.totalVal || 0) / (member.capacity || 1)) * 100);
                const health = getHealthInfo(curPct);

                return (
                  <div
                    key={member.id}
                    onClick={() => setTargetAssigneeId(member.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border bg-card hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                        {member.avatar}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-foreground truncate">{member.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {member.totalVal || 0} / {member.capacity} {unitLabel} ({curPct}%)
                        </p>
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${health.badge}`}>
                      {health.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Real-time Before vs After Simulation Card */}
          <div className="bg-muted/30 border border-border rounded-2xl p-4 space-y-3">
            <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span>Simulated Utilization Impact</span>
              <span className="text-[10px] font-mono text-muted-foreground ml-auto">
                Transfer Weight: {totalShiftedWeight} {unitLabel}
              </span>
            </h4>

            {/* Impact Grid */}
            <div className="space-y-2.5">
              {/* Source Members Relief */}
              {sourceMembersAnalysis.map((src) => (
                <div
                  key={src.member.id}
                  className="bg-background border border-border p-3 rounded-xl flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground">{src.member.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      (-{src.shiftedVal} {unitLabel})
                    </span>
                  </div>

                  <div className="flex items-center gap-2 font-mono">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${src.beforeHealth.color}`}>
                      {src.beforePct}% ({src.beforeHealth.label})
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${src.afterHealth.color}`}>
                      {src.afterPct}% ({src.afterHealth.label})
                    </span>
                  </div>
                </div>
              ))}

              {/* Target Member Load */}
              {targetMemberAnalysis ? (
                <div className="bg-background border border-primary/40 p-3 rounded-xl flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-primary">{targetMemberAnalysis.member.name} (Target)</span>
                    <span className="text-[10px] text-primary font-bold">
                      (+{targetMemberAnalysis.incomingWeight} {unitLabel})
                    </span>
                  </div>

                  <div className="flex items-center gap-2 font-mono">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${targetMemberAnalysis.beforeHealth.color}`}>
                      {targetMemberAnalysis.beforePct}% ({targetMemberAnalysis.beforeHealth.label})
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${targetMemberAnalysis.afterHealth.color}`}>
                      {targetMemberAnalysis.afterPct}% ({targetMemberAnalysis.afterHealth.label})
                    </span>
                  </div>
                </div>
              ) : targetAssigneeId === 'UNASSIGNED' ? (
                <div className="bg-amber-50/40 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 p-3 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>
                    Moving <strong>{selectedIssues.length}</strong> tasks to the <strong>Unassigned Pool</strong> ({totalShiftedWeight} {unitLabel}). These will be available for any developer to claim.
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Itemized Tasks Table */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-foreground">Selected Work Items to Reassign:</h4>
            <div className="border border-border rounded-xl overflow-hidden max-h-48 overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
                  <tr>
                    <th className="p-2">Key</th>
                    <th className="p-2">Title</th>
                    <th className="p-2">Priority</th>
                    <th className="p-2">Weight</th>
                    <th className="p-2">Current Assignee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {selectedIssues.map((issue) => (
                    <tr key={issue.id} className="hover:bg-muted/30">
                      <td className="p-2 font-mono font-bold text-primary">{issue.issueKey}</td>
                      <td className="p-2 font-medium text-foreground truncate max-w-[200px]">{issue.title}</td>
                      <td className="p-2">
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                          style={{
                            backgroundColor: `${getPriorityColor(issue.priority)}15`,
                            color: getPriorityColor(issue.priority),
                          }}
                        >
                          {issue.priority}
                        </span>
                      </td>
                      <td className="p-2 font-mono text-muted-foreground">
                        {getIssueVal(issue)} {unitLabel}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {issue.assignee ? `${issue.assignee.firstName || ''} ${issue.assignee.lastName || ''}`.trim() || issue.assignee.email : 'Unassigned'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-muted/40 border-t border-border flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-semibold rounded-xl border border-border bg-background hover:bg-muted transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || selectedIssues.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-primary text-primary-foreground hover:opacity-95 transition-all shadow-xs cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? (
              <span>Rebalancing...</span>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Confirm &amp; Reassign ({selectedIssues.length})</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
