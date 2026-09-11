'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Users,
  User,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  Filter,
  SlidersHorizontal,
  Edit2,
  Check,
  X,
  RotateCcw,
  Sparkles,
  Zap,
  ArrowRight,
  Shield,
  Layers,
  ChevronDown,
  Info,
  Calendar,
  CheckSquare,
  Square,
  BarChart2,
  TrendingUp,
  FileText,
  History,
  Download,
  Printer,
  FileSpreadsheet,
  Eye,
  FolderGit2,
  Target,
  Flame,
  ShieldAlert,
  ArrowUpRight,
  HelpCircle,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';
import { AnalyticsDrillDownModal } from '@/components/analytics/AnalyticsDrillDownModal';
import { ReportViewModal } from '@/components/analytics/ReportViewModal';
import { SmartRebalanceModal } from '@/components/workload/SmartRebalanceModal';

interface WorkloadViewProps {
  issues: any[];
  statuses?: any[];
  priorities?: any[];
  members?: any[];
  teams?: any[];
  sprints?: any[];
  projects?: any[];
  projectId?: string;
  projectName?: string;
  currentUser?: any;
  onSelectProject?: (projectId: string) => void;
  onSelectIssue: (issue: any) => void;
  onRefresh?: () => void;
}

type MetricUnit = 'PTS' | 'HOURS' | 'COUNT';
type MemberHealthTier = 'CRITICAL' | 'OVERLOADED' | 'OPTIMAL' | 'UNDER' | 'AVAILABLE';
type ActiveTab = 'PLANNER' | 'MATRIX' | 'RISKS' | 'FORECAST' | 'TRENDS' | 'REPORTS' | 'AUDIT';

export const WORKLOAD_REPORTS_LIST = [
  { id: 'team-capacity', name: 'Team Capacity & Bandwidth Report', desc: 'Developer capacity limits, available bandwidth, and iteration thresholds.' },
  { id: 'team-workload', name: 'Team Workload & Allocation Report', desc: 'Active task assignments, story points load, and team capacity distribution.' },
  { id: 'member-utilization', name: 'Member Utilization Breakdown', desc: 'Granular workload percentages, completed vs pending tasks per engineer.' },
  { id: 'overloaded-members', name: 'Overloaded Members & Bottleneck Risk', desc: 'Work items assigned to developers exceeding healthy capacity thresholds (>100%).' },
  { id: 'unassigned-work', name: 'Unassigned Work Pool Report', desc: 'All unscoped and unassigned iteration tasks awaiting resource allocation.' },
  { id: 'sprint-capacity', name: 'Sprint Capacity & Commitment Planning', desc: 'Committed iteration story points versus total team bandwidth.' },
  { id: 'capacity-vs-commitment', name: 'Capacity vs Commitment Comparison', desc: 'Variance analysis between estimated capacity and actual delivered commitment.' },
  { id: 'workload-trend', name: 'Historical Workload & Throughput Trend', desc: 'Cross-sprint tracking of team workload volume and capacity utilization.' },
  { id: 'reassignment-activity', name: 'Workload Reassignment & Audit Activity', desc: 'Audit log of task reassignments, unassignments, and capacity adjustments.' },
];

export function WorkloadView({
  issues,
  statuses = [],
  priorities = [],
  members = [],
  teams = [],
  sprints = [],
  projects = [],
  projectId = 'default',
  projectName = 'Current Project',
  currentUser,
  onSelectProject,
  onSelectIssue,
  onRefresh,
}: WorkloadViewProps) {
  // --- Active Tab State ---
  const [activeTab, setActiveTab] = useState<ActiveTab>('PLANNER');

  // --- Interactive Drill-Down Modal State ---
  const [drillDownModal, setDrillDownModal] = useState<{
    isOpen: boolean;
    title: string;
    subtitle?: string;
    category?: string;
    metricLabel?: string;
    percentage?: string | number;
    issues: any[];
  }>({
    isOpen: false,
    title: '',
    issues: [],
  });

  const openDrillDown = (params: {
    title: string;
    subtitle?: string;
    category?: string;
    metricLabel?: string;
    percentage?: string | number;
    issues: any[];
  }) => {
    setDrillDownModal({
      isOpen: true,
      ...params,
    });
  };

  // --- Report Modal State ---
  const [reportModal, setReportModal] = useState<{
    isOpen: boolean;
    reportType: string;
    reportTitle: string;
    reportDescription: string;
  }>({
    isOpen: false,
    reportType: 'team-workload',
    reportTitle: 'Team Workload & Capacity Utilization',
    reportDescription: 'Active task assignments, story points load, and team capacity distribution.',
  });

  // --- Metric & Scope State ---
  const [metricUnit, setMetricUnit] = useState<MetricUnit>('PTS');
  const [sprintScope, setSprintScope] = useState<string>('ALL');
  const [statusScope, setStatusScope] = useState<'ALL' | 'REMAINING'>('ALL');
  const [teamFilter, setTeamFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [healthFilter, setHealthFilter] = useState<'ALL' | MemberHealthTier>('ALL');

  // --- Multi-Select & Smart Rebalancing State ---
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [isRebalanceModalOpen, setIsRebalanceModalOpen] = useState<boolean>(false);
  const [singleRebalanceIssue, setSingleRebalanceIssue] = useState<any | null>(null);

  // --- Local Issues for Optimistic Drag-and-Drop & Rebalancing ---
  const [localIssues, setLocalIssues] = useState<any[]>(issues);

  useEffect(() => {
    setLocalIssues(issues);
  }, [issues]);

  // Set default sprint scope to Active Sprint if one exists
  useEffect(() => {
    const active = sprints.find((s: any) => s.status === 'ACTIVE');
    if (active) {
      setSprintScope(active.id);
    }
  }, [sprints]);

  // --- Available Teams List ---
  const allTeamsList = useMemo(() => {
    if (Array.isArray(teams) && teams.length > 0) {
      return teams;
    }
    const map = new Map<string, any>();
    if (Array.isArray(teams)) {
      teams.forEach((t: any) => {
        if (t && t.id) map.set(t.id, t);
      });
    }
    if (map.size === 0) {
      localIssues.forEach((i: any) => {
        if (i.team && i.team.id && !map.has(i.team.id)) {
          map.set(i.team.id, {
            id: i.team.id,
            name: i.team.name || 'Team',
            members: [],
          });
        }
      });
    }
    return Array.from(map.values());
  }, [teams, localIssues]);

  const selectedTeamObj = useMemo(() => {
    if (teamFilter === 'ALL') return null;
    return allTeamsList.find((t: any) => t.id === teamFilter) || null;
  }, [allTeamsList, teamFilter]);

  // User IDs belonging to selected team
  const selectedTeamUserIds = useMemo(() => {
    if (!selectedTeamObj) return null;
    const ids = new Set<string>();
    if (Array.isArray(selectedTeamObj.members)) {
      selectedTeamObj.members.forEach((tm: any) => {
        if (tm.userId) ids.add(tm.userId);
        if (tm.user?.id) ids.add(tm.user.id);
      });
    }
    localIssues.forEach((i: any) => {
      if (i.teamId === selectedTeamObj.id && i.assigneeId) {
        ids.add(i.assigneeId);
      }
    });
    return ids;
  }, [selectedTeamObj, localIssues]);

  // --- Capacities per Member ---
  const defaultCapacityForUnit = useMemo(() => {
    if (metricUnit === 'HOURS') return 40;
    if (metricUnit === 'COUNT') return 10;
    return 20; // Default 20 Story Points
  }, [metricUnit]);

  const [customCapacities, setCustomCapacities] = useState<Record<string, number>>({});
  const [editingCapacityMemberId, setEditingCapacityMemberId] = useState<string | null>(null);
  const [capacityInputVal, setCapacityInputVal] = useState<string>('');

  // Load custom capacities from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const storageKey = `zenith_cap_${projectId}_${metricUnit}`;
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        setCustomCapacities(JSON.parse(saved));
      } else {
        setCustomCapacities({});
      }
    } catch {
      // Ignore storage errors
    }
  }, [projectId, metricUnit]);

  const handleSaveMemberCapacity = (memberId: string, val: number) => {
    const clamped = Math.max(1, Math.min(999, Math.round(val)));
    const updated = { ...customCapacities, [memberId]: clamped };
    setCustomCapacities(updated);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(`zenith_cap_${projectId}_${metricUnit}`, JSON.stringify(updated));
      } catch {
        // Ignore
      }
    }
    setEditingCapacityMemberId(null);
    showSuccess(`Updated capacity to ${clamped} ${getUnitLabel(metricUnit)}`);
  };

  const handleResetMemberCapacity = (memberId: string) => {
    const updated = { ...customCapacities };
    delete updated[memberId];
    setCustomCapacities(updated);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(`zenith_cap_${projectId}_${metricUnit}`, JSON.stringify(updated));
      } catch {
        // Ignore
      }
    }
    setEditingCapacityMemberId(null);
    showSuccess(`Reset to default (${defaultCapacityForUnit} ${getUnitLabel(metricUnit)})`);
  };

  function getUnitLabel(unit: MetricUnit) {
    if (unit === 'HOURS') return 'hrs';
    if (unit === 'COUNT') return 'tasks';
    return 'pts';
  }

  // --- Drag and Drop State ---
  const [draggedIssueId, setDraggedIssueId] = useState<string | null>(null);
  const [dragOverTargetId, setDragOverTargetId] = useState<string | null>(null);

  // --- Priority Helpers ---
  const priorityList = priorities.length > 0 ? priorities : [
    { value: 'CRITICAL', color: '#ef4444' },
    { value: 'HIGHEST', color: '#f97316' },
    { value: 'HIGH', color: '#f59e0b' },
    { value: 'MEDIUM', color: '#3b82f6' },
    { value: 'LOW', color: '#10b981' },
    { value: 'LOWEST', color: '#64748b' },
  ];

  const getPriorityColor = useCallback((val: string) => {
    const found = priorityList.find(
      (p: any) => p.value === val || p.name?.toUpperCase() === val?.toUpperCase()
    );
    return found?.color || '#3b82f6';
  }, [priorityList]);

  // --- Status Categorization ---
  const categorizeStatus = useCallback((status: any) => {
    if (!status) return 'TO_DO';
    const cat = (status.category || '').toUpperCase();
    const name = (status.name || '').toLowerCase();
    if (cat === 'DONE' || name.includes('done') || name.includes('complete') || name.includes('closed')) {
      return 'DONE';
    }
    if (cat === 'IN_PROGRESS' || cat === 'REVIEW' || name.includes('progress') || name.includes('review') || name.includes('testing') || name.includes('qa')) {
      return 'IN_PROGRESS';
    }
    return 'TO_DO';
  }, []);

  // --- Metric Extraction per Issue ---
  const getIssueMetricValue = useCallback((issue: any, unit: MetricUnit) => {
    if (unit === 'COUNT') return 1;
    if (unit === 'HOURS') {
      return Math.max(0, Number(issue.estimateHours || issue.remainingHours || 0));
    }
    return Math.max(0, Number(issue.estimatePoints || 0));
  }, []);

  // --- Roster Aggregation ---
  const allRosterMembers = useMemo(() => {
    const map = new Map<string, any>();

    // 1. Members from project.members
    if (Array.isArray(members)) {
      members.forEach((pm: any) => {
        const u = pm.user || pm;
        if (u && u.id) {
          map.set(u.id, {
            id: u.id,
            name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Team Member',
            email: u.email || '',
            role: pm.role || u.jobTitle || 'Engineer',
            avatarUrl: u.avatarUrl,
            avatar: (u.firstName?.[0] || u.name?.[0] || u.email?.[0] || '?').toUpperCase(),
          });
        }
      });
    }

    // 2. Members from selected team
    if (selectedTeamObj && Array.isArray(selectedTeamObj.members)) {
      selectedTeamObj.members.forEach((tm: any) => {
        const u = tm.user;
        const uid = tm.userId || u?.id;
        if (uid && !map.has(uid)) {
          map.set(uid, {
            id: uid,
            name: u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Team Member' : 'Team Member',
            email: u?.email || '',
            role: tm.role || u?.jobTitle || 'Engineer',
            avatarUrl: u?.avatarUrl,
            avatar: (u?.firstName?.[0] || u?.email?.[0] || '?').toUpperCase(),
          });
        }
      });
    }

    // 3. Any assignees in issues
    localIssues.forEach((i: any) => {
      if (i.assignee && !map.has(i.assignee.id)) {
        map.set(i.assignee.id, {
          id: i.assignee.id,
          name: `${i.assignee.firstName || ''} ${i.assignee.lastName || ''}`.trim() || i.assignee.email || 'Team Member',
          email: i.assignee.email || '',
          role: i.assignee.jobTitle || 'Engineer',
          avatarUrl: i.assignee.avatarUrl,
          avatar: (i.assignee.firstName?.[0] || i.assignee.name?.[0] || i.assignee.email?.[0] || '?').toUpperCase(),
        });
      }
    });

    let roster = Array.from(map.values());
    if (selectedTeamUserIds) {
      roster = roster.filter((m) => selectedTeamUserIds.has(m.id));
    }

    return roster;
  }, [members, localIssues, selectedTeamObj, selectedTeamUserIds]);

  // --- Filter Issues by Sprint, Team, and Work Scope ---
  const scopedIssues = useMemo(() => {
    return localIssues.filter((issue) => {
      // 1. Sprint Scope Filter
      if (sprintScope === 'BACKLOG') {
        if (issue.sprintId) return false;
      } else if (sprintScope !== 'ALL') {
        if (issue.sprintId !== sprintScope) return false;
      }

      // 2. Team Filter
      if (teamFilter !== 'ALL') {
        const matchesTeamDirectly = issue.teamId === teamFilter;
        const matchesTeamMember = selectedTeamUserIds && issue.assigneeId && selectedTeamUserIds.has(issue.assigneeId);
        if (!matchesTeamDirectly && !matchesTeamMember) {
          return false;
        }
      }

      // 3. Work Scope (Remaining vs All)
      if (statusScope === 'REMAINING') {
        if (categorizeStatus(issue.status) === 'DONE') return false;
      }

      return true;
    });
  }, [localIssues, sprintScope, teamFilter, selectedTeamUserIds, statusScope, categorizeStatus]);

  const now = useMemo(() => new Date(), []);

  // --- Aggregate Member Capacities and Workloads with 5 Health Status Levels ---
  const { memberAggregates, unassignedIssues } = useMemo(() => {
    const unassigned: any[] = [];
    const memberIssueMap = new Map<string, any[]>();

    allRosterMembers.forEach((m) => {
      memberIssueMap.set(m.id, []);
    });

    scopedIssues.forEach((issue) => {
      if (issue.assigneeId && memberIssueMap.has(issue.assigneeId)) {
        memberIssueMap.get(issue.assigneeId)!.push(issue);
      } else if (issue.assignee && memberIssueMap.has(issue.assignee.id)) {
        memberIssueMap.get(issue.assignee.id)!.push(issue);
      } else {
        if (teamFilter === 'ALL' || issue.teamId === teamFilter) {
          unassigned.push(issue);
        }
      }
    });

    const aggregates = allRosterMembers.map((member) => {
      const assigned = memberIssueMap.get(member.id) || [];
      const capacity = customCapacities[member.id] || defaultCapacityForUnit;

      const doneIssues = assigned.filter((i) => categorizeStatus(i.status) === 'DONE');
      const inProgressIssues = assigned.filter((i) => categorizeStatus(i.status) === 'IN_PROGRESS');
      const toDoIssues = assigned.filter((i) => categorizeStatus(i.status) === 'TO_DO');
      const overdueIssues = assigned.filter(
        (i) => i.dueDate && new Date(i.dueDate) < now && categorizeStatus(i.status) !== 'DONE'
      );

      const doneVal = doneIssues.reduce((sum, i) => sum + getIssueMetricValue(i, metricUnit), 0);
      const inProgressVal = inProgressIssues.reduce((sum, i) => sum + getIssueMetricValue(i, metricUnit), 0);
      const toDoVal = toDoIssues.reduce((sum, i) => sum + getIssueMetricValue(i, metricUnit), 0);
      const overdueVal = overdueIssues.reduce((sum, i) => sum + getIssueMetricValue(i, metricUnit), 0);
      const totalVal = doneVal + inProgressVal + toDoVal;
      const remainingVal = inProgressVal + toDoVal;

      const percentage = capacity > 0 ? Math.round((totalVal / capacity) * 100) : 0;
      const availableCap = Math.max(0, capacity - totalVal);

      // Stacked Bar Proportions
      const donePct = capacity > 0 ? Math.min(100, Math.round((doneVal / capacity) * 100)) : 0;
      const inProgressPct = capacity > 0 ? Math.min(100 - donePct, Math.round((inProgressVal / capacity) * 100)) : 0;
      const toDoPct = capacity > 0 ? Math.min(100 - donePct - inProgressPct, Math.round((toDoVal / capacity) * 100)) : 0;

      // 5 Professional Health Status Levels
      let health: MemberHealthTier = 'OPTIMAL';
      let healthLabel = 'Healthy (80–100%)';
      let healthBadgeColor = 'bg-emerald-500 text-white';
      let healthBorderColor = 'border-emerald-200 dark:border-emerald-800';

      if (totalVal === 0) {
        health = 'AVAILABLE';
        healthLabel = 'No Allocation (0%)';
        healthBadgeColor = 'bg-slate-400 text-white';
        healthBorderColor = 'border-border';
      } else if (percentage > 120) {
        health = 'CRITICAL';
        healthLabel = 'Critical (>120%)';
        healthBadgeColor = 'bg-rose-600 text-white';
        healthBorderColor = 'border-rose-300 dark:border-rose-900 bg-rose-50/10';
      } else if (percentage > 100) {
        health = 'OVERLOADED';
        healthLabel = 'Overloaded (>100%)';
        healthBadgeColor = 'bg-amber-500 text-white';
        healthBorderColor = 'border-amber-300 dark:border-amber-800 bg-amber-50/10';
      } else if (percentage >= 80) {
        health = 'OPTIMAL';
        healthLabel = 'Healthy (80–100%)';
        healthBadgeColor = 'bg-emerald-500 text-white';
        healthBorderColor = 'border-emerald-300 dark:border-emerald-800';
      } else {
        health = 'UNDER';
        healthLabel = 'Available (<80%)';
        healthBadgeColor = 'bg-blue-500 text-white';
        healthBorderColor = 'border-blue-200 dark:border-blue-900';
      }

      return {
        ...member,
        issues: assigned,
        doneIssues,
        inProgressIssues,
        toDoIssues,
        overdueIssues,
        doneVal,
        inProgressVal,
        toDoVal,
        overdueVal,
        totalVal,
        remainingVal,
        capacity,
        availableCap,
        percentage,
        isOverloaded: percentage > 100,
        isCritical: percentage > 120,
        donePct,
        inProgressPct,
        toDoPct,
        health,
        healthLabel,
        healthBadgeColor,
        healthBorderColor,
      };
    });

    return {
      memberAggregates: aggregates,
      unassignedIssues: unassigned,
    };
  }, [allRosterMembers, scopedIssues, teamFilter, customCapacities, defaultCapacityForUnit, categorizeStatus, getIssueMetricValue, metricUnit, now]);

  // --- Executive KPI Dashboard (8 Real Database Metrics) ---
  const summaryKPIs = useMemo(() => {
    const totalCapacity = memberAggregates.reduce((sum, m) => sum + m.capacity, 0);
    const totalAssigned = memberAggregates.reduce((sum, m) => sum + m.totalVal, 0);
    const availableCapacity = Math.max(0, totalCapacity - totalAssigned);
    const totalUtilization = totalCapacity > 0 ? Math.round((totalAssigned / totalCapacity) * 100) : 0;

    const overloadedMembers = memberAggregates.filter((m) => m.isOverloaded);
    const criticalOverloadedMembers = memberAggregates.filter((m) => m.isCritical);
    const availableMembers = memberAggregates.filter((m) => m.totalVal === 0 || m.health === 'UNDER');

    const unassignedTotal = unassignedIssues.reduce((sum, i) => sum + getIssueMetricValue(i, metricUnit), 0);

    const overdueIssues = scopedIssues.filter(
      (i) => i.dueDate && new Date(i.dueDate) < now && categorizeStatus(i.status) !== 'DONE'
    );
    const overdueTotal = overdueIssues.reduce((sum, i) => sum + getIssueMetricValue(i, metricUnit), 0);

    const criticalUnassignedIssues = unassignedIssues.filter(
      (i) => i.priority === 'CRITICAL' || i.priority === 'HIGHEST'
    );
    const criticalUnassignedTotal = criticalUnassignedIssues.reduce((sum, i) => sum + getIssueMetricValue(i, metricUnit), 0);

    const unestimatedIssues = scopedIssues.filter((i) => !i.estimatePoints && !i.estimateHours);

    const upcomingIssues = scopedIssues.filter((i) => {
      if (!i.dueDate || categorizeStatus(i.status) === 'DONE') return false;
      const d = new Date(i.dueDate);
      const diffDays = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 7;
    });

    return {
      totalCapacity,
      totalAssigned,
      availableCapacity,
      totalUtilization,
      overloadedCount: overloadedMembers.length,
      criticalOverloadedCount: criticalOverloadedMembers.length,
      availableCount: availableMembers.length,
      unassignedCount: unassignedIssues.length,
      unassignedTotal,
      overdueCount: overdueIssues.length,
      overdueTotal,
      overdueIssues,
      criticalUnassignedCount: criticalUnassignedIssues.length,
      criticalUnassignedTotal,
      criticalUnassignedIssues,
      unestimatedIssues,
      upcomingIssues,
    };
  }, [memberAggregates, unassignedIssues, scopedIssues, getIssueMetricValue, metricUnit, categorizeStatus, now]);

  // --- Filtered Member Cards based on Search & Status ---
  const displayedMembers = useMemo(() => {
    return memberAggregates.filter((member) => {
      // Health Filter
      if (healthFilter === 'CRITICAL' && !member.isCritical) return false;
      if (healthFilter === 'OVERLOADED' && !member.isOverloaded) return false;
      if (healthFilter === 'OPTIMAL' && member.health !== 'OPTIMAL') return false;
      if (healthFilter === 'UNDER' && member.health !== 'UNDER') return false;
      if (healthFilter === 'AVAILABLE' && member.health !== 'AVAILABLE') return false;

      // Search Query Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesMember =
          member.name.toLowerCase().includes(q) ||
          member.email.toLowerCase().includes(q) ||
          member.role.toLowerCase().includes(q);
        const matchesIssue = member.issues.some(
          (i: any) =>
            (i.issueKey && i.issueKey.toLowerCase().includes(q)) ||
            (i.title && i.title.toLowerCase().includes(q))
        );
        if (!matchesMember && !matchesIssue) return false;
      }

      return true;
    });
  }, [memberAggregates, healthFilter, searchQuery]);

  // --- Multi-Select Checkbox Actions ---
  const handleToggleSelectIssue = (issueId: string) => {
    setSelectedIssueIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  };

  const handleSelectAllInScope = () => {
    const allIds = new Set<string>();
    scopedIssues.forEach((i) => allIds.add(i.id));
    setSelectedIssueIds(allIds);
  };

  const handleClearSelection = () => {
    setSelectedIssueIds(new Set());
  };

  const selectedIssuesArray = useMemo(() => {
    return scopedIssues.filter((i) => selectedIssueIds.has(i.id));
  }, [scopedIssues, selectedIssueIds]);

  // --- Rebalance Action via Drag and Drop or Modal ---
  const handleReassignIssues = async (issueIds: string[], newAssigneeId: string | null) => {
    if (issueIds.length === 0) return;

    // Snapshot for rollback
    const previousSnapshot = localIssues.map((item) => ({ ...item }));

    const newAssigneeObj = newAssigneeId
      ? allRosterMembers.find((m) => m.id === newAssigneeId)
      : null;

    // Optimistic UI Update
    setLocalIssues((prev) =>
      prev.map((item) => {
        if (issueIds.includes(item.id)) {
          const newTeamId = (teamFilter !== 'ALL' && !item.teamId) ? teamFilter : item.teamId;
          return {
            ...item,
            assigneeId: newAssigneeId,
            teamId: newTeamId,
            assignee: newAssigneeObj
              ? {
                  id: newAssigneeObj.id,
                  firstName: newAssigneeObj.name.split(' ')[0],
                  lastName: newAssigneeObj.name.split(' ').slice(1).join(' '),
                  email: newAssigneeObj.email,
                  avatarUrl: newAssigneeObj.avatarUrl,
                }
              : null,
          };
        }
        return item;
      })
    );

    setDraggedIssueId(null);
    setDragOverTargetId(null);
    setSelectedIssueIds(new Set());

    const targetName = newAssigneeObj ? newAssigneeObj.name : 'Unassigned Pool';
    showSuccess(`Reassigned ${issueIds.length} ${issueIds.length === 1 ? 'task' : 'tasks'} to ${targetName}`);

    try {
      const res = await fetch('/api/issues/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueIds,
          updates: {
            assigneeId: newAssigneeId,
            teamId: teamFilter !== 'ALL' ? teamFilter : undefined,
          },
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to update issue assignments');
      }

      onRefresh?.();
    } catch (err: any) {
      // Revert optimistic update
      setLocalIssues(previousSnapshot);
      showError(err.message || 'Failed to reassign issues');
    }
  };

  // --- Historical Trends Analytics ---
  const historicalSprintsData = useMemo(() => {
    return sprints
      .filter((s: any) => s.status === 'COMPLETED' || s.status === 'ACTIVE')
      .slice(0, 6)
      .map((sp: any) => {
        const spIssues = issues.filter((i: any) => i.sprintId === sp.id);
        const allocated = spIssues.reduce((sum, i) => sum + getIssueMetricValue(i, metricUnit), 0);
        const completed = spIssues
          .filter((i) => categorizeStatus(i.status) === 'DONE')
          .reduce((sum, i) => sum + getIssueMetricValue(i, metricUnit), 0);
        const cap = allRosterMembers.length * defaultCapacityForUnit;
        const util = cap > 0 ? Math.round((allocated / cap) * 100) : 0;
        return {
          id: sp.id,
          name: sp.name,
          status: sp.status,
          capacity: cap,
          allocated,
          completed,
          utilization: util,
          issueCount: spIssues.length,
        };
      });
  }, [sprints, issues, allRosterMembers, defaultCapacityForUnit, getIssueMetricValue, metricUnit, categorizeStatus]);

  // --- Capacity Forecasting Engine ---
  const forecastData = useMemo(() => {
    const avgVelocity = historicalSprintsData.length > 0
      ? Math.round(historicalSprintsData.reduce((sum, s) => sum + s.completed, 0) / historicalSprintsData.length)
      : Math.round(summaryKPIs.totalCapacity * 0.75);

    const activeSprintPlanned = summaryKPIs.totalAssigned;
    const activeCapacity = summaryKPIs.totalCapacity;
    const activeRemaining = summaryKPIs.availableCapacity;

    // Upcoming sprints
    const upcomingSprints = sprints.filter((s: any) => s.status === 'FUTURE');

    const nextSprint = upcomingSprints[0] || { name: 'Next Sprint' };
    const nextIssues = issues.filter((i: any) => i.sprintId === nextSprint.id);
    const nextPlanned = nextIssues.reduce((sum, i) => sum + getIssueMetricValue(i, metricUnit), 0);

    return [
      {
        scope: 'Current Active Sprint',
        capacity: activeCapacity,
        planned: activeSprintPlanned,
        remaining: activeRemaining,
        expectedUtil: summaryKPIs.totalUtilization,
        surplus: Math.max(0, activeCapacity - activeSprintPlanned),
        deficit: Math.max(0, activeSprintPlanned - activeCapacity),
      },
      {
        scope: 'Next Sprint Projection',
        capacity: activeCapacity,
        planned: nextPlanned || avgVelocity,
        remaining: Math.max(0, activeCapacity - (nextPlanned || avgVelocity)),
        expectedUtil: Math.round(((nextPlanned || avgVelocity) / (activeCapacity || 1)) * 100),
        surplus: Math.max(0, activeCapacity - (nextPlanned || avgVelocity)),
        deficit: Math.max(0, (nextPlanned || avgVelocity) - activeCapacity),
      },
      {
        scope: 'Next 3 Sprints (Horizon)',
        capacity: activeCapacity * 3,
        planned: (nextPlanned || avgVelocity) * 3,
        remaining: Math.max(0, (activeCapacity * 3) - ((nextPlanned || avgVelocity) * 3)),
        expectedUtil: Math.round((((nextPlanned || avgVelocity) * 3) / (activeCapacity * 3 || 1)) * 100),
        surplus: Math.max(0, (activeCapacity * 3) - ((nextPlanned || avgVelocity) * 3)),
        deficit: Math.max(0, ((nextPlanned || avgVelocity) * 3) - (activeCapacity * 3)),
      },
    ];
  }, [historicalSprintsData, summaryKPIs, sprints, issues, getIssueMetricValue, metricUnit]);

  // --- Audit Trail from Issues' Activity Logs ---
  const auditLogs = useMemo(() => {
    const logs: any[] = [];
    issues.forEach((i: any) => {
      if (Array.isArray(i.activityLogs)) {
        i.activityLogs.forEach((al: any) => {
          if (al.actionType === 'UPDATED_ASSIGNEE' || al.fieldChanged === 'assignee' || al.actionType === 'BULK_UPDATE') {
            logs.push({
              id: al.id,
              issueKey: i.issueKey,
              issueTitle: i.title,
              actionType: al.actionType,
              actor: al.actor ? `${al.actor.firstName || ''} ${al.actor.lastName || ''}`.trim() || al.actor.email : 'System',
              oldAssignee: al.oldValue || 'Unassigned',
              newAssignee: al.newValue || 'Unassigned',
              timestamp: new Date(al.timestamp || i.updatedAt),
            });
          }
        });
      }
    });

    return logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [issues]);

  const activeSprintObj = sprints.find((s: any) => s.status === 'ACTIVE');

  return (
    <div className="flex-1 p-4 sm:p-6 space-y-6 max-w-7xl mx-auto w-full">
      {/* 1. Top Enterprise Header with Project Switcher & Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-5 bg-card/40 p-4 rounded-2xl border">
        <div className="space-y-1">
          <div className="flex items-center flex-wrap gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-xs">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                Team Workload &amp; Capacity Planner
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Live DB Data
                </span>
              </h1>
            </div>

            {/* Project Selector Dropdown */}
            {projects.length > 0 && onSelectProject && (
              <div className="flex items-center gap-1.5 ml-2 bg-background border border-border rounded-xl px-2.5 py-1 shadow-2xs">
                <FolderGit2 className="w-3.5 h-3.5 text-primary" />
                <select
                  value={projectId}
                  onChange={(e) => onSelectProject(e.target.value)}
                  className="bg-transparent text-xs font-bold text-foreground outline-none cursor-pointer"
                  aria-label="Switch project"
                >
                  {projects.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.key})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <span>Enterprise resource planning, developer bandwidth forecasting, and capacity rebalancing.</span>
            {selectedTeamObj && (
              <span className="font-semibold text-purple-600 dark:text-purple-400">
                • Filtered to Team: {selectedTeamObj.name}
              </span>
            )}
          </p>
        </div>

        {/* Action Controls & Report Access */}
        <div className="flex items-center gap-2 flex-wrap">
          {summaryKPIs.overloadedCount > 0 && (
            <button
              type="button"
              onClick={() => {
                const overloaded = memberAggregates.filter((m) => m.isOverloaded);
                const issuesToRebalance = overloaded.flatMap((m) => m.issues);
                if (issuesToRebalance.length > 0) {
                  setSingleRebalanceIssue(null);
                  setSelectedIssueIds(new Set(issuesToRebalance.slice(0, 5).map((i) => i.id)));
                  setIsRebalanceModalOpen(true);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 rounded-xl text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-100 transition-all cursor-pointer shadow-2xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Smart Rebalance ({summaryKPIs.overloadedCount} Overloaded)</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('REPORTS')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border hover:bg-muted rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-2xs"
          >
            <FileText className="w-3.5 h-3.5 text-primary" />
            <span>Workload Reports</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (onRefresh) onRefresh();
              showSuccess('Team workload refreshed from database');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border hover:bg-muted rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-2xs"
            title="Refresh from database"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* 2. Executive KPI Dashboard (8 Real Database Metrics) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {/* 1. Total Capacity */}
        <div
          onClick={() => openDrillDown({
            title: selectedTeamObj ? `${selectedTeamObj.name} Total Capacity` : 'Total Team Capacity',
            subtitle: `Configured throughput across ${memberAggregates.length} team members`,
            category: 'Team Capacity',
            metricLabel: `${summaryKPIs.totalCapacity} ${getUnitLabel(metricUnit)} total capacity`,
            issues: scopedIssues.filter((i) => i.assigneeId),
          })}
          className="bg-card border border-border p-3 rounded-xl shadow-2xs cursor-pointer hover:border-primary/60 hover:shadow-xs transition-all group"
          title="Click to view all team tasks"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className="truncate group-hover:text-primary transition-colors">Total Capacity</span>
            <Users className="w-3.5 h-3.5 text-primary shrink-0" />
          </div>
          <p className="text-xl font-black text-foreground mt-1">{summaryKPIs.totalCapacity}</p>
          <span className="text-[10px] text-muted-foreground font-mono">{getUnitLabel(metricUnit)} across {memberAggregates.length} devs</span>
        </div>

        {/* 2. Allocated Workload */}
        <div
          onClick={() => openDrillDown({
            title: 'Allocated Workload Tasks',
            subtitle: `${summaryKPIs.totalAssigned} ${getUnitLabel(metricUnit)} currently committed to developers`,
            category: 'Workload Allocation',
            metricLabel: `${summaryKPIs.totalAssigned} ${getUnitLabel(metricUnit)} assigned`,
            percentage: summaryKPIs.totalUtilization,
            issues: scopedIssues.filter((i) => i.assigneeId),
          })}
          className="bg-card border border-border p-3 rounded-xl shadow-2xs cursor-pointer hover:border-blue-500/60 hover:shadow-xs transition-all group"
          title="Click to inspect allocated work"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className="truncate group-hover:text-blue-500 transition-colors">Allocated Work</span>
            <Zap className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          </div>
          <p className="text-xl font-black text-blue-600 dark:text-blue-400 mt-1">{summaryKPIs.totalAssigned}</p>
          <span className="text-[10px] text-blue-600 font-bold">{getUnitLabel(metricUnit)} active</span>
        </div>

        {/* 3. Available Capacity */}
        <div
          onClick={() => {
            const availableIssues = memberAggregates
              .filter((m) => m.health === 'UNDER' || m.health === 'AVAILABLE')
              .flatMap((m) => m.issues);
            openDrillDown({
              title: 'Available Bandwidth Work',
              subtitle: `${summaryKPIs.availableCapacity} ${getUnitLabel(metricUnit)} unused headroom available for intake`,
              category: 'Available Capacity',
              metricLabel: `${summaryKPIs.availableCapacity} ${getUnitLabel(metricUnit)} available`,
              issues: availableIssues,
            });
          }}
          className="bg-card border border-border p-3 rounded-xl shadow-2xs cursor-pointer hover:border-emerald-500/60 hover:shadow-xs transition-all group"
          title="Click to view work on available devs"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className="truncate group-hover:text-emerald-500 transition-colors">Available Cap</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          </div>
          <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{summaryKPIs.availableCapacity}</p>
          <span className="text-[10px] text-emerald-600 font-bold">{getUnitLabel(metricUnit)} buffer</span>
        </div>

        {/* 4. Utilization % */}
        <div
          onClick={() => setActiveTab('MATRIX')}
          className="bg-card border border-border p-3 rounded-xl shadow-2xs cursor-pointer hover:border-primary/60 hover:shadow-xs transition-all group"
          title="Click to view capacity vs workload matrix"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className="truncate group-hover:text-foreground transition-colors">Utilization %</span>
            <TrendingUp className="w-3.5 h-3.5 text-primary shrink-0" />
          </div>
          <p className={`text-xl font-black mt-1 ${
            summaryKPIs.totalUtilization > 100
              ? 'text-rose-600 dark:text-rose-400'
              : summaryKPIs.totalUtilization >= 80
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-blue-600 dark:text-blue-400'
          }`}>
            {summaryKPIs.totalUtilization}%
          </p>
          <span className="text-[10px] text-muted-foreground font-semibold">
            {summaryKPIs.totalUtilization > 100 ? 'Over limit' : summaryKPIs.totalUtilization >= 80 ? 'Optimal load' : 'Under capacity'}
          </span>
        </div>

        {/* 5. Overloaded Members */}
        <div
          onClick={() => {
            const overloadedIssues = memberAggregates
              .filter((m) => m.isOverloaded)
              .flatMap((m) => m.issues);
            openDrillDown({
              title: 'Overloaded Members Work',
              subtitle: `Issues assigned to ${summaryKPIs.overloadedCount} overloaded team members`,
              category: 'Overloaded Members',
              metricLabel: `${summaryKPIs.overloadedCount} overloaded`,
              issues: overloadedIssues,
            });
          }}
          className={`bg-card border p-3 rounded-xl shadow-2xs cursor-pointer hover:shadow-xs transition-all group ${
            summaryKPIs.overloadedCount > 0
              ? 'border-rose-300 dark:border-rose-900 bg-rose-50/20 dark:bg-rose-950/10'
              : 'border-border'
          }`}
          title="Click to inspect overloaded work"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className={`truncate ${summaryKPIs.overloadedCount > 0 ? 'text-rose-600 font-bold' : ''}`}>Overloaded</span>
            <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${summaryKPIs.overloadedCount > 0 ? 'text-rose-600' : 'text-slate-400'}`} />
          </div>
          <p className={`text-xl font-black mt-1 ${summaryKPIs.overloadedCount > 0 ? 'text-rose-600' : 'text-foreground'}`}>
            {summaryKPIs.overloadedCount}
          </p>
          <span className={`text-[10px] font-semibold ${summaryKPIs.overloadedCount > 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>
            {summaryKPIs.criticalOverloadedCount > 0 ? `${summaryKPIs.criticalOverloadedCount} critical` : 'Members >100%'}
          </span>
        </div>

        {/* 6. Unassigned Work */}
        <div
          onClick={() => openDrillDown({
            title: 'Unassigned Iteration Tasks',
            subtitle: `${summaryKPIs.unassignedCount} tasks ready for allocation`,
            category: 'Unassigned Pool',
            metricLabel: `${summaryKPIs.unassignedCount} tasks (${summaryKPIs.unassignedTotal} ${getUnitLabel(metricUnit)})`,
            issues: unassignedIssues,
          })}
          className="bg-card border border-border p-3 rounded-xl shadow-2xs cursor-pointer hover:border-amber-500/60 hover:shadow-xs transition-all group"
          title="Click to inspect unassigned work"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className="truncate group-hover:text-amber-500 transition-colors">Unassigned</span>
            <Layers className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          </div>
          <p className="text-xl font-black text-foreground mt-1">{summaryKPIs.unassignedCount}</p>
          <span className="text-[10px] text-amber-600 font-bold font-mono">{summaryKPIs.unassignedTotal} {getUnitLabel(metricUnit)}</span>
        </div>

        {/* 7. Overdue Work */}
        <div
          onClick={() => openDrillDown({
            title: 'Overdue Work Items',
            subtitle: `${summaryKPIs.overdueCount} unfinished tasks with passed due dates`,
            category: 'Overdue Tasks',
            metricLabel: `${summaryKPIs.overdueCount} overdue`,
            issues: summaryKPIs.overdueIssues,
          })}
          className={`bg-card border p-3 rounded-xl shadow-2xs cursor-pointer hover:shadow-xs transition-all group ${
            summaryKPIs.overdueCount > 0
              ? 'border-rose-300 dark:border-rose-900 bg-rose-50/20 dark:bg-rose-950/10'
              : 'border-border'
          }`}
          title="Click to inspect overdue tasks"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className={`truncate ${summaryKPIs.overdueCount > 0 ? 'text-rose-600 font-bold' : ''}`}>Overdue</span>
            <Clock className={`w-3.5 h-3.5 shrink-0 ${summaryKPIs.overdueCount > 0 ? 'text-rose-600' : 'text-slate-400'}`} />
          </div>
          <p className={`text-xl font-black mt-1 ${summaryKPIs.overdueCount > 0 ? 'text-rose-600' : 'text-foreground'}`}>
            {summaryKPIs.overdueCount}
          </p>
          <span className={`text-[10px] font-semibold ${summaryKPIs.overdueCount > 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>
            {summaryKPIs.overdueTotal} {getUnitLabel(metricUnit)} pending
          </span>
        </div>

        {/* 8. Critical Unassigned Work */}
        <div
          onClick={() => openDrillDown({
            title: 'Critical Unassigned Tasks',
            subtitle: 'Unassigned tasks marked as Critical or Highest priority',
            category: 'Urgent Action',
            metricLabel: `${summaryKPIs.criticalUnassignedCount} critical tasks`,
            issues: summaryKPIs.criticalUnassignedIssues,
          })}
          className={`bg-card border p-3 rounded-xl shadow-2xs cursor-pointer hover:shadow-xs transition-all group ${
            summaryKPIs.criticalUnassignedCount > 0
              ? 'border-rose-400 dark:border-rose-800 bg-rose-50/30 dark:bg-rose-950/20'
              : 'border-border'
          }`}
          title="Click to view critical unassigned tasks"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className={`truncate ${summaryKPIs.criticalUnassignedCount > 0 ? 'text-rose-600 font-bold' : ''}`}>Critical Unassigned</span>
            <ShieldAlert className={`w-3.5 h-3.5 shrink-0 ${summaryKPIs.criticalUnassignedCount > 0 ? 'text-rose-600' : 'text-slate-400'}`} />
          </div>
          <p className={`text-xl font-black mt-1 ${summaryKPIs.criticalUnassignedCount > 0 ? 'text-rose-600' : 'text-foreground'}`}>
            {summaryKPIs.criticalUnassignedCount}
          </p>
          <span className={`text-[10px] font-semibold ${summaryKPIs.criticalUnassignedCount > 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>
            {summaryKPIs.criticalUnassignedCount > 0 ? 'Urgent triage' : 'None pending'}
          </span>
        </div>
      </div>

      {/* 3. Multi-Dimensional Navigation Tabs */}
      <div className="flex items-center bg-muted/60 p-1 rounded-xl border border-border flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('PLANNER')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'PLANNER'
              ? 'bg-background text-primary shadow-2xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Workload Planner
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('MATRIX')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'MATRIX'
              ? 'bg-background text-primary shadow-2xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Capacity vs Workload Matrix
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('RISKS')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
            activeTab === 'RISKS'
              ? 'bg-background text-primary shadow-2xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <span>Action Required</span>
          {(summaryKPIs.overloadedCount > 0 || summaryKPIs.overdueCount > 0 || summaryKPIs.criticalUnassignedCount > 0) && (
            <span className="w-2 h-2 rounded-full bg-rose-500" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('FORECAST')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'FORECAST'
              ? 'bg-background text-primary shadow-2xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Capacity Forecasting
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('TRENDS')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'TRENDS'
              ? 'bg-background text-primary shadow-2xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Historical Trends
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('REPORTS')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'REPORTS'
              ? 'bg-background text-primary shadow-2xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Workload Reports
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('AUDIT')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            activeTab === 'AUDIT'
              ? 'bg-background text-primary shadow-2xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Assignment Audit Trail
        </button>
      </div>

      {/* 4. Controls Toolbar (Sprint, Team, Metric, Scope, Search) */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left Filters Group */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Team Filter */}
            <div className="flex items-center gap-1.5 bg-background border border-border rounded-xl px-2.5 py-1.5">
              <Shield className="w-3.5 h-3.5 text-purple-600" />
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                className="bg-transparent text-xs font-bold text-foreground outline-none cursor-pointer"
                aria-label="Filter by team"
              >
                <option value="ALL">All Teams</option>
                {allTeamsList.map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Sprint Scope */}
            <div className="flex items-center gap-1.5 bg-background border border-border rounded-xl px-2.5 py-1.5">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <select
                value={sprintScope}
                onChange={(e) => setSprintScope(e.target.value)}
                className="bg-transparent text-xs font-bold text-foreground outline-none cursor-pointer"
                aria-label="Filter by iteration"
              >
                <option value="ALL">All Iterations &amp; Backlog</option>
                {activeSprintObj && (
                  <option value={activeSprintObj.id} className="font-bold text-primary">
                    ⚡ Active: {activeSprintObj.name}
                  </option>
                )}
                {sprints
                  .filter((s: any) => s.id !== activeSprintObj?.id)
                  .map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.status})
                    </option>
                  ))}
                <option value="BACKLOG">Backlog (No Sprint)</option>
              </select>
            </div>

            {/* Metric Unit Toggle */}
            <div className="flex items-center bg-muted/60 p-0.5 rounded-xl border border-border">
              <button
                type="button"
                onClick={() => setMetricUnit('PTS')}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  metricUnit === 'PTS'
                    ? 'bg-background text-primary shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Story Points (pts)
              </button>
              <button
                type="button"
                onClick={() => setMetricUnit('HOURS')}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  metricUnit === 'HOURS'
                    ? 'bg-background text-primary shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Hours (hrs)
              </button>
              <button
                type="button"
                onClick={() => setMetricUnit('COUNT')}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  metricUnit === 'COUNT'
                    ? 'bg-background text-primary shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Task Count (#)
              </button>
            </div>

            {/* Work Scope Toggle */}
            <div className="flex items-center bg-muted/60 p-0.5 rounded-xl border border-border">
              <button
                type="button"
                onClick={() => setStatusScope('ALL')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  statusScope === 'ALL'
                    ? 'bg-background text-foreground shadow-2xs font-bold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                All Work
              </button>
              <button
                type="button"
                onClick={() => setStatusScope('REMAINING')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  statusScope === 'REMAINING'
                    ? 'bg-background text-foreground shadow-2xs font-bold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Exclude completed tasks to view remaining burden"
              >
                Remaining Only
              </button>
            </div>
          </div>

          {/* Search Box */}
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search member, task, key..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-background border border-border rounded-xl text-foreground focus:ring-2 focus:ring-primary focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Secondary Filter Row: Health Status Levels */}
        <div className="flex flex-wrap items-center justify-between pt-2 border-t border-border gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mr-1">Health Status:</span>
            <button
              type="button"
              onClick={() => setHealthFilter('ALL')}
              className={`px-2 py-0.5 text-xs rounded-lg font-semibold transition-all cursor-pointer ${
                healthFilter === 'ALL'
                  ? 'bg-foreground text-background font-bold'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              All ({memberAggregates.length})
            </button>
            <button
              type="button"
              onClick={() => setHealthFilter('CRITICAL')}
              className={`px-2 py-0.5 text-xs rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                healthFilter === 'CRITICAL'
                  ? 'bg-rose-600 text-white font-bold'
                  : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100'
              }`}
            >
              <AlertCircle className="w-3 h-3" />
              Critical &gt;120% ({summaryKPIs.criticalOverloadedCount})
            </button>
            <button
              type="button"
              onClick={() => setHealthFilter('OVERLOADED')}
              className={`px-2 py-0.5 text-xs rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                healthFilter === 'OVERLOADED'
                  ? 'bg-amber-600 text-white font-bold'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 hover:bg-amber-100'
              }`}
            >
              Overloaded &gt;100% ({summaryKPIs.overloadedCount})
            </button>
            <button
              type="button"
              onClick={() => setHealthFilter('OPTIMAL')}
              className={`px-2 py-0.5 text-xs rounded-lg font-semibold transition-all cursor-pointer ${
                healthFilter === 'OPTIMAL'
                  ? 'bg-emerald-600 text-white font-bold'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100'
              }`}
            >
              Healthy 80–100% ({memberAggregates.filter((m) => m.health === 'OPTIMAL').length})
            </button>
            <button
              type="button"
              onClick={() => setHealthFilter('UNDER')}
              className={`px-2 py-0.5 text-xs rounded-lg font-semibold transition-all cursor-pointer ${
                healthFilter === 'UNDER'
                  ? 'bg-blue-600 text-white font-bold'
                  : 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100'
              }`}
            >
              Available &lt;80% ({memberAggregates.filter((m) => m.health === 'UNDER').length})
            </button>
            <button
              type="button"
              onClick={() => setHealthFilter('AVAILABLE')}
              className={`px-2 py-0.5 text-xs rounded-lg font-semibold transition-all cursor-pointer ${
                healthFilter === 'AVAILABLE'
                  ? 'bg-slate-700 text-white font-bold'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              No Allocation 0% ({memberAggregates.filter((m) => m.totalVal === 0).length})
            </button>
          </div>

          {/* Progress Bar Legend */}
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" /> Completed (Done)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-blue-500 inline-block" /> In Progress
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-slate-400 dark:bg-slate-600 inline-block" /> To Do
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-rose-500 inline-block" /> Overload
            </span>
          </div>
        </div>
      </div>

      {/* Floating / Sticky Multi-Select Action Bar */}
      {selectedIssueIds.size > 0 && (
        <div className="sticky top-4 z-30 bg-card border-2 border-primary/50 shadow-xl rounded-2xl p-3 flex items-center justify-between gap-4 animate-in slide-in-from-top-3 duration-200">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs">
              {selectedIssueIds.size}
            </div>
            <div>
              <p className="text-xs font-bold text-foreground">
                {selectedIssueIds.size} {selectedIssueIds.size === 1 ? 'task' : 'tasks'} selected for reassignment
              </p>
              <p className="text-[10px] text-muted-foreground">
                Total weight: {selectedIssuesArray.reduce((s, i) => s + getIssueMetricValue(i, metricUnit), 0)} {getUnitLabel(metricUnit)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSelectAllInScope}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-border hover:bg-muted text-foreground cursor-pointer"
            >
              Select All in Scope ({scopedIssues.length})
            </button>
            <button
              type="button"
              onClick={handleClearSelection}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                setSingleRebalanceIssue(null);
                setIsRebalanceModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-bold rounded-xl hover:opacity-95 transition-all shadow-xs cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Smart Reassign ({selectedIssueIds.size})</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 1: Workload Planner (Main View) */}
      {activeTab === 'PLANNER' && (
        <div className="space-y-4">
          {displayedMembers.map((member) => {
            const isTargeted = dragOverTargetId === member.id;
            const hasCustomCap = customCapacities[member.id] !== undefined;

            return (
              <div
                key={member.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverTargetId !== member.id) {
                    setDragOverTargetId(member.id);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverTargetId === member.id) {
                    setDragOverTargetId(null);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const issueId = e.dataTransfer.getData('text/plain') || draggedIssueId;
                  if (issueId) {
                    handleReassignIssues([issueId], member.id);
                  }
                }}
                className={`bg-card border rounded-2xl p-5 shadow-2xs space-y-4 transition-all duration-200 ${
                  isTargeted
                    ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
                    : member.healthBorderColor
                }`}
              >
                {/* Member Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-sm flex items-center justify-center shadow-xs shrink-0">
                      {member.avatar}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-foreground">{member.name}</h3>
                        <span className="text-[10px] font-semibold bg-muted text-muted-foreground px-2 py-0.5 rounded-md">
                          {member.role}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${member.healthBadgeColor}`}>
                          {member.healthLabel}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate max-w-xs">{member.email}</p>
                    </div>
                  </div>

                  {/* Capacity Metrics & Inline Editor */}
                  <div className="flex items-center gap-3 self-end sm:self-auto">
                    {editingCapacityMemberId === member.id ? (
                      <div className="flex items-center gap-1.5 bg-muted p-1.5 rounded-xl border border-primary shadow-xs">
                        <span className="text-xs font-semibold text-muted-foreground pl-1">Cap:</span>
                        <input
                          type="number"
                          min="1"
                          max="999"
                          autoFocus
                          value={capacityInputVal}
                          onChange={(e) => setCapacityInputVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const val = Number(capacityInputVal);
                              if (!isNaN(val) && val > 0) handleSaveMemberCapacity(member.id, val);
                            } else if (e.key === 'Escape') {
                              setEditingCapacityMemberId(null);
                            }
                          }}
                          className="w-16 px-1.5 py-0.5 text-xs font-bold bg-background border border-border rounded text-foreground outline-none"
                        />
                        <span className="text-[11px] text-muted-foreground font-bold">{getUnitLabel(metricUnit)}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const val = Number(capacityInputVal);
                            if (!isNaN(val) && val > 0) handleSaveMemberCapacity(member.id, val);
                          }}
                          className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-950 text-emerald-600 rounded cursor-pointer"
                          title="Save capacity"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCapacityMemberId(null)}
                          className="p-1 hover:bg-muted text-muted-foreground rounded cursor-pointer"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                        {hasCustomCap && (
                          <button
                            type="button"
                            onClick={() => handleResetMemberCapacity(member.id)}
                            className="p-1 hover:bg-rose-100 text-rose-500 rounded cursor-pointer"
                            title="Reset to default"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          <span className="text-xs font-bold text-foreground">
                            {member.totalVal} / {member.capacity} {getUnitLabel(metricUnit)}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCapacityMemberId(member.id);
                              setCapacityInputVal(String(member.capacity));
                            }}
                            className="p-1 text-muted-foreground hover:text-primary hover:bg-muted rounded transition-colors cursor-pointer"
                            title={`Customize capacity (default is ${defaultCapacityForUnit} ${getUnitLabel(metricUnit)})`}
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        </div>
                        <span className={`text-[10px] font-bold block ${
                          member.isCritical
                            ? 'text-rose-600'
                            : member.isOverloaded
                            ? 'text-amber-600'
                            : member.percentage >= 80
                            ? 'text-emerald-600'
                            : 'text-blue-600'
                        }`}>
                          {member.percentage}% Capacity
                          {member.isOverloaded && ` (+${member.totalVal - member.capacity} ${getUnitLabel(metricUnit)} over)`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Multi-Segment Stacked Capacity Bar */}
                <div
                  onClick={() => openDrillDown({
                    title: `Member Workload: ${member.name}`,
                    subtitle: `All ${member.issues.length} issues assigned to ${member.name}`,
                    category: 'Member Workload',
                    metricLabel: `${member.totalVal} / ${member.capacity} ${getUnitLabel(metricUnit)} (${member.percentage}% capacity)`,
                    percentage: member.percentage,
                    issues: member.issues,
                  })}
                  className="space-y-1.5 cursor-pointer group"
                  title="Click to view all tasks assigned to this developer"
                >
                  <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden flex relative shadow-inner group-hover:ring-2 group-hover:ring-primary/40 transition-all">
                    {member.donePct > 0 && (
                      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${member.donePct}%` }} />
                    )}
                    {member.inProgressPct > 0 && (
                      <div className="h-full bg-blue-500 transition-all" style={{ width: `${member.inProgressPct}%` }} />
                    )}
                    {member.toDoPct > 0 && (
                      <div className="h-full bg-slate-400 dark:bg-slate-600 transition-all" style={{ width: `${member.toDoPct}%` }} />
                    )}
                    {member.isOverloaded && (
                      <div className="absolute right-0 top-0 bottom-0 w-2 bg-rose-500" />
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-muted-foreground px-0.5">
                    <div className="flex items-center gap-3 font-mono">
                      <span className="text-emerald-600 dark:text-emerald-400">Done: {member.doneVal}</span>
                      <span className="text-blue-600 dark:text-blue-400">In Prog: {member.inProgressVal}</span>
                      <span className="text-slate-500">To Do: {member.toDoVal}</span>
                      {member.overdueVal > 0 && (
                        <span className="text-rose-600 font-bold">Overdue: {member.overdueVal}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {member.issues.length} {member.issues.length === 1 ? 'task' : 'tasks'}
                    </span>
                  </div>
                </div>

                {/* Task Tray: Drop Target */}
                <div
                  className={`min-h-[52px] rounded-xl p-2.5 transition-all duration-150 ${
                    isTargeted
                      ? 'bg-primary/10 border-2 border-dashed border-primary'
                      : 'bg-muted/30 border border-border'
                  }`}
                >
                  {isTargeted ? (
                    <div className="flex items-center justify-center gap-2 py-3 text-primary font-bold text-xs">
                      <ArrowRight className="w-4 h-4" />
                      <span>Drop task here to reassign to {member.name}</span>
                    </div>
                  ) : member.issues.length === 0 ? (
                    <div className="flex items-center justify-center py-2 text-muted-foreground text-xs italic">
                      No tasks allocated in this scope • Drag tasks here to allocate work
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {member.issues.map((issue: any) => {
                        const isDone = categorizeStatus(issue.status) === 'DONE';
                        const val = getIssueMetricValue(issue, metricUnit);
                        const isBeingDragged = draggedIssueId === issue.id;
                        const isSelected = selectedIssueIds.has(issue.id);

                        return (
                          <div
                            key={issue.id}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', issue.id);
                              setDraggedIssueId(issue.id);
                            }}
                            onDragEnd={() => {
                              setDraggedIssueId(null);
                              setDragOverTargetId(null);
                            }}
                            onClick={() => onSelectIssue(issue)}
                            className={`group flex items-center gap-2 px-2.5 py-1.5 bg-background hover:bg-muted rounded-xl text-xs border border-border cursor-grab active:cursor-grabbing border-l-4 transition-all shadow-2xs select-none ${
                              isBeingDragged ? 'opacity-40 scale-95' : ''
                            } ${isDone ? 'opacity-70' : ''} ${isSelected ? 'ring-2 ring-primary border-primary' : ''}`}
                            style={{ borderLeftColor: getPriorityColor(issue.priority) }}
                          >
                            {/* Checkbox for Multi-Select */}
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleSelectIssue(issue.id);
                              }}
                              className="cursor-pointer text-muted-foreground hover:text-primary"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-3.5 h-3.5 text-primary" />
                              ) : (
                                <Square className="w-3.5 h-3.5" />
                              )}
                            </div>

                            {isDone ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            ) : (
                              <span className="font-mono font-bold text-primary shrink-0">{issue.issueKey}</span>
                            )}

                            <span className={`truncate max-w-[160px] font-medium text-foreground ${
                              isDone ? 'line-through text-muted-foreground' : ''
                            }`}>
                              {issue.title}
                            </span>

                            {issue.status && (
                              <span
                                className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                                style={
                                  issue.status.color
                                    ? {
                                        backgroundColor: `${issue.status.color}15`,
                                        color: issue.status.color,
                                      }
                                    : undefined
                                }
                              >
                                {issue.status.name}
                              </span>
                            )}

                            <span className="text-[10px] text-muted-foreground font-mono font-bold bg-muted px-1.5 py-0.5 rounded">
                              {val} {getUnitLabel(metricUnit)}
                            </span>

                            {/* Smart Rebalance Button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSingleRebalanceIssue(issue);
                                setSelectedIssueIds(new Set([issue.id]));
                                setIsRebalanceModalOpen(true);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-primary rounded cursor-pointer"
                              title="Smart Rebalance task"
                            >
                              <Sparkles className="w-3 h-3 text-amber-500" />
                            </button>

                            {/* Quick Unassign Button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReassignIssues([issue.id], null);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-rose-500 rounded cursor-pointer"
                              title="Unassign task"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Unassigned Work Bucket (Drop Target) */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragOverTargetId !== 'unassigned') {
                setDragOverTargetId('unassigned');
              }
            }}
            onDragLeave={() => {
              if (dragOverTargetId === 'unassigned') {
                setDragOverTargetId(null);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              const issueId = e.dataTransfer.getData('text/plain') || draggedIssueId;
              if (issueId) {
                handleReassignIssues([issueId], null);
              }
            }}
            className={`border-2 border-dashed rounded-2xl p-5 shadow-2xs space-y-4 transition-all duration-200 ${
              dragOverTargetId === 'unassigned'
                ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/20 ring-2 ring-amber-500/20'
                : 'border-border bg-card/60'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-muted text-muted-foreground font-bold text-sm flex items-center justify-center">
                  ?
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    Unassigned Work Pool
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400">
                      {unassignedIssues.length} tasks
                    </span>
                    {selectedTeamObj && (
                      <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 rounded-md">
                        {selectedTeamObj.name}
                      </span>
                    )}
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Drag tasks onto team members to allocate, or drag assigned tasks here to unassign them.
                  </p>
                </div>
              </div>

              <div className="text-right">
                <span className="text-xs font-bold text-foreground">
                  {summaryKPIs.unassignedTotal} {getUnitLabel(metricUnit)} total
                </span>
                <span className="text-[10px] block text-muted-foreground">Ready for allocation</span>
              </div>
            </div>

            {/* Unassigned Task Chips */}
            <div className="min-h-[48px] rounded-xl p-2.5 bg-background border border-border">
              {dragOverTargetId === 'unassigned' ? (
                <div className="flex items-center justify-center gap-2 py-3 text-amber-600 font-bold text-xs">
                  <ArrowRight className="w-4 h-4" />
                  <span>Drop task here to unassign</span>
                </div>
              ) : unassignedIssues.length === 0 ? (
                <div className="flex items-center justify-center py-2 text-muted-foreground text-xs italic">
                  {selectedTeamObj
                    ? `All ${selectedTeamObj.name} tasks in this iteration are allocated!`
                    : 'All tasks in this iteration are fully assigned!'}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {unassignedIssues.map((issue: any) => {
                    const val = getIssueMetricValue(issue, metricUnit);
                    const isBeingDragged = draggedIssueId === issue.id;
                    const isSelected = selectedIssueIds.has(issue.id);

                    return (
                      <div
                        key={issue.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', issue.id);
                          setDraggedIssueId(issue.id);
                        }}
                        onDragEnd={() => {
                          setDraggedIssueId(null);
                          setDragOverTargetId(null);
                        }}
                        onClick={() => onSelectIssue(issue)}
                        className={`flex items-center gap-2 px-2.5 py-1.5 bg-card hover:bg-muted rounded-xl text-xs border border-border cursor-grab active:cursor-grabbing border-l-4 transition-all shadow-2xs select-none ${
                          isBeingDragged ? 'opacity-40 scale-95' : ''
                        } ${isSelected ? 'ring-2 ring-primary border-primary' : ''}`}
                        style={{ borderLeftColor: getPriorityColor(issue.priority) }}
                      >
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSelectIssue(issue.id);
                          }}
                          className="cursor-pointer text-muted-foreground hover:text-primary"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 text-primary" />
                          ) : (
                            <Square className="w-3.5 h-3.5" />
                          )}
                        </div>

                        <span className="font-mono font-bold text-muted-foreground">{issue.issueKey}</span>
                        <span className="truncate max-w-[160px] text-foreground font-medium">{issue.title}</span>

                        {issue.status && (
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                            style={
                              issue.status.color
                                ? {
                                    backgroundColor: `${issue.status.color}15`,
                                    color: issue.status.color,
                                  }
                                : undefined
                            }
                          >
                            {issue.status.name}
                          </span>
                        )}

                        <span className="text-[10px] text-muted-foreground font-mono font-bold bg-muted px-1.5 py-0.5 rounded">
                          {val} {getUnitLabel(metricUnit)}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSingleRebalanceIssue(issue);
                            setSelectedIssueIds(new Set([issue.id]));
                            setIsRebalanceModalOpen(true);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-primary rounded cursor-pointer"
                          title="Smart Assign"
                        >
                          <Sparkles className="w-3 h-3 text-amber-500" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Capacity vs Workload Matrix */}
      {activeTab === 'MATRIX' && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-2xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-primary" />
                <span>Capacity vs Workload Matrix</span>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Comparative analysis of configured capacity against allocated workload across all team members.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-foreground font-bold">Total Cap: {summaryKPIs.totalCapacity} {getUnitLabel(metricUnit)}</span>
              <span className="text-muted-foreground">•</span>
              <span className="text-primary font-bold">Allocated: {summaryKPIs.totalAssigned} {getUnitLabel(metricUnit)}</span>
              <span className="text-muted-foreground">•</span>
              <span className="text-emerald-600 font-bold">Available: {summaryKPIs.availableCapacity} {getUnitLabel(metricUnit)}</span>
            </div>
          </div>

          {/* Member Comparative Bars */}
          <div className="space-y-4">
            {memberAggregates.map((member) => (
              <div
                key={member.id}
                onClick={() => openDrillDown({
                  title: `${member.name}: Workload Breakdown`,
                  subtitle: `Allocated: ${member.totalVal} / ${member.capacity} ${getUnitLabel(metricUnit)}`,
                  category: 'Capacity Matrix',
                  metricLabel: `${member.percentage}% Capacity`,
                  percentage: member.percentage,
                  issues: member.issues,
                })}
                className="p-4 rounded-xl border border-border hover:border-primary/50 hover:shadow-2xs transition-all cursor-pointer space-y-2 bg-background"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground font-bold text-[10px] flex items-center justify-center">
                      {member.avatar}
                    </div>
                    <span className="font-bold text-foreground">{member.name}</span>
                    <span className="text-[10px] text-muted-foreground">({member.role})</span>
                  </div>

                  <div className="flex items-center gap-3 font-mono">
                    <span className="text-muted-foreground">
                      {member.totalVal} / {member.capacity} {getUnitLabel(metricUnit)}
                    </span>
                    <span className={`font-bold px-2 py-0.5 rounded text-[10px] ${member.healthBadgeColor}`}>
                      {member.percentage}% ({member.healthLabel})
                    </span>
                  </div>
                </div>

                {/* Comparative Double Gauge */}
                <div className="space-y-1">
                  <div className="w-full h-3 rounded-full bg-muted overflow-hidden flex relative">
                    <div
                      className={`h-full transition-all duration-300 ${
                        member.isCritical
                          ? 'bg-rose-500'
                          : member.isOverloaded
                          ? 'bg-amber-500'
                          : member.percentage >= 80
                          ? 'bg-emerald-500'
                          : 'bg-blue-500'
                      }`}
                      style={{ width: `${Math.min(100, member.percentage)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Remaining to Do: {member.remainingVal} {getUnitLabel(metricUnit)}</span>
                    <span>Available Headroom: {member.availableCap} {getUnitLabel(metricUnit)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: Action Required & Risk Radar */}
      {activeTab === 'RISKS' && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-2xl p-5 shadow-2xs space-y-4">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>Iteration Risk Radar &amp; Action Items</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Proactive alerts detecting potential delivery bottlenecks, unestimated work, and deadline conflicts.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* Overloaded Developers */}
              <div
                onClick={() => {
                  const issues = memberAggregates.filter((m) => m.isOverloaded).flatMap((m) => m.issues);
                  openDrillDown({
                    title: 'Overloaded Developers',
                    subtitle: `${summaryKPIs.overloadedCount} engineers over 100% capacity`,
                    category: 'Risk Item',
                    metricLabel: `${summaryKPIs.overloadedCount} members`,
                    issues,
                  });
                }}
                className="p-4 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/20 dark:bg-rose-950/10 cursor-pointer hover:shadow-xs transition-all space-y-2"
              >
                <div className="flex items-center justify-between text-xs font-bold text-rose-700 dark:text-rose-300">
                  <span className="flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                    Overloaded Developers (&gt;100%)
                  </span>
                  <span className="text-sm">{summaryKPIs.overloadedCount}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {summaryKPIs.overloadedCount > 0
                    ? `${summaryKPIs.overloadedCount} team member(s) have more work allocated than their scheduled bandwidth.`
                    : 'All developers currently within healthy capacity limits.'}
                </p>
              </div>

              {/* Overdue Tasks */}
              <div
                onClick={() => openDrillDown({
                  title: 'Overdue Iteration Tasks',
                  subtitle: `${summaryKPIs.overdueCount} incomplete tasks past due date`,
                  category: 'Risk Item',
                  metricLabel: `${summaryKPIs.overdueCount} overdue`,
                  issues: summaryKPIs.overdueIssues,
                })}
                className="p-4 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/20 dark:bg-rose-950/10 cursor-pointer hover:shadow-xs transition-all space-y-2"
              >
                <div className="flex items-center justify-between text-xs font-bold text-rose-700 dark:text-rose-300">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-rose-600" />
                    Overdue Unfinished Tasks
                  </span>
                  <span className="text-sm">{summaryKPIs.overdueCount}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {summaryKPIs.overdueCount > 0
                    ? `${summaryKPIs.overdueCount} task(s) (${summaryKPIs.overdueTotal} ${getUnitLabel(metricUnit)}) have passed their scheduled target date.`
                    : 'Zero overdue tasks in current iteration scope.'}
                </p>
              </div>

              {/* Critical Unassigned Tasks */}
              <div
                onClick={() => openDrillDown({
                  title: 'Critical Unassigned Tasks',
                  subtitle: 'High-severity issues without an owner',
                  category: 'Risk Item',
                  metricLabel: `${summaryKPIs.criticalUnassignedCount} tasks`,
                  issues: summaryKPIs.criticalUnassignedIssues,
                })}
                className="p-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/20 dark:bg-amber-950/10 cursor-pointer hover:shadow-xs transition-all space-y-2"
              >
                <div className="flex items-center justify-between text-xs font-bold text-amber-700 dark:text-amber-300">
                  <span className="flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    Critical Unassigned Tasks (P0/P1)
                  </span>
                  <span className="text-sm">{summaryKPIs.criticalUnassignedCount}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {summaryKPIs.criticalUnassignedCount > 0
                    ? `${summaryKPIs.criticalUnassignedCount} critical issues need immediate owner assignment.`
                    : 'All critical severity issues are currently assigned.'}
                </p>
              </div>

              {/* Tasks Missing Estimates */}
              <div
                onClick={() => openDrillDown({
                  title: 'Tasks Missing Estimates',
                  subtitle: 'Issues with 0 or missing story points / hours',
                  category: 'Risk Item',
                  metricLabel: `${summaryKPIs.unestimatedIssues.length} unestimated`,
                  issues: summaryKPIs.unestimatedIssues,
                })}
                className="p-4 rounded-xl border border-border bg-card cursor-pointer hover:shadow-xs transition-all space-y-2"
              >
                <div className="flex items-center justify-between text-xs font-bold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <HelpCircle className="w-4 h-4 text-blue-500" />
                    Tasks Missing Estimates
                  </span>
                  <span className="text-sm">{summaryKPIs.unestimatedIssues.length}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {summaryKPIs.unestimatedIssues.length > 0
                    ? `${summaryKPIs.unestimatedIssues.length} task(s) lack story points or hours, skewing capacity accuracy.`
                    : 'All tasks in scope have valid estimates.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Capacity Forecasting */}
      {activeTab === 'FORECAST' && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-2xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                <span>Forward Capacity Forecasting</span>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Predictive model projecting resource availability against planned sprint scope.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {forecastData.map((f, idx) => (
              <div key={idx} className="bg-background border border-border rounded-xl p-4 space-y-3 shadow-2xs">
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <h4 className="text-xs font-bold text-foreground">{f.scope}</h4>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    f.deficit > 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {f.deficit > 0 ? 'Deficit Alert' : 'Healthy Buffer'}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Capacity:</span>
                    <span className="font-bold text-foreground">{f.capacity} {getUnitLabel(metricUnit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Planned Work:</span>
                    <span className="font-bold text-primary">{f.planned} {getUnitLabel(metricUnit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expected Utilization:</span>
                    <span className="font-bold text-foreground">{f.expectedUtil}%</span>
                  </div>
                  {f.surplus > 0 && (
                    <div className="flex justify-between text-emerald-600">
                      <span>Capacity Surplus:</span>
                      <span className="font-bold">+{f.surplus} {getUnitLabel(metricUnit)}</span>
                    </div>
                  )}
                  {f.deficit > 0 && (
                    <div className="flex justify-between text-rose-600">
                      <span>Capacity Shortfall:</span>
                      <span className="font-bold">-{f.deficit} {getUnitLabel(metricUnit)}</span>
                    </div>
                  )}
                </div>

                <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full ${f.deficit > 0 ? 'bg-rose-500' : 'bg-primary'}`}
                    style={{ width: `${Math.min(100, f.expectedUtil)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: Historical Trends */}
      {activeTab === 'TRENDS' && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-2xs space-y-6">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                <span>Historical Sprint Workload Trends</span>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Delivered story points vs planned capacity across completed iterations.
              </p>
            </div>
          </div>

          {historicalSprintsData.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No completed sprint history available for trend analysis.
            </div>
          ) : (
            <div className="space-y-4">
              {historicalSprintsData.map((sp) => (
                <div key={sp.id} className="bg-background border border-border rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-foreground">{sp.name}</span>
                    <span className="font-mono text-muted-foreground">
                      Completed: {sp.completed} / {sp.allocated} {getUnitLabel(metricUnit)} ({sp.utilization}% util)
                    </span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden flex">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${sp.allocated > 0 ? Math.min(100, Math.round((sp.completed / sp.allocated) * 100)) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 6: Workload Reports Hub */}
      {activeTab === 'REPORTS' && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-2xs space-y-6">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <span>Downloadable Workload &amp; Capacity Reports</span>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Download verified real-data reports in PDF, Microsoft Excel (.xls), and RFC 4180 CSV formats.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {WORKLOAD_REPORTS_LIST.map((rep) => {
              const buildDownloadUrl = (fmt: string) => {
                const p = new URLSearchParams();
                p.set('reportType', rep.id);
                p.set('format', fmt);
                if (sprintScope !== 'ALL') p.set('sprintId', sprintScope);
                if (teamFilter !== 'ALL') p.set('teamId', teamFilter);
                return `/api/projects/${projectId}/reports/download?${p.toString()}`;
              };

              return (
                <div key={rep.id} className="bg-background border border-border rounded-xl p-4 flex flex-col justify-between hover:border-primary/50 transition-all group">
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                      {rep.name}
                    </h4>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{rep.desc}</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setReportModal({
                          isOpen: true,
                          reportType: rep.id,
                          reportTitle: rep.name,
                          reportDescription: rep.desc,
                        })
                      }
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                    >
                      <Eye className="w-3 h-3" />
                      <span>View</span>
                    </button>

                    <div className="flex items-center gap-1">
                      <a
                        href={buildDownloadUrl('pdf')}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1 text-[10px] font-bold rounded-lg border border-border hover:bg-muted text-rose-600"
                      >
                        PDF
                      </a>
                      <a
                        href={buildDownloadUrl('excel')}
                        download
                        className="px-2 py-1 text-[10px] font-bold rounded-lg border border-border hover:bg-muted text-emerald-600"
                      >
                        Excel
                      </a>
                      <a
                        href={buildDownloadUrl('csv')}
                        download
                        className="px-2 py-1 text-[10px] font-bold rounded-lg border border-border hover:bg-muted text-blue-600"
                      >
                        CSV
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 7: Assignment Audit Trail */}
      {activeTab === 'AUDIT' && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <History className="w-4 h-4 text-primary" />
                <span>Assignment &amp; Reassignment Audit Trail</span>
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Chronological log of workload reassignments, unassignments, and capacity updates.
              </p>
            </div>
          </div>

          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
                <tr>
                  <th className="p-2.5">Date / Time</th>
                  <th className="p-2.5">Task Key</th>
                  <th className="p-2.5">Title</th>
                  <th className="p-2.5">Previous Assignee</th>
                  <th className="p-2.5">New Assignee</th>
                  <th className="p-2.5">Changed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/30">
                    <td className="p-2.5 font-mono text-muted-foreground">
                      {log.timestamp.toLocaleDateString()} {log.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="p-2.5 font-mono font-bold text-primary">{log.issueKey}</td>
                    <td className="p-2.5 font-medium text-foreground truncate max-w-[200px]">{log.issueTitle}</td>
                    <td className="p-2.5 text-muted-foreground">{log.oldAssignee}</td>
                    <td className="p-2.5 font-bold text-foreground">{log.newAssignee}</td>
                    <td className="p-2.5 text-muted-foreground">{log.actor}</td>
                  </tr>
                ))}
                {auditLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                      No assignment change history logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Smart Rebalance Simulation Modal */}
      <SmartRebalanceModal
        isOpen={isRebalanceModalOpen}
        onClose={() => {
          setIsRebalanceModalOpen(false);
          setSingleRebalanceIssue(null);
        }}
        selectedIssues={singleRebalanceIssue ? [singleRebalanceIssue] : selectedIssuesArray}
        allMembers={memberAggregates}
        metricUnit={metricUnit}
        unitLabel={getUnitLabel(metricUnit)}
        getPriorityColor={getPriorityColor}
        onConfirmReassign={handleReassignIssues}
      />

      {/* Interactive Underlying Data Drill-Down Modal */}
      <AnalyticsDrillDownModal
        isOpen={drillDownModal.isOpen}
        onClose={() => setDrillDownModal((prev) => ({ ...prev, isOpen: false }))}
        title={drillDownModal.title}
        subtitle={drillDownModal.subtitle}
        category={drillDownModal.category}
        metricLabel={drillDownModal.metricLabel}
        percentage={drillDownModal.percentage}
        projectName={projectName}
        issues={drillDownModal.issues}
        onSelectIssue={(issue) => {
          if (onSelectIssue) onSelectIssue(issue);
        }}
      />

      {/* Live Standardized Report View Modal */}
      <ReportViewModal
        isOpen={reportModal.isOpen}
        onClose={() => setReportModal((prev) => ({ ...prev, isOpen: false }))}
        reportType={reportModal.reportType}
        reportTitle={reportModal.reportTitle}
        reportDescription={reportModal.reportDescription}
        category="Team Workload"
        issues={scopedIssues}
        projectId={projectId}
        projectName={projectName}
        sprintId={sprintScope !== 'ALL' ? sprintScope : undefined}
        teamId={teamFilter !== 'ALL' ? teamFilter : undefined}
        onSelectIssue={onSelectIssue}
      />
    </div>
  );
}
