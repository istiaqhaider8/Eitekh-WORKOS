'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  BarChart3,
  PieChart as PieIcon,
  TrendingUp,
  Activity,
  User,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  Flame,
  Info,
  Layers,
  Download,
  Printer,
  Filter,
  Search,
  X,
  Calendar,
  Shield,
  ArrowUpDown,
  RotateCcw,
  Zap,
  FolderGit2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileSpreadsheet,
  FileCode,
  Copy,
  ExternalLink,
  Target,
  Sparkles,
  ArrowRight,
  FileText,
  Eye,
  Briefcase,
  HelpCircle,
  Radio,
  SlidersHorizontal,
  Wifi,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';
import { AnalyticsDrillDownModal } from '@/components/analytics/AnalyticsDrillDownModal';
import { ReportViewModal } from '@/components/analytics/ReportViewModal';
import { ReportDifferenceGuideModal } from '@/components/analytics/ReportDifferenceGuideModal';
import { SprintVelocityCard } from '@/components/analytics/SprintVelocityCard';
import { REPORT_CATALOG } from './DashboardView';

interface AnalyticsChartsViewProps {
  issues?: any[];
  statuses?: any[];
  priorities?: any[];
  sprints?: any[];
  teams?: any[];
  members?: any[];
  projects?: any[];
  projectId?: string;
  projectName?: string;
  currentUserId?: string;
  onSelectProject?: (projectId: string) => void;
  onSelectIssue?: (issue: any) => void;
  onRefresh?: () => void;
  lastSyncTimestamp?: number;
  syncStatus?: string;
}

export function AnalyticsChartsView({
  issues = [],
  statuses = [],
  priorities = [],
  sprints = [],
  teams = [],
  members = [],
  projects = [],
  projectId = 'default',
  projectName,
  currentUserId,
  onSelectProject,
  onSelectIssue,
  onRefresh,
  lastSyncTimestamp,
  syncStatus = 'connected',
}: AnalyticsChartsViewProps) {
  // --- Project Selector State ---
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    projectId && projectId !== 'default' ? projectId : 'ALL'
  );

  useEffect(() => {
    if (projectId && projectId !== 'default') {
      setSelectedProjectId(projectId);
    }
  }, [projectId]);

  // Compute effective project ID & Name for scoping and downloads
  const effectiveProjectId = useMemo(() => {
    if (selectedProjectId && selectedProjectId !== 'ALL') return selectedProjectId;
    if (projectId && projectId !== 'default') return projectId;
    if (projects && projects.length > 0) return projects[0].id;
    if (issues && issues.length > 0 && issues[0].projectId) return issues[0].projectId;
    return '';
  }, [selectedProjectId, projectId, projects, issues]);

  const effectiveProjectName = useMemo(() => {
    if (selectedProjectId && selectedProjectId !== 'ALL') {
      const p = projects.find((proj: any) => proj.id === selectedProjectId);
      if (p) return p.name;
    }
    if (projectName && projectName !== 'Platform Overview') return projectName;
    if (projects && projects.length > 0 && selectedProjectId !== 'ALL') return projects[0].name;
    return 'All Projects';
  }, [selectedProjectId, projects, projectName]);

  // --- Filter State ---
  const [sprintFilter, setSprintFilter] = useState<string>('ALL');
  const [teamFilter, setTeamFilter] = useState<string>('ALL');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [epicFilter, setEpicFilter] = useState<string>('ALL');
  const [timeRange, setTimeRange] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // --- UI View Tabs ---
  const [activeTab, setActiveTab] = useState<'ALL' | 'VELOCITY' | 'DISTRIBUTION' | 'WORKLOAD' | 'TRENDS' | 'MATRIX' | 'REPORTS'>('ALL');

  // --- Dimension Switchers ---
  const [barMetric, setBarMetric] = useState<'PTS' | 'COUNT' | 'HOURS'>('PTS');
  const [pieDimension, setPieDimension] = useState<'STATUS' | 'PRIORITY' | 'TYPE' | 'ASSIGNEE' | 'TEAM'>('STATUS');
  const [scatterDimension, setScatterDimension] = useState<'POINTS_VS_HOURS_LOGGED' | 'POINTS_VS_HOURS_EST'>('POINTS_VS_HOURS_LOGGED');
  const [histogramDimension, setHistogramDimension] = useState<'POINTS' | 'HOURS' | 'CYCLE_TIME'>('POINTS');

  // --- Table Sorting & Pagination ---
  const [tableSearch, setTableSearch] = useState<string>('');
  const [tableSortCol, setTableSortCol] = useState<string>('key');
  const [tableSortAsc, setTableSortAsc] = useState<boolean>(true);
  const [tablePage, setTablePage] = useState<number>(1);
  const [tablePageSize, setTablePageSize] = useState<number | 'ALL'>(25);

  // --- Live Backend API State ---
  const [apiData, setApiData] = useState<any | null>(null);
  const [isLoadingApi, setIsLoadingApi] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [autoSyncInterval, setAutoSyncInterval] = useState<'live' | '15s' | '30s' | '60s' | 'manual'>('live');
  const [relativeTime, setRelativeTime] = useState<string>('just now');
  const [showMobileFilters, setShowMobileFilters] = useState<boolean>(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Relative time updater
  useEffect(() => {
    const updateRelative = () => {
      const diffSec = Math.floor((Date.now() - lastRefreshedAt.getTime()) / 1000);
      if (diffSec < 5) setRelativeTime('just now');
      else if (diffSec < 60) setRelativeTime(`${diffSec}s ago`);
      else if (diffSec < 3600) setRelativeTime(`${Math.floor(diffSec / 60)}m ago`);
      else setRelativeTime(`${Math.floor(diffSec / 3600)}h ago`);
    };
    updateRelative();
    const interval = setInterval(updateRelative, 5000);
    return () => clearInterval(interval);
  }, [lastRefreshedAt]);

  // --- Interactive Drill-Down Modal State ---
  const [reportModal, setReportModal] = useState<{
    isOpen: boolean;
    reportType: string;
    reportTitle: string;
    category?: string;
  }>({
    isOpen: false,
    reportType: 'project-overview',
    reportTitle: 'Project Overview Report',
  });

  const [reportSearch, setReportSearch] = useState<string>('');
  const [selectedReportCat, setSelectedReportCat] = useState<string>('ALL');
  const [isGuideOpen, setIsGuideOpen] = useState<boolean>(false);

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

  // --- Fetch Analytics from Real Backend API ---
  const fetchAnalytics = useCallback(async () => {
    const targetProjId = effectiveProjectId;
    if (!targetProjId || targetProjId === 'default') return;
    setIsLoadingApi(true);
    setApiError(null);
    try {
      const queryParams = new URLSearchParams();
      if (sprintFilter !== 'ALL') queryParams.set('sprintId', sprintFilter);
      if (teamFilter !== 'ALL') queryParams.set('teamId', teamFilter);
      if (assigneeFilter !== 'ALL') queryParams.set('assigneeId', assigneeFilter);
      if (statusFilter !== 'ALL') queryParams.set('statusId', statusFilter);
      if (priorityFilter !== 'ALL') queryParams.set('priority', priorityFilter);
      if (typeFilter !== 'ALL') queryParams.set('issueType', typeFilter);
      if (epicFilter !== 'ALL') queryParams.set('epicId', epicFilter);
      if (timeRange !== 'ALL') queryParams.set('timeRange', timeRange);
      if (searchQuery.trim()) queryParams.set('search', searchQuery.trim());

      const url = `/api/projects/${targetProjId}/analytics?${queryParams.toString()}`;
      const res = await fetch(url);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setApiData(data);
      setLastRefreshedAt(new Date());
    } catch (err: any) {
      console.warn('Backend analytics API fallback to local data:', err.message);
      setApiError(err.message);
    } finally {
      setIsLoadingApi(false);
    }
  }, [effectiveProjectId, sprintFilter, teamFilter, assigneeFilter, statusFilter, priorityFilter, typeFilter, epicFilter, timeRange, searchQuery]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Reactive SSE Sync effect: when lastSyncTimestamp changes, debounce a background refetch
  useEffect(() => {
    if (!lastSyncTimestamp) return;
    if (autoSyncInterval === 'live') {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        fetchAnalytics();
      }, 600);
    }
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [lastSyncTimestamp, autoSyncInterval, fetchAnalytics]);

  // Periodic Auto-Sync Timer (15s / 30s / 60s)
  useEffect(() => {
    if (autoSyncInterval === 'manual' || autoSyncInterval === 'live') return;
    const ms = autoSyncInterval === '15s' ? 15000 : autoSyncInterval === '30s' ? 30000 : 60000;
    const timer = setInterval(() => {
      fetchAnalytics();
      if (onRefresh) onRefresh();
    }, ms);
    return () => clearInterval(timer);
  }, [autoSyncInterval, fetchAnalytics, onRefresh]);

  // Refresh Trigger
  const handleManualRefresh = () => {
    fetchAnalytics();
    if (onRefresh) onRefresh();
    showSuccess('Analytics data refreshed');
  };

  // Extract metadata lists
  const allTeamsList = useMemo(() => {
    const map = new Map<string, any>();
    if (Array.isArray(teams)) {
      teams.forEach((t: any) => { if (t && t.id) map.set(t.id, t); });
    }
    issues.forEach((i: any) => {
      if (i.team && i.team.id && !map.has(i.team.id)) {
        map.set(i.team.id, { id: i.team.id, name: i.team.name || 'Team' });
      }
    });
    return Array.from(map.values());
  }, [teams, issues]);

  const uniqueUsers = useMemo(() => {
    const map = new Map<string, any>();
    if (Array.isArray(members)) {
      members.forEach((m: any) => {
        const u = m.user || m;
        if (u && u.id) {
          map.set(u.id, {
            id: u.id,
            name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Member',
            email: u.email || '',
            avatar: (u.firstName?.[0] || u.name?.[0] || '?').toUpperCase(),
          });
        }
      });
    }
    issues.forEach((i: any) => {
      if (i.assignee && !map.has(i.assignee.id)) {
        map.set(i.assignee.id, {
          id: i.assignee.id,
          name: `${i.assignee.firstName || ''} ${i.assignee.lastName || ''}`.trim() || i.assignee.email || 'Member',
          email: i.assignee.email || '',
          avatar: (i.assignee.firstName?.[0] || '?').toUpperCase(),
        });
      }
    });
    return Array.from(map.values());
  }, [issues, members]);

  // Extract epics
  const epicsList = useMemo(() => {
    const map = new Map<string, any>();
    issues.forEach((i: any) => {
      if (i.epic && i.epic.id && !map.has(i.epic.id)) {
        map.set(i.epic.id, i.epic);
      }
    });
    return Array.from(map.values());
  }, [issues]);

  // Selected Team Member IDs
  const selectedTeamObj = useMemo(() => {
    if (teamFilter === 'ALL') return null;
    return allTeamsList.find((t: any) => t.id === teamFilter) || null;
  }, [allTeamsList, teamFilter]);

  // --- Filtered Issues Data Source ---
  const activeFilteredIssues = useMemo(() => {
    const baseList = issues && issues.length > 0
      ? issues
      : (apiData && Array.isArray(apiData.filteredIssues) ? apiData.filteredIssues : []);

    return baseList.filter((issue: any) => {
      if (selectedProjectId !== 'ALL') {
        const issueProjId = issue.projectId || (issue.project && issue.project.id);
        if (issueProjId && issueProjId !== selectedProjectId) return false;
      }

      if (sprintFilter === 'BACKLOG') {
        if (issue.sprintId) return false;
      } else if (sprintFilter !== 'ALL') {
        if (issue.sprintId !== sprintFilter) return false;
      }

      if (teamFilter !== 'ALL') {
        if (issue.teamId !== teamFilter) return false;
      }

      if (assigneeFilter === 'UNASSIGNED') {
        if (issue.assigneeId) return false;
      } else if (assigneeFilter !== 'ALL') {
        if (issue.assigneeId !== assigneeFilter) return false;
      }

      if (statusFilter !== 'ALL') {
        if (issue.statusId !== statusFilter) return false;
      }

      if (priorityFilter !== 'ALL') {
        if (issue.priority !== priorityFilter) return false;
      }

      if (typeFilter !== 'ALL') {
        if (issue.issueType !== typeFilter) return false;
      }

      if (epicFilter !== 'ALL') {
        if (issue.epicId !== epicFilter) return false;
      }

      if (timeRange !== 'ALL') {
        const days = timeRange === '7D' ? 7 : timeRange === '14D' ? 14 : timeRange === '30D' ? 30 : 90;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const created = new Date(issue.createdAt || 0);
        if (created < cutoff) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const key = (issue.issueKey || '').toLowerCase();
        const title = (issue.title || '').toLowerCase();
        const assignee = issue.assignee ? `${issue.assignee.firstName} ${issue.assignee.lastName}`.toLowerCase() : '';
        if (!key.includes(q) && !title.includes(q) && !assignee.includes(q)) return false;
      }

      return true;
    });
  }, [apiData, issues, selectedProjectId, sprintFilter, teamFilter, assigneeFilter, statusFilter, priorityFilter, typeFilter, epicFilter, timeRange, searchQuery]);

  const now = new Date();

  // --- Compute 12 Real KPI Metrics ---
  const kpis = useMemo(() => {
    if (apiData && apiData.summaryKPIs) {
      return apiData.summaryKPIs;
    }

    const total = activeFilteredIssues.length;
    const completedIssues = activeFilteredIssues.filter(
      (i: any) => i.status?.category === 'DONE' || i.status?.name?.toLowerCase().includes('done') || i.status?.name?.toLowerCase().includes('complete')
    );
    const inProgressIssues = activeFilteredIssues.filter(
      (i: any) => i.status?.category === 'IN_PROGRESS' || i.status?.category === 'REVIEW' || i.status?.category === 'TESTING' || i.status?.name?.toLowerCase().includes('progress')
    );
    const openIssues = activeFilteredIssues.filter(
      (i: any) => i.status?.category === 'TO_DO' || i.status?.name?.toLowerCase().includes('to do') || (!i.status?.category && !completedIssues.includes(i) && !inProgressIssues.includes(i))
    );
    const backlog = activeFilteredIssues.filter((i: any) => !i.sprintId);
    const overdue = activeFilteredIssues.filter(
      (i: any) => i.dueDate && new Date(i.dueDate) < now && i.status?.category !== 'DONE' && !i.status?.name?.toLowerCase().includes('done')
    );
    const blocked = activeFilteredIssues.filter(
      (i: any) =>
        (i.incomingDeps && i.incomingDeps.some((d: any) => d.type === 'BLOCKED_BY')) ||
        (i.outgoingDeps && i.outgoingDeps.some((d: any) => d.type === 'BLOCKS')) ||
        i.status?.name?.toLowerCase().includes('block') ||
        i.title?.toLowerCase().includes('[blocked]')
    );

    const totalPoints = activeFilteredIssues.reduce((acc: any, i: any) => acc + (i.estimatePoints || 0), 0);
    const completedPoints = completedIssues.reduce((acc: any, i: any) => acc + (i.estimatePoints || 0), 0);
    const totalHoursSpent = activeFilteredIssues.reduce((acc: any, i: any) => acc + (i.timeSpentHours || 0), 0);
    const totalHoursEst = activeFilteredIssues.reduce((acc: any, i: any) => acc + (i.estimateHours || 0), 0);
    const completionRate = total > 0 ? Math.round((completedIssues.length / total) * 100) : 0;

    let totalCycleDays = 0;
    let cycleCount = 0;
    completedIssues.forEach((i: any) => {
      if (i.createdAt && i.updatedAt) {
        const diffDays = Math.max(0.1, (new Date(i.updatedAt).getTime() - new Date(i.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        totalCycleDays += diffDays;
        cycleCount++;
      }
    });
    const avgCycleDays = cycleCount > 0 ? Number((totalCycleDays / cycleCount).toFixed(1)) : 0;

    return {
      totalIssues: total,
      completedIssues: completedIssues.length,
      openIssues: openIssues.length,
      inProgressIssues: inProgressIssues.length,
      backlogIssues: backlog.length,
      overdueIssues: overdue.length,
      blockedIssues: apiData?.summaryKPIs?.blockedIssues !== undefined ? apiData.summaryKPIs.blockedIssues : blocked.length,
      totalPoints,
      completedPoints,
      totalHoursSpent,
      totalHoursEst,
      activeSprints: sprints.filter((s) => s.status === 'ACTIVE').length,
      teamMembers: uniqueUsers.length,
      completionRate,
      avgCycleDays,
    };
  }, [apiData, activeFilteredIssues, sprints, uniqueUsers]);

  // Active Sprint
  const activeSprintObj = useMemo(() => {
    return sprints.find((s: any) => s.status === 'ACTIVE') || null;
  }, [sprints]);

  // Priority Color Resolver
  const getPriorityColor = useCallback((pri: string) => {
    const map: Record<string, string> = {
      CRITICAL: '#ef4444',
      HIGHEST: '#f97316',
      HIGH: '#fb923c',
      MEDIUM: '#3b82f6',
      LOW: '#64748b',
      LOWEST: '#94a3b8',
    };
    return map[pri?.toUpperCase()] || '#3b82f6';
  }, []);

  // --- Distributions ---
  const statusDistribution = useMemo(() => {
    if (apiData?.distributions?.byStatus) {
      return apiData.distributions.byStatus;
    }
    const total = activeFilteredIssues.length;
    return statuses.map((st) => {
      const match = activeFilteredIssues.filter((i: any) => i.statusId === st.id);
      return {
        id: st.id,
        name: st.name,
        category: st.category,
        color: st.color || '#3b82f6',
        count: match.length,
        points: match.reduce((s: any, i: any) => s + (i.estimatePoints || 0), 0),
        percentage: total > 0 ? Math.round((match.length / total) * 100) : 0,
      };
    });
  }, [apiData, activeFilteredIssues, statuses]);

  const priorityDistribution = useMemo(() => {
    if (apiData?.distributions?.byPriority) {
      return apiData.distributions.byPriority;
    }
    const total = activeFilteredIssues.length;
    const priList = ['CRITICAL', 'HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'];
    return priList.map((pri) => {
      const match = activeFilteredIssues.filter((i: any) => i.priority === pri);
      return {
        priority: pri,
        name: pri.charAt(0) + pri.slice(1).toLowerCase(),
        color: getPriorityColor(pri),
        count: match.length,
        points: match.reduce((s: any, i: any) => s + (i.estimatePoints || 0), 0),
        percentage: total > 0 ? Math.round((match.length / total) * 100) : 0,
      };
    });
  }, [apiData, activeFilteredIssues, getPriorityColor]);

  // Donut Conic Gradient
  const statusConicGradient = useMemo(() => {
    // Each segment starts where the previous ones ended. This used to
    // accumulate into a `let` captured by the map callback, which reassigns a
    // render-scoped variable from inside a closure — correct only because the
    // callback happens to run synchronously. Deriving each segment's offset
    // from the slice before it keeps the computation a pure function of
    // statusDistribution. The list is one entry per workflow status, so the
    // extra passes are not worth avoiding.
    const offsets: number[] = [];
    let running = 0;
    for (const s of statusDistribution as any[]) {
      offsets.push(running);
      running += s.percentage || 0;
    }

    const segments = (statusDistribution as any[]).map((s: any, i: number) => {
      const start = offsets[i];
      return `${s.color} ${start}% ${start + (s.percentage || 0)}%`;
    });

    return segments.length > 0 ? segments.join(', ') : '#e2e8f0 0% 100%';
  }, [statusDistribution]);

  // --- Member Workload Throughput ---
  const memberThroughput = useMemo(() => {
    if (apiData?.distributions?.byAssignee) {
      return apiData.distributions.byAssignee;
    }
    const map = new Map<string, any>();
    activeFilteredIssues.forEach((i: any) => {
      const key = i.assigneeId || 'UNASSIGNED';
      if (!map.has(key)) {
        const u = i.assignee;
        map.set(key, {
          userId: key,
          name: u ? `${u.firstName} ${u.lastName || ''}`.trim() : 'Unassigned',
          email: u?.email || '',
          avatar: u ? (u.firstName?.[0] || 'U').toUpperCase() : '?',
          total: 0,
          completed: 0,
          inProgress: 0,
          points: 0,
          completedPoints: 0,
          hours: 0,
        });
      }
      const b = map.get(key);
      b.total++;
      b.points += i.estimatePoints || 0;
      b.hours += i.timeSpentHours || 0;
      if (i.status?.category === 'DONE' || i.status?.name?.toLowerCase().includes('done')) {
        b.completed++;
        b.completedPoints += i.estimatePoints || 0;
      } else if (i.status?.category === 'IN_PROGRESS' || i.status?.category === 'REVIEW') {
        b.inProgress++;
      }
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [apiData, activeFilteredIssues]);

  // Max value for workload bars
  const maxWorkloadVal = useMemo(() => {
    if (barMetric === 'PTS') {
      return Math.max(...memberThroughput.map((m: any) => m.points), 1);
    }
    if (barMetric === 'HOURS') {
      return Math.max(...memberThroughput.map((m: any) => m.hours), 1);
    }
    return Math.max(...memberThroughput.map((m: any) => m.total), 1);
  }, [memberThroughput, barMetric]);

  // --- Real Burndown Points ---
  const burndownData = useMemo(() => {
    if (apiData?.sprintAnalytics?.burndownPoints && apiData.sprintAnalytics.burndownPoints.length > 0) {
      return apiData.sprintAnalytics.burndownPoints;
    }
    const sprintIssues = activeSprintObj ? activeFilteredIssues.filter((i: any) => i.sprintId === activeSprintObj.id) : activeFilteredIssues;
    const totalPts = sprintIssues.reduce((s: any, i: any) => s + (i.estimatePoints || 0), 0);
    const completedPts = sprintIssues
      .filter((i: any) => i.status?.category === 'DONE' || i.status?.name?.toLowerCase().includes('done'))
      .reduce((s: any, i: any) => s + (i.estimatePoints || 0), 0);

    const points = [];
    const days = 7;
    for (let i = 0; i <= days; i++) {
      const ideal = Math.max(0, Math.round(totalPts * (1 - i / days)));
      const actual = Math.max(0, Math.round(totalPts - completedPts * (i / days)));
      points.push({ label: `Day ${i}`, date: `+${i}d`, ideal, actual });
    }
    return points;
  }, [apiData, activeSprintObj, activeFilteredIssues]);

  const maxBurndownVal = useMemo(() => {
    return Math.max(...burndownData.map((b: any) => Math.max(b.ideal, b.actual)), 10);
  }, [burndownData]);

  // --- Real Creation & Completion Trends ---
  const trendsData = useMemo(() => {
    if (apiData?.trends && Array.isArray(apiData.trends)) {
      return apiData.trends;
    }
    // Client-side fallback: 14 days
    const map = new Map<string, any>();
    for (let d = 13; d >= 0; d--) {
      const date = new Date();
      date.setDate(date.getDate() - d);
      const key = date.toISOString().split('T')[0];
      const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      map.set(key, { date: key, label, created: 0, completed: 0 });
    }
    activeFilteredIssues.forEach((i: any) => {
      if (i.createdAt) {
        const k = new Date(i.createdAt).toISOString().split('T')[0];
        if (map.has(k)) map.get(k).created++;
      }
      if ((i.status?.category === 'DONE' || i.status?.name?.toLowerCase().includes('done')) && i.updatedAt) {
        const uk = new Date(i.updatedAt).toISOString().split('T')[0];
        if (map.has(uk)) map.get(uk).completed++;
      }
    });
    return Array.from(map.values());
  }, [apiData, activeFilteredIssues]);

  const maxTrendVal = useMemo(() => {
    return Math.max(...trendsData.map((t: any) => Math.max(t.created, t.completed)), 1);
  }, [trendsData]);

  // --- Cycle Time Histogram Bins ---
  const cycleBins = useMemo(() => {
    if (apiData?.cycleBins) return apiData.cycleBins;
    const bins = [
      { label: '< 1 day', min: 0, max: 1, count: 0, issues: [] as any[] },
      { label: '1-3 days', min: 1, max: 3, count: 0, issues: [] as any[] },
      { label: '4-7 days', min: 4, max: 7, count: 0, issues: [] as any[] },
      { label: '8-14 days', min: 8, max: 14, count: 0, issues: [] as any[] },
      { label: '15+ days', min: 15, max: 9999, count: 0, issues: [] as any[] },
    ];
    activeFilteredIssues
      .filter((i: any) => i.status?.category === 'DONE' || i.status?.name?.toLowerCase().includes('done'))
      .forEach((i: any) => {
        if (i.createdAt && i.updatedAt) {
          const days = Math.max(0.1, (new Date(i.updatedAt).getTime() - new Date(i.createdAt).getTime()) / (1000 * 60 * 60 * 24));
          const bin = bins.find((b: any) => days >= b.min && (b.max === 9999 ? days >= b.min : days <= b.max));
          if (bin) {
            bin.count++;
            bin.issues.push(i);
          }
        }
      });
    return bins;
  }, [apiData, activeFilteredIssues]);

  const maxCycleBinCount = useMemo(() => {
    return Math.max(...cycleBins.map((b: any) => b.count), 1);
  }, [cycleBins]);

  // --- Raw Data Table Processing ---
  const sortedTableIssues = useMemo(() => {
    let list = [...activeFilteredIssues];
    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase();
      list = list.filter((i: any) =>
        (i.issueKey || '').toLowerCase().includes(q) ||
        (i.title || '').toLowerCase().includes(q) ||
        (i.assignee ? `${i.assignee.firstName} ${i.assignee.lastName}`.toLowerCase() : '').includes(q) ||
        (i.status?.name || '').toLowerCase().includes(q) ||
        (i.priority || '').toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      switch (tableSortCol) {
        case 'key':
          valA = a.keyNumber || a.issueKey || '';
          valB = b.keyNumber || b.issueKey || '';
          break;
        case 'title':
          valA = a.title?.toLowerCase() || '';
          valB = b.title?.toLowerCase() || '';
          break;
        case 'status':
          valA = a.status?.name?.toLowerCase() || '';
          valB = b.status?.name?.toLowerCase() || '';
          break;
        case 'priority':
          valA = a.priority || '';
          valB = b.priority || '';
          break;
        case 'points':
          valA = Number(a.estimatePoints) || 0;
          valB = Number(b.estimatePoints) || 0;
          break;
        case 'dueDate':
          valA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
          valB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
          break;
      }
      if (valA < valB) return tableSortAsc ? -1 : 1;
      if (valA > valB) return tableSortAsc ? 1 : -1;
      return 0;
    });
    return list;
  }, [activeFilteredIssues, tableSearch, tableSortCol, tableSortAsc]);

  const paginatedTableIssues = useMemo(() => {
    if (tablePageSize === 'ALL') return sortedTableIssues;
    const start = (tablePage - 1) * tablePageSize;
    return sortedTableIssues.slice(start, start + tablePageSize);
  }, [sortedTableIssues, tablePage, tablePageSize]);

  const totalTablePages = useMemo(() => {
    if (tablePageSize === 'ALL') return 1;
    return Math.max(1, Math.ceil(sortedTableIssues.length / tablePageSize));
  }, [sortedTableIssues.length, tablePageSize]);

  // --- Export Actions ---
  const handleExportCSV = () => {
    if (activeFilteredIssues.length === 0) {
      showError('No filtered data to export');
      return;
    }
    const headers = ['Issue Key', 'Title', 'Type', 'Status', 'Priority', 'Assignee', 'Sprint', 'Story Points', 'Hours Spent', 'Due Date', 'Created At'];
    const rows = activeFilteredIssues.map((i: any) => [
      `"${i.issueKey || ''}"`,
      `"${(i.title || '').replace(/"/g, '""')}"`,
      `"${i.issueType || 'TASK'}"`,
      `"${i.status?.name || ''}"`,
      `"${i.priority || ''}"`,
      `"${i.assignee ? `${i.assignee.firstName} ${i.assignee.lastName || ''}`.trim() : 'Unassigned'}"`,
      `"${i.sprint?.name || 'Backlog'}"`,
      i.estimatePoints ?? '',
      i.timeSpentHours ?? '',
      `"${i.dueDate ? new Date(i.dueDate).toISOString().split('T')[0] : ''}"`,
      `"${i.createdAt ? new Date(i.createdAt).toISOString().split('T')[0] : ''}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r: any) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `analytics_${projectName || 'project'}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showSuccess('Exported filtered data to CSV');
  };

  const handleExportJSON = () => {
    if (activeFilteredIssues.length === 0) {
      showError('No filtered data to export');
      return;
    }
    const exportData = {
      project: { id: projectId, name: projectName },
      exportedAt: new Date().toISOString(),
      summaryKPIs: kpis,
      totalRecords: activeFilteredIssues.length,
      issues: activeFilteredIssues,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `analytics_${projectName || 'project'}_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showSuccess('Exported filtered data to JSON');
  };

  const handleCopyTSV = () => {
    if (activeFilteredIssues.length === 0) {
      showError('No filtered data to copy');
      return;
    }
    const headers = ['Key', 'Title', 'Type', 'Status', 'Priority', 'Assignee', 'Sprint', 'Points', 'Due Date'];
    const rows = activeFilteredIssues.map((i: any) => [
      i.issueKey || '',
      i.title || '',
      i.issueType || '',
      i.status?.name || '',
      i.priority || '',
      i.assignee ? `${i.assignee.firstName} ${i.assignee.lastName || ''}`.trim() : 'Unassigned',
      i.sprint?.name || 'Backlog',
      i.estimatePoints ?? '',
      i.dueDate ? new Date(i.dueDate).toISOString().split('T')[0] : '',
    ]);
    const tsv = [headers.join('\t'), ...rows.map((r: any) => r.join('\t'))].join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      showSuccess('Table copied to clipboard (ready for Excel/Sheets)');
    });
  };

  const hasActiveFilters = Boolean(
    sprintFilter !== 'ALL' ||
    teamFilter !== 'ALL' ||
    assigneeFilter !== 'ALL' ||
    statusFilter !== 'ALL' ||
    priorityFilter !== 'ALL' ||
    typeFilter !== 'ALL' ||
    epicFilter !== 'ALL' ||
    timeRange !== 'ALL' ||
    searchQuery.trim() !== ''
  );

  return (
    <div className="flex-1 p-4 sm:p-6 space-y-6 max-w-7xl mx-auto w-full">
      {/* Top Header with Project Selector, Live Refresh & Export Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-5 bg-card/40 p-4 rounded-2xl border">
        <div className="space-y-1">
          <div className="flex items-center flex-wrap gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-md">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                Data &amp; Visual Analytics Suite
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5 shadow-2xs">
                  <span className={`w-2 h-2 rounded-full ${autoSyncInterval === 'live' ? 'bg-emerald-500 animate-pulse' : 'bg-blue-500'}`} />
                  {autoSyncInterval === 'live' ? 'Live SSE Active' : `Auto-Sync: ${autoSyncInterval}`}
                </span>
              </h1>
            </div>

            {/* Project Selector Dropdown */}
            {projects.length > 0 && onSelectProject && (
              <div className="flex items-center gap-1.5 ml-2 bg-background border border-border rounded-xl px-2.5 py-1 shadow-xs">
                <FolderGit2 className="w-3.5 h-3.5 text-primary" />
                <select
                  value={projectId}
                  onChange={(e) => onSelectProject(e.target.value)}
                  className="bg-transparent text-xs font-bold text-foreground outline-none cursor-pointer"
                  aria-label="Switch project analytics"
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
          <p className="text-xs text-muted-foreground flex items-center flex-wrap gap-2">
            <span>Executive metrics, sprint burndowns, velocity trends &amp; real-time task drill-down.</span>
            <span className="text-[11px] text-muted-foreground/80 font-mono">
              • Synced: {relativeTime} ({lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})
            </span>
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Auto-Sync Cadence Dropdown */}
          <div className="flex items-center gap-1.5 bg-background border border-border rounded-xl px-2.5 py-1.5 shadow-xs text-xs font-semibold">
            <Radio className={`w-3.5 h-3.5 ${autoSyncInterval === 'live' ? 'text-emerald-500 animate-pulse' : 'text-muted-foreground'}`} />
            <select
              value={autoSyncInterval}
              onChange={(e) => {
                setAutoSyncInterval(e.target.value as any);
                showSuccess(`Auto-sync cadence set to ${e.target.value}`);
              }}
              className="bg-transparent text-xs font-semibold text-foreground outline-none cursor-pointer"
              title="Configure real-time auto-synchronization interval"
            >
              <option value="live">Live SSE (Instant)</option>
              <option value="15s">Every 15s</option>
              <option value="30s">Every 30s</option>
              <option value="60s">Every 60s</option>
              <option value="manual">Manual Only</option>
            </select>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isLoadingApi}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border hover:bg-muted rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-xs disabled:opacity-50"
            title="Refresh analytics directly from database"
          >
            <RotateCcw className={`w-3.5 h-3.5 text-primary ${isLoadingApi ? 'animate-spin' : ''}`} />
            <span>{isLoadingApi ? 'Refreshing...' : 'Refresh'}</span>
          </button>

          {/* Export CSV */}
          <button
            type="button"
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border hover:bg-muted rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-xs"
            title="Export filtered dataset as CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
            <span>CSV</span>
          </button>

          {/* Export JSON */}
          <button
            type="button"
            onClick={handleExportJSON}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border hover:bg-muted rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-xs"
            title="Export analytics payload as JSON"
          >
            <FileCode className="w-3.5 h-3.5 text-blue-500" />
            <span>JSON</span>
          </button>

          {/* Copy TSV */}
          <button
            type="button"
            onClick={handleCopyTSV}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border hover:bg-muted rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-xs"
            title="Copy table to clipboard (Excel / Sheets)"
          >
            <Copy className="w-3.5 h-3.5 text-indigo-500" />
            <span>Copy</span>
          </button>

          {/* Print / PDF */}
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border hover:bg-muted rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-xs"
            title="Print dashboard or save as PDF"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* Real Multi-Dimensional Filter Toolbar */}
      <div className="bg-card border border-border rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative min-w-[200px] flex-1 sm:flex-initial">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search issues, keys, assignees..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-background border border-border rounded-xl text-foreground focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>

            {/* Sprint Filter */}
            <div className="flex items-center gap-1.5 bg-background border border-border rounded-xl px-2.5 py-1.5">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <select
                value={sprintFilter}
                onChange={(e) => setSprintFilter(e.target.value)}
                className="bg-transparent text-xs font-semibold text-foreground outline-none cursor-pointer"
                aria-label="Filter by sprint"
              >
                <option value="ALL">All Sprints &amp; Backlog</option>
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
                <option value="BACKLOG">Backlog Only</option>
              </select>
            </div>

            {/* Mobile Filter Toggle */}
            <button
              type="button"
              onClick={() => setShowMobileFilters((prev) => !prev)}
              className="md:hidden flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border rounded-xl text-xs font-semibold text-foreground cursor-pointer shadow-2xs"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
              <span>Filters {hasActiveFilters ? '(Active)' : ''}</span>
              <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showMobileFilters ? 'rotate-180' : ''}`} />
            </button>

            {/* Secondary Collapsible Filters */}
            <div className={`items-center flex-wrap gap-2 ${showMobileFilters ? 'flex w-full pt-2 border-t border-border/60' : 'hidden md:flex'}`}>
              {/* Assignee Filter */}
              <div className="flex items-center gap-1.5 bg-background border border-border rounded-xl px-2.5 py-1.5">
                <User className="w-3.5 h-3.5 text-muted-foreground" />
                <select
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-foreground outline-none cursor-pointer"
                  aria-label="Filter by assignee"
                >
                  <option value="ALL">All Assignees</option>
                  {uniqueUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                  <option value="UNASSIGNED">Unassigned Only</option>
                </select>
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1 bg-background border border-border rounded-xl px-2.5 py-1.5">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-foreground outline-none cursor-pointer"
                  aria-label="Filter by status"
                >
                  <option value="ALL">All Statuses</option>
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Priority Filter */}
              <div className="flex items-center gap-1 bg-background border border-border rounded-xl px-2.5 py-1.5">
                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-foreground outline-none cursor-pointer"
                  aria-label="Filter by priority"
                >
                  <option value="ALL">All Priorities</option>
                  <option value="CRITICAL">Critical</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
              </div>

              {/* Issue Type Filter */}
              <div className="flex items-center gap-1 bg-background border border-border rounded-xl px-2.5 py-1.5">
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-foreground outline-none cursor-pointer"
                  aria-label="Filter by type"
                >
                  <option value="ALL">All Types</option>
                  <option value="TASK">Task</option>
                  <option value="BUG">Bug</option>
                  <option value="STORY">Story</option>
                  <option value="EPIC">Epic</option>
                </select>
              </div>

              {/* Time Horizon Filter */}
              <div className="flex items-center gap-1 bg-background border border-border rounded-xl px-2.5 py-1.5">
                <select
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-foreground outline-none cursor-pointer"
                  aria-label="Filter by date range"
                >
                  <option value="ALL">All Time</option>
                  <option value="7D">Past 7 Days</option>
                  <option value="14D">Past 14 Days</option>
                  <option value="30D">Past 30 Days</option>
                  <option value="90D">Past 90 Days</option>
                </select>
              </div>

              {/* Reset Filters */}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setSprintFilter('ALL');
                    setTeamFilter('ALL');
                    setAssigneeFilter('ALL');
                    setStatusFilter('ALL');
                    setPriorityFilter('ALL');
                    setTypeFilter('ALL');
                    setEpicFilter('ALL');
                    setTimeRange('ALL');
                    setSearchQuery('');
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 rounded-xl font-semibold transition-colors cursor-pointer"
                  title="Clear all active filters"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              )}
            </div>
          </div>

          {/* Section View Tabs */}
          <div className="flex items-center bg-muted/60 p-1 rounded-xl border border-border overflow-x-auto no-scrollbar max-w-full gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('ALL')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'ALL'
                  ? 'bg-background text-primary shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All Sections
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('VELOCITY')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'VELOCITY'
                  ? 'bg-background text-primary shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Velocity &amp; Burndown
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('DISTRIBUTION')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'DISTRIBUTION'
                  ? 'bg-background text-primary shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Distributions
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('WORKLOAD')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'WORKLOAD'
                  ? 'bg-background text-primary shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Workload
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('TRENDS')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'TRENDS'
                  ? 'bg-background text-primary shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Trends
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('REPORTS')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'REPORTS'
                  ? 'bg-background text-primary shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Report Center
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('MATRIX')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'MATRIX'
                  ? 'bg-background text-primary shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Traceability Matrix
            </button>
          </div>
        </div>
      </div>

      {/* 12 Meaningful Real KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {/* 1. Total Issues */}
        <div
          onClick={() => openDrillDown({
            title: 'Total Scoped Issues',
            subtitle: 'All project issues matching active filters',
            category: 'Total Scope',
            metricLabel: `${kpis.totalIssues} Issues (${kpis.totalPoints} pts)`,
            percentage: 100,
            issues: activeFilteredIssues,
          })}
          className="bg-card border border-border p-3.5 rounded-xl shadow-xs cursor-pointer hover:border-primary/60 hover:shadow-md transition-all group"
          title="Click to view all scoped issues"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className="group-hover:text-primary transition-colors">Total Issues</span>
            <Activity className="w-3.5 h-3.5 text-primary" />
          </div>
          <p className="text-2xl font-black text-foreground mt-1">{kpis.totalIssues}</p>
          <span className="text-[10px] text-primary font-bold">{kpis.totalPoints} pts total</span>
        </div>

        {/* 2. Completed Issues */}
        <div
          onClick={() => openDrillDown({
            title: 'Completed Work Items',
            subtitle: 'Issues marked as Done or Completed',
            category: 'Completed',
            metricLabel: `${kpis.completedIssues} of ${kpis.totalIssues} Completed`,
            percentage: kpis.completionRate,
            issues: activeFilteredIssues.filter((i: any) => i.status?.category === 'DONE' || i.status?.name?.toLowerCase().includes('done') || i.status?.name?.toLowerCase().includes('complete')),
          })}
          className="bg-card border border-border p-3.5 rounded-xl shadow-xs cursor-pointer hover:border-emerald-500/60 hover:shadow-md transition-all group"
          title="Click to view completed issues"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className="group-hover:text-emerald-500 transition-colors">Completed</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{kpis.completedIssues}</p>
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">{kpis.completionRate}% Done</span>
        </div>

        {/* 3. Open Issues (To Do) */}
        <div
          onClick={() => openDrillDown({
            title: 'Open Issues (To Do)',
            subtitle: 'Issues waiting to be started',
            category: 'To Do',
            metricLabel: `${kpis.openIssues} open issues`,
            issues: activeFilteredIssues.filter((i: any) => i.status?.category === 'TO_DO' || i.status?.name?.toLowerCase().includes('to do')),
          })}
          className="bg-card border border-border p-3.5 rounded-xl shadow-xs cursor-pointer hover:border-slate-400 hover:shadow-md transition-all group"
          title="Click to view open issues"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className="group-hover:text-foreground transition-colors">Open / To Do</span>
            <Clock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          </div>
          <p className="text-2xl font-black text-foreground mt-1">{kpis.openIssues}</p>
          <span className="text-[10px] text-muted-foreground">Pending pickup</span>
        </div>

        {/* 4. In Progress */}
        <div
          onClick={() => openDrillDown({
            title: 'In-Flight Work Items',
            subtitle: 'Issues in development, review, or testing',
            category: 'In Progress',
            metricLabel: `${kpis.inProgressIssues} active issues`,
            issues: activeFilteredIssues.filter((i: any) => i.status?.category === 'IN_PROGRESS' || i.status?.category === 'REVIEW' || i.status?.category === 'TESTING' || i.status?.name?.toLowerCase().includes('progress')),
          })}
          className="bg-card border border-border p-3.5 rounded-xl shadow-xs cursor-pointer hover:border-amber-500/60 hover:shadow-md transition-all group"
          title="Click to view in-flight issues"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className="group-hover:text-amber-500 transition-colors">In Progress</span>
            <Zap className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <p className="text-2xl font-black text-amber-500 mt-1">{kpis.inProgressIssues}</p>
          <span className="text-[10px] text-amber-500 font-bold">Active work</span>
        </div>

        {/* 5. Backlog Tasks */}
        <div
          onClick={() => openDrillDown({
            title: 'Product Backlog Tasks',
            subtitle: 'Issues not currently allocated to an active sprint',
            category: 'Backlog',
            metricLabel: `${kpis.backlogIssues} backlog issues`,
            issues: activeFilteredIssues.filter((i: any) => !i.sprintId),
          })}
          className="bg-card border border-border p-3.5 rounded-xl shadow-xs cursor-pointer hover:border-indigo-500/60 hover:shadow-md transition-all group"
          title="Click to view backlog issues"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className="group-hover:text-indigo-500 transition-colors">Backlog</span>
            <Layers className="w-3.5 h-3.5 text-indigo-500" />
          </div>
          <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">{kpis.backlogIssues}</p>
          <span className="text-[10px] text-indigo-500 font-medium">Unplanned tasks</span>
        </div>

        
        {/* 6b. Blocked Issues */}
        <div
          onClick={() => openDrillDown({
            title: 'Blocked Work Items',
            subtitle: 'Issues with active blockers or impediment dependencies',
            category: 'Blocked Issues',
            metricLabel: `${kpis.blockedIssues || 0} blocked tasks`,
            issues: activeFilteredIssues.filter((i: any) =>
              (i.incomingDeps && i.incomingDeps.some((d: any) => d.type === 'BLOCKED_BY')) ||
              (i.outgoingDeps && i.outgoingDeps.some((d: any) => d.type === 'BLOCKS')) ||
              i.status?.name?.toLowerCase().includes('block') ||
              i.title?.toLowerCase().includes('[blocked]')
            ),
          })}
          className={`bg-card border p-3.5 rounded-xl shadow-xs cursor-pointer hover:shadow-md transition-all group ${
            (kpis.blockedIssues || 0) > 0
              ? 'border-amber-400 dark:border-amber-700 bg-amber-50/20 dark:bg-amber-950/10'
              : 'border-border'
          }`}
          title="Click to inspect blocked issues"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className={(kpis.blockedIssues || 0) > 0 ? 'text-amber-600 dark:text-amber-400 font-bold' : ''}>Blocked</span>
            <AlertCircle className={`w-3.5 h-3.5 ${(kpis.blockedIssues || 0) > 0 ? 'text-amber-600 dark:text-amber-400 animate-pulse' : 'text-slate-500 dark:text-slate-400'}`} />
          </div>
          <p className={`text-2xl font-black mt-1 ${(kpis.blockedIssues || 0) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
            {kpis.blockedIssues || 0}
          </p>
          <span className={`text-[10px] font-semibold ${(kpis.blockedIssues || 0) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
            {(kpis.blockedIssues || 0) > 0 ? 'Action required' : 'Zero blockers'}
          </span>
        </div>

        {/* 6. Overdue Issues */}
        <div
          onClick={() => openDrillDown({
            title: 'Overdue Work Items',
            subtitle: 'Uncompleted tasks whose due date has passed',
            category: 'Overdue Alert',
            metricLabel: `${kpis.overdueIssues} overdue issues`,
            issues: activeFilteredIssues.filter((i: any) => i.dueDate && new Date(i.dueDate) < now && i.status?.category !== 'DONE' && !i.status?.name?.toLowerCase().includes('done')),
          })}
          className={`bg-card border p-3.5 rounded-xl shadow-xs cursor-pointer hover:shadow-md transition-all group ${
            kpis.overdueIssues > 0
              ? 'border-rose-300 dark:border-rose-900 bg-rose-50/20 dark:bg-rose-950/10'
              : 'border-border'
          }`}
          title="Click to inspect overdue issues"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span className={kpis.overdueIssues > 0 ? 'text-rose-600 font-bold' : ''}>Overdue</span>
            <AlertTriangle className={`w-3.5 h-3.5 ${kpis.overdueIssues > 0 ? 'text-rose-600 animate-pulse' : 'text-slate-500 dark:text-slate-400'}`} />
          </div>
          <p className={`text-2xl font-black mt-1 ${kpis.overdueIssues > 0 ? 'text-rose-600' : 'text-foreground'}`}>
            {kpis.overdueIssues}
          </p>
          <span className={`text-[10px] font-semibold ${kpis.overdueIssues > 0 ? 'text-rose-600' : 'text-muted-foreground'}`}>
            {kpis.overdueIssues > 0 ? 'Action required' : 'None overdue'}
          </span>
        </div>

        {/* 7. Total Story Points */}
        <div
          onClick={() => openDrillDown({
            title: 'Committed Story Points',
            subtitle: 'Total estimated delivery points across scope',
            category: 'Story Points',
            metricLabel: `${kpis.totalPoints} pts`,
            issues: activeFilteredIssues.filter((i: any) => (i.estimatePoints || 0) > 0),
          })}
          className="bg-card border border-border p-3.5 rounded-xl shadow-xs cursor-pointer hover:border-blue-500/60 hover:shadow-md transition-all group"
          title="Click to view issues with story points"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>Total Points</span>
            <Target className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <p className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1">{kpis.totalPoints}</p>
          <span className="text-[10px] text-muted-foreground">{kpis.totalHoursEst}h estimated</span>
        </div>

        {/* 8. Points Burned */}
        <div
          onClick={() => openDrillDown({
            title: 'Points Delivered (Burned)',
            subtitle: 'Completed issues delivering story points',
            category: 'Burned Points',
            metricLabel: `${kpis.completedPoints} pts burned`,
            percentage: kpis.totalPoints > 0 ? Math.round((kpis.completedPoints / kpis.totalPoints) * 100) : 0,
            issues: activeFilteredIssues.filter((i: any) => (i.status?.category === 'DONE' || i.status?.name?.toLowerCase().includes('done')) && (i.estimatePoints || 0) > 0),
          })}
          className="bg-card border border-border p-3.5 rounded-xl shadow-xs cursor-pointer hover:border-indigo-500/60 hover:shadow-md transition-all group"
          title="Click to view points burned"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>Points Burned</span>
            <Zap className="w-3.5 h-3.5 text-indigo-500" />
          </div>
          <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">{kpis.completedPoints}</p>
          <span className="text-[10px] text-indigo-500 font-bold">
            {kpis.totalPoints > 0 ? Math.round((kpis.completedPoints / kpis.totalPoints) * 100) : 0}% burned
          </span>
        </div>

        {/* 9. Active Sprints */}
        <div
          onClick={() => openDrillDown({
            title: 'Active Sprint Issues',
            subtitle: activeSprintObj ? `Current iteration: ${activeSprintObj.name}` : 'No active sprint',
            category: 'Sprint Scope',
            metricLabel: `${activeSprintObj ? '1 Active Sprint' : '0 Sprints'}`,
            issues: activeSprintObj ? activeFilteredIssues.filter((i: any) => i.sprintId === activeSprintObj.id) : [],
          })}
          className="bg-card border border-border p-3.5 rounded-xl shadow-xs cursor-pointer hover:border-purple-500/60 hover:shadow-md transition-all group"
          title="Click to inspect active sprint tasks"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>Active Sprints</span>
            <Calendar className="w-3.5 h-3.5 text-purple-500" />
          </div>
          <p className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">{kpis.activeSprints}</p>
          <span className="text-[10px] text-muted-foreground truncate">{activeSprintObj?.name || 'None'}</span>
        </div>

        {/* 10. Team Members Assigned */}
        <div
          onClick={() => openDrillDown({
            title: 'Team Members Allocated Work',
            subtitle: 'All assigned tasks across project roster',
            category: 'Team Roster',
            metricLabel: `${kpis.teamMembers} members involved`,
            issues: activeFilteredIssues.filter((i: any) => i.assigneeId),
          })}
          className="bg-card border border-border p-3.5 rounded-xl shadow-xs cursor-pointer hover:border-emerald-500/60 hover:shadow-md transition-all group"
          title="Click to view assigned team issues"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>Team Members</span>
            <User className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <p className="text-2xl font-black text-foreground mt-1">{kpis.teamMembers}</p>
          <span className="text-[10px] text-emerald-600 font-semibold">{memberThroughput.length} active assignees</span>
        </div>

        {/* 11. Completion Rate % */}
        <div
          onClick={() => openDrillDown({
            title: 'Delivery Progress Overview',
            subtitle: `${kpis.completedIssues} of ${kpis.totalIssues} issues completed`,
            category: 'Progress',
            metricLabel: `${kpis.completionRate}%`,
            percentage: kpis.completionRate,
            issues: activeFilteredIssues,
          })}
          className="bg-card border border-border p-3.5 rounded-xl shadow-xs cursor-pointer hover:border-primary hover:shadow-md transition-all group"
          title="Click to inspect delivery progress"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>Delivery Pace</span>
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
          </div>
          <p className="text-2xl font-black text-primary mt-1">{kpis.completionRate}%</p>
          <span className="text-[10px] text-muted-foreground">{kpis.totalIssues - kpis.completedIssues} remaining</span>
        </div>

        {/* 12. Average Cycle Time */}
        <div
          onClick={() => openDrillDown({
            title: 'Cycle Time Performance',
            subtitle: 'Resolved tasks with lead time measured from creation to completion',
            category: 'Lead Time',
            metricLabel: `${kpis.avgCycleDays} days average`,
            issues: activeFilteredIssues.filter((i: any) => i.status?.category === 'DONE' || i.status?.name?.toLowerCase().includes('done')),
          })}
          className="bg-card border border-border p-3.5 rounded-xl shadow-xs cursor-pointer hover:border-amber-500/60 hover:shadow-md transition-all group"
          title="Click to inspect cycle time issues"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>Avg Cycle Time</span>
            <Flame className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
            {kpis.avgCycleDays} <span className="text-xs font-normal text-muted-foreground">d</span>
          </p>
          <span className="text-[10px] text-amber-600 font-bold">Created → Resolved</span>
        </div>
      </div>

      {/* Main Visualizations Grid */}
      <div className="space-y-6">
        {/* SECTION 0: PROJECT PROGRESS & MILESTONES */}
        {(activeTab === 'ALL' || activeTab === 'VELOCITY') && (
          <div className="bg-card border border-border rounded-2xl p-5 shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border">
              <div>
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <h3 className="text-base font-bold text-foreground">
                    Project Progress &amp; Milestone Tracking
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Real-time delivery progress across tasks, story points, active sprints, and epics
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-2xl font-black text-foreground">{kpis.completionRate}%</div>
                  <div className="text-[11px] text-muted-foreground">Overall Completion</div>
                </div>
                <div className="w-12 h-12 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 flex items-center justify-center font-bold text-xs text-emerald-600">
                  {kpis.completionRate}%
                </div>
              </div>
            </div>

            {/* Dual Progress Bars */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
              {/* Task Count Progress */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-foreground">Issue Completion Progress</span>
                  <span className="text-muted-foreground">{kpis.completedIssues} of {kpis.totalIssues} issues</span>
                </div>
                <div className="w-full h-3 bg-muted/60 rounded-full overflow-hidden flex">
                  <div style={{ width: String(kpis.completionRate) + '%' }} className="bg-emerald-500 transition-all" title="Done" />
                  <div style={{ width: String(kpis.totalIssues > 0 ? Math.round((kpis.inProgressIssues / kpis.totalIssues) * 100) : 0) + '%' }} className="bg-amber-500 transition-all" title="In Progress" />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Done ({kpis.completedIssues})</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> In Progress ({kpis.inProgressIssues})</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-400" /> Open ({kpis.openIssues})</span>
                </div>
              </div>

              {/* Story Point Progress */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-foreground">Story Points Velocity</span>
                  <span className="text-muted-foreground">{kpis.completedPoints} of {kpis.totalPoints} pts burned ({kpis.totalPoints > 0 ? Math.round((kpis.completedPoints / kpis.totalPoints) * 100) : 0}%)</span>
                </div>
                <div className="w-full h-3 bg-muted/60 rounded-full overflow-hidden">
                  <div
                    style={{ width: String(kpis.totalPoints > 0 ? Math.round((kpis.completedPoints / kpis.totalPoints) * 100) : 0) + '%' }}
                    className="h-full bg-purple-600 rounded-full transition-all"
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                  <span className="text-purple-600 font-semibold">{kpis.completedPoints} pts completed</span>
                  <span className="text-slate-500 dark:text-slate-400">{Math.max(0, kpis.totalPoints - kpis.completedPoints)} pts remaining</span>
                </div>
              </div>
            </div>

            {/* Overdue Risk Alert & Sprint Status Banner */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-border">
              {kpis.overdueIssues > 0 ? (
                <div
                  onClick={() => openDrillDown({
                    title: 'Overdue Project Tasks',
                    subtitle: 'Tasks requiring immediate attention past their target completion date',
                    category: 'Risk',
                    metricLabel: String(kpis.overdueIssues) + ' Overdue Tasks',
                    issues: activeFilteredIssues.filter((i: any) => i.dueDate && new Date(i.dueDate) < now && i.status?.category !== 'DONE'),
                  })}
                  className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl cursor-pointer hover:bg-rose-500/15 transition flex items-center justify-between"
                >
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <div>
                      <div className="text-xs font-bold text-rose-700 dark:text-rose-400">
                        {kpis.overdueIssues} Overdue Tasks Detected
                      </div>
                      <div className="text-[10px] text-rose-600/80">Click to view items past due date</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-rose-500" />
                </div>
              ) : (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>All tasks on schedule — Zero overdue items</span>
                </div>
              )}

              {activeSprintObj ? (
                <div
                  onClick={() => openDrillDown({
                    title: 'Active Sprint: ' + activeSprintObj.name,
                    subtitle: 'Issues assigned to the current active iteration',
                    category: 'Active Sprint',
                    metricLabel: activeSprintObj.name,
                    issues: activeFilteredIssues.filter((i: any) => i.sprintId === activeSprintObj.id),
                  })}
                  className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl cursor-pointer hover:bg-blue-500/15 transition flex items-center justify-between"
                >
                  <div className="flex items-center gap-2.5">
                    <Flame className="w-4 h-4 text-blue-600" />
                    <div>
                      <div className="text-xs font-bold text-blue-700 dark:text-blue-400">
                        Active: {activeSprintObj.name}
                      </div>
                      <div className="text-[10px] text-blue-600/80">
                        {activeFilteredIssues.filter((i: any) => i.sprintId === activeSprintObj.id).length} issues in sprint
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-blue-500" />
                </div>
              ) : (
                <div className="p-3 bg-slate-500/10 border border-slate-500/20 rounded-xl flex items-center gap-2.5 text-xs text-muted-foreground">
                  <Layers className="w-4 h-4" />
                  <span>No active sprint currently running</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 1: SPRINT BURNDOWN & VELOCITY */}
        {(activeTab === 'ALL' || activeTab === 'VELOCITY') && (
          <div className="space-y-6">
            {/* Sprint Velocity Engine Card */}
            {effectiveProjectId && (
              <SprintVelocityCard
                projectId={effectiveProjectId}
                projectName={effectiveProjectName}
                teams={teams}
                selectedTeamId={teamFilter}
                onSelectIssue={onSelectIssue}
                onOpenDrillDown={openDrillDown}
              />
            )}

            {/* Sprint Burndown Line Chart */}
            <div className="bg-card border border-border rounded-2xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground">
                        Sprint Burndown Pace ({activeSprintObj?.name || 'Active Sprint'})
                      </h3>
                      <p className="text-[11px] text-muted-foreground">
                        Target ideal pace vs. actual remaining story points
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {kpis.totalPoints} pts scope
                  </span>
                </div>

                {/* SVG Burndown Chart */}
                <div className="w-full relative pt-2">
                  <svg viewBox="0 0 500 180" className="w-full h-44 bg-muted/20 rounded-xl border border-border">
                    {/* Horizontal Guides */}
                    {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                      const y = 20 + 130 * ratio;
                      const val = Math.round(maxBurndownVal * (1 - ratio));
                      return (
                        <g key={idx}>
                          <line x1="40" y1={y} x2="480" y2={y} stroke="currentColor" strokeOpacity="0.1" strokeDasharray="3 3" />
                          <text x="35" y={y + 3} fontSize="9" textAnchor="end" fill="currentColor" opacity="0.4" fontFamily="monospace">
                            {val}
                          </text>
                        </g>
                      );
                    })}

                    {/* Ideal Burndown Polyline */}
                    <polyline
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                      points={burndownData.map((d: any, idx: number) => {
                        const x = 50 + (idx / Math.max(1, burndownData.length - 1)) * 410;
                        const y = 20 + (1 - d.ideal / maxBurndownVal) * 130;
                        return `${x},${y}`;
                      }).join(' ')}
                    />

                    {/* Actual Burndown Polyline */}
                    <polyline
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="2.5"
                      points={burndownData.map((d: any, idx: number) => {
                        const x = 50 + (idx / Math.max(1, burndownData.length - 1)) * 410;
                        const y = 20 + (1 - d.actual / maxBurndownVal) * 130;
                        return `${x},${y}`;
                      }).join(' ')}
                    />

                    {/* Interactive Data Points on Actual Line */}
                    {burndownData.map((d: any, idx: number) => {
                      const x = 50 + (idx / Math.max(1, burndownData.length - 1)) * 410;
                      const y = 20 + (1 - d.actual / maxBurndownVal) * 130;
                      return (
                        <g key={idx} className="group">
                          <circle
                            cx={x}
                            cy={y}
                            r="5"
                            fill="#2563eb"
                            stroke="#ffffff"
                            strokeWidth="2"
                            onClick={() => {
                              const sprintIssues = activeSprintObj ? activeFilteredIssues.filter((i: any) => i.sprintId === activeSprintObj.id) : activeFilteredIssues;
                              openDrillDown({
                                title: `Burndown Pace: ${d.label}`,
                                subtitle: `Ideal: ${d.ideal} pts • Actual remaining: ${d.actual} pts`,
                                category: 'Sprint Burndown',
                                metricLabel: `${d.actual} pts remaining`,
                                issues: sprintIssues,
                              });
                            }}
                            className="cursor-pointer hover:scale-150 transition-transform"
                          />
                          <text x={x} y="170" fontSize="9" textAnchor="middle" fill="currentColor" opacity="0.6">
                            {d.label}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 mt-3 border-t border-border text-[11px] text-muted-foreground">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-0.5 bg-blue-600" /> Actual Remaining
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-0.5 bg-slate-400 border-dashed" /> Ideal Pace
                  </span>
                </div>
                <span className="font-mono text-primary font-bold">{kpis.completedPoints} pts burned</span>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 2: CATEGORICAL DISTRIBUTIONS (STATUS & PRIORITY) */}
        {(activeTab === 'ALL' || activeTab === 'DISTRIBUTION') && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Status Breakdown Donut */}
            <div className="bg-card border border-border rounded-2xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600">
                      <PieIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground">
                        Issues by Workflow Status
                      </h3>
                      <p className="text-[11px] text-muted-foreground">Real-time distribution across workflow phases</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground font-semibold">
                    {statusDistribution.length} statuses
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-6 mt-4">
                  {/* Conic Donut Visual */}
                  <div
                    onClick={() => openDrillDown({
                      title: 'All Scoped Issues by Status',
                      subtitle: 'Full portfolio of project issues',
                      category: 'All Statuses',
                      metricLabel: `${activeFilteredIssues.length} issues`,
                      percentage: 100,
                      issues: activeFilteredIssues,
                    })}
                    className="relative w-36 h-36 flex-shrink-0 flex items-center justify-center cursor-pointer hover:scale-105 transition-transform"
                    title="Click to view all issues in donut"
                  >
                    <div
                      className="w-full h-full rounded-full transition-all duration-500 shadow-inner"
                      style={{ background: `conic-gradient(${statusConicGradient})` }}
                    />
                    <div className="absolute w-20 h-20 bg-card rounded-full flex flex-col items-center justify-center shadow-md">
                      <span className="text-xl font-black text-foreground">
                        {activeFilteredIssues.length}
                      </span>
                      <span className="text-[9px] text-muted-foreground uppercase font-bold">Total</span>
                    </div>
                  </div>

                  {/* Slices Legend List */}
                  <div className="flex-1 w-full space-y-1.5 max-h-44 overflow-y-auto pr-1">
                    {statusDistribution.map((s: any) => (
                      <div
                        key={s.id}
                        onClick={() => {
                          const matching = activeFilteredIssues.filter((i: any) => i.statusId === s.id);
                          openDrillDown({
                            title: `Status: ${s.name}`,
                            subtitle: `Issues currently in status ${s.name} (${s.points} story points)`,
                            category: 'Status Breakdown',
                            metricLabel: `${s.count} issues (${s.percentage}%)`,
                            percentage: s.percentage,
                            issues: matching,
                          });
                        }}
                        className="flex items-center justify-between text-xs hover:bg-muted/60 p-1.5 rounded-lg cursor-pointer group transition-colors"
                        title={`Click to inspect all ${s.count} issues in ${s.name}`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 group-hover:scale-125 transition-transform" style={{ backgroundColor: s.color }} />
                          <span className="text-foreground truncate font-medium group-hover:text-primary transition-colors">{s.name}</span>
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                          <span className="font-bold text-foreground">{s.count}</span>
                          <span>({s.percentage}%)</span>
                        </div>
                      </div>
                    ))}
                    {statusDistribution.length === 0 && (
                      <div className="text-xs text-muted-foreground py-6 text-center">No issues in current scope</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 mt-3 border-t border-border text-[11px] text-muted-foreground">
                <span>Completed: {kpis.completedIssues} issues</span>
                <span className="text-emerald-600 font-semibold">{kpis.completionRate}% throughput</span>
              </div>
            </div>

            {/* Priority Distribution Breakdown */}
            <div className="bg-card border border-border rounded-2xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-orange-500/10 text-orange-600">
                      <Flame className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground">
                        Issues by Priority Level
                      </h3>
                      <p className="text-[11px] text-muted-foreground">Risk and urgency profile of active workload</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-600 border border-orange-500/20">
                    6 Tiers
                  </span>
                </div>

                {/* Priority Horizontal Bars */}
                <div className="space-y-2.5 mt-4">
                  {priorityDistribution.map((p: any) => {
                    const pct = activeFilteredIssues.length > 0 ? (p.count / activeFilteredIssues.length) * 100 : 0;
                    return (
                      <div
                        key={p.priority}
                        onClick={() => {
                          const matching = activeFilteredIssues.filter((i: any) => i.priority === p.priority);
                          openDrillDown({
                            title: `Priority: ${p.name}`,
                            subtitle: `Issues marked with priority level ${p.name} (${p.points} story points)`,
                            category: 'Priority Breakdown',
                            metricLabel: `${p.count} issues (${p.percentage}%)`,
                            percentage: p.percentage,
                            issues: matching,
                          });
                        }}
                        className="space-y-1 p-1 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group"
                        title={`Click to view all ${p.count} ${p.name} priority issues`}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                            <span className="font-semibold text-foreground group-hover:text-primary transition-colors">{p.name}</span>
                          </div>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            <strong className="text-foreground">{p.count}</strong> tasks ({p.points} pts)
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(3, pct)}%`, backgroundColor: p.color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 mt-3 border-t border-border text-[11px] text-muted-foreground">
                <span>Critical / Highest: {priorityDistribution.filter((p: any) => p.priority === 'CRITICAL' || p.priority === 'HIGHEST').reduce((s: number, p: any) => s + p.count, 0)} issues</span>
                <span className="text-blue-600 font-semibold">{kpis.totalPoints} total points</span>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 3: CREATION & RESOLUTION VELOCITY TRENDS */}
        {(activeTab === 'ALL' || activeTab === 'TRENDS') && (
          <div className="bg-card border border-border rounded-2xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    Creation vs. Resolution Velocity Trend (Past 14 Days)
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Incoming issue inflow vs. completed resolution rate over time
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5 text-blue-600 font-semibold">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Issues Created
                </span>
                <span className="flex items-center gap-1.5 text-emerald-600 font-semibold">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Issues Completed
                </span>
              </div>
            </div>

            {/* Time Series SVG */}
            <div className="w-full relative">
              <svg viewBox="0 0 600 160" className="w-full h-44 bg-muted/20 rounded-xl border border-border">
                {/* Horizontal grid lines */}
                {[0, 0.33, 0.66, 1].map((ratio, idx) => {
                  const y = 20 + 110 * ratio;
                  const val = Math.round(maxTrendVal * (1 - ratio));
                  return (
                    <g key={idx}>
                      <line x1="40" y1={y} x2="580" y2={y} stroke="currentColor" strokeOpacity="0.1" strokeDasharray="3 3" />
                      <text x="35" y={y + 3} fontSize="9" textAnchor="end" fill="currentColor" opacity="0.4" fontFamily="monospace">
                        {val}
                      </text>
                    </g>
                  );
                })}

                {/* Created Polyline */}
                <polyline
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="2"
                  points={trendsData.map((t: any, idx: number) => {
                    const x = 50 + (idx / Math.max(1, trendsData.length - 1)) * 520;
                    const y = 20 + (1 - t.created / maxTrendVal) * 110;
                    return `${x},${y}`;
                  }).join(' ')}
                />

                {/* Completed Polyline */}
                <polyline
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2"
                  points={trendsData.map((t: any, idx: number) => {
                    const x = 50 + (idx / Math.max(1, trendsData.length - 1)) * 520;
                    const y = 20 + (1 - t.completed / maxTrendVal) * 110;
                    return `${x},${y}`;
                  }).join(' ')}
                />

                {/* Data Points */}
                {trendsData.map((t: any, idx: number) => {
                  const x = 50 + (idx / Math.max(1, trendsData.length - 1)) * 520;
                  const yCreated = 20 + (1 - t.created / maxTrendVal) * 110;
                  const yCompleted = 20 + (1 - t.completed / maxTrendVal) * 110;
                  return (
                    <g key={idx}>
                      <circle
                        cx={x}
                        cy={yCreated}
                        r="4"
                        fill="#3b82f6"
                        stroke="#fff"
                        strokeWidth="1.5"
                        onClick={() => {
                          const dateIssues = activeFilteredIssues.filter((i: any) => i.createdAt && new Date(i.createdAt).toISOString().split('T')[0] === t.date);
                          openDrillDown({
                            title: `Issues Created on ${t.label}`,
                            subtitle: `${t.created} issues created on ${t.date}`,
                            category: 'Creation Trend',
                            metricLabel: `${t.created} issues`,
                            issues: dateIssues,
                          });
                        }}
                        className="cursor-pointer hover:scale-150 transition-transform"
                      />
                      <circle
                        cx={x}
                        cy={yCompleted}
                        r="4"
                        fill="#10b981"
                        stroke="#fff"
                        strokeWidth="1.5"
                        onClick={() => {
                          const dateDoneIssues = activeFilteredIssues.filter((i: any) =>
                            (i.status?.category === 'DONE' || i.status?.name?.toLowerCase().includes('done')) &&
                            i.updatedAt && new Date(i.updatedAt).toISOString().split('T')[0] === t.date
                          );
                          openDrillDown({
                            title: `Issues Completed on ${t.label}`,
                            subtitle: `${t.completed} issues resolved on ${t.date}`,
                            category: 'Completion Trend',
                            metricLabel: `${t.completed} resolved`,
                            issues: dateDoneIssues,
                          });
                        }}
                        className="cursor-pointer hover:scale-150 transition-transform"
                      />
                      <text x={x} y="150" fontSize="8.5" textAnchor="middle" fill="currentColor" opacity="0.6">
                        {t.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        )}

        {/* SECTION 4: TEAM WORKLOAD & THROUGHPUT MATRIX */}
        {(activeTab === 'ALL' || activeTab === 'WORKLOAD') && (
          <div className="bg-card border border-border rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/10 text-primary">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    Team Member Throughput &amp; Allocation Matrix
                  </h3>
                  <p className="text-[11px] text-muted-foreground">Workload balance and completion progress per team member</p>
                </div>
              </div>

              {/* Metric Switcher */}
              <div className="flex items-center bg-muted/60 p-0.5 rounded-lg text-[10px]">
                <button
                  type="button"
                  onClick={() => setBarMetric('PTS')}
                  className={`px-2.5 py-1 rounded-md font-bold cursor-pointer transition-all ${
                    barMetric === 'PTS' ? 'bg-background text-primary shadow-xs' : 'text-muted-foreground'
                  }`}
                >
                  Points
                </button>
                <button
                  type="button"
                  onClick={() => setBarMetric('COUNT')}
                  className={`px-2.5 py-1 rounded-md font-bold cursor-pointer transition-all ${
                    barMetric === 'COUNT' ? 'bg-background text-primary shadow-xs' : 'text-muted-foreground'
                  }`}
                >
                  Tasks
                </button>
                <button
                  type="button"
                  onClick={() => setBarMetric('HOURS')}
                  className={`px-2.5 py-1 rounded-md font-bold cursor-pointer transition-all ${
                    barMetric === 'HOURS' ? 'bg-background text-primary shadow-xs' : 'text-muted-foreground'
                  }`}
                >
                  Hours
                </button>
              </div>
            </div>

            {/* Workload Bars List */}
            <div className="space-y-3 pt-2">
              {memberThroughput.map((m: any) => {
                const total = barMetric === 'PTS' ? m.points : barMetric === 'HOURS' ? m.hours : m.total;
                const completed = barMetric === 'PTS' ? m.completedPoints : m.completed;
                const unit = barMetric === 'PTS' ? 'pts' : barMetric === 'HOURS' ? 'hrs' : 'tasks';
                const compPct = total > 0 ? Math.round((completed / total) * 100) : 0;

                return (
                  <div
                    key={m.userId}
                    onClick={() => {
                      const memberIssues = activeFilteredIssues.filter((i: any) =>
                        m.userId === 'UNASSIGNED' ? !i.assigneeId : i.assigneeId === m.userId
                      );
                      openDrillDown({
                        title: `Member Workload: ${m.name}`,
                        subtitle: `All ${m.total} tasks assigned to ${m.name} (${m.completed} completed, ${m.points} pts)`,
                        category: 'Member Workload',
                        metricLabel: `${completed} / ${total} ${unit} completed`,
                        percentage: compPct,
                        issues: memberIssues,
                      });
                    }}
                    className="space-y-1 p-2 rounded-xl hover:bg-muted/60 transition-colors cursor-pointer group"
                    title={`Click to inspect all ${m.total} issues for ${m.name}`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 font-semibold text-foreground truncate">
                        <div className="w-5 h-5 rounded-full bg-primary/20 text-primary font-bold text-[10px] flex items-center justify-center shrink-0">
                          {m.avatar}
                        </div>
                        <span className="truncate max-w-[200px] group-hover:text-primary transition-colors">{m.name}</span>
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground flex items-center gap-2">
                        <span>
                          <strong className="text-foreground">{completed}</strong> / {total} {unit}
                        </span>
                        <span className="text-emerald-600 font-bold">({compPct}%)</span>
                      </div>
                    </div>
                    <div className="h-3 w-full bg-muted rounded-md overflow-hidden flex relative shadow-inner">
                      <div
                        className="bg-emerald-500 h-full transition-all duration-500"
                        style={{ width: `${(completed / (maxWorkloadVal || 1)) * 100}%` }}
                      />
                      <div
                        className="bg-amber-400 h-full transition-all duration-500"
                        style={{ width: `${((total - completed) / (maxWorkloadVal || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {memberThroughput.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground">No member data in current scope</div>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border text-[10px] text-muted-foreground">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-emerald-500" /> Completed
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-amber-400" /> Remaining
                </span>
              </div>
              <span className="font-mono">Metric: {barMetric}</span>
            </div>
          </div>
        )}

        {/* SECTION 5: ESTIMATION ACCURACY & CYCLE TIME HISTOGRAM */}
        {(activeTab === 'ALL' || activeTab === 'TRENDS') && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Cycle Time Histogram */}
            <div className="bg-card border border-border rounded-2xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-600">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground">
                        Cycle Time Frequency Distribution
                      </h3>
                      <p className="text-[11px] text-muted-foreground">Resolved tasks binned by turnaround speed</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-purple-600 font-bold">
                    Avg: {kpis.avgCycleDays} days
                  </span>
                </div>

                <div className="h-44 w-full flex items-end justify-around pt-6 pb-2 border-b border-l border-border px-2">
                  {cycleBins.map((bin: any, idx: number) => {
                    const heightPct = maxCycleBinCount > 0 ? (bin.count / maxCycleBinCount) * 100 : 0;
                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          openDrillDown({
                            title: `Cycle Time: ${bin.label}`,
                            subtitle: `Tasks resolved within ${bin.label}`,
                            category: 'Cycle Time Histogram',
                            metricLabel: `${bin.count} tasks`,
                            issues: bin.issues,
                          });
                        }}
                        className="flex flex-col items-center gap-1.5 h-full justify-end group cursor-pointer w-14"
                        title={`Click to view all ${bin.count} tasks in ${bin.label}`}
                      >
                        <span className="text-[10px] font-bold text-purple-600 group-hover:scale-110 transition-transform">
                          {bin.count}
                        </span>
                        <div
                          className="w-10 rounded-t bg-purple-500 group-hover:bg-purple-600 transition-all duration-300 relative"
                          style={{ height: `${Math.max(8, heightPct)}%` }}
                        />
                        <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
                          {bin.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 mt-3 border-t border-border text-[11px] text-muted-foreground">
                <span>Total resolved: {kpis.completedIssues} tasks</span>
                <span className="text-purple-600 font-semibold">{kpis.avgCycleDays} days average lead time</span>
              </div>
            </div>

            {/* Estimation Accuracy Scatter Plot */}
            <div className="bg-card border border-border rounded-2xl p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600">
                      <Flame className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground">
                        Estimation Accuracy Correlation
                      </h3>
                      <p className="text-[11px] text-muted-foreground">Story Points (X) vs. Actual Logged Effort (Y)</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-amber-600 font-bold">
                    {kpis.totalHoursSpent}h logged
                  </span>
                </div>

                {/* Coordinate Plane */}
                <div className="relative h-44 w-full border border-border rounded-xl bg-muted/20 p-2 overflow-hidden">
                  <div className="absolute top-2 left-2 text-[9px] font-mono text-muted-foreground">
                    ↑ Hours Logged (Y)
                  </div>
                  <div className="absolute bottom-2 right-2 text-[9px] font-mono text-muted-foreground">
                    Story Points (X) →
                  </div>

                  {/* Reference Ideal Diagonal Line */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                    <line x1="10%" y1="90%" x2="90%" y2="10%" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.4" />
                  </svg>

                  {/* Plotted Scatter Points */}
                  {activeFilteredIssues.slice(0, 30).map((issue: any, idx: number) => {
                    const pts = issue.estimatePoints || 0;
                    const hrs = issue.timeSpentHours || 0;
                    const maxPts = Math.max(...activeFilteredIssues.map((i: any) => i.estimatePoints || 0), 13);
                    const maxHrs = Math.max(...activeFilteredIssues.map((i: any) => i.timeSpentHours || 0), 20);

                    const posX = 10 + (pts / maxPts) * 80;
                    const posY = 90 - (hrs / maxHrs) * 80;
                    const color = getPriorityColor(issue.priority);

                    return (
                      <div
                        key={issue.id || idx}
                        style={{ left: `${posX}%`, top: `${posY}%`, backgroundColor: color }}
                        onClick={() => {
                          if (onSelectIssue) onSelectIssue(issue);
                        }}
                        className="absolute -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-background shadow-md cursor-pointer hover:scale-150 transition-transform z-10"
                        title={`${issue.issueKey}: ${issue.title} (${pts} pts, ${hrs}h logged)`}
                      />
                    );
                  })}
                  {activeFilteredIssues.length === 0 && (
                    <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                      No points/effort data in scope
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 mt-3 border-t border-border text-[11px] text-muted-foreground">
                <span>Plotted: {Math.min(30, activeFilteredIssues.length)} tasks</span>
                <span className="font-mono text-amber-600 font-semibold">Dashed: Ideal estimation ratio</span>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 6: EMBEDDED RAW DATA MATRIX TABLE */}
        {(activeTab === 'ALL' || activeTab === 'MATRIX') && (
          <div className="bg-card border border-border rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  Underlying Project Data Matrix
                </h3>
                <span className="text-xs text-muted-foreground font-medium">
                  ({sortedTableIssues.length} matching records)
                </span>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter table..."
                  value={tableSearch}
                  onChange={(e) => {
                    setTableSearch(e.target.value);
                    setTablePage(1);
                  }}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-background border border-border rounded-xl text-foreground outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            {/* Interactive Data Table */}
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-muted/50 text-[11px] uppercase font-bold text-muted-foreground border-b border-border select-none">
                  <tr>
                    <th
                      onClick={() => {
                        if (tableSortCol === 'key') setTableSortAsc(!tableSortAsc);
                        else { setTableSortCol('key'); setTableSortAsc(true); }
                      }}
                      className="py-3 px-3 cursor-pointer hover:text-foreground"
                    >
                      <div className="flex items-center gap-1">
                        <span>Key</span>
                        <ArrowUpDown className="w-3 h-3 opacity-60" />
                      </div>
                    </th>
                    <th
                      onClick={() => {
                        if (tableSortCol === 'title') setTableSortAsc(!tableSortAsc);
                        else { setTableSortCol('title'); setTableSortAsc(true); }
                      }}
                      className="py-3 px-3 cursor-pointer hover:text-foreground"
                    >
                      <div className="flex items-center gap-1">
                        <span>Title</span>
                        <ArrowUpDown className="w-3 h-3 opacity-60" />
                      </div>
                    </th>
                    <th className="py-3 px-3">Type</th>
                    <th
                      onClick={() => {
                        if (tableSortCol === 'status') setTableSortAsc(!tableSortAsc);
                        else { setTableSortCol('status'); setTableSortAsc(true); }
                      }}
                      className="py-3 px-3 cursor-pointer hover:text-foreground"
                    >
                      <div className="flex items-center gap-1">
                        <span>Status</span>
                        <ArrowUpDown className="w-3 h-3 opacity-60" />
                      </div>
                    </th>
                    <th
                      onClick={() => {
                        if (tableSortCol === 'priority') setTableSortAsc(!tableSortAsc);
                        else { setTableSortCol('priority'); setTableSortAsc(true); }
                      }}
                      className="py-3 px-3 cursor-pointer hover:text-foreground"
                    >
                      <div className="flex items-center gap-1">
                        <span>Priority</span>
                        <ArrowUpDown className="w-3 h-3 opacity-60" />
                      </div>
                    </th>
                    <th className="py-3 px-3">Assignee</th>
                    <th
                      onClick={() => {
                        if (tableSortCol === 'points') setTableSortAsc(!tableSortAsc);
                        else { setTableSortCol('points'); setTableSortAsc(false); }
                      }}
                      className="py-3 px-3 text-right cursor-pointer hover:text-foreground"
                    >
                      <div className="flex items-center justify-end gap-1">
                        <span>Points</span>
                        <ArrowUpDown className="w-3 h-3 opacity-60" />
                      </div>
                    </th>
                    <th
                      onClick={() => {
                        if (tableSortCol === 'dueDate') setTableSortAsc(!tableSortAsc);
                        else { setTableSortCol('dueDate'); setTableSortAsc(true); }
                      }}
                      className="py-3 px-3 cursor-pointer hover:text-foreground"
                    >
                      <div className="flex items-center gap-1">
                        <span>Due Date</span>
                        <ArrowUpDown className="w-3 h-3 opacity-60" />
                      </div>
                    </th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-medium">
                  {paginatedTableIssues.map((issue) => {
                    const priColor = getPriorityColor(issue.priority);
                    const isDone = issue.status?.category === 'DONE' || issue.status?.name?.toLowerCase().includes('done');
                    const isProg = issue.status?.category === 'IN_PROGRESS';

                    return (
                      <tr
                        key={issue.id}
                        onClick={() => onSelectIssue && onSelectIssue(issue)}
                        className="hover:bg-muted/40 transition-colors cursor-pointer group"
                      >
                        <td className="py-2.5 px-3 font-mono font-bold text-primary text-xs">
                          {issue.issueKey}
                        </td>
                        <td className="py-2.5 px-3 font-medium max-w-xs truncate text-foreground group-hover:text-primary transition-colors">
                          {issue.title}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                            {issue.issueType || 'TASK'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              isDone
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                : isProg
                                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                                : 'bg-muted text-muted-foreground border-border'
                            }`}
                          >
                            {issue.status?.name || 'Unknown'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border"
                            style={{
                              backgroundColor: `${priColor}15`,
                              color: priColor,
                              borderColor: `${priColor}30`,
                            }}
                          >
                            {issue.priority}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {issue.assignee ? (
                            <div className="flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded-full bg-primary/20 text-primary font-bold text-[10px] flex items-center justify-center shrink-0">
                                {issue.assignee.firstName?.[0] || 'U'}
                              </div>
                              <span className="truncate max-w-[120px] text-foreground text-xs">
                                {issue.assignee.firstName} {issue.assignee.lastName}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic text-[11px]">Unassigned</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-foreground">
                          {issue.estimatePoints ? `${issue.estimatePoints} pts` : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground font-mono text-[11px]">
                          {issue.dueDate ? new Date(issue.dueDate).toLocaleDateString() : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onSelectIssue) onSelectIssue(issue);
                            }}
                            className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                            title="Open issue detail"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {sortedTableIssues.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-xs text-muted-foreground">
                        No issues match the search and filter criteria
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Enterprise Multi-Page Pagination Controls */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-border text-xs text-muted-foreground">
              {/* Range & Total records indicator */}
              <div className="font-mono">
                Showing{' '}
                <strong className="text-foreground">
                  {sortedTableIssues.length > 0
                    ? tablePageSize === 'ALL'
                      ? 1
                      : (tablePage - 1) * tablePageSize + 1
                    : 0}
                  –
                  {tablePageSize === 'ALL'
                    ? sortedTableIssues.length
                    : Math.min(tablePage * tablePageSize, sortedTableIssues.length)}
                </strong>{' '}
                of <strong className="text-foreground">{sortedTableIssues.length}</strong> records{' '}
                {tablePageSize !== 'ALL' && `(Page ${tablePage} of ${totalTablePages})`}
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {/* Page Size Selector (25, 50, 100, 150, 250, 500, All) */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>Rows per page:</span>
                  <select
                    value={tablePageSize}
                    onChange={(e) => {
                      const val = e.target.value === 'ALL' ? 'ALL' : Number(e.target.value);
                      setTablePageSize(val as any);
                      setTablePage(1);
                    }}
                    className="px-2 py-1 text-xs font-bold rounded-lg border border-border bg-background text-foreground cursor-pointer focus:ring-1 focus:ring-primary outline-hidden shadow-2xs"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={150}>150</option>
                    <option value={250}>250</option>
                    <option value={500}>500</option>
                    <option value="ALL">All ({sortedTableIssues.length})</option>
                  </select>
                </div>

                {/* Multi-Page Navigation Buttons */}
                {tablePageSize !== 'ALL' && totalTablePages > 1 && (
                  <div className="flex items-center gap-1">
                    {/* First Page */}
                    <button
                      onClick={() => setTablePage(1)}
                      disabled={tablePage === 1}
                      className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-30 disabled:pointer-events-none text-foreground transition cursor-pointer"
                      title="First Page"
                    >
                      <ChevronsLeft className="w-3.5 h-3.5" />
                    </button>

                    {/* Previous Page */}
                    <button
                      onClick={() => setTablePage((p: number) => Math.max(1, p - 1))}
                      disabled={tablePage === 1}
                      className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-30 disabled:pointer-events-none text-foreground transition cursor-pointer"
                      title="Previous Page"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>

                    {/* Smart Page Number Indicators */}
                    {Array.from({ length: Math.min(5, totalTablePages) }, (_, i) => {
                      let pageNum = i + 1;
                      if (totalTablePages > 5) {
                        if (tablePage > 3 && tablePage < totalTablePages - 1) {
                          pageNum = tablePage - 2 + i;
                        } else if (tablePage >= totalTablePages - 1) {
                          pageNum = totalTablePages - 4 + i;
                        }
                      }
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setTablePage(pageNum)}
                          className={`w-7 h-7 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center ${
                            tablePage === pageNum
                              ? 'bg-primary text-primary-foreground shadow-2xs'
                              : 'border border-border bg-card hover:bg-muted text-foreground'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}

                    {/* Next Page */}
                    <button
                      onClick={() => setTablePage((p: number) => Math.min(totalTablePages, p + 1))}
                      disabled={tablePage === totalTablePages}
                      className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-30 disabled:pointer-events-none text-foreground transition cursor-pointer"
                      title="Next Page"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>

                    {/* Last Page */}
                    <button
                      onClick={() => setTablePage(totalTablePages)}
                      disabled={tablePage === totalTablePages}
                      className="p-1.5 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-30 disabled:pointer-events-none text-foreground transition cursor-pointer"
                      title="Last Page"
                    >
                      <ChevronsRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      
      {/* ============================================================ */}
      {/* 8-Category Standardized Report Download & Live View Center  */}
      {/* ============================================================ */}
      {(activeTab === 'ALL' || activeTab === 'REPORTS') && (
        <div className="bg-card border border-border rounded-2xl p-5 shadow-xs space-y-5">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-border pb-4">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <h2 className="text-base font-bold text-foreground whitespace-nowrap">
                  Project Reports &amp; Download Center
                </h2>
                <span className="inline-flex items-center text-[10px] uppercase font-extrabold tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 whitespace-nowrap shrink-0">
                  10 Canonical Reports • Zero Duplication
                </span>
                {selectedProjectId !== 'ALL' && (
                  <span className="inline-flex items-center text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 whitespace-nowrap shrink-0">
                    Scoped: {effectiveProjectName}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                10 specialized domain reports with instant live preview, printable PDF reports, Microsoft Excel workbooks, and CSV downloads directly from real database records.
              </p>
            </div>

            {/* Project Selector, Category Filter & Search Toolbar */}
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              {/* Report Comparison Guide Button */}
              <button
                onClick={() => setIsGuideOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30 transition shadow-2xs cursor-pointer h-9 shrink-0"
                title="View difference matrix between all 10 reports"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>What is the difference?</span>
              </button>

              {/* Project Wise View Selector */}
              {projects.length > 0 && (
                <div className="flex items-center gap-1.5 bg-background border border-border rounded-xl px-2.5 py-1.5 shadow-2xs h-9">
                  <FolderGit2 className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap">Project:</span>
                  <select
                    value={selectedProjectId}
                    onChange={(e) => {
                      const newId = e.target.value;
                      setSelectedProjectId(newId);
                      if (newId !== 'ALL' && onSelectProject) {
                        onSelectProject(newId);
                      }
                    }}
                    className="bg-transparent border-none text-xs font-bold text-foreground outline-none cursor-pointer pr-1 max-w-[150px] truncate"
                    aria-label="Select Project for Reports"
                  >
                    <option value="ALL">🌐 All Projects ({projects.length})</option>
                    {projects.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.key ? `(${p.key})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Category Filter */}
              <select
                value={selectedReportCat}
                onChange={(e) => setSelectedReportCat(e.target.value)}
                className="bg-background border border-border rounded-xl px-3 py-1.5 text-xs font-semibold text-foreground outline-none cursor-pointer shadow-2xs h-9"
                aria-label="Filter by report category"
              >
                <option value="ALL">All Categories</option>
                {REPORT_CATALOG.map((c) => (
                  <option key={c.category} value={c.category}>
                    {c.category}
                  </option>
                ))}
              </select>

              {/* Search Canonical Reports */}
              <div className="relative w-56">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={reportSearch}
                  onChange={(e) => setReportSearch(e.target.value)}
                  placeholder="Search canonical reports..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-background border border-border rounded-xl text-foreground focus:ring-2 focus:ring-primary focus:outline-hidden shadow-2xs h-9"
                />
              </div>
            </div>
          </div>

          {/* Report Category Grids */}
          <div className="space-y-6">
            {REPORT_CATALOG
              .filter((cat) => selectedReportCat === 'ALL' || cat.category === selectedReportCat)
              .map((cat) => {
                const filteredReports = cat.reports.filter(
                  (r) =>
                    !reportSearch.trim() ||
                    r.name.toLowerCase().includes(reportSearch.toLowerCase()) ||
                    r.desc.toLowerCase().includes(reportSearch.toLowerCase())
                );

                if (filteredReports.length === 0) return null;

                const CatIcon = cat.icon || FileText;

                return (
                  <div key={cat.category} className="space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground tracking-wide uppercase">
                      <CatIcon className="w-4 h-4 text-primary" />
                      <span>{cat.category}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-muted text-foreground">
                        {filteredReports.length}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {filteredReports.map((r) => {
                        return (
                          <div
                            key={r.id}
                            className="bg-card border border-border hover:border-primary/50 dark:hover:border-primary/40 rounded-2xl p-5 flex flex-col justify-between hover:shadow-md transition-all duration-200 group relative overflow-hidden"
                          >
                            <div className="space-y-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                                    <CatIcon className="w-4 h-4" />
                                  </div>
                                  <h4 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors leading-snug truncate">
                                    {r.name}
                                  </h4>
                                </div>
                                <span className="px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
                                  {cat.category}
                                </span>
                              </div>

                              <p className="text-xs text-muted-foreground leading-relaxed">
                                {r.desc}
                              </p>

                              {/* Business Question Hook */}
                              {(r as any).question && (
                                <div className="px-3 py-2 rounded-xl bg-muted/50 border border-border/60 text-[11px] text-muted-foreground flex items-center gap-2">
                                  <HelpCircle className="w-3.5 h-3.5 text-primary shrink-0" />
                                  <span className="italic font-medium text-foreground/90 leading-tight">"{(r as any).question}"</span>
                                </div>
                              )}

                              {/* Tags & Key Metrics */}
                              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                {(r as any).tags?.map((tag: string) => (
                                  <span
                                    key={tag}
                                    className="px-2 py-0.5 text-[10px] font-semibold rounded-md bg-muted text-muted-foreground border border-border/50"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                Live Database • Decision Support
                              </span>

                              <button
                                type="button"
                                onClick={() =>
                                  setReportModal({
                                    isOpen: true,
                                    reportType: r.id,
                                    reportTitle: r.name,
                                    category: cat.category,
                                  })
                                }
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-2xs hover:shadow-xs active:scale-98 cursor-pointer shrink-0"
                                title="Open Full Enterprise Decision Support Report"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>View & Analyze Report</span>
                                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}


      {/* Underlying Data Drill-Down Modal */}
      <AnalyticsDrillDownModal
        isOpen={drillDownModal.isOpen}
        onClose={() => setDrillDownModal((prev) => ({ ...prev, isOpen: false }))}
        title={drillDownModal.title}
        subtitle={drillDownModal.subtitle}
        category={drillDownModal.category}
        metricLabel={drillDownModal.metricLabel}
        percentage={drillDownModal.percentage}
        projectName={effectiveProjectName}
        issues={drillDownModal.issues}
        onSelectIssue={(issue) => {
          if (onSelectIssue) onSelectIssue(issue);
        }}
      />
    
      {/* Standardized Live Report View Modal */}
      <ReportViewModal
        isOpen={reportModal.isOpen}
        onClose={() => setReportModal((prev) => ({ ...prev, isOpen: false }))}
        reportType={reportModal.reportType}
        reportTitle={reportModal.reportTitle}
        category={reportModal.category}
        issues={activeFilteredIssues}
        projectId={effectiveProjectId}
        projectName={effectiveProjectName}
        sprintId={sprintFilter !== 'ALL' ? sprintFilter : undefined}
        teamId={teamFilter !== 'ALL' ? teamFilter : undefined}
        assigneeId={assigneeFilter !== 'ALL' ? assigneeFilter : undefined}
        statusId={statusFilter !== 'ALL' ? statusFilter : undefined}
        priority={priorityFilter !== 'ALL' ? priorityFilter : undefined}
        issueType={typeFilter !== 'ALL' ? typeFilter : undefined}
        epicId={epicFilter !== 'ALL' ? epicFilter : undefined}
        timeRange={timeRange !== 'ALL' ? timeRange : undefined}
        search={searchQuery.trim() ? searchQuery.trim() : undefined}
        onSelectIssue={(issue) => {
          if (onSelectIssue) onSelectIssue(issue);
        }}
      />

      {/* Report Difference & Comparison Guide Modal */}
      <ReportDifferenceGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        onSelectReport={(selectedId, selectedTitle) => {
          setIsGuideOpen(false);
          const allReports = REPORT_CATALOG.flatMap((c) => c.reports);
          const found = allReports.find((r) => r.id === selectedId);
          if (found) {
            setReportModal({
              isOpen: true,
              reportType: found.id,
              reportTitle: found.name,
              category: '',
            });
          }
        }}
      />
    </div>
  );
}
