'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Plus,
  Search,
  Filter,
  X,
  Clock,
  User as UserIcon,
  CheckCircle2,
  AlertCircle,
  Move,
  Layers,
  Sparkles,
  Check,
  CalendarDays,
  ListFilter,
  Palette,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CalendarRange,
  CornerDownLeft,
  Users,
  FolderGit2,
  FileText,
  Download,
  ShieldAlert,
  Flame,
  CheckSquare,
  Square,
  ArrowRight,
  SlidersHorizontal,
  TrendingUp,
  Eye,
  EyeOff,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Zap,
  BarChart2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';
import { isUserOnLeave, formatLeaveRange } from '@/lib/leave-engine';
import { AnalyticsDrillDownModal } from '@/components/analytics/AnalyticsDrillDownModal';

import { ReportViewModal } from '@/components/analytics/ReportViewModal';
import { isIssueDone, getIssueKeyClass } from '@/lib/designSystem';

interface CalendarViewProps {
  issues: any[];
  statuses?: any[];
  priorities?: any[];
  members?: any[];
  teams?: any[];
  sprints?: any[];
  projects?: any[];
  leaves?: any[];
  delegations?: any[];
  projectId?: string;
  projectName?: string;
  currentUser?: any;
  onSelectProject?: (projectId: string) => void;
  onSelectIssue: (issue: any) => void;
  onRefresh?: () => void;
}


// Timezone-safe local date parser to avoid UTC shifting
function parseLocalDate(dateStr: string | Date | null | undefined): Date | null {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr;
  const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    return new Date(year, month, day, 12, 0, 0, 0);
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function getDateCountdown(dueDateStr: string | null | undefined): {
  label: string;
  tone: 'overdue' | 'today' | 'soon' | 'normal' | 'completed';
} {
  const due = parseLocalDate(dueDateStr);
  if (!due) return { label: 'No due date', tone: 'normal' };
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  due.setHours(12, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: `Overdue by ${Math.abs(diffDays)}d`, tone: 'overdue' };
  if (diffDays === 0) return { label: 'Due Today', tone: 'today' };
  if (diffDays === 1) return { label: 'Due Tomorrow', tone: 'soon' };
  if (diffDays <= 3) return { label: `Due in ${diffDays}d`, tone: 'soon' };
  return { label: `Due in ${diffDays}d`, tone: 'normal' };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAY_NAMES_FULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES_WORK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export const CALENDAR_REPORTS_LIST = [
  { id: 'schedule-report', name: 'Master Project Schedule Report', desc: 'Comprehensive schedule of all planned deliverables, milestones, and deadlines.' },
  { id: 'upcoming-deadlines', name: 'Upcoming Deadlines Schedule Report', desc: 'Imminent deliverables due within the active project horizon.' },
  { id: 'overdue-tasks', name: 'Overdue Task Schedule Report', desc: 'Triage agenda of all past-due work items requiring immediate rescheduling.' },
  { id: 'team-schedule', name: 'Team Resource Schedule Report', desc: 'Task schedules mapped against individual engineers and allocated capacity.' },
  { id: 'sprint-schedule', name: 'Sprint Schedule & Horizons Report', desc: 'Iteration-aligned task delivery dates, sprint start/end dates, and milestones.' },
  { id: 'unassigned-tasks', name: 'Unassigned Tasks Schedule Pool', desc: 'Unassigned work items awaiting resource delegation and scheduling.' },
  { id: 'capacity-vs-schedule', name: 'Capacity vs Schedule Allocation Report', desc: 'Cross-evaluation of scheduled story point commitments against team bandwidth.' },
  { id: 'calendar-activity', name: 'Calendar & Rescheduling Audit Report', desc: 'Audit log of task rescheduling, deadline shifts, and schedule adjustments.' },
];


function getPriorityBadgeClass(priority: string) {
  switch (priority) {
    case 'CRITICAL':
    case 'HIGHEST':
      return 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60 font-bold';
    case 'HIGH':
      return 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60 font-bold';
    case 'MEDIUM':
      return 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900/60 font-bold';
    case 'LOW':
    case 'LOWEST':
      return 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60 font-bold';
    default:
      return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-bold';
  }
}

export function CalendarView({
  issues = [],
  statuses = [],
  priorities = [],
  members = [],
  teams = [],
  sprints = [],
  projects = [],
  leaves: propsLeaves = [],
  delegations = [],
  projectId = 'default',
  projectName = 'Current Project',
  currentUser,
  onSelectProject,
  onSelectIssue,
  onRefresh,
}: CalendarViewProps) {
  // Local state for optimistic UI updates
  const [localIssues, setLocalIssues] = useState<any[]>(issues);

  const [fetchedLeaves, setFetchedLeaves] = useState<any[]>([]);

  useEffect(() => {
    if (propsLeaves.length > 0) return;
    if (projectId && projectId !== 'default') {
      fetch(`/api/projects/${projectId}/availability`)
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data.leaves)) setFetchedLeaves(data.leaves);
        })
        .catch(() => {});
    }
  }, [projectId, propsLeaves]);

  const activeLeaves = useMemo(() => (propsLeaves.length > 0 ? propsLeaves : fetchedLeaves), [propsLeaves, fetchedLeaves]);

  useEffect(() => {
    setLocalIssues(issues);
  }, [issues]);


  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'workweek' | 'day'>('month');
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);

  // Density Mode (Comfortable vs Compact)
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('eitekh_calendar_density');
      if (saved === 'comfortable' || saved === 'compact') {
        setDensity(saved);
      }
    } catch (e) {}
  }, []);

  const handleToggleDensity = () => {
    const next = density === 'comfortable' ? 'compact' : 'comfortable';
    setDensity(next);
    try {
      localStorage.setItem('eitekh_calendar_density', next);
    } catch (e) {}
  };

  // View All Tasks Flexibly Toggle (shows all tasks without clipping)
  const [viewAllTasks, setViewAllTasks] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('eitekh_calendar_view_all_tasks');
      if (saved !== null) {
        setViewAllTasks(saved === 'true');
      }
    } catch (e) {}
  }, []);

  const handleToggleViewAllTasks = () => {
    const next = !viewAllTasks;
    setViewAllTasks(next);
    try {
      localStorage.setItem('eitekh_calendar_view_all_tasks', String(next));
    } catch (e) {}
  };

  // Collapsible Analytics Strip
  const [showAnalyticsBar, setShowAnalyticsBar] = useState(false);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [assigneeFilter, setAssigneeFilter] = useState('ALL');
  const [teamFilter, setTeamFilter] = useState('ALL');
  const [sprintFilter, setSprintFilter] = useState('ALL');
  const [colorMode, setColorMode] = useState<'status' | 'priority'>('status');

  const hasActiveFilters = useMemo(() => {
    return (
      searchQuery.trim() !== '' ||
      statusFilter !== 'ALL' ||
      priorityFilter !== 'ALL' ||
      assigneeFilter !== 'ALL' ||
      teamFilter !== 'ALL' ||
      sprintFilter !== 'ALL'
    );
  }, [searchQuery, statusFilter, priorityFilter, assigneeFilter, teamFilter, sprintFilter]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('ALL');
    setPriorityFilter('ALL');
    setAssigneeFilter('ALL');
    setTeamFilter('ALL');
    setSprintFilter('ALL');
  };

  // Multi-Select & Bulk Actions
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [showBulkRescheduleModal, setShowBulkRescheduleModal] = useState(false);
  const [bulkTargetDate, setBulkTargetDate] = useState('');
  const [isExecutingBulk, setIsExecutingBulk] = useState(false);

  // Popovers & Modals
  const [selectedDayDetails, setSelectedDayDetails] = useState<Date | null>(null);
  const [daySearchQuery, setDaySearchQuery] = useState('');
  const [isUnscheduledOpen, setIsUnscheduledOpen] = useState(false);
  const [unscheduledSearch, setUnscheduledSearch] = useState('');
  const [showConflictsModal, setShowConflictsModal] = useState(false);
  const [showReportsHub, setShowReportsHub] = useState(false);

  // Live Standardized Report Modal
  const [reportModal, setReportModal] = useState<{
    isOpen: boolean;
    reportType: string;
    reportTitle: string;
    reportDescription: string;
  }>({
    isOpen: false,
    reportType: 'schedule-report',
    reportTitle: 'Master Project Schedule Report',
    reportDescription: 'Comprehensive schedule of all planned deliverables, milestones, and deadlines.',
  });

  // Interactive Drilldown Modal
  const [drillDownModal, setDrillDownModal] = useState<{
    isOpen: boolean;
    title: string;
    subtitle: string;
    category: string;
    metricLabel: string;
    issues: any[];
    percentage?: number;
  }>({
    isOpen: false,
    title: '',
    subtitle: '',
    category: 'Calendar',
    metricLabel: 'Tasks',
    issues: [],
  });

  // Inline Quick Add State
  const [inlineAddDateStr, setInlineAddDateStr] = useState<string | null>(null);
  const [inlineAddTitle, setInlineAddTitle] = useState('');
  const [isSubmittingInlineAdd, setIsSubmittingInlineAdd] = useState(false);

  // Full Quick Create Modal State
  const [quickCreateDate, setQuickCreateDate] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newType, setNewType] = useState('TASK');
  const [newStatusId, setNewStatusId] = useState('');
  const [newPriority, setNewPriority] = useState('MEDIUM');
  const [newAssigneeId, setNewAssigneeId] = useState('');
  const [newSprintId, setNewSprintId] = useState('');
  const [newPoints, setNewPoints] = useState<number | ''>('');
  const [isSubmittingQuickCreate, setIsSubmittingQuickCreate] = useState(false);

  // Drag & Drop State
  const [draggedIssue, setDraggedIssue] = useState<any | null>(null);
  const [dragOverDateStr, setDragOverDateStr] = useState<string | null>(null);
  const [isOverUnscheduledTray, setIsOverUnscheduledTray] = useState(false);
  const [capacityWarning, setCapacityWarning] = useState<string | null>(null);

  // Priority List
  const priorityList = useMemo(() => {
    if (priorities && priorities.length > 0) return priorities;
    return [
      { name: 'Critical', value: 'CRITICAL', color: '#ef4444' },
      { name: 'Highest', value: 'HIGHEST', color: '#f97316' },
      { name: 'High', value: 'HIGH', color: '#f59e0b' },
      { name: 'Medium', value: 'MEDIUM', color: '#3b82f6' },
      { name: 'Low', value: 'LOW', color: '#10b981' },
      { name: 'Lowest', value: 'LOWEST', color: '#64748b' },
    ];
  }, [priorities]);

  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();
  const today = useMemo(() => new Date(), []);

  // Active Sprint
  const activeSprint = useMemo(() => {
    return sprints.find((s: any) => s.status === 'ACTIVE') || null;
  }, [sprints]);

  // Navigation handlers
  const handlePrev = useCallback(() => {
    if (viewMode === 'month') {
      setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
    } else if (viewMode === 'day') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 1);
      setCurrentDate(d);
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 7);
      setCurrentDate(d);
    }
  }, [viewMode, currentYear, currentMonth, currentDate]);

  const handleNext = useCallback(() => {
    if (viewMode === 'month') {
      setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
    } else if (viewMode === 'day') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 1);
      setCurrentDate(d);
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 7);
      setCurrentDate(d);
    }
  }, [viewMode, currentYear, currentMonth, currentDate]);

  const handleToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        handleToday();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'm' || e.key === 'M') {
        setViewMode('month');
      } else if (e.key === 'w' || e.key === 'W') {
        setViewMode('week');
      } else if (e.key === 'd' || e.key === 'D') {
        setViewMode('day');
      } else if (e.key === 'Escape') {
        setShowMonthPicker(false);
        setShowProjectDropdown(false);
        setSelectedDayDetails(null);
        setQuickCreateDate(null);
        setShowBulkRescheduleModal(false);
        setShowConflictsModal(false);
        setShowReportsHub(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToday, handlePrev, handleNext]);

  // Click outside to close month picker & project dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node)) {
        setShowMonthPicker(false);
      }
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node)) {
        setShowProjectDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter issues according to in-calendar search and filters
  const filteredIssues = useMemo(() => {
    return localIssues.filter((issue) => {
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesTitle = issue.title?.toLowerCase().includes(query);
        const matchesKey = issue.issueKey?.toLowerCase().includes(query);
        const matchesDesc = issue.description?.toLowerCase().includes(query);
        if (!matchesTitle && !matchesKey && !matchesDesc) return false;
      }

      if (statusFilter !== 'ALL') {
        if (issue.statusId !== statusFilter && issue.status?.name !== statusFilter) {
          return false;
        }
      }

      if (priorityFilter !== 'ALL') {
        const issuePrio = (issue.priority || '').toUpperCase();
        if (issuePrio !== priorityFilter.toUpperCase()) {
          return false;
        }
      }

      if (assigneeFilter !== 'ALL') {
        if (assigneeFilter === 'UNASSIGNED') {
          if (issue.assigneeId) return false;
        } else if (issue.assigneeId !== assigneeFilter) {
          return false;
        }
      }

      if (teamFilter !== 'ALL') {
        if (issue.teamId !== teamFilter) return false;
      }

      if (sprintFilter !== 'ALL') {
        if (sprintFilter === 'BACKLOG') {
          if (issue.sprintId) return false;
        } else if (issue.sprintId !== sprintFilter) {
          return false;
        }
      }

      return true;
    });
  }, [localIssues, searchQuery, statusFilter, priorityFilter, assigneeFilter, teamFilter, sprintFilter]);

  // Scheduled vs Unscheduled
  const scheduledIssues = useMemo(() => {
    return filteredIssues.filter((i) => !!i.dueDate);
  }, [filteredIssues]);

  const unscheduledIssues = useMemo(() => {
    return filteredIssues.filter((i) => !i.dueDate);
  }, [filteredIssues]);

  // Filtered unscheduled for drawer
  const displayedUnscheduled = useMemo(() => {
    if (!unscheduledSearch.trim()) return unscheduledIssues;
    const q = unscheduledSearch.toLowerCase().trim();
    return unscheduledIssues.filter(
      (i) => i.title?.toLowerCase().includes(q) || i.issueKey?.toLowerCase().includes(q)
    );
  }, [unscheduledIssues, unscheduledSearch]);

  // Categorize Status Helper
  const isDoneStatus = useCallback((status: any) => {
    if (!status) return false;
    const cat = (status.category || '').toUpperCase();
    const name = (status.name || '').toLowerCase();
    return cat === 'DONE' || name.includes('done') || name.includes('complete') || name.includes('closed');
  }, []);

  // --- Calendar Analytics (8 Real Database KPIs) ---
  const analyticsKPIs = useMemo(() => {
    const totalScheduled = scheduledIssues.length;
    const completedTasks = scheduledIssues.filter((i) => isDoneStatus(i.status));
    const pendingTasks = scheduledIssues.filter((i) => !isDoneStatus(i.status));

    const now12 = new Date();
    now12.setHours(12, 0, 0, 0);

    const overdueTasks = pendingTasks.filter((i) => {
      const d = parseLocalDate(i.dueDate);
      return d && d < now12;
    });

    const unassignedTasks = scheduledIssues.filter((i) => !i.assigneeId);

    // Due this week (current 7 days window)
    const weekStart = new Date(now12);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const dueThisWeek = pendingTasks.filter((i) => {
      const d = parseLocalDate(i.dueDate);
      return d && d >= weekStart && d <= weekEnd;
    });

    const totalPoints = scheduledIssues.reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
    const completionRate = totalScheduled > 0 ? Math.round((completedTasks.length / totalScheduled) * 100) : 0;

    // Day distribution map
    const dayMap = new Map<string, number>();
    scheduledIssues.forEach((i) => {
      const d = parseLocalDate(i.dueDate);
      if (d) {
        const iso = formatDateIso(d);
        dayMap.set(iso, (dayMap.get(iso) || 0) + 1);
      }
    });

    return {
      totalScheduled,
      completedCount: completedTasks.length,
      completedTasks,
      overdueCount: overdueTasks.length,
      overdueTasks,
      unassignedCount: unassignedTasks.length,
      unassignedTasks,
      dueThisWeekCount: dueThisWeek.length,
      dueThisWeekTasks: dueThisWeek,
      totalPoints,
      completionRate,
      activeDaysCount: dayMap.size,
    };
  }, [scheduledIssues, isDoneStatus]);

  // --- Schedule Conflict Detection Engine ---
  const scheduleConflicts = useMemo(() => {
    const conflicts: {
      type: 'OVERLOAD' | 'DAY_BOTTLENECK' | 'SPRINT_HORIZON' | 'DEPENDENCY' | 'WEEKEND' | 'CRITICAL_NO_DATE' | 'ON_LEAVE';
      severity: 'HIGH' | 'MEDIUM' | 'LOW';
      title: string;

      description: string;
      issue?: any;
      dateStr?: string;
    }[] = [];

    const now12 = new Date();
    now12.setHours(12, 0, 0, 0);

    // 1. Sprint Horizon Conflicts
    if (activeSprint?.endDate) {
      const sprintEnd = parseLocalDate(activeSprint.endDate);
      if (sprintEnd) {
        scheduledIssues.forEach((i) => {
          if (i.sprintId === activeSprint.id) {
            const due = parseLocalDate(i.dueDate);
            if (due && due > sprintEnd && !isDoneStatus(i.status)) {
              conflicts.push({
                type: 'SPRINT_HORIZON',
                severity: 'HIGH',
                title: `Task ${i.issueKey} exceeds sprint end date`,
                description: 'Schedule conflict: task is due after the sprint end date.',
                issue: i,
                dateStr: formatDateIso(due),
              });
            }
          }
        });
      }
    }

    // 2. Day Bottlenecks (> 5 tasks on one day)
    const dayTasksMap = new Map<string, any[]>();
    scheduledIssues.forEach((i) => {
      const d = parseLocalDate(i.dueDate);
      if (d && !isDoneStatus(i.status)) {
        const iso = formatDateIso(d);
        if (!dayTasksMap.has(iso)) dayTasksMap.set(iso, []);
        dayTasksMap.get(iso)!.push(i);
      }
    });

    dayTasksMap.forEach((tasksOnDay, dayStr) => {
      if (tasksOnDay.length > 5) {
        conflicts.push({
          type: 'DAY_BOTTLENECK',
          severity: 'MEDIUM',
          title: `High Task Density on ${dayStr}`,
          description: `${tasksOnDay.length} tasks scheduled on ${dayStr}. Risk of team bottleneck.`,
          dateStr: dayStr,
        });
      }
    });

    // 3. Weekend / Non-Working Day Conflicts
    scheduledIssues.forEach((i) => {
      const d = parseLocalDate(i.dueDate);
      if (d && !isDoneStatus(i.status)) {
        const dayOfWeek = d.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          conflicts.push({
            type: 'WEEKEND',
            severity: 'LOW',
            title: `Task ${i.issueKey} scheduled on weekend`,
            description: `Deliverable set for ${dayOfWeek === 6 ? 'Saturday' : 'Sunday'} (${formatDateIso(d)}).`,
            issue: i,
            dateStr: formatDateIso(d),
          });
        }
      }
    });

    // 4. Critical items missing due dates
    unscheduledIssues.forEach((i) => {
      if ((i.priority === 'CRITICAL' || i.priority === 'HIGHEST') && !isDoneStatus(i.status)) {
        conflicts.push({
          type: 'CRITICAL_NO_DATE',
          severity: 'HIGH',
          title: `Critical Task ${i.issueKey} lacks due date`,
          description: 'High-priority deliverable is sitting in backlog without a target delivery schedule.',
          issue: i,
        });
      }
    });

    // 5. Dependency Inversions
    scheduledIssues.forEach((i) => {
      if (i.incomingDeps && i.incomingDeps.length > 0) {
        const due = parseLocalDate(i.dueDate);
        if (due) {
          i.incomingDeps.forEach((dep: any) => {
            if (dep.type === 'BLOCKED_BY' && dep.sourceIssue?.dueDate) {
              const blockerDue = parseLocalDate(dep.sourceIssue.dueDate);
              if (blockerDue && blockerDue > due && !isDoneStatus(dep.sourceIssue.status)) {
                conflicts.push({
                  type: 'DEPENDENCY',
                  severity: 'HIGH',
                  title: `Dependency Conflict on ${i.issueKey}`,
                  description: `Task is due on ${formatDateIso(due)}, before blocking issue ${dep.sourceIssue.issueKey} is due on ${formatDateIso(blockerDue)}.`,
                  issue: i,
                });
              }
            }
          });
        }
      }
    });

    // 6. Leave Overlap Conflicts
    scheduledIssues.forEach((i) => {
      if (i.assigneeId && activeLeaves.length > 0) {
        const memberLeaves = activeLeaves.filter((l: any) => l.userId === i.assigneeId);
        const due = parseLocalDate(i.dueDate);
        if (due && memberLeaves.length > 0) {
          const leaveRes = isUserOnLeave(memberLeaves, due);
          if (leaveRes.onLeave && leaveRes.leave) {
            conflicts.push({
              type: 'ON_LEAVE',
              severity: 'HIGH',
              title: `Assignee On Leave for ${i.issueKey}`,
              description: `${i.assignee?.firstName || 'Assignee'} is on leave (${formatLeaveRange(leaveRes.leave.startDate, leaveRes.leave.endDate)}) on due date ${formatDateIso(due)}.`,
              issue: i,
              dateStr: formatDateIso(due),
            });
          }
        }
      }
    });

    return conflicts;
  }, [scheduledIssues, unscheduledIssues, activeSprint, isDoneStatus, activeLeaves]);


  // Multi-select helpers
  const handleToggleSelectIssue = (issueId: string) => {
    setSelectedIssueIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  };

  const handleSelectAllScheduled = () => {
    const all = new Set<string>();
    scheduledIssues.forEach((i) => all.add(i.id));
    setSelectedIssueIds(all);
  };

  const handleClearSelection = () => {
    setSelectedIssueIds(new Set());
  };

  // --- Drag and Drop Reschedule Implementation with Rollback ---
  const handleDropOnDate = async (targetDateStr: string) => {
    if (!draggedIssue) return;
    setDragOverDateStr(null);

    const oldDueDate = draggedIssue.dueDate;
    const issueId = draggedIssue.id;

    // Check capacity impact
    if (draggedIssue.assignee) {
      const assigneeName = draggedIssue.assignee.firstName || draggedIssue.assignee.email;
      const memberTasks = scheduledIssues.filter(
        (i) => i.assigneeId === draggedIssue.assigneeId && i.id !== issueId
      );
      const curPts = memberTasks.reduce((s, i) => s + (i.estimatePoints || 1), 0);
      const addPts = draggedIssue.estimatePoints || 1;
      const totalPts = curPts + addPts;
      if (totalPts > 20) {
        const utilPct = Math.round((totalPts / 20) * 100);
        setCapacityWarning(`Warning: Scheduling this task increases ${assigneeName}'s workload to ${utilPct}% of capacity.`);
      } else {
        setCapacityWarning(null);
      }
    }

    // Optimistic Update
    setLocalIssues((prev) =>
      prev.map((i) => (i.id === issueId ? { ...i, dueDate: targetDateStr } : i))
    );

    showSuccess(`Rescheduled ${draggedIssue.issueKey} to ${targetDateStr}`);
    setDraggedIssue(null);

    try {
      const res = await fetch(`/api/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: targetDateStr }),
      });

      if (!res.ok) {
        throw new Error('Failed to update due date in database');
      }

      onRefresh?.();
    } catch (err: any) {
      // Rollback
      setLocalIssues((prev) =>
        prev.map((i) => (i.id === issueId ? { ...i, dueDate: oldDueDate } : i))
      );
      showError(err.message || 'Failed to update schedule. Reverted.');
    }
  };

  // Drag task to unscheduled tray to remove due date
  const handleDropOnUnscheduled = async () => {
    if (!draggedIssue) return;
    setIsOverUnscheduledTray(false);

    const oldDueDate = draggedIssue.dueDate;
    const issueId = draggedIssue.id;

    // Optimistic Update
    setLocalIssues((prev) =>
      prev.map((i) => (i.id === issueId ? { ...i, dueDate: null } : i))
    );

    showSuccess(`Removed deadline from ${draggedIssue.issueKey} (Moved to Backlog)`);
    setDraggedIssue(null);

    try {
      const res = await fetch(`/api/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: null }),
      });

      if (!res.ok) {
        throw new Error('Failed to remove deadline');
      }

      onRefresh?.();
    } catch (err: any) {
      // Rollback
      setLocalIssues((prev) =>
        prev.map((i) => (i.id === issueId ? { ...i, dueDate: oldDueDate } : i))
      );
      showError(err.message || 'Failed to remove deadline. Reverted.');
    }
  };

  // --- Bulk Operations Execution ---
  const handleExecuteBulkReschedule = async (newDateIso: string | null) => {
    if (selectedIssueIds.size === 0) return;
    setIsExecutingBulk(true);

    const ids = Array.from(selectedIssueIds);
    const prevMap = new Map<string, string | null>();
    ids.forEach((id) => {
      const found = localIssues.find((i) => i.id === id);
      if (found) prevMap.set(id, found.dueDate);
    });

    // Optimistic update
    setLocalIssues((prev) =>
      prev.map((i) => (selectedIssueIds.has(i.id) ? { ...i, dueDate: newDateIso } : i))
    );

    try {
      const promises = ids.map((id) =>
        fetch(`/api/issues/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dueDate: newDateIso }),
        })
      );

      const results = await Promise.all(promises);
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) throw new Error(`Failed to update ${failed.length} tasks`);

      showSuccess(`Successfully rescheduled ${ids.length} tasks.`);
      setSelectedIssueIds(new Set());
      setShowBulkRescheduleModal(false);
      onRefresh?.();
    } catch (err: any) {
      // Rollback
      setLocalIssues((prev) =>
        prev.map((i) => (prevMap.has(i.id) ? { ...i, dueDate: prevMap.get(i.id) } : i))
      );
      showError(err.message || 'Bulk reschedule failed. Reverted.');
    } finally {
      setIsExecutingBulk(false);
    }
  };

  // --- Inline Quick Add Task Submission ---
  const handleInlineAddSubmit = async (dateStr: string) => {
    if (!inlineAddTitle.trim()) return;
    setIsSubmittingInlineAdd(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: inlineAddTitle.trim(),
          dueDate: dateStr,
          issueType: 'TASK',
          priority: 'MEDIUM',
        }),
      });

      if (!res.ok) throw new Error('Failed to create task');
      const newIssue = await res.json();
      setLocalIssues((prev) => [newIssue, ...prev]);
      showSuccess(`Created ${newIssue.issueKey || 'task'} scheduled for ${dateStr}`);
      setInlineAddDateStr(null);
      setInlineAddTitle('');
      onRefresh?.();
    } catch (err: any) {
      showError(err.message || 'Failed to create task');
    } finally {
      setIsSubmittingInlineAdd(false);
    }
  };

  // --- Full Quick Create Task Modal Submission ---
  const handleQuickCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !quickCreateDate) return;
    setIsSubmittingQuickCreate(true);

    try {
      const body: any = {
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        dueDate: quickCreateDate,
        issueType: newType,
        priority: newPriority,
        statusId: newStatusId || undefined,
        assigneeId: newAssigneeId || undefined,
        sprintId: newSprintId || undefined,
        estimatePoints: newPoints !== '' ? Number(newPoints) : undefined,
      };

      const res = await fetch(`/api/projects/${projectId}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Failed to create and schedule task');
      const created = await res.json();
      setLocalIssues((prev) => [created, ...prev]);
      showSuccess(`Created & scheduled ${created.issueKey || 'task'}`);
      setQuickCreateDate(null);
      setNewTitle('');
      setNewDescription('');
      setNewPoints('');
      onRefresh?.();
    } catch (err: any) {
      showError(err.message || 'Failed to create task');
    } finally {
      setIsSubmittingQuickCreate(false);
    }
  };

  // --- Calendar Date Calculations ---
  const monthCalendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1, 12, 0, 0, 0);
    const dayOfWeek = (firstDayOfMonth.getDay() + 6) % 7; // Monday = 0

    const startDate = new Date(firstDayOfMonth);
    startDate.setDate(startDate.getDate() - dayOfWeek);

    const days: any[] = [];
    const running = new Date(startDate);

    for (let i = 0; i < 35; i++) {
      const dateStr = formatDateIso(running);
      const isCurrentMonth = running.getMonth() === currentMonth;
      const isToday = isSameDay(running, today);
      const dayOfWeekVal = running.getDay();
      const isWeekend = dayOfWeekVal === 0 || dayOfWeekVal === 6;

      const dayIssues = scheduledIssues.filter((issue) => {
        const d = parseLocalDate(issue.dueDate);
        return d && formatDateIso(d) === dateStr;
      });

      days.push({
        date: new Date(running),
        dateStr,
        dayNumber: running.getDate(),
        isCurrentMonth,
        isToday,
        isWeekend,
        issues: dayIssues,
      });

      running.setDate(running.getDate() + 1);
    }

    // If month needs 6th row
    if (days.length === 35) {
      const lastDay = days[34];
      const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0, 12, 0, 0, 0);
      if (lastDay.date < lastDayOfMonth) {
        for (let i = 0; i < 7; i++) {
          const dateStr = formatDateIso(running);
          const isCurrentMonth = running.getMonth() === currentMonth;
          const isToday = isSameDay(running, today);
          const dayOfWeekVal = running.getDay();
          const isWeekend = dayOfWeekVal === 0 || dayOfWeekVal === 6;

          const dayIssues = scheduledIssues.filter((issue) => {
            const d = parseLocalDate(issue.dueDate);
            return d && formatDateIso(d) === dateStr;
          });

          days.push({
            date: new Date(running),
            dateStr,
            dayNumber: running.getDate(),
            isCurrentMonth,
            isToday,
            isWeekend,
            issues: dayIssues,
          });

          running.setDate(running.getDate() + 1);
        }
      }
    }

    return days;
  }, [currentYear, currentMonth, scheduledIssues, today]);

  // Split Month Days into Week Rows for guaranteed non-overlapping layout
  const monthWeeks = useMemo(() => {
    const weeks: any[][] = [];
    for (let i = 0; i < monthCalendarDays.length; i += 7) {
      weeks.push(monthCalendarDays.slice(i, i + 7));
    }
    return weeks;
  }, [monthCalendarDays]);

  // Week View Days
  const weekCalendarDays = useMemo(() => {
    const d = new Date(currentDate);
    d.setHours(12, 0, 0, 0);
    const dayOfWeek = (d.getDay() + 6) % 7;
    const monday = new Date(d);
    monday.setDate(monday.getDate() - dayOfWeek);

    const count = viewMode === 'workweek' ? 5 : 7;
    const days: any[] = [];
    const running = new Date(monday);

    for (let i = 0; i < count; i++) {
      const dateStr = formatDateIso(running);
      const isToday = isSameDay(running, today);
      const isWeekend = running.getDay() === 0 || running.getDay() === 6;

      const dayIssues = scheduledIssues.filter((issue) => {
        const dd = parseLocalDate(issue.dueDate);
        return dd && formatDateIso(dd) === dateStr;
      });

      days.push({
        date: new Date(running),
        dateStr,
        dayNumber: running.getDate(),
        isCurrentMonth: true,
        isToday,
        isWeekend,
        issues: dayIssues,
      });

      running.setDate(running.getDate() + 1);
    }

    return days;
  }, [currentDate, viewMode, scheduledIssues, today]);

  // Day View Data
  const dayViewData = useMemo(() => {
    const date = new Date(currentDate);
    date.setHours(12, 0, 0, 0);
    const dateStr = formatDateIso(date);
    const dayIssues = scheduledIssues.filter((i) => {
      const d = parseLocalDate(i.dueDate);
      return d && formatDateIso(d) === dateStr;
    });

    return {
      date,
      dateStr,
      isToday: isSameDay(date, today),
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      issues: dayIssues,
    };
  }, [currentDate, scheduledIssues, today]);

  // Max tasks to show per cell in capped mode
  const maxTasksPerCell = density === 'comfortable' ? 3 : 4;

  // Selected Day Details Filtered Issues (for modal)
  const selectedDayIssues = useMemo(() => {
    if (!selectedDayDetails) return [];
    const iso = formatDateIso(selectedDayDetails);
    return scheduledIssues.filter((i) => {
      const d = parseLocalDate(i.dueDate);
      return d && formatDateIso(d) === iso;
    });
  }, [selectedDayDetails, scheduledIssues]);

  const filteredSelectedDayIssues = useMemo(() => {
    if (!daySearchQuery.trim()) return selectedDayIssues;
    const q = daySearchQuery.toLowerCase().trim();
    return selectedDayIssues.filter(
      (i) => i.title?.toLowerCase().includes(q) || i.issueKey?.toLowerCase().includes(q)
    );
  }, [selectedDayIssues, daySearchQuery]);

  // -----------------------------------------------------------------
  // RENDER DAY CELL COMPONENT (Strictly Isolated Container)
  // -----------------------------------------------------------------
  const renderDayCell = (cell: any, isWeekView = false) => {
    const isDragOver = dragOverDateStr === cell.dateStr;
    const isInlineAdding = inlineAddDateStr === cell.dateStr;

    return (
      <div
        key={cell.dateStr}
        onDragOver={(e) => {
          e.preventDefault();
          if (dragOverDateStr !== cell.dateStr) {
            setDragOverDateStr(cell.dateStr);
          }
        }}
        onDragLeave={() => {
          if (dragOverDateStr === cell.dateStr) {
            setDragOverDateStr(null);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          handleDropOnDate(cell.dateStr);
        }}
        className={`flex flex-col min-w-0 transition-colors relative group/cell border-r border-slate-300 dark:border-slate-800/80 ${
          cell.isCurrentMonth === false
            ? 'bg-slate-100/70 dark:bg-slate-950/90 text-slate-400 dark:text-slate-600'
            : cell.isWeekend
            ? 'bg-slate-50 dark:bg-slate-950/60'
            : 'bg-white dark:bg-slate-900/30 hover:bg-slate-50/80 dark:hover:bg-slate-900/50'
        } ${cell.isToday ? 'bg-blue-50/60 dark:bg-blue-950/20 ring-1 ring-inset ring-blue-500/40' : ''} ${
          isDragOver ? 'bg-blue-500/15 ring-2 ring-inset ring-blue-500' : ''
        }`}
        style={{
          minHeight: isWeekView
            ? '500px'
            : density === 'comfortable'
            ? '140px'
            : '110px',
        }}
      >
        {/* 1. Dedicated Cell Top Header Banner */}
        <div className="h-7 px-2 flex items-center justify-between border-b border-slate-200 dark:border-slate-800/60 bg-slate-100/90 dark:bg-slate-900/80 shrink-0 select-none">
          {/* Left: Date Number / Today Badge */}
          <div className="flex items-center gap-1.5">
            <span
              onClick={() => {
                setCurrentDate(cell.date);
                setViewMode('day');
              }}
              className={`text-xs font-bold transition-all cursor-pointer ${
                cell.isToday
                  ? 'px-2 py-0.5 rounded-full bg-blue-600 text-white shadow-xs ring-2 ring-blue-400/40 font-extrabold scale-105'
                  : cell.isCurrentMonth
                  ? 'w-6 h-6 flex items-center justify-center rounded-full text-slate-700 dark:text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800'
                  : 'w-6 h-6 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400'
              }`}
              title="Click to view full day timeline"
            >
              {cell.dayNumber}
            </span>
            {isWeekView && (
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                {WEEKDAY_NAMES_FULL[(cell.date.getDay() + 6) % 7]}
              </span>
            )}
          </div>

          {/* Right: Task Count Badge & Quick Add Button */}
          <div className="flex items-center gap-1">
            {cell.issues.length > 0 && (
              <span
                onClick={() => setSelectedDayDetails(cell.date)}
                className="text-[10px] font-bold font-mono px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700/60 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-colors"
                title={`${cell.issues.length} tasks scheduled on this date. Click to inspect.`}
              >
                {cell.issues.length}
              </span>
            )}
            <button
              type="button"
              onClick={() => setInlineAddDateStr(cell.dateStr)}
              className="w-5 h-5 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-800 dark:hover:text-white rounded opacity-0 group-hover/cell:opacity-100 transition-opacity cursor-pointer"
              title="Quick add task for this date"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 2. Inline Quick Add Input */}
        {isInlineAdding && (
          <div className="m-1.5 p-1.5 bg-white dark:bg-slate-900 border border-blue-500 rounded-lg shadow-xl z-20 animate-in fade-in shrink-0">
            <input
              type="text"
              autoFocus
              placeholder="New task title..."
              value={inlineAddTitle}
              onChange={(e) => setInlineAddTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleInlineAddSubmit(cell.dateStr);
                if (e.key === 'Escape') setInlineAddDateStr(null);
              }}
              className="w-full text-xs bg-transparent border-none p-0 focus:outline-hidden text-slate-900 dark:text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
            />
            <div className="flex items-center justify-end gap-1 mt-1.5 pt-1.5 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setInlineAddDateStr(null)}
                className="px-1.5 py-0.5 text-[9px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleInlineAddSubmit(cell.dateStr)}
                disabled={isSubmittingInlineAdd}
                className="px-2 py-0.5 text-[9px] font-bold bg-blue-600 text-white rounded hover:bg-blue-500 cursor-pointer shadow-2xs"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* 3. Task Cards Container (Guaranteed Internal Scroll & Zero Overlap) */}
        <div
          className={`flex-1 min-h-0 p-1.5 space-y-1.5 overflow-y-auto ${
            isWeekView ? 'max-h-none' : 'max-h-[170px]'
          }`}
        >
          {(viewAllTasks ? cell.issues : cell.issues.slice(0, maxTasksPerCell)).map((issue: any) => {
            const countdown = getDateCountdown(issue.dueDate);
            const isDone = isDoneStatus(issue.status);
            const isSelected = selectedIssueIds.has(issue.id);

            // Status/Priority Bar Color
            let accentBorderColor = 'border-l-blue-500';
            if (isDone) {
              accentBorderColor = 'border-l-emerald-500';
            } else if (countdown.tone === 'overdue') {
              accentBorderColor = 'border-l-rose-500';
            } else if (colorMode === 'priority') {
              if (issue.priority === 'CRITICAL' || issue.priority === 'HIGHEST') {
                accentBorderColor = 'border-l-rose-500';
              } else if (issue.priority === 'HIGH') {
                accentBorderColor = 'border-l-amber-500';
              } else {
                accentBorderColor = 'border-l-slate-400';
              }
            }

            return (
              <div
                key={issue.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', issue.id);
                  setDraggedIssue(issue);
                }}
                onClick={() => onSelectIssue(issue)}
                className={`group/card relative rounded-md border border-slate-300 dark:border-slate-800 border-l-[3.5px] ${accentBorderColor} bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer select-none shadow-2xs hover:shadow-md p-1.5 ${
                  isDone ? 'opacity-65' : ''
                } ${isSelected ? 'ring-2 ring-blue-500 bg-blue-950/70' : ''}`}
              >
                {/* Top Row: Checkbox + Key + Points + Assignee */}
                <div className="flex items-center justify-between gap-1 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleToggleSelectIssue(issue.id);
                      }}
                      className={`rounded border-slate-600 text-blue-600 focus:ring-0 cursor-pointer shrink-0 transition-opacity ${
                        isSelected ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100'
                      } w-3 h-3`}
                    />
                    <span className={getIssueKeyClass(isIssueDone(issue, statuses), "text-[10px]")}>
                      {issue.issueKey}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {issue.estimatePoints && (
                      <span className="text-[9px] font-mono font-bold px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                        {issue.estimatePoints}p
                      </span>
                    )}
                    {issue.assignee && (
                      <div
                        className="w-4 h-4 rounded-full bg-blue-600/30 text-blue-300 border border-blue-400/40 flex items-center justify-center text-[8px] font-bold shrink-0"
                        title={issue.assignee.firstName || issue.assignee.email}
                      >
                        {(issue.assignee.firstName || issue.assignee.email || '?')[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                </div>

                {/* Title */}
                <div
                  className={`text-xs font-semibold leading-snug truncate ${
                    isDone ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-900 dark:text-slate-100 group-hover/card:text-blue-600 dark:group-hover/card:text-white'
                  }`}
                  title={issue.title}
                >
                  {issue.title}
                </div>

                {/* Bottom Row (Comfortable density or Overdue): Status & Countdown */}
                {density === 'comfortable' && (
                  <div className="flex items-center justify-between gap-1 mt-1 text-[9px] text-slate-400">
                    <span className="truncate text-slate-400">{issue.status?.name || 'Open'}</span>
                    {countdown.tone === 'overdue' && !isDone && (
                      <span className="text-rose-400 font-bold shrink-0 flex items-center gap-0.5">
                        <Flame className="w-2.5 h-2.5" />
                        {countdown.label}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* +N More Button (When Capped Mode is Active) */}
          {!viewAllTasks && cell.issues.length > maxTasksPerCell && (
            <button
              type="button"
              onClick={() => setSelectedDayDetails(cell.date)}
              className="w-full text-center py-1 text-[10px] font-bold text-blue-400 hover:text-blue-300 bg-blue-950/40 hover:bg-blue-950/70 border border-blue-500/30 rounded-md transition-colors cursor-pointer"
            >
              +{cell.issues.length - maxTasksPerCell} more tasks
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 select-none overflow-hidden">
      {/* ------------------------------------------------------------- */}
      {/* 1. TOP SCHEDULE TOOLBAR (SLEEK 2-TIER ENTERPRISE DECK)        */}
      {/* ------------------------------------------------------------- */}
      <header className="px-3 sm:px-4 py-2 sm:py-2.5 bg-white dark:bg-slate-900 border-b border-slate-300 dark:border-slate-800 shrink-0 space-y-2.5 z-20 shadow-2xs">
        {/* Tier 1: Period Navigation, Views, & Action Hub */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Left: Navigation Controls */}
          <div className="flex items-center gap-2">
            {/* Period Navigator */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700/80 rounded-lg p-0.5 shadow-2xs">
              <button
                type="button"
                onClick={handlePrev}
                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-md transition-colors cursor-pointer"
                title="Previous (Left Arrow)"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleToday}
                className="px-2.5 py-0.5 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white rounded-md transition-colors cursor-pointer"
                title="Jump to Today (T)"
              >
                Today
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-md transition-colors cursor-pointer"
                title="Next (Right Arrow)"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Current Month / Period Display with Fast Jump Picker */}
            <div className="relative" ref={monthPickerRef}>
              <button
                type="button"
                onClick={() => setShowMonthPicker((prev) => !prev)}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700/80 rounded-lg text-sm font-bold text-slate-800 dark:text-slate-900 dark:text-slate-100 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer shadow-2xs"
              >
                <CalendarIcon className="w-4 h-4 text-blue-400" />
                <span>
                  {MONTH_NAMES[currentMonth]} {currentYear}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
              </button>

              {/* Fast Month Picker Popover */}
              {showMonthPicker && (
                <div className="absolute left-0 top-full mt-1 w-56 p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Select Month</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setCurrentDate(new Date(currentYear - 1, currentMonth, 1))}
                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white rounded cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs font-bold text-blue-400">{currentYear}</span>
                      <button
                        type="button"
                        onClick={() => setCurrentDate(new Date(currentYear + 1, currentMonth, 1))}
                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white rounded cursor-pointer"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {MONTH_NAMES.map((name, idx) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => {
                          setCurrentDate(new Date(currentYear, idx, 1));
                          setShowMonthPicker(false);
                        }}
                        className={`px-1.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                          idx === currentMonth
                            ? 'bg-blue-600 text-white font-bold'
                            : 'text-slate-700 dark:text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {name.slice(0, 3)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Project Switcher Badge */}
            <div className="relative" ref={projectDropdownRef}>
              <button
                type="button"
                onClick={() => setShowProjectDropdown((prev) => !prev)}
                className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700/80 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer shadow-2xs"
              >
                <FolderGit2 className="w-3.5 h-3.5 text-blue-400" />
                <span className="truncate max-w-[140px]">{projectName}</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {showProjectDropdown && projects.length > 0 && (
                <div className="absolute left-0 top-full mt-1 w-64 p-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl z-50">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Select Project
                  </div>
                  <div className="space-y-0.5 mt-1 max-h-48 overflow-y-auto">
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onSelectProject?.(p.id);
                          setShowProjectDropdown(false);
                        }}
                        className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                          p.id === projectId
                            ? 'bg-blue-600 text-white font-bold'
                            : 'text-slate-700 dark:text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <span className="truncate">{p.name}</span>
                        <span className="text-[10px] font-mono opacity-80">{p.key}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Center: View Switcher Segmented Control */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700/80 rounded-lg p-0.5 shadow-2xs">
            {(['month', 'week', 'workweek', 'day'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors capitalize cursor-pointer ${
                  viewMode === mode
                    ? 'bg-blue-600 text-white font-bold shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700/50'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Right: Actions, Density, Conflicts, Reports, Unscheduled */}
          <div className="flex items-center gap-1.5">
            {/* Density Toggle (Comfortable vs Compact) */}
            <button
              type="button"
              onClick={handleToggleDensity}
              className="h-8 px-2.5 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700/80 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              title="Toggle calendar density (Comfortable / Compact)"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-blue-400" />
              <span className="capitalize hidden sm:inline">{density}</span>
            </button>

            {/* View All Tasks Flexibly Toggle */}
            <button
              type="button"
              onClick={handleToggleViewAllTasks}
              className={`h-8 px-2.5 border rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs ${
                viewAllTasks
                  ? 'bg-blue-600/20 text-blue-300 border-blue-500/40 hover:bg-blue-600/30'
                  : 'bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title="Toggle flexible view: show all tasks vs capped +N more"
            >
              {viewAllTasks ? <Eye className="w-3.5 h-3.5 text-blue-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
              <span className="hidden sm:inline">{viewAllTasks ? 'Flexible' : 'Capped'}</span>
            </button>

            {/* Analytics Toggle Button */}
            <button
              type="button"
              onClick={() => setShowAnalyticsBar((prev) => !prev)}
              className={`h-8 px-2.5 border rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs ${
                showAnalyticsBar
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title="Toggle schedule analytics strip"
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Analytics</span>
            </button>

            {/* Schedule Conflicts Alert Button */}
            {scheduleConflicts.length > 0 && (
              <button
                type="button"
                onClick={() => setShowConflictsModal(true)}
                className="h-8 px-2.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                title="View detected scheduling conflicts"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
                <span>{scheduleConflicts.length} Conflicts</span>
              </button>
            )}

            {/* Reports Modal Button */}
            <button
              type="button"
              onClick={() => setShowReportsHub(true)}
              className="h-8 px-2.5 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700/80 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              title="Open Calendar Schedule Reports Download Center"
            >
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              <span>Reports</span>
            </button>

            {/* Unscheduled Backlog Drawer Button */}
            <button
              type="button"
              onClick={() => setIsUnscheduledOpen((prev) => !prev)}
              className={`h-8 px-2.5 border rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs ${
                isUnscheduledOpen
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title="Toggle Unscheduled Tasks Pool"
            >
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>Unscheduled</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {unscheduledIssues.length}
              </span>
            </button>

            {/* Quick Create Task Button */}
            <button
              type="button"
              onClick={() => setQuickCreateDate(formatDateIso(new Date()))}
              className="h-8 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Schedule Task</span>
            </button>
          </div>
        </div>

        {/* Tier 2: Search, Filters, Color Mode, & Real-Time Stats */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800/80">
          {/* Left: Search & Filter Dropdowns */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search schedule..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 pr-7 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700/60 rounded-lg text-xs text-slate-900 dark:text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500 w-40 sm:w-48 transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 px-2.5 bg-white dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700/60 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-700 dark:text-slate-300 cursor-pointer focus:outline-hidden hover:border-slate-400 dark:hover:border-slate-600 shadow-2xs transition-colors"
            >
              <option value="ALL">Status: All</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            {/* Priority Filter */}
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="h-8 px-2.5 bg-white dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700/60 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-700 dark:text-slate-300 cursor-pointer focus:outline-hidden hover:border-slate-400 dark:hover:border-slate-600 shadow-2xs transition-colors"
            >
              <option value="ALL">Priority: All</option>
              {priorityList.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.name}
                </option>
              ))}
            </select>

            {/* Assignee Filter */}
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="h-8 px-2.5 bg-white dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700/60 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-700 dark:text-slate-300 cursor-pointer focus:outline-hidden hover:border-slate-400 dark:hover:border-slate-600 shadow-2xs transition-colors"
            >
              <option value="ALL">Assignee: All</option>
              <option value="UNASSIGNED">Unassigned</option>
              {members.map((m) => {
                const u = m.user || m;
                const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
                return (
                  <option key={u.id} value={u.id}>
                    {name}
                  </option>
                );
              })}
            </select>

            {/* Sprint Filter */}
            {sprints.length > 0 && (
              <select
                value={sprintFilter}
                onChange={(e) => setSprintFilter(e.target.value)}
                className="h-8 px-2.5 bg-white dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700/60 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-700 dark:text-slate-300 cursor-pointer focus:outline-hidden hover:border-slate-400 dark:hover:border-slate-600 shadow-2xs transition-colors"
              >
                <option value="ALL">Sprint: All</option>
                <option value="BACKLOG">Backlog (No Sprint)</option>
                {sprints.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name} {sp.status === 'ACTIVE' ? '(Active)' : ''}
                  </option>
                ))}
              </select>
            )}

            {/* Color Mode Switcher */}
            <button
              type="button"
              onClick={() => setColorMode((prev) => (prev === 'status' ? 'priority' : 'status'))}
              className="h-8 px-2 bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700/60 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              title="Toggle task card color coding"
            >
              <Palette className="w-3.5 h-3.5 text-blue-400" />
              <span className="capitalize">{colorMode}</span>
            </button>

            {/* Clear Filters Button */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="h-8 px-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
              >
                <X className="w-3 h-3" />
                <span>Clear</span>
              </button>
            )}
          </div>

          {/* Quick Schedule Stat Counters */}
          <div className="hidden md:flex items-center gap-3 text-xs text-slate-400 font-medium">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <strong className="text-slate-800 dark:text-slate-200">{scheduledIssues.length}</strong> scheduled
            </span>
            {analyticsKPIs.overdueCount > 0 && (
              <span className="flex items-center gap-1.5 text-rose-400 font-semibold">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <strong>{analyticsKPIs.overdueCount}</strong> overdue
              </span>
            )}
            <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <strong className="text-emerald-300">{analyticsKPIs.completedCount}</strong> delivered
            </span>
          </div>
        </div>

        {/* Capacity Overload Alert Banner */}
        {capacityWarning && (
          <div className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-lg text-xs font-medium flex items-center justify-between gap-2 animate-in fade-in">
            <div className="flex items-center gap-2 truncate">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="truncate">{capacityWarning}</span>
            </div>
            <button
              type="button"
              onClick={() => setCapacityWarning(null)}
              className="hover:opacity-75 p-0.5 cursor-pointer text-amber-400"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ----------------------------------------------------------- */}
        {/* COLLAPSIBLE ANALYTICS BAR (8 Real KPIs)                     */}
        {/* ----------------------------------------------------------- */}
        {showAnalyticsBar && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 animate-in slide-in-from-top-2 duration-200">
            {/* 1. Scheduled Tasks */}
            <div
              onClick={() =>
                setDrillDownModal({
                  isOpen: true,
                  title: 'Scheduled Deliverables',
                  subtitle: 'All project tasks possessing an assigned delivery deadline',
                  category: 'Calendar Planning',
                  metricLabel: 'Scheduled Tasks',
                  issues: scheduledIssues,
                })
              }
              className="bg-white dark:bg-slate-900/90 hover:bg-slate-50 dark:hover:bg-slate-800/80 border border-slate-300 dark:border-slate-800 rounded-lg p-2 cursor-pointer transition-all hover:border-blue-500/50 shadow-2xs"
            >
              <div className="text-[10px] font-bold text-slate-400 uppercase truncate">Scheduled</div>
              <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{analyticsKPIs.totalScheduled}</div>
              <div className="text-[9px] text-slate-400 flex items-center gap-1 truncate">
                <CalendarRange className="w-2.5 h-2.5 text-blue-400" />
                <span>Active Horizon</span>
              </div>
            </div>

            {/* 2. Completed Tasks */}
            <div
              onClick={() =>
                setDrillDownModal({
                  isOpen: true,
                  title: 'Completed Scheduled Deliverables',
                  subtitle: 'Tasks completed on or before scheduled dates',
                  category: 'Delivery',
                  metricLabel: 'Completed Tasks',
                  issues: analyticsKPIs.completedTasks,
                })
              }
              className="bg-white dark:bg-slate-900/90 hover:bg-slate-50 dark:hover:bg-slate-800/80 border border-slate-300 dark:border-slate-800 rounded-lg p-2 cursor-pointer transition-all hover:border-emerald-500/50 shadow-2xs"
            >
              <div className="text-[10px] font-bold text-slate-400 uppercase truncate">Completed</div>
              <div className="text-lg font-bold text-emerald-400">
                {analyticsKPIs.completedCount}
              </div>
              <div className="text-[9px] text-emerald-400 flex items-center gap-1 font-semibold truncate">
                <CheckCircle2 className="w-2.5 h-2.5" />
                <span>Delivered</span>
              </div>
            </div>

            {/* 3. Overdue Tasks */}
            <div
              onClick={() =>
                setDrillDownModal({
                  isOpen: true,
                  title: 'Overdue Project Tasks',
                  subtitle: 'Past-due deliverables requiring immediate triage',
                  category: 'Risk Radar',
                  metricLabel: 'Overdue Tasks',
                  issues: analyticsKPIs.overdueTasks,
                })
              }
              className="bg-white dark:bg-slate-900/90 hover:bg-slate-50 dark:hover:bg-slate-800/80 border border-slate-300 dark:border-slate-800 rounded-lg p-2 cursor-pointer transition-all hover:border-rose-500/50 shadow-2xs"
            >
              <div className="text-[10px] font-bold text-slate-400 uppercase truncate">Overdue</div>
              <div className="text-lg font-bold text-rose-400">
                {analyticsKPIs.overdueCount}
              </div>
              <div className="text-[9px] text-rose-400 flex items-center gap-1 font-semibold truncate">
                <AlertCircle className="w-2.5 h-2.5" />
                <span>Past Due</span>
              </div>
            </div>

            {/* 4. Due This Week */}
            <div
              onClick={() =>
                setDrillDownModal({
                  isOpen: true,
                  title: 'Deliverables Due This Week',
                  subtitle: 'Committed tasks reaching maturity in the current work week',
                  category: 'Horizon',
                  metricLabel: 'Tasks Due This Week',
                  issues: analyticsKPIs.dueThisWeekTasks,
                })
              }
              className="bg-white dark:bg-slate-900/90 hover:bg-slate-50 dark:hover:bg-slate-800/80 border border-slate-300 dark:border-slate-800 rounded-lg p-2 cursor-pointer transition-all hover:border-amber-500/50 shadow-2xs"
            >
              <div className="text-[10px] font-bold text-slate-400 uppercase truncate">Due This Week</div>
              <div className="text-lg font-bold text-amber-400">
                {analyticsKPIs.dueThisWeekCount}
              </div>
              <div className="text-[9px] text-amber-400 flex items-center gap-1 truncate">
                <Clock className="w-2.5 h-2.5" />
                <span>7-Day Window</span>
              </div>
            </div>

            {/* 5. Unassigned Deliverables */}
            <div
              onClick={() =>
                setDrillDownModal({
                  isOpen: true,
                  title: 'Unassigned Scheduled Deliverables',
                  subtitle: 'Tasks possessing deadlines but awaiting owner allocation',
                  category: 'Resourcing',
                  metricLabel: 'Unassigned Tasks',
                  issues: analyticsKPIs.unassignedTasks,
                })
              }
              className="bg-white dark:bg-slate-900/90 hover:bg-slate-50 dark:hover:bg-slate-800/80 border border-slate-300 dark:border-slate-800 rounded-lg p-2 cursor-pointer transition-all hover:border-indigo-500/50 shadow-2xs"
            >
              <div className="text-[10px] font-bold text-slate-400 uppercase truncate">Unassigned</div>
              <div className="text-lg font-bold text-indigo-400">
                {analyticsKPIs.unassignedCount}
              </div>
              <div className="text-[9px] text-indigo-400 flex items-center gap-1 truncate">
                <UserIcon className="w-2.5 h-2.5" />
                <span>Needs Owner</span>
              </div>
            </div>

            {/* 6. Completion Rate */}
            <div
              onClick={() =>
                setDrillDownModal({
                  isOpen: true,
                  title: 'Schedule Delivery Completion Rate',
                  subtitle: 'Percentage of scheduled items successfully delivered',
                  category: 'Velocity',
                  metricLabel: 'Delivered',
                  issues: analyticsKPIs.completedTasks,
                  percentage: analyticsKPIs.completionRate,
                })
              }
              className="bg-white dark:bg-slate-900/90 hover:bg-slate-50 dark:hover:bg-slate-800/80 border border-slate-300 dark:border-slate-800 rounded-lg p-2 cursor-pointer transition-all hover:border-teal-500/50 shadow-2xs"
            >
              <div className="text-[10px] font-bold text-slate-400 uppercase truncate">Completion %</div>
              <div className="text-lg font-bold text-teal-400">{analyticsKPIs.completionRate}%</div>
              <div className="text-[9px] text-slate-400 flex items-center gap-1 truncate">
                <TrendingUp className="w-2.5 h-2.5 text-teal-400" />
                <span>On-Time Rate</span>
              </div>
            </div>

            {/* 7. Total Story Points */}
            <div
              onClick={() =>
                setDrillDownModal({
                  isOpen: true,
                  title: 'Scheduled Story Points Commitment',
                  subtitle: 'Sum of all estimation points allocated across the schedule',
                  category: 'Capacity',
                  metricLabel: 'Story Points',
                  issues: scheduledIssues,
                })
              }
              className="bg-white dark:bg-slate-900/90 hover:bg-slate-50 dark:hover:bg-slate-800/80 border border-slate-300 dark:border-slate-800 rounded-lg p-2 cursor-pointer transition-all hover:border-purple-500/50 shadow-2xs"
            >
              <div className="text-[10px] font-bold text-slate-400 uppercase truncate">Story Points</div>
              <div className="text-lg font-bold text-purple-400">{analyticsKPIs.totalPoints} pts</div>
              <div className="text-[9px] text-slate-400 flex items-center gap-1 truncate">
                <Zap className="w-2.5 h-2.5 text-purple-400" />
                <span>Committed</span>
              </div>
            </div>

            {/* 8. Active Work Days */}
            <div
              onClick={() =>
                setDrillDownModal({
                  isOpen: true,
                  title: 'Active Delivery Days',
                  subtitle: 'Calendar days that have scheduled work items',
                  category: 'Distribution',
                  metricLabel: 'Active Work Days',
                  issues: scheduledIssues,
                })
              }
              className="bg-white dark:bg-slate-900/90 hover:bg-slate-50 dark:hover:bg-slate-800/80 border border-slate-300 dark:border-slate-800 rounded-lg p-2 cursor-pointer transition-all hover:border-sky-500/50 shadow-2xs"
            >
              <div className="text-[10px] font-bold text-slate-400 uppercase truncate">Active Days</div>
              <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{analyticsKPIs.activeDaysCount}</div>
              <div className="text-[9px] text-slate-400 flex items-center gap-1 truncate">
                <CalendarDays className="w-2.5 h-2.5 text-sky-400" />
                <span>Spread</span>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ------------------------------------------------------------- */}
      {/* 2. CALENDAR GRID CONTAINER (WEEK-ROW ISOLATED & UNCONGESTED)  */}
      {/* ------------------------------------------------------------- */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* Calendar Area */}
        <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950 overflow-hidden">
          {viewMode === 'day' ? (
            /* --- DAY VIEW --- */
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    {MONTH_NAMES[dayViewData.date.getMonth()]} {dayViewData.date.getDate()},{' '}
                    {dayViewData.date.getFullYear()}
                    {dayViewData.isToday && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white">
                        Today
                      </span>
                    )}
                    {dayViewData.isWeekend && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                        Weekend
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {dayViewData.issues.length} {dayViewData.issues.length === 1 ? 'task' : 'tasks'} scheduled for this date.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setQuickCreateDate(dayViewData.dateStr)}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Schedule Task</span>
                </button>
              </div>

              {/* Day Tasks List */}
              <div className="space-y-2 max-w-4xl">
                {dayViewData.issues.map((issue) => {
                  const countdown = getDateCountdown(issue.dueDate);
                  const isDone = isDoneStatus(issue.status);
                  return (
                    <div
                      key={issue.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', issue.id);
                        setDraggedIssue(issue);
                      }}
                      onClick={() => onSelectIssue(issue)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer bg-white dark:bg-slate-900/80 hover:bg-slate-50 dark:hover:bg-slate-850 flex items-center justify-between shadow-2xs ${
                        isDone
                          ? 'border-emerald-400 dark:border-emerald-500/40 opacity-70'
                          : countdown.tone === 'overdue' ? 'border-rose-300 dark:border-rose-500/40 bg-rose-50/20 dark:bg-rose-950/20 border-l-4 border-l-rose-500'
                          : 'border-slate-300 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={selectedIssueIds.has(issue.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleToggleSelectIssue(issue.id);
                          }}
                          className="rounded border-slate-700 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={getIssueKeyClass(isIssueDone(issue, statuses), "text-xs")}>
                              {issue.issueKey}
                            </span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-md shadow-2xs ${getPriorityBadgeClass(issue.priority)}`}>
                              {issue.priority}
                            </span>
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              {issue.status?.name || 'Open'}
                            </span>
                          </div>
                          <div className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-0.5 truncate">
                            {issue.title}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-slate-400 shrink-0">
                        {issue.estimatePoints && (
                          <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                            {issue.estimatePoints} pts
                          </span>
                        )}
                        {issue.assignee ? (
                          <div className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                            <div className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-400/30 flex items-center justify-center text-[9px] font-bold">
                              {(issue.assignee.firstName || issue.assignee.email || '?')[0].toUpperCase()}
                            </div>
                            <span className="truncate max-w-[100px]">
                              {issue.assignee.firstName || issue.assignee.email.split('@')[0]}
                            </span>
                          </div>
                        ) : (
                          <span className="italic font-medium text-amber-600 dark:text-amber-400">Unassigned</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {dayViewData.issues.length === 0 && (
                  <div className="text-center py-16 bg-slate-50 dark:bg-slate-900/30 border border-dashed border-slate-300 dark:border-slate-800 rounded-xl">
                    <CalendarDays className="w-10 h-10 mx-auto text-slate-600 mb-2" />
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No scheduled tasks for this date.</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Drag a task from the unscheduled pool or click below to schedule.
                    </p>
                    <button
                      type="button"
                      onClick={() => setQuickCreateDate(dayViewData.dateStr)}
                      className="mt-3 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Create Task for {dayViewData.dateStr}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : viewMode === 'month' ? (
            /* --- MONTH VIEW (WEEK-BY-WEEK ROW ISOLATION) --- */
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Sticky Weekday Header */}
              <div className="grid grid-cols-7 border-b border-slate-300 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-[11px] font-bold tracking-wider text-slate-600 dark:text-slate-400 uppercase py-2 text-center sticky top-0 z-10 shrink-0 select-none">
                {WEEKDAY_NAMES_FULL.map((day) => (
                  <div key={day} className="truncate">
                    <span className="hidden sm:inline">{day}</span>
                    <span className="sm:hidden">{day[0]}</span>
                  </div>
                ))}
              </div>

              {/* Scrollable Week Rows Container */}
              <div className="flex-1 flex flex-col min-h-0 overflow-y-auto divide-y divide-slate-300 dark:divide-slate-800/80 bg-slate-50 dark:bg-slate-950">
                {monthWeeks.map((week, weekIdx) => (
                  <div key={weekIdx} className="grid grid-cols-7 flex-1 min-h-[100px] sm:min-h-[140px] shrink-0">
                    {week.map((cell) => renderDayCell(cell))}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* --- WEEK / WORKWEEK VIEW --- */
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Weekday Header */}
              <div
                className={`grid border-b border-slate-300 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-[11px] font-bold tracking-wider text-slate-600 dark:text-slate-400 uppercase py-2 text-center sticky top-0 z-10 shrink-0 select-none ${
                  viewMode === 'workweek' ? 'grid-cols-5' : 'grid-cols-7'
                }`}
              >
                {(viewMode === 'workweek' ? WEEKDAY_NAMES_WORK : WEEKDAY_NAMES_FULL).map((day) => (
                  <div key={day} className="truncate">
                    <span className="hidden sm:inline">{day}</span>
                    <span className="sm:hidden">{day[0]}</span>
                  </div>
                ))}
              </div>

              {/* Week Columns */}
              <div
                className={`flex-1 grid overflow-y-auto bg-slate-50 dark:bg-slate-950 ${
                  viewMode === 'workweek' ? 'grid-cols-5' : 'grid-cols-7'
                }`}
              >
                {weekCalendarDays.map((cell) => renderDayCell(cell, true))}
              </div>
            </div>
          )}
        </div>

        {/* ----------------------------------------------------------- */}
        {/* 3. UNSCHEDULED BACKLOG WORK TRAY                            */}
        {/* ----------------------------------------------------------- */}
        {isUnscheduledOpen && (
          <aside
            onDragOver={(e) => {
              e.preventDefault();
              setIsOverUnscheduledTray(true);
            }}
            onDragLeave={() => setIsOverUnscheduledTray(false)}
            onDrop={(e) => {
              e.preventDefault();
              handleDropOnUnscheduled();
            }}
            className={`w-80 border-l border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col shrink-0 z-10 shadow-2xl transition-all ${
              isOverUnscheduledTray ? 'ring-2 ring-inset ring-amber-500 bg-amber-950/20' : ''
            }`}
          >
            {/* Tray Header */}
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-850">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-amber-400" />
                  <span>Unscheduled Pool</span>
                </h4>
                <p className="text-[11px] text-slate-400">
                  {unscheduledIssues.length} tasks without delivery deadlines
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsUnscheduledOpen(false)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drag Target Notice */}
            {draggedIssue && (
              <div className="p-2 bg-amber-500/15 border-b border-amber-500/30 text-amber-300 text-xs font-semibold flex items-center gap-1.5 animate-pulse">
                <CornerDownLeft className="w-3.5 h-3.5" />
                <span>Drop here to remove deadline & move to Backlog</span>
              </div>
            )}

            {/* Search Tray Input */}
            <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Filter unscheduled tasks..."
                  value={unscheduledSearch}
                  onChange={(e) => setUnscheduledSearch(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 bg-white dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700/80 rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-500 focus:outline-hidden focus:border-amber-500"
                />
                {unscheduledSearch && (
                  <button
                    type="button"
                    onClick={() => setUnscheduledSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Unscheduled Task Cards List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {displayedUnscheduled.map((issue) => (
                <div
                  key={issue.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', issue.id);
                    setDraggedIssue(issue);
                  }}
                  onClick={() => onSelectIssue(issue)}
                  className="p-2 bg-white dark:bg-slate-800/70 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700/70 hover:border-amber-500/50 rounded-lg transition-all cursor-grab active:cursor-grabbing group shadow-2xs"
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className={getIssueKeyClass(isIssueDone(issue, statuses), "text-[10px]")}>
                      {issue.issueKey}
                    </span>
                    <span
                      className={`text-[9px] font-semibold px-1.5 py-0.2 rounded ${
                        issue.priority === 'CRITICAL'
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-slate-900 text-slate-400'
                      }`}
                    >
                      {issue.priority}
                    </span>
                  </div>
                  <div className="text-xs font-medium text-slate-800 dark:text-slate-200 line-clamp-2 leading-snug">
                    {issue.title}
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-700/50 text-[10px] text-slate-400">
                    <span>{issue.status?.name || 'Backlog'}</span>
                    {issue.estimatePoints && (
                      <span className="font-mono font-semibold bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 px-1.5 py-0.2 rounded">
                        {issue.estimatePoints} pts
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {displayedUnscheduled.length === 0 && (
                <div className="text-center py-10 text-slate-500 text-xs">
                  {unscheduledIssues.length === 0
                    ? 'All project tasks are scheduled!'
                    : 'No matching unscheduled tasks.'}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 4. MODALS & POPUPS                                            */}
      {/* ------------------------------------------------------------- */}

      {/* A. Selected Day Details Popover / Modal */}
      {selectedDayDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-850">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-blue-400" />
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Schedule for {MONTH_NAMES[selectedDayDetails.getMonth()]}{' '}
                    {selectedDayDetails.getDate()}, {selectedDayDetails.getFullYear()}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {selectedDayIssues.length} total deliverables assigned to this date
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDayDetails(null)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter Day Search */}
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-between gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Filter tasks on this date..."
                  value={daySearchQuery}
                  onChange={(e) => setDaySearchQuery(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 bg-white dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700/80 rounded-lg text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setQuickCreateDate(formatDateIso(selectedDayDetails));
                  setSelectedDayDetails(null);
                }}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shrink-0 cursor-pointer shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Task</span>
              </button>
            </div>

            {/* Tasks List */}
            <div className="p-4 overflow-y-auto space-y-2 flex-1">
              {filteredSelectedDayIssues.map((issue) => {
                const countdown = getDateCountdown(issue.dueDate);
                const isDone = isDoneStatus(issue.status);
                return (
                  <div
                    key={issue.id}
                    onClick={() => {
                      onSelectIssue(issue);
                      setSelectedDayDetails(null);
                    }}
                    className={`p-3 rounded-xl border transition-all cursor-pointer bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between shadow-2xs ${
                      isDone
                        ? 'border-emerald-400 dark:border-emerald-500/30 opacity-70'
                        : countdown.tone === 'overdue' ? 'border-rose-300 dark:border-rose-500/40 bg-rose-50/20 dark:bg-rose-950/20 border-l-4 border-l-rose-500'
                        : 'border-slate-300 dark:border-slate-700/60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={getIssueKeyClass(isIssueDone(issue, statuses), "text-xs")}>
                            {issue.issueKey}
                          </span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shadow-2xs">
                            {issue.status?.name || 'Open'}
                          </span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-md shadow-2xs ${getPriorityBadgeClass(issue.priority)}`}>
                            {issue.priority}
                          </span>
                        </div>
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-0.5 truncate">
                          {issue.title}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-slate-400 shrink-0">
                      {issue.estimatePoints && (
                        <span className="font-mono text-[10px] font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2 py-0.5 rounded-md shadow-2xs">
                          {issue.estimatePoints} pts
                        </span>
                      )}
                      {issue.assignee ? (
                        <span className="font-medium text-slate-700 dark:text-slate-300 truncate max-w-[120px]">
                          {issue.assignee.firstName || issue.assignee.email.split('@')[0]}
                        </span>
                      ) : (
                        <span className="italic font-medium text-amber-600 dark:text-amber-400">Unassigned</span>
                      )}
                    </div>
                  </div>
                );
              })}

              {filteredSelectedDayIssues.length === 0 && (
                <div className="text-center py-8 text-slate-500 text-xs">
                  No tasks match the filter for this date.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* B. Full Quick Create Task Modal */}
      {quickCreateDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-850">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-400" />
                <span>Schedule Task for {quickCreateDate}</span>
              </h3>
              <button
                type="button"
                onClick={() => setQuickCreateDate(null)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white rounded cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleQuickCreateSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Title <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Task title..."
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Add details, acceptance criteria..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Priority
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200"
                  >
                    {priorityList.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Type
                  </label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200"
                  >
                    <option value="TASK">Task</option>
                    <option value="BUG">Bug</option>
                    <option value="STORY">Story</option>
                    <option value="FEATURE">Feature</option>
                    <option value="INCIDENT">Incident</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Assignee
                  </label>
                  <select
                    value={newAssigneeId}
                    onChange={(e) => setNewAssigneeId(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200"
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => {
                      const u = m.user || m;
                      const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
                      return (
                        <option key={u.id} value={u.id}>
                          {name}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Story Points
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 5"
                    value={newPoints}
                    onChange={(e) =>
                      setNewPoints(e.target.value === '' ? '' : parseInt(e.target.value, 10))
                    }
                    className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setQuickCreateDate(null)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingQuickCreate}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold shadow-md cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingQuickCreate ? 'Creating...' : 'Schedule Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* C. Schedule Conflicts Modal */}
      {showConflictsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-850">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-rose-400" />
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Schedule Conflict Radar ({scheduleConflicts.length})
                  </h3>
                  <p className="text-xs text-slate-400">
                    Automated analysis of delivery bottlenecks, sprint overlaps, and risks
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowConflictsModal(false)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white rounded cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
              {scheduleConflicts.map((conf, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-xl border flex items-start gap-3 ${
                    conf.severity === 'HIGH'
                      ? 'bg-rose-950/20 border-rose-500/40 text-rose-200'
                      : conf.severity === 'MEDIUM'
                      ? 'bg-amber-950/20 border-amber-500/40 text-amber-200'
                      : 'bg-white dark:bg-slate-800/60 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-300'
                  }`}
                >
                  <AlertTriangle
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      conf.severity === 'HIGH'
                        ? 'text-rose-400'
                        : conf.severity === 'MEDIUM'
                        ? 'text-amber-400'
                        : 'text-slate-400'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{conf.title}</span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                          conf.severity === 'HIGH'
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {conf.type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{conf.description}</p>
                    {conf.issue && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectIssue(conf.issue);
                          setShowConflictsModal(false);
                        }}
                        className="mt-2 text-[11px] font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer"
                      >
                        <span>Open {conf.issue.issueKey}</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* D. Calendar Schedule Reports Hub Modal */}
      {showReportsHub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-850">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Calendar & Schedule Reports Hub</h3>
                  <p className="text-xs text-slate-400">Download formatted reports in CSV, Excel, or printable PDF format</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowReportsHub(false)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white rounded cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
              {CALENDAR_REPORTS_LIST.map((rep) => (
                <div
                  key={rep.id}
                  className="p-3 rounded-xl border border-slate-300 dark:border-slate-700/80 bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{rep.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{rep.desc}</div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setReportModal({
                          isOpen: true,
                          reportType: rep.id,
                          reportTitle: rep.name,
                          reportDescription: rep.desc,
                        });
                        setShowReportsHub(false);
                      }}
                      className="px-2.5 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>View</span>
                    </button>
                    <a
                      href={`/api/projects/${projectId}/reports?reportType=${rep.id}&format=csv`}
                      download
                      className="px-2 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                      title="Download CSV"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>CSV</span>
                    </a>
                    <a
                      href={`/api/projects/${projectId}/reports?reportType=${rep.id}&format=excel`}
                      download
                      className="px-2 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                      title="Download Excel"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Excel</span>
                    </a>
                    <a
                      href={`/api/projects/${projectId}/reports?reportType=${rep.id}&format=pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      title="Print PDF"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>PDF</span>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* E. Live Standardized Report View Modal */}
      <ReportViewModal
        isOpen={reportModal.isOpen}
        onClose={() => setReportModal((prev) => ({ ...prev, isOpen: false }))}
        reportType={reportModal.reportType}
        reportTitle={reportModal.reportTitle}
        reportDescription={reportModal.reportDescription}
        category="Calendar Planning"
        issues={scheduledIssues}
        projectId={projectId}
        projectName={projectName}
        onSelectIssue={onSelectIssue}
      />

      {/* F. Analytics DrillDown Modal */}
      {drillDownModal.isOpen && (
        <AnalyticsDrillDownModal
          isOpen={drillDownModal.isOpen}
          onClose={() => setDrillDownModal((prev) => ({ ...prev, isOpen: false }))}
          title={drillDownModal.title}
          subtitle={drillDownModal.subtitle}
          category={drillDownModal.category}
          metricLabel={drillDownModal.metricLabel}
          issues={drillDownModal.issues}
          percentage={drillDownModal.percentage}
          onSelectIssue={(issue) => {
            onSelectIssue(issue);
            setDrillDownModal((prev) => ({ ...prev, isOpen: false }));
          }}
        />
      )}
    </div>
  );
}
