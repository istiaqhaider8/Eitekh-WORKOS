'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Play,
  Calendar,
  Clock,
  Target,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  X,
  Layers,
  Sparkles,
  Zap,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';

interface StartSprintModalProps {
  sprint: any;
  issues: any[];
  averageVelocity?: number;
  isOpen: boolean;
  onClose: () => void;
  onSprintStarted: () => void;
}

export function StartSprintModal({
  sprint,
  issues,
  averageVelocity = 0,
  isOpen,
  onClose,
  onSprintStarted,
}: StartSprintModalProps) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [duration, setDuration] = useState<'1' | '2' | '3' | '4' | 'custom'>('2');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);

  // Helper to format Date for datetime-local input
  const formatForInput = (d: Date) => {
    const pad = (n: number) => (n < 10 ? '0' + n : n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  useEffect(() => {
    if (sprint && isOpen) {
      setName(sprint.name || '');
      setGoal(sprint.goal || '');

      const start = sprint.startDate ? new Date(sprint.startDate) : new Date();
      setStartDate(formatForInput(start));

      // Default 2 weeks
      const end = sprint.endDate
        ? new Date(sprint.endDate)
        : new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
      setEndDate(formatForInput(end));
      setDuration('2');
    }
  }, [sprint, isOpen]);

  // Handle duration change
  const handleDurationChange = (weeks: '1' | '2' | '3' | '4' | 'custom') => {
    setDuration(weeks);
    if (weeks === 'custom') return;

    const numWeeks = parseInt(weeks, 10);
    const start = startDate ? new Date(startDate) : new Date();
    const end = new Date(start.getTime() + numWeeks * 7 * 24 * 60 * 60 * 1000);
    setEndDate(formatForInput(end));
  };

  // Scope metrics
  const sprintIssues = useMemo(() => {
    if (!sprint) return [];
    return issues.filter((i) => i.sprintId === sprint.id);
  }, [sprint, issues]);

  const primaryIssues = useMemo(() => {
    return sprintIssues.filter((i) => !i.parentIssueId);
  }, [sprintIssues]);

  const plannedPoints = useMemo(() => {
    return primaryIssues.reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
  }, [primaryIssues]);

  const unestimatedCount = useMemo(() => {
    return primaryIssues.filter((i) => i.estimatePoints == null || i.estimatePoints === 0).length;
  }, [primaryIssues]);

  // Capacity Assessment
  const capacityAssessment = useMemo(() => {
    if (averageVelocity <= 0) {
      return {
        status: 'NEW',
        label: 'Baseline Sprint',
        badgeColor: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-300',
        message: 'No historical velocity established yet. This sprint will help baseline team velocity.',
        diff: 0,
      };
    }

    const ratio = plannedPoints / averageVelocity;
    if (ratio > 1.15) {
      const diff = plannedPoints - averageVelocity;
      return {
        status: 'OVERCOMMITTED',
        label: 'Overcommitted',
        badgeColor: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border-rose-300',
        message: `Planned scope (${plannedPoints} pts) exceeds rolling team velocity (${averageVelocity} pts) by +${diff} pts. Consider moving non-critical items to the backlog.`,
        diff,
      };
    } else if (ratio < 0.75) {
      const diff = averageVelocity - plannedPoints;
      return {
        status: 'UNDER_ALLOCATED',
        label: 'Available Capacity',
        badgeColor: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-300',
        message: `Team has room for approximately +${diff} more points based on historical velocity (${averageVelocity} pts).`,
        diff,
      };
    } else {
      return {
        status: 'OPTIMAL',
        label: 'Optimal Scope',
        badgeColor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300',
        message: `Planned scope (${plannedPoints} pts) aligns well with historical team velocity (${averageVelocity} pts).`,
        diff: 0,
      };
    }
  }, [plannedPoints, averageVelocity]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showError('Sprint name is required');
      return;
    }
    if (!startDate || !endDate) {
      showError('Start and End dates are required');
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end <= start) {
      showError('End date must be after start date');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/sprints', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sprintId: sprint.id,
          status: 'ACTIVE',
          name: name.trim(),
          goal: goal.trim() || null,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        showSuccess(`Sprint "${name}" started successfully!`);
        onSprintStarted();
        onClose();
      } else {
        showError(data.error || 'Failed to start sprint');
      }
    } catch (err: any) {
      showError(err.message || 'Network error starting sprint');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !sprint) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <Play className="w-5 h-5 fill-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Start Sprint: {sprint.name}</h2>
              <p className="text-xs text-muted-foreground">
                Confirm iteration goals, duration, and commitment scope
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Sprint Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Sprint Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full text-xs p-2.5 rounded-lg border border-border bg-background text-foreground focus:ring-2 focus:ring-primary outline-none"
            />
          </div>

          {/* Duration Presets */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Duration Preset</span>
            </label>
            <div className="grid grid-cols-5 gap-2">
              {(['1', '2', '3', '4', 'custom'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleDurationChange(key)}
                  className={`py-1.5 text-xs font-semibold rounded-lg border transition ${
                    duration === key
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background hover:bg-muted border-border text-muted-foreground'
                  }`}
                >
                  {key === 'custom' ? 'Custom' : `${key} Week${key === '1' ? '' : 's'}`}
                </button>
              ))}
            </div>
          </div>

          {/* Dates Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Start Date *</span>
              </label>
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setDuration('custom');
                }}
                required
                className="w-full text-xs p-2.5 rounded-lg border border-border bg-background text-foreground focus:ring-2 focus:ring-primary outline-none font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                <span>End Date *</span>
              </label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setDuration('custom');
                }}
                required
                className="w-full text-xs p-2.5 rounded-lg border border-border bg-background text-foreground focus:ring-2 focus:ring-primary outline-none font-mono"
              />
            </div>
          </div>

          {/* Sprint Goal */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Sprint Goal</span>
              <span className="text-[10px] text-muted-foreground font-normal">(Optional)</span>
            </label>
            <textarea
              rows={2}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What is the team committing to accomplish in this sprint?"
              className="w-full text-xs p-2.5 rounded-lg border border-border bg-background text-foreground focus:ring-2 focus:ring-primary outline-none resize-none"
            />
          </div>

          {/* Capacity & Velocity Assessment Card */}
          <div className="p-4 rounded-xl border border-border bg-muted/40 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-indigo-500" />
                Capacity &amp; Velocity Guidance
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${capacityAssessment.badgeColor}`}
              >
                {capacityAssessment.label}
              </span>
            </div>

            {/* Metrics Breakdown */}
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-2 rounded-lg bg-card border border-border">
                <span className="text-[10px] text-muted-foreground block">Planned Scope</span>
                <span className="text-sm font-black text-foreground font-mono">
                  {plannedPoints} <span className="text-[10px] font-normal">pts</span>
                </span>
                <span className="text-[9px] text-muted-foreground block">
                  {primaryIssues.length} primary tickets
                </span>
              </div>
              <div className="p-2 rounded-lg bg-card border border-border">
                <span className="text-[10px] text-muted-foreground block">Team Velocity</span>
                <span className="text-sm font-black text-indigo-600 dark:text-indigo-400 font-mono">
                  {averageVelocity > 0 ? averageVelocity : '—'}{' '}
                  <span className="text-[10px] font-normal">pts</span>
                </span>
                <span className="text-[9px] text-muted-foreground block">3-sprint avg</span>
              </div>
              <div className="p-2 rounded-lg bg-card border border-border">
                <span className="text-[10px] text-muted-foreground block">Unestimated</span>
                <span
                  className={`text-sm font-black font-mono ${
                    unestimatedCount > 0 ? 'text-amber-500' : 'text-emerald-500'
                  }`}
                >
                  {unestimatedCount}
                </span>
                <span className="text-[9px] text-muted-foreground block">tickets</span>
              </div>
            </div>

            {/* Assessment message */}
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {capacityAssessment.message}
            </p>

            {unestimatedCount > 0 && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-[11px] text-amber-800 dark:text-amber-200">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                <span>
                  <strong>{unestimatedCount} issues</strong> have no story point estimates. They will not contribute to velocity.
                </span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg shadow-sm transition disabled:opacity-50 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{loading ? 'Starting...' : 'Start Sprint'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
