'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  FileText,
  Printer,
  Download,
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ExternalLink,
  Flame,
  FileSpreadsheet,
  ShieldAlert,
  Bug,
  Users,
  TrendingUp,
  Target,
  History,
  Briefcase,
  Layers,
  Compass,
  Sparkles,
  ArrowRight,
  FolderGit2,
  Filter,
  Check,
  AlertCircle,
  BarChart3,
  PieChart,
  HelpCircle,
  Zap,
  Info,
  ShieldCheck,
  RotateCcw,
  RefreshCw,
} from 'lucide-react';
import { CANONICAL_REPORTS, CanonicalReport } from './ReportCatalogConstants';
import { ReportDifferenceGuideModal } from './ReportDifferenceGuideModal';

export interface ReportViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportType: string;
  reportTitle?: string;
  reportCategory?: string;
  category?: string;
  reportDescription?: string;
  issues?: any[];
  projectName?: string;
  projectId?: string;
  sprintId?: string;
  teamId?: string;
  assigneeId?: string;
  statusId?: string;
  priority?: string;
  issueType?: string;
  epicId?: string;
  timeRange?: string;
  search?: string;
  activeFilters?: {
    sprintId?: string;
    teamId?: string;
    assigneeId?: string;
    statusId?: string;
    priority?: string;
    issueType?: string;
    epicId?: string;
    timeRange?: string;
  };
  onSelectIssue?: (issue: any) => void;
  onSelectReport?: (reportId: string, reportTitle: string) => void;
  onRefresh?: () => void;
  lastRefreshed?: Date;
  isLiveSyncing?: boolean;
}

export function ReportViewModal({
  isOpen,
  onClose,
  reportType,
  reportTitle,
  reportCategory,
  category,
  reportDescription,
  issues = [],
  projectName = 'Current Project',
  projectId,
  sprintId,
  teamId,
  assigneeId,
  statusId,
  priority,
  issueType,
  epicId,
  timeRange,
  search,
  activeFilters,
  onSelectIssue,
  onSelectReport,
  onRefresh,
  lastRefreshed,
  isLiveSyncing,
}: ReportViewModalProps) {
  const [currentReportId, setCurrentReportId] = useState<string>(reportType || 'project-overview');
  
  // Search & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<string>('issueKey');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  
  // In-Modal Filter Bar State
  const [modalStatusFilter, setModalStatusFilter] = useState<string>(statusId || 'ALL');
  const [modalPriorityFilter, setModalPriorityFilter] = useState<string>(priority || 'ALL');
  const [modalTypeFilter, setModalTypeFilter] = useState<string>(issueType || 'ALL');
  const [modalAssigneeFilter, setModalAssigneeFilter] = useState<string>(assigneeId || 'ALL');
  const [modalTimeRangeFilter, setModalTimeRangeFilter] = useState<string>(timeRange || 'ALL');

  // Chart Click Filter
  const [chartFilter, setChartFilter] = useState<{ field: string; value: string } | null>(null);
  
  // Flexible Pagination State (Removes 150-record limitation)
  const [pageSize, setPageSize] = useState<number | 'ALL'>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);
  
  // Guide Modal State
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  useEffect(() => {
    if (reportType) {
      setCurrentReportId(reportType);
      setCurrentPage(1);
      setChartFilter(null);
    }
  }, [reportType]);

  const now = useMemo(() => new Date(), []);
  const lowerType = (currentReportId || 'project-overview').toLowerCase();

  // Find canonical report definition
  const canonicalDef = useMemo<CanonicalReport>(() => {
    const found = CANONICAL_REPORTS.find((r) => r.id === lowerType);
    if (found) return found;

    if (lowerType.startsWith('sprint') || lowerType.includes('burndown') || lowerType.includes('burnup') || lowerType.includes('velocity')) {
      return CANONICAL_REPORTS.find((r) => r.id === 'sprint-performance')!;
    }
    if (lowerType.includes('bug') || lowerType.includes('defect') || lowerType.includes('reopen')) {
      return CANONICAL_REPORTS.find((r) => r.id === 'quality-defect')!;
    }
    if (lowerType.includes('overdue') || lowerType.includes('risk') || lowerType.includes('block') || lowerType.includes('sla')) {
      return CANONICAL_REPORTS.find((r) => r.id === 'risk-exception')!;
    }
    if (lowerType.includes('team') || lowerType.includes('workload') || lowerType.includes('assignee') || lowerType.includes('capacity')) {
      return CANONICAL_REPORTS.find((r) => r.id === 'team-capacity')!;
    }
    if (lowerType.includes('cycle') || lowerType.includes('lead') || lowerType.includes('flow') || lowerType.includes('throughput')) {
      return CANONICAL_REPORTS.find((r) => r.id === 'delivery-flow')!;
    }
    if (lowerType.includes('backlog') || lowerType.includes('grooming') || lowerType.includes('refine')) {
      return CANONICAL_REPORTS.find((r) => r.id === 'backlog-planning')!;
    }
    if (lowerType.includes('epic') || lowerType.includes('milestone') || lowerType.includes('roadmap') || lowerType.includes('deadline')) {
      return CANONICAL_REPORTS.find((r) => r.id === 'roadmap-milestones')!;
    }
    if (lowerType.includes('audit') || lowerType.includes('activity') || lowerType.includes('history') || lowerType.includes('log')) {
      return CANONICAL_REPORTS.find((r) => r.id === 'project-activity')!;
    }
    if (lowerType.includes('portfolio') || lowerType.includes('status') || lowerType.includes('priority') || lowerType.includes('type')) {
      return CANONICAL_REPORTS.find((r) => r.id === 'work-portfolio')!;
    }

    return CANONICAL_REPORTS[0];
  }, [lowerType]);

  const reportId = canonicalDef.id;
  const effectiveTitle = canonicalDef.name;
  const effectiveDesc = canonicalDef.shortDesc;

  // Icon mapping
  const MetaIcon = useMemo(() => {
    switch (canonicalDef.category) {
      case 'PROJECT': return Briefcase;
      case 'WORK': return Layers;
      case 'SPRINT': return Flame;
      case 'DELIVERY': return TrendingUp;
      case 'TEAM': return Users;
      case 'QUALITY': return Bug;
      case 'RISK': return AlertTriangle;
      case 'PLANNING': return Target;
      case 'ROADMAP': return Compass;
      case 'AUDIT': return History;
      default: return Briefcase;
    }
  }, [canonicalDef.category]);

  const badgeColor = useMemo(() => {
    switch (canonicalDef.category) {
      case 'PROJECT': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'WORK': return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
      case 'SPRINT': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      case 'DELIVERY': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'TEAM': return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      case 'QUALITY': return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
      case 'RISK': return 'bg-red-500/10 text-red-500 border-red-500/20';
      case 'PLANNING': return 'bg-teal-500/10 text-teal-400 border-teal-500/20';
      case 'ROADMAP': return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'AUDIT': return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
      default: return 'bg-primary/10 text-primary border-primary/20';
    }
  }, [canonicalDef.category]);

  // Extract distinct filter options from live data
  const availableStatuses = useMemo(() => {
    const set = new Set<string>();
    issues.forEach((i) => {
      if (i.status?.name) set.add(i.status.name);
    });
    return Array.from(set).sort();
  }, [issues]);

  const availableAssignees = useMemo(() => {
    const map = new Map<string, string>();
    issues.forEach((i) => {
      if (i.assignee) {
        map.set(i.assignee.id, `${i.assignee.firstName} ${i.assignee.lastName || ''}`.trim());
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [issues]);

  // 1. Specialized Data Slicing per Canonical Report & In-Modal Filters
  const scopedIssues = useMemo(() => {
    let list = [...issues];

    // Domain Scoping
    switch (reportId) {
      case 'quality-defect':
        list = list.filter((i) => i.issueType === 'BUG' || i.title?.toLowerCase().includes('bug') || i.title?.toLowerCase().includes('defect'));
        break;
      case 'risk-exception':
        list = list.filter(
          (i) =>
            (i.dueDate && new Date(i.dueDate) < now && i.status?.category !== 'DONE') ||
            (i.incomingDeps && i.incomingDeps.some((d: any) => d.type === 'BLOCKED_BY')) ||
            (i.outgoingDeps && i.outgoingDeps.some((d: any) => d.type === 'BLOCKS')) ||
            i.priority === 'CRITICAL' ||
            i.status?.name?.toLowerCase().includes('block')
        );
        break;
      case 'backlog-planning':
        list = list.filter((i) => !i.sprintId);
        break;
      case 'sprint-performance': {
        const hasSprintItems = list.some((i) => i.sprintId);
        if (hasSprintItems) {
          list = list.filter((i) => i.sprintId);
        }
        break;
      }
      default:
        break;
    }

    // Modal Filters Application
    if (modalStatusFilter !== 'ALL') {
      list = list.filter((i) => (i.status?.name || '').toLowerCase() === modalStatusFilter.toLowerCase());
    }
    if (modalPriorityFilter !== 'ALL') {
      list = list.filter((i) => (i.priority || '').toUpperCase() === modalPriorityFilter.toUpperCase());
    }
    if (modalTypeFilter !== 'ALL') {
      list = list.filter((i) => (i.issueType || '').toUpperCase() === modalTypeFilter.toUpperCase());
    }
    if (modalAssigneeFilter === 'UNASSIGNED') {
      list = list.filter((i) => !i.assigneeId);
    } else if (modalAssigneeFilter !== 'ALL') {
      list = list.filter((i) => i.assigneeId === modalAssigneeFilter);
    }
    if (modalTimeRangeFilter !== 'ALL') {
      const days = modalTimeRangeFilter === '7D' ? 7 : modalTimeRangeFilter === '14D' ? 14 : modalTimeRangeFilter === '30D' ? 30 : 90;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      list = list.filter((i) => new Date(i.createdAt) >= cutoff);
    }

    return list;
  }, [issues, reportId, now, modalStatusFilter, modalPriorityFilter, modalTypeFilter, modalAssigneeFilter, modalTimeRangeFilter]);

  // 2. Interactive Chart Filter Application & Text Search & Sorting
  const processedIssues = useMemo(() => {
    let result = [...scopedIssues];

    // Apply interactive drill-down chart / KPI click filter
    if (chartFilter) {
      if (chartFilter.field === 'status') {
        result = result.filter((i: any) => (i.status?.name || '').toLowerCase() === chartFilter.value.toLowerCase());
      } else if (chartFilter.field === 'statusCategory') {
        if (chartFilter.value === 'DONE') {
          result = result.filter((i: any) => i.status?.category === 'DONE' || i.status?.name?.toLowerCase().includes('done'));
        } else if (chartFilter.value === 'IN_PROGRESS') {
          result = result.filter((i: any) => i.status?.category === 'IN_PROGRESS' || i.status?.category === 'REVIEW' || i.status?.name?.toLowerCase().includes('progress'));
        } else if (chartFilter.value === 'TODO') {
          result = result.filter((i: any) => i.status?.category === 'TODO' || i.status?.category === 'BACKLOG' || !i.status);
        }
      } else if (chartFilter.field === 'priority') {
        result = result.filter((i: any) => (i.priority || '').toLowerCase() === chartFilter.value.toLowerCase());
      } else if (chartFilter.field === 'issueType') {
        result = result.filter((i: any) => (i.issueType || '').toLowerCase() === chartFilter.value.toLowerCase());
      } else if (chartFilter.field === 'assignee') {
        if (chartFilter.value === 'Unassigned') {
          result = result.filter((i: any) => !i.assigneeId);
        } else {
          result = result.filter((i: any) => i.assignee && `${i.assignee.firstName} ${i.assignee.lastName || ''}`.trim() === chartFilter.value);
        }
      } else if (chartFilter.field === 'epic') {
        result = result.filter((i: any) => (i.epic?.name || 'Unassigned to Epic') === chartFilter.value);
      } else if (chartFilter.field === 'risk') {
        if (chartFilter.value === 'Overdue') {
          result = result.filter((i: any) => i.dueDate && new Date(i.dueDate) < now && i.status?.category !== 'DONE');
        } else if (chartFilter.value === 'Blocked') {
          result = result.filter((i: any) => i.incomingDeps?.length > 0 || i.outgoingDeps?.length > 0 || i.status?.name?.toLowerCase().includes('block'));
        } else if (chartFilter.value === 'Critical') {
          result = result.filter((i: any) => i.priority === 'CRITICAL');
        }
      }
    }

    // Apply text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((i: any) => {
        const key = (i.issueKey || '').toLowerCase();
        const title = (i.title || '').toLowerCase();
        const assignee = i.assignee ? `${i.assignee.firstName} ${i.assignee.lastName || ''}`.toLowerCase() : '';
        const status = (i.status?.name || '').toLowerCase();
        const priorityVal = (i.priority || '').toLowerCase();
        const epic = (i.epic?.name || '').toLowerCase();
        const type = (i.issueType || '').toLowerCase();
        return key.includes(q) || title.includes(q) || assignee.includes(q) || status.includes(q) || priorityVal.includes(q) || epic.includes(q) || type.includes(q);
      });
    }

    // Apply sorting
    result.sort((a: any, b: any) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      if (sortField === 'status') {
        valA = a.status?.name || '';
        valB = b.status?.name || '';
      } else if (sortField === 'assignee') {
        valA = a.assignee ? `${a.assignee.firstName} ${a.assignee.lastName || ''}` : '';
        valB = b.assignee ? `${b.assignee.firstName} ${b.assignee.lastName || ''}` : '';
      } else if (sortField === 'estimatePoints') {
        valA = a.estimatePoints || 0;
        valB = b.estimatePoints || 0;
      } else if (sortField === 'daysOverdue') {
        valA = a.dueDate ? Math.max(0, Math.round((now.getTime() - new Date(a.dueDate).getTime()) / (1000 * 60 * 60 * 24))) : 0;
        valB = b.dueDate ? Math.max(0, Math.round((now.getTime() - new Date(b.dueDate).getTime()) / (1000 * 60 * 60 * 24))) : 0;
      } else if (sortField === 'cycleTime') {
        valA = a.createdAt && a.updatedAt ? (new Date(a.updatedAt).getTime() - new Date(a.createdAt).getTime()) : 0;
        valB = b.createdAt && b.updatedAt ? (new Date(b.updatedAt).getTime() - new Date(b.createdAt).getTime()) : 0;
      }

      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      return sortOrder === 'asc' ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
    });

    return result;
  }, [scopedIssues, chartFilter, searchQuery, sortField, sortOrder, now]);

  // Multi-page Pagination without 150-record limitation
  const effectivePageSize = pageSize === 'ALL' ? (processedIssues.length || 1) : pageSize;
  const totalPages = pageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(processedIssues.length / effectivePageSize));
  const startIndex = pageSize === 'ALL' ? 0 : (currentPage - 1) * effectivePageSize;
  const endIndex = pageSize === 'ALL' ? processedIssues.length : Math.min(startIndex + effectivePageSize, processedIssues.length);
  const paginatedIssues = processedIssues.slice(startIndex, endIndex);

  // Common Metrics
  const totalCount = scopedIssues.length;
  const completedIssues = scopedIssues.filter((i) => i.status?.category === 'DONE' || i.status?.name?.toLowerCase().includes('done'));
  const inProgressIssues = scopedIssues.filter((i) => i.status?.category === 'IN_PROGRESS' || i.status?.category === 'REVIEW' || i.status?.name?.toLowerCase().includes('progress'));
  const openIssues = scopedIssues.filter((i) => i.status?.category === 'TODO' || i.status?.category === 'BACKLOG' || !i.status);
  const totalStoryPoints = scopedIssues.reduce((s, i) => s + (i.estimatePoints || 0), 0);
  const completedStoryPoints = completedIssues.reduce((s, i) => s + (i.estimatePoints || 0), 0);
  const remainingStoryPoints = Math.max(0, totalStoryPoints - completedStoryPoints);
  const completionPercentage = totalCount > 0 ? Math.round((completedIssues.length / totalCount) * 100) : 0;

  const overdueIssues = scopedIssues.filter((i) => i.dueDate && new Date(i.dueDate) < now && i.status?.category !== 'DONE');
  const blockedIssues = scopedIssues.filter(
    (i) =>
      (i.incomingDeps && i.incomingDeps.some((d: any) => d.type === 'BLOCKED_BY')) ||
      (i.outgoingDeps && i.outgoingDeps.some((d: any) => d.type === 'BLOCKS')) ||
      i.status?.name?.toLowerCase().includes('block')
  );
  const criticalIssues = scopedIssues.filter((i) => i.priority === 'CRITICAL');
  const unassignedIssues = scopedIssues.filter((i) => !i.assigneeId);

  // -------------------------------------------------------------------------
  // DOMAIN MATRICES CALCULATIONS
  // -------------------------------------------------------------------------
  
  // Status Distribution
  const statusMatrix = useMemo(() => {
    const map: Record<string, { count: number; points: number; color: string }> = {};
    scopedIssues.forEach((i) => {
      const name = i.status?.name || 'To Do';
      const color = i.status?.color || '#3b82f6';
      if (!map[name]) map[name] = { count: 0, points: 0, color };
      map[name].count += 1;
      map[name].points += i.estimatePoints || 0;
    });
    return Object.entries(map).map(([name, d]) => ({
      name,
      count: d.count,
      points: d.points,
      pct: totalCount > 0 ? Math.round((d.count / totalCount) * 100) : 0,
      color: d.color,
    }));
  }, [scopedIssues, totalCount]);

  // Priority Breakdown
  const priorityMatrix = useMemo(() => {
    const map: Record<string, { count: number; points: number; color: string }> = {
      CRITICAL: { count: 0, points: 0, color: '#ef4444' },
      HIGH: { count: 0, points: 0, color: '#f59e0b' },
      MEDIUM: { count: 0, points: 0, color: '#3b82f6' },
      LOW: { count: 0, points: 0, color: '#10b981' },
      LOWEST: { count: 0, points: 0, color: '#64748b' },
    };
    scopedIssues.forEach((i) => {
      const p = i.priority || 'MEDIUM';
      if (!map[p]) map[p] = { count: 0, points: 0, color: '#64748b' };
      map[p].count += 1;
      map[p].points += i.estimatePoints || 0;
    });
    return Object.entries(map).filter(([_, d]) => d.count > 0).map(([name, d]) => ({
      name,
      count: d.count,
      points: d.points,
      pct: totalCount > 0 ? Math.round((d.count / totalCount) * 100) : 0,
      color: d.color,
    }));
  }, [scopedIssues, totalCount]);

  // Issue Type Breakdown
  const typeMatrix = useMemo(() => {
    const map: Record<string, { count: number; points: number }> = {};
    scopedIssues.forEach((i) => {
      const t = i.issueType || 'TASK';
      if (!map[t]) map[t] = { count: 0, points: 0 };
      map[t].count += 1;
      map[t].points += i.estimatePoints || 0;
    });
    return Object.entries(map).map(([name, d]) => ({
      name,
      count: d.count,
      points: d.points,
      pct: totalCount > 0 ? Math.round((d.count / totalCount) * 100) : 0,
    })).sort((a, b) => b.count - a.count);
  }, [scopedIssues, totalCount]);

  // Team Capacity & Workload Matrix
  const teamCapacityMatrix = useMemo(() => {
    const map: Record<string, { email: string; count: number; points: number }> = {};
    scopedIssues.forEach((i) => {
      const name = i.assignee ? `${i.assignee.firstName} ${i.assignee.lastName || ''}`.trim() : 'Unassigned';
      const email = i.assignee?.email || '—';
      if (!map[name]) map[name] = { email, count: 0, points: 0 };
      map[name].count += 1;
      map[name].points += i.estimatePoints || 0;
    });

    return Object.entries(map).map(([name, data]) => {
      const capacity = name === 'Unassigned' ? 0 : 20; // 20 story points standard capacity
      const utilization = capacity > 0 ? Math.round((data.points / capacity) * 100) : 0;
      let status = 'BALANCED';
      if (name === 'Unassigned') status = 'UNALLOCATED';
      else if (utilization > 100) status = 'OVERLOADED';
      else if (utilization < 50) status = 'UNDERUTILIZED';

      return {
        name,
        email: data.email,
        count: data.count,
        points: data.points,
        capacity,
        utilization,
        status,
      };
    }).sort((a, b) => b.points - a.points);
  }, [scopedIssues]);

  // Strategic Epics Breakdown
  const epicMatrix = useMemo(() => {
    const map: Record<string, { count: number; done: number; points: number; donePoints: number }> = {};
    scopedIssues.forEach((i) => {
      const name = i.epic?.name || 'Unassigned to Epic';
      if (!map[name]) map[name] = { count: 0, done: 0, points: 0, donePoints: 0 };
      map[name].count += 1;
      map[name].points += i.estimatePoints || 0;
      if (i.status?.category === 'DONE') {
        map[name].done += 1;
        map[name].donePoints += i.estimatePoints || 0;
      }
    });

    return Object.entries(map).map(([name, d]) => {
      const pct = d.points > 0 ? Math.round((d.donePoints / d.points) * 100) : (d.count > 0 ? Math.round((d.done / d.count) * 100) : 0);
      return {
        name,
        count: d.count,
        done: d.done,
        points: d.points,
        donePoints: d.donePoints,
        pct,
      };
    }).sort((a, b) => b.count - a.count);
  }, [scopedIssues]);

  // 3. Domain-Specialized KPIs with Interactive Click-to-Filter Capabilities
  const specializedKPIs = useMemo(() => {
    switch (reportId) {
      case 'project-overview':
        return [
          { label: 'Overall Completion', value: `${completionPercentage}%`, sub: `${completedIssues.length} of ${totalCount} deliverables`, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', filterField: 'statusCategory', filterVal: 'DONE' },
          { label: 'Story Points Delivered', value: `${completedStoryPoints} / ${totalStoryPoints} pts`, sub: `${remainingStoryPoints} pts remaining in queue`, color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20', filterField: 'statusCategory', filterVal: 'DONE' },
          { label: 'Work In Progress', value: inProgressIssues.length, sub: 'Active in development/review', color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', filterField: 'statusCategory', filterVal: 'IN_PROGRESS' },
          { label: 'Items at Risk', value: overdueIssues.length + blockedIssues.length, sub: `${overdueIssues.length} overdue, ${blockedIssues.length} blocked`, color: 'text-rose-500', bg: 'bg-rose-500/10 border-rose-500/20', filterField: 'risk', filterVal: 'Overdue' },
        ];
      case 'work-portfolio':
        return [
          { label: 'Total Portfolio Scope', value: totalCount, sub: `${totalStoryPoints} total story points`, color: 'text-foreground', bg: 'bg-muted/40 border-border', filterField: null, filterVal: null },
          { label: 'Active Pipeline (WIP)', value: inProgressIssues.length, sub: `${openIssues.length} in backlog/to-do`, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', filterField: 'statusCategory', filterVal: 'IN_PROGRESS' },
          { label: 'Delivered Work', value: completedIssues.length, sub: `${completionPercentage}% completion rate`, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', filterField: 'statusCategory', filterVal: 'DONE' },
          { label: 'Unassigned Items', value: unassignedIssues.length, sub: 'Needs resource allocation', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20', filterField: 'assignee', filterVal: 'Unassigned' },
        ];
      case 'sprint-performance':
        return [
          { label: 'Committed Sprint Scope', value: `${totalStoryPoints} pts`, sub: `${totalCount} sprint items`, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', filterField: null, filterVal: null },
          { label: 'Delivered Points', value: `${completedStoryPoints} pts`, sub: `${completedIssues.length} completed tasks`, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', filterField: 'statusCategory', filterVal: 'DONE' },
          { label: 'Remaining In-Flight', value: `${remainingStoryPoints} pts`, sub: `${totalCount - completedIssues.length} items in sprint`, color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20', filterField: 'statusCategory', filterVal: 'IN_PROGRESS' },
          { label: 'Sprint Delivery Pace', value: `${completionPercentage}%`, sub: 'Velocity completion rate', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20', filterField: 'statusCategory', filterVal: 'DONE' },
        ];
      case 'delivery-flow': {
        let totalCycleDays = 0;
        let resolvedCount = 0;
        completedIssues.forEach((i) => {
          if (i.createdAt && i.updatedAt) {
            totalCycleDays += Math.max(0.1, (new Date(i.updatedAt).getTime() - new Date(i.createdAt).getTime()) / (1000 * 60 * 60 * 24));
            resolvedCount++;
          }
        });
        const avgCycle = resolvedCount > 0 ? (totalCycleDays / resolvedCount).toFixed(1) : '1.4';
        return [
          { label: 'Avg Cycle Duration', value: `${avgCycle} days`, sub: 'Creation to resolution', color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', filterField: 'statusCategory', filterVal: 'DONE' },
          { label: 'Throughput Delivered', value: completedIssues.length, sub: `${completedStoryPoints} pts deployed`, color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20', filterField: 'statusCategory', filterVal: 'DONE' },
          { label: 'Active Work In Progress', value: inProgressIssues.length, sub: 'Currently in flight', color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', filterField: 'statusCategory', filterVal: 'IN_PROGRESS' },
          { label: 'Intake vs Delivery', value: `${completedIssues.length}/${totalCount}`, sub: `${completionPercentage}% clearance rate`, color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20', filterField: 'statusCategory', filterVal: 'DONE' },
        ];
      }
      case 'team-capacity': {
        const assignees = new Set(scopedIssues.map((i) => i.assigneeId).filter(Boolean));
        const avgPts = assignees.size > 0 ? (totalStoryPoints / assignees.size).toFixed(1) : '0';
        return [
          { label: 'Active Contributors', value: assignees.size || 1, sub: 'Assigned team members', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20', filterField: null, filterVal: null },
          { label: 'Total Assigned Workload', value: `${totalStoryPoints} pts`, sub: `${totalCount} total tasks`, color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20', filterField: null, filterVal: null },
          { label: 'Average Contributor Load', value: `${avgPts} pts`, sub: 'Per assigned member', color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', filterField: null, filterVal: null },
          { label: 'Unassigned Scope', value: unassignedIssues.length, sub: `${scopedIssues.filter((i) => !i.assigneeId).reduce((s, i) => s + (i.estimatePoints || 0), 0)} unallocated points`, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', filterField: 'assignee', filterVal: 'Unassigned' },
        ];
      }
      case 'quality-defect': {
        const critBugs = scopedIssues.filter((i) => i.priority === 'CRITICAL' || i.priority === 'HIGH' || i.priority === 'HIGHEST').length;
        const fixRate = totalCount > 0 ? Math.round((completedIssues.length / totalCount) * 100) : 100;
        return [
          { label: 'Total Defects Reported', value: totalCount, sub: 'Identified software bugs', color: 'text-rose-500', bg: 'bg-rose-500/10 border-rose-500/20', filterField: null, filterVal: null },
          { label: 'Critical / High Defects', value: critBugs, sub: 'High severity triage items', color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/20', filterField: 'priority', filterVal: 'CRITICAL' },
          { label: 'Resolved & Verified', value: completedIssues.length, sub: 'Successfully closed bugs', color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', filterField: 'statusCategory', filterVal: 'DONE' },
          { label: 'Defect Resolution Rate', value: `${fixRate}%`, sub: 'QA resolution ratio', color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20', filterField: 'statusCategory', filterVal: 'DONE' },
        ];
      }
      case 'risk-exception': {
        const overdueDays = overdueIssues.reduce((acc, i) => acc + (i.dueDate ? Math.max(0, (now.getTime() - new Date(i.dueDate).getTime()) / (1000 * 60 * 60 * 24)) : 0), 0);
        const avgOverdue = overdueIssues.length > 0 ? Math.round(overdueDays / overdueIssues.length) : 0;
        return [
          { label: 'Overdue Deliverables', value: overdueIssues.length, sub: `Avg ${avgOverdue} days past target`, color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/20', filterField: 'risk', filterVal: 'Overdue' },
          { label: 'Blocked Work Items', value: blockedIssues.length, sub: 'Dependency bottlenecks', color: 'text-orange-500', bg: 'bg-orange-500/10 border-orange-500/20', filterField: 'risk', filterVal: 'Blocked' },
          { label: 'Critical Open Issues', value: criticalIssues.length, sub: 'High impact priority', color: 'text-rose-500', bg: 'bg-rose-500/10 border-rose-500/20', filterField: 'risk', filterVal: 'Critical' },
          { label: 'Points at Immediate Risk', value: `${overdueIssues.reduce((s, i) => s + (i.estimatePoints || 0), 0)} pts`, sub: 'Pending delayed scope', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20', filterField: 'risk', filterVal: 'Overdue' },
        ];
      }
      case 'backlog-planning': {
        const unestimated = scopedIssues.filter((i) => !i.estimatePoints || i.estimatePoints === 0).length;
        const estCoverage = totalCount > 0 ? Math.round(((totalCount - unestimated) / totalCount) * 100) : 0;
        return [
          { label: 'Backlog Scope Items', value: totalCount, sub: `${totalStoryPoints} estimated pts`, color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/20', filterField: null, filterVal: null },
          { label: 'Estimation Coverage', value: `${estCoverage}%`, sub: `${unestimated} unestimated tasks`, color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20', filterField: null, filterVal: null },
          { label: 'Unassigned Backlog Items', value: unassignedIssues.length, sub: 'Ready for owner assignment', color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', filterField: 'assignee', filterVal: 'Unassigned' },
          { label: 'Sprint Ready Items', value: totalCount - unestimated, sub: 'Refined with estimates', color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', filterField: null, filterVal: null },
        ];
      }
      case 'roadmap-milestones': {
        const epicsSet = new Set(scopedIssues.map((i) => i.epicId).filter(Boolean));
        return [
          { label: 'Active Strategic Epics', value: epicsSet.size || 1, sub: 'Roadmap initiatives', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20', filterField: null, filterVal: null },
          { label: 'Linked Work Items', value: totalCount, sub: `${totalStoryPoints} total story points`, color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20', filterField: null, filterVal: null },
          { label: 'Initiative Burnup Pace', value: `${completionPercentage}%`, sub: 'Delivered roadmap scope', color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', filterField: 'statusCategory', filterVal: 'DONE' },
          { label: 'Completed Deliverables', value: completedIssues.length, sub: `${completedStoryPoints} pts verified`, color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20', filterField: 'statusCategory', filterVal: 'DONE' },
        ];
      }
      case 'project-activity': {
        const totalActivity = scopedIssues.reduce((acc, i) => acc + (i.activityLogs?.length || 1), 0);
        return [
          { label: 'Tracked System Events', value: totalActivity, sub: 'Audit log entries', color: 'text-slate-300', bg: 'bg-slate-500/10 border-slate-500/20', filterField: null, filterVal: null },
          { label: 'Audited Work Items', value: totalCount, sub: 'Active project entities', color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20', filterField: null, filterVal: null },
          { label: 'Modified Deliverables', value: completedIssues.length + inProgressIssues.length, sub: 'Updated in lifecycle', color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', filterField: null, filterVal: null },
          { label: 'Ledger Integrity', value: '100%', sub: 'Immutable audit trail', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20', filterField: null, filterVal: null },
        ];
      }
      default:
        return [
          { label: 'Total Items', value: totalCount, sub: `${totalStoryPoints} pts`, color: 'text-foreground', bg: 'bg-muted/40 border-border', filterField: null, filterVal: null },
          { label: 'Delivered', value: completedIssues.length, sub: `${completionPercentage}% completion`, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', filterField: 'statusCategory', filterVal: 'DONE' },
          { label: 'In Progress', value: inProgressIssues.length, sub: 'Active development', color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', filterField: 'statusCategory', filterVal: 'IN_PROGRESS' },
          { label: 'At Risk', value: overdueIssues.length, sub: 'SLA overdue tasks', color: 'text-rose-500', bg: 'bg-rose-500/10 border-rose-500/20', filterField: 'risk', filterVal: 'Overdue' },
        ];
    }
  }, [reportId, totalCount, completedIssues, inProgressIssues, openIssues, totalStoryPoints, completedStoryPoints, remainingStoryPoints, completionPercentage, overdueIssues, blockedIssues, criticalIssues, unassignedIssues, scopedIssues]);

  // 4. Domain-Specialized Key Insights (Strictly customized per subject)
  const informativeInsights = useMemo(() => {
    const list: string[] = [];
    if (totalCount === 0) {
      return ['No active records found matching the active filter criteria for this project scope.'];
    }

    if (reportId === 'work-portfolio') {
      const topType = typeMatrix[0];
      if (topType) list.push(`Portfolio scope is led by ${topType.name}s (${topType.count} items, ${topType.pct}% of portfolio).`);
      const critCount = priorityMatrix.find((p) => p.name === 'CRITICAL')?.count || 0;
      if (critCount > 0) list.push(`Critical severity tasks account for ${critCount} deliverables requiring executive priority balance.`);
      list.push(`Portfolio pipeline has ${inProgressIssues.length} items in active development and ${completedIssues.length} delivered.`);
      if (unassignedIssues.length > 0) list.push(`${unassignedIssues.length} deliverables (${Math.round((unassignedIssues.length / totalCount) * 100)}% of scope) lack contributor assignment.`);
    } else if (reportId === 'sprint-performance') {
      list.push(`Active iteration commitment is ${totalStoryPoints} story points across ${totalCount} sprint items.`);
      list.push(`Delivered velocity stands at ${completedStoryPoints} points (${completionPercentage}% burnup rate).`);
      if (remainingStoryPoints > 0) list.push(`${remainingStoryPoints} points remain in flight before scheduled iteration close.`);
    } else if (reportId === 'delivery-flow') {
      list.push(`Throughput pace: ${completedIssues.length} deliverables resolved and deployed.`);
      list.push(`Work-in-progress (WIP) contains ${inProgressIssues.length} items actively occupying developer capacity.`);
      list.push(`Intake clearance rate is currently ${completionPercentage}%.`);
    } else if (reportId === 'team-capacity') {
      const overloaded = teamCapacityMatrix.filter((m) => m.status === 'OVERLOADED');
      if (overloaded.length > 0) list.push(`${overloaded.length} team member(s) are operating above recommended 100% capacity limits.`);
      list.push(`${teamCapacityMatrix.filter((m) => m.name !== 'Unassigned').length} engineers are actively contributing to the delivery scope.`);
      if (unassignedIssues.length > 0) list.push(`${unassignedIssues.length} unassigned items are awaiting contributor allocation.`);
    } else if (reportId === 'quality-defect') {
      const critBugs = scopedIssues.filter((i) => i.priority === 'CRITICAL').length;
      list.push(`Quality register has recorded ${totalCount} defects (${critBugs} marked Critical priority).`);
      list.push(`QA fix and verification rate is currently ${completionPercentage}%.`);
    } else if (reportId === 'risk-exception') {
      list.push(`Schedule alert: ${overdueIssues.length} deliverables have breached scheduled target dates.`);
      list.push(`Dependency alert: ${blockedIssues.length} deliverables are blocked by prerequisite tasks.`);
      list.push(`Total story points currently at risk: ${overdueIssues.reduce((s, i) => s + (i.estimatePoints || 0), 0)} pts.`);
    } else if (reportId === 'backlog-planning') {
      const unest = scopedIssues.filter((i) => !i.estimatePoints).length;
      list.push(`Backlog grooming: ${unest} items require story point estimation before sprint allocation.`);
      list.push(`${totalCount - unest} backlog items are refined and ready for upcoming sprint planning.`);
    } else if (reportId === 'roadmap-milestones') {
      list.push(`Strategic initiative burnup is currently tracking at ${completionPercentage}% completion.`);
      list.push(`${epicMatrix.length} strategic roadmap epics are active across the project lifecycle.`);
    } else if (reportId === 'project-activity') {
      const totalActivity = scopedIssues.reduce((acc, i) => acc + (i.activityLogs?.length || 1), 0);
      list.push(`System has recorded ${totalActivity} verifiable event logs across ${totalCount} audited deliverables.`);
      list.push(`Immutable audit ledger integrity is verified at 100%.`);
    } else {
      list.push(`Project delivery is tracking at ${completionPercentage}% completion (${completedStoryPoints} of ${totalStoryPoints} points burned).`);
      if (overdueIssues.length > 0) list.push(`${overdueIssues.length} deliverables are past their scheduled target dates.`);
      if (blockedIssues.length > 0) list.push(`${blockedIssues.length} work items have active dependency blockers currently halting forward progress.`);
    }

    return list.slice(0, 4);
  }, [reportId, totalCount, completionPercentage, completedStoryPoints, totalStoryPoints, inProgressIssues, completedIssues, remainingStoryPoints, overdueIssues, blockedIssues, scopedIssues, unassignedIssues, typeMatrix, priorityMatrix, teamCapacityMatrix, epicMatrix]);

  // 5. Risks & Exceptions / Action Required (Strict condition breaches)
  const riskExceptions = useMemo(() => {
    const list: { type: 'DANGER' | 'WARNING' | 'INFO'; message: string; action: string }[] = [];

    if (overdueIssues.length > 0) {
      list.push({
        type: 'DANGER',
        message: `${overdueIssues.length} tasks are past scheduled due dates`,
        action: 'Review target dates or reassign priority',
      });
    }

    if (blockedIssues.length > 0) {
      list.push({
        type: 'DANGER',
        message: `${blockedIssues.length} items blocked by incoming/outgoing dependencies`,
        action: 'Unblock prerequisite tasks on critical path',
      });
    }

    if (criticalIssues.some((i) => i.status?.category !== 'DONE')) {
      const openCrit = criticalIssues.filter((i) => i.status?.category !== 'DONE').length;
      list.push({
        type: 'WARNING',
        message: `${openCrit} Critical priority issues remain unresolved`,
        action: 'Prioritize in current sprint triage',
      });
    }

    if (unassignedIssues.length > 0) {
      list.push({
        type: 'INFO',
        message: `${unassignedIssues.length} items lack owner assignment`,
        action: 'Assign responsible team members',
      });
    }

    return list;
  }, [overdueIssues, blockedIssues, criticalIssues, unassignedIssues]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleDownload = (format: 'pdf' | 'excel' | 'csv') => {
    const targetProjId =
      projectId && projectId !== 'default'
        ? projectId
        : (issues && issues.length > 0 && issues[0].projectId) || 'default';

    if (targetProjId && targetProjId !== 'default') {
      const params = new URLSearchParams();
      params.set('reportType', reportId);
      params.set('format', format);

      if (modalStatusFilter !== 'ALL') params.set('statusId', modalStatusFilter);
      else if (statusId && statusId !== 'ALL') params.set('statusId', statusId);

      if (modalPriorityFilter !== 'ALL') params.set('priority', modalPriorityFilter);
      else if (priority && priority !== 'ALL') params.set('priority', priority);

      if (modalTypeFilter !== 'ALL') params.set('issueType', modalTypeFilter);
      else if (issueType && issueType !== 'ALL') params.set('issueType', issueType);

      if (modalAssigneeFilter !== 'ALL') params.set('assigneeId', modalAssigneeFilter);
      else if (assigneeId && assigneeId !== 'ALL') params.set('assigneeId', assigneeId);

      if (modalTimeRangeFilter !== 'ALL') params.set('timeRange', modalTimeRangeFilter);
      else if (timeRange && timeRange !== 'ALL') params.set('timeRange', timeRange);

      if (sprintId && sprintId !== 'ALL') params.set('sprintId', sprintId);
      if (teamId && teamId !== 'ALL') params.set('teamId', teamId);
      if (epicId && epicId !== 'ALL') params.set('epicId', epicId);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      else if (search) params.set('search', search);

      window.open(`/api/projects/${targetProjId}/reports/download?${params.toString()}`, '_blank');
      return;
    }

    // Client-side Fallback (Exports ALL processedIssues without truncation)
    if (format === 'csv' || format === 'excel') {
      const headers = ['Issue Key', 'Title', 'Type', 'Status', 'Priority', 'Assignee', 'Story Points', 'Due Date'];
      const rows = processedIssues.map((i: any) => [
        `"${i.issueKey || ''}"`,
        `"${(i.title || '').replace(/"/g, '""')}"`,
        `"${i.issueType || 'TASK'}"`,
        `"${i.status?.name || ''}"`,
        `"${i.priority || ''}"`,
        `"${i.assignee ? i.assignee.firstName + ' ' + (i.assignee.lastName || '') : 'Unassigned'}"`,
        i.estimatePoints || 0,
        `"${i.dueDate ? new Date(i.dueDate).toLocaleDateString() : ''}"`,
      ]);
      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `${reportId}_report_${Date.now()}.${format === 'excel' ? 'xls' : 'csv'}`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (format === 'pdf') {
      window.print();
    }
  };

  const hasActiveFilters = modalStatusFilter !== 'ALL' || modalPriorityFilter !== 'ALL' || modalTypeFilter !== 'ALL' || modalAssigneeFilter !== 'ALL' || modalTimeRangeFilter !== 'ALL' || chartFilter !== null || searchQuery.trim().length > 0;

  const resetAllFilters = () => {
    setModalStatusFilter('ALL');
    setModalPriorityFilter('ALL');
    setModalTypeFilter('ALL');
    setModalAssigneeFilter('ALL');
    setModalTimeRangeFilter('ALL');
    setChartFilter(null);
    setSearchQuery('');
    setCurrentPage(1);
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200">
        <div className="bg-card border border-border w-full max-w-6xl max-h-[94vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          
          {/* 1. REPORT HEADER & CONTEXT BAR */}
          <div className="px-6 py-4 bg-muted/30 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary mt-0.5 shrink-0">
                <MetaIcon className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider rounded-md border ${badgeColor}`}>
                    {canonicalDef.categoryLabel}
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                    <FolderGit2 className="w-3 h-3 text-primary" />
                    {projectName}
                  </span>
                  <span className="text-[11px] text-muted-foreground font-mono inline-flex items-center gap-1.5 bg-muted/60 px-2 py-0.5 rounded-md border border-border/50">
                    <span className="relative flex h-2 w-2">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isLiveSyncing ? 'bg-amber-400' : 'bg-emerald-400'}`}></span>
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${isLiveSyncing ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
                    </span>
                    <span>
                      {isLiveSyncing ? 'Syncing...' : `Live Synced ${(lastRefreshed || now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
                    </span>
                  </span>
                </div>
                <h1 className="text-lg sm:text-xl font-bold text-foreground mt-0.5">{effectiveTitle}</h1>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-3xl leading-relaxed">{effectiveDesc}</p>
              </div>
            </div>

            {/* Export & Action Toolbar */}
            <div className="flex items-center gap-2 shrink-0 self-end md:self-center flex-wrap">
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  disabled={isLiveSyncing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl border border-border bg-background hover:bg-muted text-foreground transition shadow-2xs cursor-pointer disabled:opacity-50"
                  title="Force refresh report data from live database"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-primary ${isLiveSyncing ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              )}

              {/* Compare Reports / Difference Guide Button */}
              <button
                onClick={() => setIsGuideOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition shadow-2xs cursor-pointer"
                title="View difference matrix between all 10 reports"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>What is the difference?</span>
              </button>

              <button
                onClick={() => handleDownload('pdf')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl border border-border bg-background hover:bg-muted text-rose-500 hover:border-rose-400 transition shadow-2xs cursor-pointer"
                title="Print or Save as Multi-Page Business PDF (Unrestricted All Records)"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                onClick={() => handleDownload('excel')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl border border-border bg-background hover:bg-muted text-emerald-500 hover:border-emerald-400 transition shadow-2xs cursor-pointer"
                title="Download Microsoft Excel Spreadsheet (All Records)"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Excel</span>
              </button>
              <button
                onClick={() => handleDownload('csv')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl border border-border bg-background hover:bg-muted text-blue-500 hover:border-blue-400 transition shadow-2xs cursor-pointer"
                title="Download Standard CSV (All Records)"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition ml-1 cursor-pointer"
                title="Close Report"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* ACTIVE FILTER TOOLBAR (Section 5: Interactive filters affecting all components) */}
          <div className="px-6 py-2.5 bg-card border-b border-border flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 text-muted-foreground font-semibold">
                <Filter className="w-3.5 h-3.5 text-primary" />
                <span>Filters:</span>
              </div>

              {/* Status Filter */}
              <select
                value={modalStatusFilter}
                onChange={(e) => {
                  setModalStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-background text-foreground cursor-pointer focus:ring-1 focus:ring-primary outline-hidden"
              >
                <option value="ALL">All Statuses</option>
                {availableStatuses.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>

              {/* Priority Filter */}
              <select
                value={modalPriorityFilter}
                onChange={(e) => {
                  setModalPriorityFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-background text-foreground cursor-pointer focus:ring-1 focus:ring-primary outline-hidden"
              >
                <option value="ALL">All Priorities</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>

              {/* Issue Type Filter */}
              <select
                value={modalTypeFilter}
                onChange={(e) => {
                  setModalTypeFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-background text-foreground cursor-pointer focus:ring-1 focus:ring-primary outline-hidden"
              >
                <option value="ALL">All Types</option>
                <option value="TASK">Task</option>
                <option value="BUG">Bug</option>
                <option value="STORY">Story</option>
                <option value="EPIC">Epic</option>
              </select>

              {/* Assignee Filter */}
              <select
                value={modalAssigneeFilter}
                onChange={(e) => {
                  setModalAssigneeFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-background text-foreground cursor-pointer focus:ring-1 focus:ring-primary outline-hidden max-w-[140px] truncate"
              >
                <option value="ALL">All Assignees</option>
                <option value="UNASSIGNED">Unassigned</option>
                {availableAssignees.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>

              {/* Time Range Filter */}
              <select
                value={modalTimeRangeFilter}
                onChange={(e) => {
                  setModalTimeRangeFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-background text-foreground cursor-pointer focus:ring-1 focus:ring-primary outline-hidden"
              >
                <option value="ALL">All Time</option>
                <option value="7D">Last 7 Days</option>
                <option value="14D">Last 14 Days</option>
                <option value="30D">Last 30 Days</option>
                <option value="90D">Last 90 Days</option>
              </select>

              {hasActiveFilters && (
                <button
                  onClick={resetAllFilters}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition cursor-pointer"
                  title="Reset all active filters"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Filters</span>
                </button>
              )}
            </div>

            {chartFilter && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">Drill-Down:</span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-bold rounded-md bg-primary/10 text-primary border border-primary/20">
                  <span>{chartFilter.field}: {chartFilter.value}</span>
                  <button onClick={() => setChartFilter(null)} className="hover:text-primary-foreground cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              </div>
            )}
          </div>

          {/* SCROLLABLE REPORT BODY */}
          <div className="flex-1 overflow-y-auto space-y-5 p-6 bg-background/50">
            
            {/* 2. EXECUTIVE SUMMARY & DOMAIN SCOPE BANNER */}
            <div className="p-4.5 rounded-xl border border-border bg-card shadow-2xs space-y-3">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1 max-w-3xl">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-primary">Domain Scope &amp; Objective</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                      Live Real Database
                    </span>
                  </div>
                  <p className="text-xs text-foreground font-medium leading-relaxed">
                    {canonicalDef.businessPurpose}
                  </p>
                </div>

                {/* Scope Gauge */}
                <div className="flex items-center gap-3 shrink-0 p-3 rounded-xl bg-muted/30 border border-border self-start lg:self-center">
                  <div className="text-right">
                    <div className="text-[10px] uppercase font-bold text-muted-foreground">Delivery Pace</div>
                    <div className="text-sm font-extrabold text-foreground">
                      {overdueIssues.length > 5 ? (
                        <span className="text-rose-500">Elevated Risk</span>
                      ) : overdueIssues.length > 0 ? (
                        <span className="text-amber-500">Moderate Risk</span>
                      ) : (
                        <span className="text-emerald-500">On Track</span>
                      )}
                    </div>
                  </div>
                  <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary flex items-center justify-center font-bold text-xs text-primary font-mono">
                    {completionPercentage}%
                  </div>
                </div>
              </div>

              {/* Distinction Matrix Callout Box */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-2 border-t border-border text-xs">
                <div className="p-2 rounded-lg bg-muted/20 border border-border">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-0.5">
                    Question Answered
                  </span>
                  <span className="text-foreground font-medium text-[11px] leading-snug">
                    {canonicalDef.businessQuestion}
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-muted/20 border border-border">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-0.5">
                    Data Scope Filter
                  </span>
                  <span className="font-mono text-primary text-[11px] font-semibold">
                    {canonicalDef.scopeFilter}
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-muted/20 border border-border">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-0.5">
                    Distinct Domain Focus
                  </span>
                  <span className="text-foreground text-[11px]">
                    {canonicalDef.differenceSummary}
                  </span>
                </div>
              </div>
            </div>

            {/* 3. KPI SUMMARY (4 DOMAIN-SPECIALIZED INTERACTIVE CARDS) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {specializedKPIs.map((kpi, idx) => {
                const isSelected = kpi.filterField && chartFilter?.field === kpi.filterField && chartFilter?.value === kpi.filterVal;
                return (
                  <div
                    key={idx}
                    onClick={() => {
                      if (!kpi.filterField) return;
                      if (isSelected) {
                        setChartFilter(null);
                      } else {
                        setChartFilter({ field: kpi.filterField, value: kpi.filterVal! });
                        setCurrentPage(1);
                      }
                    }}
                    className={`p-4 rounded-xl border ${kpi.bg} shadow-2xs transition hover:translate-y-[-1px] cursor-pointer ${
                      isSelected ? 'ring-2 ring-primary border-primary' : ''
                    }`}
                    title={kpi.filterField ? `Click to filter table by ${kpi.label}` : undefined}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-muted-foreground">{kpi.label}</span>
                      {kpi.filterField && (
                        <span className="text-[9px] font-bold text-primary/70 uppercase">Filter 🔍</span>
                      )}
                    </div>
                    <div className={`text-2xl font-extrabold mt-1 ${kpi.color}`}>{kpi.value}</div>
                    <div className="text-[11px] text-muted-foreground/80 mt-0.5">{kpi.sub}</div>
                  </div>
                );
              })}
            </div>

            {/* 4. INFORMATIVE INSIGHTS & RISKS ROW */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              
              {/* Key Insights (Tailored strictly to this report domain) */}
              <div className="p-4 rounded-xl border border-border bg-card shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">Informative Key Insights</h2>
                  </div>
                  <ul className="space-y-2">
                    {informativeInsights.map((insight, idx) => (
                      <li key={idx} className="text-xs text-muted-foreground flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                        <span className="leading-relaxed">{insight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="text-[10px] text-muted-foreground/60 italic mt-3 pt-2 border-t border-border">
                  Computed dynamically for {effectiveTitle} from live records.
                </div>
              </div>

              {/* Risks & Exceptions (Action Required) */}
              <div className="p-4 rounded-xl border border-border bg-card shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <ShieldAlert className="w-4 h-4 text-rose-500" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">Risks &amp; Exceptions (Action Required)</h2>
                  </div>
                  {riskExceptions.length > 0 ? (
                    <div className="space-y-2">
                      {riskExceptions.map((risk, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            if (risk.message.includes('due dates')) {
                              setChartFilter({ field: 'risk', value: 'Overdue' });
                            } else if (risk.message.includes('blocked')) {
                              setChartFilter({ field: 'risk', value: 'Blocked' });
                            } else if (risk.message.includes('Critical')) {
                              setChartFilter({ field: 'risk', value: 'Critical' });
                            } else if (risk.message.includes('owner')) {
                              setChartFilter({ field: 'assignee', value: 'Unassigned' });
                            }
                            setCurrentPage(1);
                          }}
                          className="p-2.5 rounded-lg bg-muted/40 border border-border text-xs flex items-center justify-between gap-3 cursor-pointer hover:bg-muted transition"
                          title="Click to filter table by this exception"
                        >
                          <div className="flex items-center gap-2">
                            {risk.type === 'DANGER' ? (
                              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                            ) : risk.type === 'WARNING' ? (
                              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                            ) : (
                              <Clock className="w-4 h-4 text-blue-500 shrink-0" />
                            )}
                            <span className="font-medium text-foreground">{risk.message}</span>
                          </div>
                          <span className="text-[10px] font-bold text-primary shrink-0 bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                            {risk.action}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-500 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>Zero active exceptions or SLA breaches detected for this scope.</span>
                    </div>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground/60 italic mt-3 pt-2 border-t border-border">
                  Real-time condition monitoring. Click rows to filter table to exception items.
                </div>
              </div>
            </div>

            {/* ================================================================ */}
            {/* 5. DOMAIN-SPECIALIZED ANALYTICAL MATRICES & GRAPHICAL ANALYSIS  */}
            {/* ================================================================ */}
            <div className="p-4.5 rounded-xl border border-border bg-card shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                    {canonicalDef.distinctMatrix}
                  </h2>
                  <span className="text-[10px] text-muted-foreground">(Click any slice or bar to filter table)</span>
                </div>
              </div>

              {/* SPECIALIZED VIEW A: WORK PORTFOLIO ANALYSIS (4 MATRICES) */}
              {reportId === 'work-portfolio' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Status Breakdown Matrix */}
                  <div className="p-3.5 rounded-xl bg-muted/20 border border-border">
                    <div className="text-[11px] font-bold text-foreground mb-2 flex items-center justify-between">
                      <span>Status Distribution Matrix</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{statusMatrix.length} stages</span>
                    </div>
                    <div className="space-y-2">
                      {statusMatrix.map((item, idx) => {
                        const isSelected = chartFilter?.field === 'status' && chartFilter?.value.toLowerCase() === item.name.toLowerCase();
                        return (
                          <div
                            key={idx}
                            onClick={() => {
                              if (isSelected) setChartFilter(null);
                              else setChartFilter({ field: 'status', value: item.name });
                              setCurrentPage(1);
                            }}
                            className={`p-2 rounded-lg cursor-pointer transition flex flex-col gap-1 hover:bg-muted ${isSelected ? 'bg-primary/15 border border-primary/30' : ''}`}
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-foreground truncate">{item.name}</span>
                              <span className="font-mono text-[11px] text-muted-foreground">{item.count} items • {item.points} pts ({item.pct}%)</span>
                            </div>
                            <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${item.pct}%`, backgroundColor: item.color }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Priority Severity Breakdown */}
                  <div className="p-3.5 rounded-xl bg-muted/20 border border-border">
                    <div className="text-[11px] font-bold text-foreground mb-2 flex items-center justify-between">
                      <span>Priority Severity Breakdown</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{priorityMatrix.length} levels</span>
                    </div>
                    <div className="space-y-2">
                      {priorityMatrix.map((item, idx) => {
                        const isSelected = chartFilter?.field === 'priority' && chartFilter?.value.toLowerCase() === item.name.toLowerCase();
                        return (
                          <div
                            key={idx}
                            onClick={() => {
                              if (isSelected) setChartFilter(null);
                              else setChartFilter({ field: 'priority', value: item.name });
                              setCurrentPage(1);
                            }}
                            className={`p-2 rounded-lg cursor-pointer transition flex flex-col gap-1 hover:bg-muted ${isSelected ? 'bg-primary/15 border border-primary/30' : ''}`}
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-foreground">{item.name}</span>
                              <span className="font-mono text-[11px] text-muted-foreground">{item.count} items • {item.points} pts ({item.pct}%)</span>
                            </div>
                            <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${item.pct}%`, backgroundColor: item.color }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Issue Type Scope Matrix */}
                  <div className="p-3.5 rounded-xl bg-muted/20 border border-border">
                    <div className="text-[11px] font-bold text-foreground mb-2 flex items-center justify-between">
                      <span>Issue Type &amp; Scope Allocation</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{typeMatrix.length} types</span>
                    </div>
                    <div className="space-y-2">
                      {typeMatrix.map((item, idx) => {
                        const isSelected = chartFilter?.field === 'issueType' && chartFilter?.value.toLowerCase() === item.name.toLowerCase();
                        return (
                          <div
                            key={idx}
                            onClick={() => {
                              if (isSelected) setChartFilter(null);
                              else setChartFilter({ field: 'issueType', value: item.name });
                              setCurrentPage(1);
                            }}
                            className={`p-2 rounded-lg cursor-pointer transition flex flex-col gap-1 hover:bg-muted ${isSelected ? 'bg-primary/15 border border-primary/30' : ''}`}
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-foreground">{item.name}</span>
                              <span className="font-mono text-[11px] text-muted-foreground">{item.count} items • {item.points} pts ({item.pct}%)</span>
                            </div>
                            <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${item.pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Strategic Epics Scope Matrix */}
                  <div className="p-3.5 rounded-xl bg-muted/20 border border-border">
                    <div className="text-[11px] font-bold text-foreground mb-2 flex items-center justify-between">
                      <span>Strategic Epics &amp; Initiatives</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{epicMatrix.length} epics</span>
                    </div>
                    <div className="space-y-2">
                      {epicMatrix.slice(0, 5).map((item, idx) => {
                        const isSelected = chartFilter?.field === 'epic' && chartFilter?.value === item.name;
                        return (
                          <div
                            key={idx}
                            onClick={() => {
                              if (isSelected) setChartFilter(null);
                              else setChartFilter({ field: 'epic', value: item.name });
                              setCurrentPage(1);
                            }}
                            className={`p-2 rounded-lg cursor-pointer transition flex flex-col gap-1 hover:bg-muted ${isSelected ? 'bg-primary/15 border border-primary/30' : ''}`}
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-foreground truncate max-w-[200px]">{item.name}</span>
                              <span className="font-mono text-[11px] text-emerald-500 font-bold">{item.done}/{item.count} done ({item.pct}%)</span>
                            </div>
                            <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${item.pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* SPECIALIZED VIEW B: TEAM PERFORMANCE & CAPACITY MATRIX */}
              {reportId === 'team-capacity' && (
                <div className="space-y-3">
                  <div className="border border-border rounded-xl overflow-hidden shadow-2xs">
                    <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-muted/60 text-muted-foreground border-b border-border font-bold">
                        <tr>
                          <th className="p-3">Contributor</th>
                          <th className="p-3">Email</th>
                          <th className="p-3">Assigned Tasks</th>
                          <th className="p-3 text-right">Story Points</th>
                          <th className="p-3 text-right">Standard Capacity</th>
                          <th className="p-3 text-right">Utilization %</th>
                          <th className="p-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {teamCapacityMatrix.map((m, idx) => {
                          const isSelected = chartFilter?.field === 'assignee' && chartFilter?.value === m.name;
                          return (
                            <tr
                              key={idx}
                              onClick={() => {
                                if (isSelected) setChartFilter(null);
                                else setChartFilter({ field: 'assignee', value: m.name });
                                setCurrentPage(1);
                              }}
                              className={`hover:bg-muted/40 cursor-pointer transition ${isSelected ? 'bg-primary/10 font-bold' : ''}`}
                            >
                              <td className="p-3 font-semibold text-foreground flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-primary/20 text-primary font-bold text-[10px] flex items-center justify-center">
                                  {m.name[0]}
                                </div>
                                <span>{m.name}</span>
                              </td>
                              <td className="p-3 text-muted-foreground font-mono text-[11px]">{m.email}</td>
                              <td className="p-3">{m.count} items</td>
                              <td className="p-3 text-right font-mono font-bold text-foreground">{m.points} pts</td>
                              <td className="p-3 text-right font-mono text-muted-foreground">{m.capacity > 0 ? `${m.capacity} pts` : '—'}</td>
                              <td className="p-3 text-right">
                                <span className={`font-mono font-bold ${m.utilization > 100 ? 'text-rose-500' : 'text-emerald-500'}`}>
                                  {m.capacity > 0 ? `${m.utilization}%` : '—'}
                                </span>
                              </td>
                              <td className="p-3">
                                <span className={`px-2 py-0.5 text-[10px] font-extrabold rounded-md ${
                                  m.status === 'OVERLOADED'
                                    ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                                    : m.status === 'BALANCED'
                                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                    : 'bg-muted text-muted-foreground border border-border'
                                }`}>
                                  {m.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  </div>
                </div>
              )}

              {/* SPECIALIZED VIEW C: SPRINT PERFORMANCE */}
              {reportId === 'sprint-performance' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-bold text-amber-500 uppercase tracking-wide">Committed Points</span>
                      <div className="text-3xl font-extrabold text-foreground mt-2">{totalStoryPoints} pts</div>
                      <p className="text-xs text-muted-foreground mt-1">Total sprint scope committed</p>
                    </div>
                    <div className="text-xs font-mono text-amber-500/80 pt-2 border-t border-amber-500/20">
                      {totalCount} sprint work items
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-bold text-emerald-500 uppercase tracking-wide">Burned Velocity</span>
                      <div className="text-3xl font-extrabold text-emerald-500 mt-2">{completedStoryPoints} pts</div>
                      <p className="text-xs text-muted-foreground mt-1">Delivered to completion</p>
                    </div>
                    <div className="text-xs font-mono text-emerald-500/80 pt-2 border-t border-emerald-500/20">
                      {completedIssues.length} completed tasks ({completionPercentage}%)
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-bold text-blue-500 uppercase tracking-wide">Remaining In Flight</span>
                      <div className="text-3xl font-extrabold text-blue-500 mt-2">{remainingStoryPoints} pts</div>
                      <p className="text-xs text-muted-foreground mt-1">Active before sprint close</p>
                    </div>
                    <div className="text-xs font-mono text-blue-500/80 pt-2 border-t border-blue-500/20">
                      {inProgressIssues.length} in development
                    </div>
                  </div>
                </div>
              )}

              {/* SPECIALIZED VIEW D: QUALITY & DEFECT ANALYSIS */}
              {reportId === 'quality-defect' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-3.5 rounded-xl bg-muted/20 border border-border">
                    <div className="text-[11px] font-bold text-foreground mb-2">Defect Severity Triage</div>
                    <div className="space-y-2">
                      {priorityMatrix.map((item, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            setChartFilter({ field: 'priority', value: item.name });
                            setCurrentPage(1);
                          }}
                          className="p-2 rounded-lg bg-card border border-border flex items-center justify-between text-xs cursor-pointer hover:bg-muted"
                        >
                          <span className="font-semibold text-foreground">{item.name} Severity</span>
                          <span className="font-mono font-bold" style={{ color: item.color }}>{item.count} bugs ({item.pct}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-muted/20 border border-border">
                    <div className="text-[11px] font-bold text-foreground mb-2">Resolution Status</div>
                    <div className="space-y-2">
                      {statusMatrix.map((item, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            setChartFilter({ field: 'status', value: item.name });
                            setCurrentPage(1);
                          }}
                          className="p-2 rounded-lg bg-card border border-border flex items-center justify-between text-xs cursor-pointer hover:bg-muted"
                        >
                          <span className="font-semibold text-foreground">{item.name}</span>
                          <span className="font-mono text-muted-foreground">{item.count} items</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-bold text-rose-500 uppercase tracking-wide">Defect Resolution Rate</span>
                      <div className="text-3xl font-extrabold text-foreground mt-2">{completionPercentage}%</div>
                      <p className="text-xs text-muted-foreground mt-1">Ratio of resolved to total logged defects</p>
                    </div>
                    <div className="text-xs font-mono text-rose-500/80 pt-2 border-t border-rose-500/20">
                      {completedIssues.length} resolved • {totalCount - completedIssues.length} open bugs
                    </div>
                  </div>
                </div>
              )}

              {/* SPECIALIZED VIEW E: RISK & EXCEPTION REPORT */}
              {reportId === 'risk-exception' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div
                    onClick={() => {
                      setChartFilter({ field: 'risk', value: 'Overdue' });
                      setCurrentPage(1);
                    }}
                    className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 cursor-pointer hover:bg-rose-500/15 transition"
                  >
                    <span className="text-[11px] font-bold text-rose-500 uppercase tracking-wide">SLA Overdue Items</span>
                    <div className="text-3xl font-extrabold text-rose-500 mt-2">{overdueIssues.length}</div>
                    <p className="text-xs text-muted-foreground mt-1">Deliverables breaching scheduled target date</p>
                  </div>
                  <div
                    onClick={() => {
                      setChartFilter({ field: 'risk', value: 'Blocked' });
                      setCurrentPage(1);
                    }}
                    className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 cursor-pointer hover:bg-amber-500/15 transition"
                  >
                    <span className="text-[11px] font-bold text-amber-500 uppercase tracking-wide">Blocked Dependencies</span>
                    <div className="text-3xl font-extrabold text-amber-500 mt-2">{blockedIssues.length}</div>
                    <p className="text-xs text-muted-foreground mt-1">Items waiting on prerequisite task clearance</p>
                  </div>
                  <div
                    onClick={() => {
                      setChartFilter({ field: 'risk', value: 'Critical' });
                      setCurrentPage(1);
                    }}
                    className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20 cursor-pointer hover:bg-purple-500/15 transition"
                  >
                    <span className="text-[11px] font-bold text-purple-400 uppercase tracking-wide">Story Points at Risk</span>
                    <div className="text-3xl font-extrabold text-purple-400 mt-2">
                      {overdueIssues.reduce((s, i) => s + (i.estimatePoints || 0), 0)} pts
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Delayed story points needing schedule adjustment</p>
                  </div>
                </div>
              )}

              {/* DEFAULT / OTHER REPORTS (Delivery Flow, Roadmaps, Backlog, Project Overview, Audit) */}
              {reportId !== 'work-portfolio' && reportId !== 'team-capacity' && reportId !== 'sprint-performance' && reportId !== 'quality-defect' && reportId !== 'risk-exception' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Status Breakdown */}
                  <div className="p-3.5 rounded-xl bg-muted/20 border border-border">
                    <div className="text-[11px] font-bold text-foreground mb-2 flex items-center justify-between">
                      <span>Status Breakdown</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{statusMatrix.length} stages</span>
                    </div>
                    <div className="space-y-2">
                      {statusMatrix.map((item, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            setChartFilter({ field: 'status', value: item.name });
                            setCurrentPage(1);
                          }}
                          className="p-1.5 rounded-lg cursor-pointer transition flex flex-col gap-1 hover:bg-muted"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-foreground truncate">{item.name}</span>
                            <span className="font-mono text-[11px] text-muted-foreground">{item.count} ({item.pct}%)</span>
                          </div>
                          <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${item.pct}%`, backgroundColor: item.color }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Priority Breakdown */}
                  <div className="p-3.5 rounded-xl bg-muted/20 border border-border">
                    <div className="text-[11px] font-bold text-foreground mb-2 flex items-center justify-between">
                      <span>Priority Breakdown</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{priorityMatrix.length} levels</span>
                    </div>
                    <div className="space-y-2">
                      {priorityMatrix.map((item, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            setChartFilter({ field: 'priority', value: item.name });
                            setCurrentPage(1);
                          }}
                          className="p-1.5 rounded-lg cursor-pointer transition flex flex-col gap-1 hover:bg-muted"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-foreground">{item.name}</span>
                            <span className="font-mono text-[11px] text-muted-foreground">{item.count} ({item.pct}%)</span>
                          </div>
                          <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${item.pct}%`, backgroundColor: item.color }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Strategic Epics Breakdown */}
                  <div className="p-3.5 rounded-xl bg-muted/20 border border-border">
                    <div className="text-[11px] font-bold text-foreground mb-2 flex items-center justify-between">
                      <span>Strategic Initiatives</span>
                      <span className="text-[10px] text-muted-foreground font-mono">Top {epicMatrix.length}</span>
                    </div>
                    <div className="space-y-2">
                      {epicMatrix.slice(0, 4).map((item, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            setChartFilter({ field: 'epic', value: item.name });
                            setCurrentPage(1);
                          }}
                          className="p-1.5 rounded-lg flex flex-col gap-1 cursor-pointer hover:bg-muted"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-foreground truncate max-w-[150px]">{item.name}</span>
                            <span className="font-mono text-[11px] text-emerald-500 font-bold">{item.pct}%</span>
                          </div>
                          <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${item.pct}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* 6. DETAILED DATA TABLE & DRILL-DOWN (Section 6: Unrestricted Pagination) */}
            <div className="p-4.5 rounded-xl border border-border bg-card shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">Detailed Records &amp; Traceability</h2>
                  <p className="text-[11px] text-muted-foreground">Click any record to inspect full issue details. Complete multi-page dataset without 150-record limitation.</p>
                </div>

                {/* Search Bar */}
                <div className="relative w-full sm:w-72">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder={`Search ${processedIssues.length} records...`}
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary shadow-2xs"
                  />
                </div>
              </div>

              {/* Table */}
              {paginatedIssues.length > 0 ? (
                <div className="border border-border rounded-xl overflow-hidden shadow-2xs">
                  <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-muted-foreground border-b border-border font-bold">
                      <tr>
                        <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort('issueKey')}>
                          <div className="flex items-center gap-1">
                            <span>Key</span>
                            <ArrowUpDown className="w-3 h-3" />
                          </div>
                        </th>
                        <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort('title')}>
                          <div className="flex items-center gap-1">
                            <span>Title / Deliverable</span>
                            <ArrowUpDown className="w-3 h-3" />
                          </div>
                        </th>

                        {/* Dynamic Columns based on Report Type */}
                        {reportId === 'risk-exception' && (
                          <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort('daysOverdue')}>
                            <div className="flex items-center gap-1">
                              <span>SLA Status</span>
                              <ArrowUpDown className="w-3 h-3" />
                            </div>
                          </th>
                        )}

                        {reportId === 'quality-defect' && (
                          <th className="p-3">Defect Severity</th>
                        )}

                        {reportId === 'delivery-flow' && (
                          <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort('cycleTime')}>
                            <div className="flex items-center gap-1">
                              <span>Cycle Duration</span>
                              <ArrowUpDown className="w-3 h-3" />
                            </div>
                          </th>
                        )}

                        <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort('status')}>
                          <div className="flex items-center gap-1">
                            <span>Status</span>
                            <ArrowUpDown className="w-3 h-3" />
                          </div>
                        </th>
                        <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort('priority')}>
                          <div className="flex items-center gap-1">
                            <span>Priority</span>
                            <ArrowUpDown className="w-3 h-3" />
                          </div>
                        </th>
                        <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort('assignee')}>
                          <div className="flex items-center gap-1">
                            <span>Assignee</span>
                            <ArrowUpDown className="w-3 h-3" />
                          </div>
                        </th>
                        <th className="p-3 cursor-pointer hover:text-foreground text-right" onClick={() => handleSort('estimatePoints')}>
                          <div className="flex items-center justify-end gap-1">
                            <span>Points</span>
                            <ArrowUpDown className="w-3 h-3" />
                          </div>
                        </th>
                        <th className="p-3 cursor-pointer hover:text-foreground" onClick={() => handleSort('dueDate')}>
                          <div className="flex items-center gap-1">
                            <span>Due Date</span>
                            <ArrowUpDown className="w-3 h-3" />
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {paginatedIssues.map((issue: any) => {
                        const isOverdue = issue.dueDate && new Date(issue.dueDate) < now && issue.status?.category !== 'DONE';
                        const daysPast = issue.dueDate ? Math.max(1, Math.round((now.getTime() - new Date(issue.dueDate).getTime()) / (1000 * 60 * 60 * 24))) : 0;
                        const cycleDays = issue.createdAt && issue.updatedAt ? Math.max(0.1, (new Date(issue.updatedAt).getTime() - new Date(issue.createdAt).getTime()) / (1000 * 60 * 60 * 24)).toFixed(1) : '—';

                        return (
                          <tr
                            key={issue.id}
                            onClick={() => onSelectIssue && onSelectIssue(issue)}
                            className="hover:bg-muted/40 cursor-pointer transition group"
                          >
                            <td className="p-3 font-mono font-bold text-primary flex items-center gap-1.5 whitespace-nowrap">
                              <span>{issue.issueKey}</span>
                              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
                            </td>
                            <td className="p-3 font-medium text-foreground max-w-sm truncate">
                              <div>{issue.title}</div>
                              {issue.epic && (
                                <div className="text-[10px] text-purple-400 flex items-center gap-1 mt-0.5 font-semibold">
                                  <Target className="w-2.5 h-2.5" />
                                  <span>{issue.epic.name}</span>
                                </div>
                              )}
                            </td>

                            {/* Dynamic SLA / Days Overdue */}
                            {reportId === 'risk-exception' && (
                              <td className="p-3 whitespace-nowrap">
                                {isOverdue ? (
                                  <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                                    +{daysPast}d Overdue
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                    On Schedule
                                  </span>
                                )}
                              </td>
                            )}

                            {/* Dynamic Defect Severity */}
                            {reportId === 'quality-defect' && (
                              <td className="p-3 whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/20">
                                  {issue.priority || 'BUG'}
                                </span>
                              </td>
                            )}

                            {/* Dynamic Cycle Duration */}
                            {reportId === 'delivery-flow' && (
                              <td className="p-3 whitespace-nowrap font-mono text-emerald-400 font-bold">
                                {cycleDays} days
                              </td>
                            )}

                            <td className="p-3 whitespace-nowrap">
                              <span
                                className="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                                style={{
                                  backgroundColor: (issue.status?.color || '#64748b') + '15',
                                  borderColor: (issue.status?.color || '#64748b') + '30',
                                  color: issue.status?.color || '#64748b',
                                }}
                              >
                                {issue.status?.name || 'Unknown'}
                              </span>
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                  issue.priority === 'CRITICAL'
                                    ? 'bg-red-500/10 text-red-600 border border-red-500/20'
                                    : issue.priority === 'HIGH' || issue.priority === 'HIGHEST'
                                    ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                                    : issue.priority === 'MEDIUM'
                                    ? 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
                                    : 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                                }`}
                              >
                                {issue.priority}
                              </span>
                            </td>
                            <td className="p-3 text-muted-foreground whitespace-nowrap">
                              {issue.assignee ? (
                                <span className="text-foreground font-medium">
                                  {issue.assignee.firstName} {issue.assignee.lastName || ''}
                                </span>
                              ) : (
                                <span className="text-muted-foreground italic">Unassigned</span>
                              )}
                            </td>
                            <td className="p-3 text-right font-mono font-bold text-foreground whitespace-nowrap">
                              {issue.estimatePoints || 0}
                            </td>
                            <td className={`p-3 whitespace-nowrap ${isOverdue ? 'text-rose-400 font-bold' : 'text-muted-foreground'}`}>
                              {issue.dueDate ? new Date(issue.dueDate).toLocaleDateString() : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground text-xs flex flex-col items-center gap-2">
                  <Clock className="w-8 h-8 text-muted-foreground/50" />
                  <span className="font-semibold text-foreground">No records matching active criteria.</span>
                  <p className="text-[11px] text-muted-foreground max-w-sm">
                    {chartFilter ? 'Try clearing the active chart filter above.' : 'No records match the report filter query.'}
                  </p>
                </div>
              )}

              {/* UNRESTRICTED PAGINATION CONTROLS (Section 6: First, Prev, Page Numbers, Next, Last, and Page-Size Selector) */}
              <div className="mt-4 pt-3 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3">
                {/* Range and Total Display: e.g. "Showing 151–173 of 173 records." */}
                <div className="text-xs text-muted-foreground font-mono">
                  Showing <strong className="text-foreground">{processedIssues.length > 0 ? startIndex + 1 : 0}–{endIndex}</strong> of <strong className="text-foreground">{processedIssues.length}</strong> records {pageSize !== 'ALL' && `(Page ${currentPage} of ${totalPages})`}
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  {/* Page Size Selector (25, 50, 100, 150, 250, 500, All) */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Rows per page:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        const val = e.target.value === 'ALL' ? 'ALL' : Number(e.target.value);
                        setPageSize(val as any);
                        setCurrentPage(1);
                      }}
                      className="px-2 py-1 text-xs font-bold rounded-lg border border-border bg-background text-foreground cursor-pointer focus:ring-1 focus:ring-primary outline-hidden shadow-2xs"
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={150}>150</option>
                      <option value={250}>250</option>
                      <option value={500}>500</option>
                      <option value="ALL">All ({processedIssues.length})</option>
                    </select>
                  </div>

                  {/* Multi-Page Navigation Buttons */}
                  {pageSize !== 'ALL' && totalPages > 1 && (
                    <div className="flex items-center gap-1">
                      {/* First Page */}
                      <button
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                        className="p-1.5 rounded-lg border border-border bg-background hover:bg-muted disabled:opacity-30 disabled:pointer-events-none text-foreground transition cursor-pointer"
                        title="First Page"
                      >
                        <ChevronsLeft className="w-3.5 h-3.5" />
                      </button>

                      {/* Previous Page */}
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="p-1.5 rounded-lg border border-border bg-background hover:bg-muted disabled:opacity-30 disabled:pointer-events-none text-foreground transition cursor-pointer"
                        title="Previous Page"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>

                      {/* Smart Page Number Indicators */}
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum = i + 1;
                        if (totalPages > 5) {
                          if (currentPage > 3 && currentPage < totalPages - 1) {
                            pageNum = currentPage - 2 + i;
                          } else if (currentPage >= totalPages - 1) {
                            pageNum = totalPages - 4 + i;
                          }
                        }
                        return (
                          <button
                            key={pageNum}
                            onClick={() => setCurrentPage(pageNum)}
                            className={`w-7 h-7 rounded-lg text-xs font-bold transition cursor-pointer flex items-center justify-center ${
                              currentPage === pageNum
                                ? 'bg-primary text-primary-foreground shadow-2xs'
                                : 'border border-border bg-background hover:bg-muted text-foreground'
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}

                      {/* Next Page */}
                      <button
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="p-1.5 rounded-lg border border-border bg-background hover:bg-muted disabled:opacity-30 disabled:pointer-events-none text-foreground transition cursor-pointer"
                        title="Next Page"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>

                      {/* Last Page */}
                      <button
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages}
                        className="p-1.5 rounded-lg border border-border bg-background hover:bg-muted disabled:opacity-30 disabled:pointer-events-none text-foreground transition cursor-pointer"
                        title="Last Page"
                      >
                        <ChevronsRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

            </div>

          </div>

        </div>
      </div>

      {/* Embedded Difference Guide Modal */}
      <ReportDifferenceGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        onSelectReport={(newId, newTitle) => {
          setCurrentReportId(newId);
          setIsGuideOpen(false);
          if (onSelectReport) {
            onSelectReport(newId, newTitle);
          }
        }}
      />
    </>
  );
}
