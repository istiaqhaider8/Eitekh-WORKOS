"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  FileText,
  Printer,
  Download,
  BarChart2,
  PieChart,
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Users,
  Target,
  ShieldAlert,
  Search,
  Filter,
  Calendar,
  ChevronRight,
  ArrowUpRight,
  Sparkles,
  RefreshCw,
  FolderGit2,
  ChevronDown,
  Layers,
  Flame,
  Check,
  ArrowRight,
  Briefcase,
  FileSpreadsheet,
  FileCode,
  Lock,
  Compass,
  Zap,
  Activity,
  CalendarDays,
  Bug,
  History,
  Eye,
  HelpCircle,
  ShieldCheck
} from "lucide-react";
import { AnalyticsDrillDownModal } from "@/components/analytics/AnalyticsDrillDownModal";
import { ReportViewModal } from "@/components/analytics/ReportViewModal";
import { ReportDifferenceGuideModal } from "@/components/analytics/ReportDifferenceGuideModal";

interface DashboardViewProps {
  issues?: any[];
  statuses?: any[];
  priorities?: any[];
  sprints?: any[];
  teams?: any[];
  members?: any[];
  projects?: any[];
  projectId?: string;
  projectName?: string;
  currentUser?: any;
  onOpenCharts?: () => void;
  onCreateIssue?: () => void;
  onSelectView?: (view: string) => void;
  onSelectIssue?: (issue: any) => void;
  onSelectProject?: (projectId: string) => void;
  onRefresh?: () => void;
}

type MainTab =
  | "catalog"
  | "executive"
  | "progress"
  | "sprint"
  | "team"
  | "quality"
  | "risk";

export const REPORT_CATALOG = [
  {
    category: "Executive & Portfolio",
    icon: Briefcase,
    reports: [
      {
        id: "project-overview",
        name: "Project Executive Overview",
        desc: "Comprehensive executive snapshot of project health, scope delivery, milestones, and strategic risks.",
        question: "Are we on track to deliver our project objectives?",
        metrics: ["Overall Completion %", "Burned Points", "Active WIP", "At-Risk Items"],
        tags: ["Executive", "Milestones", "Health"],
      },
      {
        id: "work-portfolio",
        name: "Work Portfolio Analysis",
        desc: "Consolidated breakdown of work items across statuses, priorities, issue types, epics, and teams.",
        question: "What does our total backlog & active work look like?",
        metrics: ["Total Scope Items", "WIP Pipeline", "Delivered Scope", "Unassigned Scope"],
        tags: ["Portfolio", "Priority Breakdown", "Type Distribution"],
      },
    ]
  },
  {
    category: "Sprint & Delivery",
    icon: Flame,
    reports: [
      {
        id: "sprint-performance",
        name: "Sprint Performance",
        desc: "Iteration velocity, committed vs delivered points, burndown trajectory, scope creep, and carryover analysis.",
        question: "Did the team deliver what was committed for this sprint?",
        metrics: ["Committed Scope", "Delivered Points", "Remaining In-Flight", "Velocity Pace %"],
        tags: ["Velocity", "Burndown", "Sprint Delivery"],
      },
      {
        id: "delivery-flow",
        name: "Delivery & Flow Analysis",
        desc: "End-to-end throughput, average cycle time, backlog lead time, work-in-progress (WIP), and process bottlenecks.",
        question: "How fast do items move from start to finish?",
        metrics: ["Avg Cycle Time (days)", "Throughput Delivered", "WIP Limit Depth", "Intake Pace"],
        tags: ["Cycle Time", "Lead Time", "Throughput"],
      },
    ]
  },
  {
    category: "Team & Quality",
    icon: Users,
    reports: [
      {
        id: "team-capacity",
        name: "Team Performance & Capacity",
        desc: "Capacity utilization, individual workload distribution, team throughput, and unassigned work allocation.",
        question: "Who has capacity and what work remains unassigned?",
        metrics: ["Active Contributors", "Assigned Workload (pts)", "Utilization %", "Unassigned Scope"],
        tags: ["Capacity", "Utilization", "Workload"],
      },
      {
        id: "quality-defect",
        name: "Quality & Defect Analysis",
        desc: "Defect intake vs resolution rate, severity distribution, reopen rates, and software stability metrics.",
        question: "How stable is the product and what is our bug resolution pace?",
        metrics: ["Total Defects", "Critical / High Bugs", "Verified Fixes", "Resolution Rate %"],
        tags: ["Defects", "Severity Triage", "Stability"],
      },
    ]
  },
  {
    category: "Risk & Planning",
    icon: AlertTriangle,
    reports: [
      {
        id: "risk-exception",
        name: "Risk & Exception Report",
        desc: "Actionable register of overdue deliverables, blocked dependencies, critical SLA breaches, and delivery risks.",
        question: "What items are overdue or blocked by dependencies right now?",
        metrics: ["Overdue Deliverables", "Blocked Tasks", "Critical Open Items", "Points at Risk"],
        tags: ["Overdue SLA", "Blockers", "Exceptions"],
      },
      {
        id: "backlog-planning",
        name: "Backlog & Planning Analysis",
        desc: "Backlog grooming readiness, estimation coverage, unassigned items, aging, and sprint readiness.",
        question: "Is our backlog estimated and ready for iteration intake?",
        metrics: ["Backlog Items", "Estimation Coverage %", "Unassigned Tasks", "Sprint Ready Scope"],
        tags: ["Backlog", "Estimation", "Refinement"],
      },
      {
        id: "roadmap-milestones",
        name: "Roadmap & Milestone Status",
        desc: "Strategic epics burnup, release milestone progress, schedule deadlines, and initiative roadmaps.",
        question: "How far along are our strategic epics and milestones?",
        metrics: ["Active Epics", "Linked Work Items", "Burnup Pace %", "Delivered Scope"],
        tags: ["Roadmap", "Strategic Epics", "Milestones"],
      },
    ]
  },
  {
    category: "Audit & Governance",
    icon: History,
    reports: [
      {
        id: "project-activity",
        name: "Project Activity & Audit",
        desc: "Complete traceability audit trail of status changes, reassignments, priority updates, and system events.",
        question: "Who changed what and is there a verifiable audit trail?",
        metrics: ["Tracked System Events", "Audited Work Items", "Modified Tasks", "Ledger Integrity 100%"],
        tags: ["Audit Trail", "Traceability", "Governance"],
      },
    ]
  }
];

export function DashboardView({
  issues = [],
  statuses = [],
  priorities = [],
  sprints = [],
  teams = [],
  members = [],
  projects = [],
  projectId,
  projectName = "Current Project",
  currentUser,
  onOpenCharts,
  onCreateIssue,
  onSelectView,
  onSelectIssue,
  onSelectProject,
  onRefresh,
}: DashboardViewProps) {
  const [activeTab, setActiveTab] = useState<MainTab>("catalog");
  const [timeRange, setTimeRange] = useState<string>("ALL");
  const [selectedSprintId, setSelectedSprintId] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [catalogSearch, setCatalogSearch] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [apiData, setApiData] = useState<any>(null);
  const [sprintChartMode, setSprintChartMode] = useState<"burndown" | "burnup" | "breakdown">("burndown");
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  // Drill-down Modal State
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
    title: "",
    issues: [],
  });

  // Report View Modal State
  const [reportModal, setReportModal] = useState<{
    isOpen: boolean;
    reportType: string;
    reportTitle: string;
    reportCategory: string;
    reportDescription: string;
    issues: any[];
  }>({
    isOpen: false,
    reportType: "project-overview",
    reportTitle: "",
    reportCategory: "",
    reportDescription: "",
    issues: [],
  });

  const [isGuideOpen, setIsGuideOpen] = useState<boolean>(false);

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

  // Fetch real analytics and report data from backend API
  const fetchReportData = async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedSprintId !== "ALL") params.set("sprintId", selectedSprintId);
      if (timeRange !== "ALL") params.set("timeRange", timeRange);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const res = await fetch(`/api/projects/${projectId}/analytics?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setApiData(json);
        setLastRefreshed(new Date());
      }
    } catch (err) {
      console.error("Error fetching report data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, [projectId, selectedSprintId, timeRange]);

  // Derived filtered issues
  const activeIssues = useMemo(() => {
    if (apiData && apiData.filteredIssues) {
      return apiData.filteredIssues;
    }
    return issues.filter((i: any) => {
      if (selectedSprintId !== "ALL" && i.sprintId !== selectedSprintId) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const key = (i.issueKey || "").toLowerCase();
        const title = (i.title || "").toLowerCase();
        if (!key.includes(q) && !title.includes(q)) return false;
      }
      return true;
    });
  }, [apiData, issues, selectedSprintId, searchQuery]);

  const totalIssues = activeIssues.length;
  const completedIssues = activeIssues.filter(
    (i: any) => i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done")
  );
  const inProgressIssues = activeIssues.filter(
    (i: any) => i.status?.category === "IN_PROGRESS" || i.status?.category === "REVIEW"
  );
  const openIssues = activeIssues.filter(
    (i: any) => i.status?.category === "TO_DO" || (!i.status?.category && !completedIssues.includes(i) && !inProgressIssues.includes(i))
  );
  const overdueIssues = activeIssues.filter(
    (i: any) => i.dueDate && new Date(i.dueDate) < new Date() && i.status?.category !== "DONE"
  );
  const blockedIssues = activeIssues.filter(
    (i: any) =>
      i.status?.name?.toLowerCase().includes("block") ||
      (i.title && i.title.toLowerCase().includes("blocked")) ||
      (i.incomingDeps && i.incomingDeps.some((d: any) => d.type === "BLOCKS")) ||
      (i.outgoingDeps && i.outgoingDeps.some((d: any) => d.type === "BLOCKED_BY"))
  );

  const totalPoints = activeIssues.reduce((sum: number, i: any) => sum + (i.estimatePoints || 0), 0);
  const completedPoints = completedIssues.reduce((sum: number, i: any) => sum + (i.estimatePoints || 0), 0);
  const completionRate = totalIssues > 0 ? Math.round((completedIssues.length / totalIssues) * 100) : 0;
  const burnedPointsPct = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;

  // Active Sprint
  const activeSprint = sprints.find((s: any) => s.status === "ACTIVE") || null;

  // Report Download handler
  const handleDownloadReport = (reportType: string, format: "pdf" | "excel" | "csv") => {
    if (!projectId) return;
    const params = new URLSearchParams();
    params.set("reportType", reportType);
    params.set("format", format);
    if (selectedSprintId !== "ALL") params.set("sprintId", selectedSprintId);
    if (timeRange !== "ALL") params.set("timeRange", timeRange);
    if (searchQuery.trim()) params.set("search", searchQuery.trim());

    window.open(`/api/projects/${projectId}/reports/download?${params.toString()}`, "_blank");
  };

  // Open Preview Modal
  const openReportModal = (report: any, categoryName: string) => {
    let reportIssues = activeIssues;
    if (report.id === "overdue-issues") reportIssues = overdueIssues;
    else if (report.id === "blocked-issues") reportIssues = blockedIssues;
    else if (report.id === "bug-defect") reportIssues = activeIssues.filter((i: any) => i.issueType === "BUG");
    else if (report.id === "sprint-report" && activeSprint) reportIssues = activeIssues.filter((i: any) => i.sprintId === activeSprint.id);

    setReportModal({
      isOpen: true,
      reportType: report.id,
      reportTitle: report.name,
      reportCategory: categoryName,
      reportDescription: report.desc,
      issues: reportIssues,
    });
  };

  // Filtered Catalog
  const filteredCatalog = useMemo(() => {
    return REPORT_CATALOG.map((cat) => {
      if (selectedCategory !== "ALL" && cat.category !== selectedCategory) {
        return null;
      }
      const matchingReports = cat.reports.filter((r) => {
        if (!catalogSearch.trim()) return true;
        const q = catalogSearch.toLowerCase();
        return r.name.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q);
      });
      if (matchingReports.length === 0) return null;
      return {
        ...cat,
        reports: matchingReports,
      };
    }).filter(Boolean);
  }, [selectedCategory, catalogSearch]);

  return (
    <div className="flex flex-col min-h-full bg-slate-50 dark:bg-slate-950 pb-20 print:bg-white print:p-0">
      {/* 1. Project Reports Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-300 dark:border-slate-800 px-6 py-5 sticky top-0 z-20 shadow-sm print:static print:border-none">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                  Project Reports Center &amp; Download Hub
                </h1>
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Real Database Data
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium text-slate-700 dark:text-slate-300">{projectName}</span>
                <span>•</span>
                <span>{totalIssues} Issues in Scope</span>
                <span>•</span>
                <span>Updated {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          </div>

          {/* Actions & Project Switcher */}
          <div className="flex items-center gap-2.5 flex-wrap print:hidden">
            {projects.length > 1 && onSelectProject && (
              <div className="relative">
                <select
                  value={projectId}
                  onChange={(e) => onSelectProject(e.target.value)}
                  className="pl-3 pr-8 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 focus:outline-hidden focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer"
                >
                  {projects.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.key})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            )}

            <button
              onClick={() => {
                fetchReportData();
                if (onRefresh) onRefresh();
              }}
              disabled={isLoading}
              className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              title="Refresh Report Data"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-blue-600" : ""}`} />
            </button>

            {onOpenCharts && (
              <button
                onClick={onOpenCharts}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition cursor-pointer"
              >
                <BarChart2 className="w-3.5 h-3.5" />
                <span>Visual Analytics Suite</span>
              </button>
            )}
          </div>
        </div>

        {/* Report Center Tabs */}
        <div className="max-w-7xl mx-auto mt-4 flex items-center justify-between border-t border-slate-300 dark:border-slate-800/80 pt-3 gap-3 overflow-x-auto print:hidden">
          <div className="flex items-center gap-1.5">
            {[
              { id: "catalog", label: "Download Reports Catalog", icon: Download },
              { id: "executive", label: "Executive Summary", icon: Briefcase },
              { id: "progress", label: "Progress & Milestones", icon: Target },
              { id: "sprint", label: "Sprint & Velocity", icon: Flame },
              { id: "team", label: "Team Workload", icon: Users },
              { id: "quality", label: "Quality & Status", icon: PieChart },
              { id: "risk", label: "Overdue & Risks", icon: ShieldAlert },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as MainTab)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                    isActive
                      ? "bg-slate-900 text-white dark:bg-blue-600 dark:text-white shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Quick Filters */}
          <div className="flex items-center gap-2 text-xs">
            <select
              value={selectedSprintId}
              onChange={(e) => setSelectedSprintId(e.target.value)}
              className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
            >
              <option value="ALL">All Sprints</option>
              {sprints.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.status})
                </option>
              ))}
            </select>

            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
            >
              <option value="ALL">All Time</option>
              <option value="7D">Last 7 Days</option>
              <option value="30D">Last 30 Days</option>
              <option value="90D">Last 90 Days</option>
            </select>
          </div>
        </div>
      </div>

      {copiedNotification && (
        <div className="max-w-7xl mx-auto px-6 mt-3 w-full">
          <div className="p-3 bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-md flex items-center gap-2">
            <Check className="w-4 h-4" />
            <span>{copiedNotification}</span>
          </div>
        </div>
      )}

      {/* Main Report Container */}
      <div className="max-w-7xl mx-auto px-6 mt-6 w-full space-y-6">
        {/* ============================================================ */}
        {/* TAB 0: DOWNLOAD REPORTS CATALOG (WORLD-CLASS REPORT CENTER) */}
        {/* ============================================================ */}
        {activeTab === "catalog" && (
          <div className="space-y-6">
            {/* Catalog Banner */}
            <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 rounded-2xl p-6 text-white shadow-lg">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <span className="px-2.5 py-0.5 rounded-full bg-white/20 text-white text-[10px] font-bold uppercase tracking-wider">
                    Enterprise Project Reporting & Analytics
                  </span>
                  <h2 className="text-2xl font-black mt-1">Enterprise Reports & Decision Center</h2>
                  <p className="text-xs text-blue-100 max-w-2xl mt-1">
                    10 canonical enterprise reports answering What is happening, How the project is performing, Why it is happening, and What needs attention.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setIsGuideOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl bg-white text-blue-700 hover:bg-blue-50 transition shadow-xs shrink-0 cursor-pointer"
                    title="Understand the exact purpose, data scope, and differences between all 10 reports"
                  >
                    <HelpCircle className="w-4 h-4" />
                    <span>What is the difference?</span>
                  </button>
                  <div className="text-right pl-3 border-l border-white/20">
                    <div className="text-2xl font-black leading-none">10</div>
                    <div className="text-[10px] text-blue-100 uppercase tracking-wider font-bold mt-0.5">Zero Duplication</div>
                  </div>
                </div>
              </div>

              {/* Filter & Search Bar */}
              <div className="mt-6 flex flex-col sm:flex-row items-center gap-3 bg-white/10 p-2 rounded-xl backdrop-blur-xs">
                <div className="relative flex-1 w-full">
                  <Search className="w-4 h-4 text-white/70 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder="Search canonical reports by name or business purpose..."
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-white/15 text-white placeholder:text-white/60 border border-white/20 focus:outline-hidden focus:bg-white/25 transition"
                  />
                </div>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full sm:w-auto px-3 py-2 text-xs font-semibold rounded-lg bg-white/20 text-white border border-white/20 focus:outline-hidden cursor-pointer"
                >
                  <option value="ALL" className="text-slate-900">All 5 Domains</option>
                  {REPORT_CATALOG.map((c) => (
                    <option key={c.category} value={c.category} className="text-slate-900">
                      {c.category}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Catalog Report Sections */}
            <div className="space-y-8">
              {filteredCatalog.map((cat: any) => {
                const Icon = cat.icon;
                return (
                  <div key={cat.category} className="space-y-3">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-300 dark:border-slate-800">
                      <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                        <Icon className="w-4 h-4" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                        {cat.category} ({cat.reports.length})
                      </h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
                      {cat.reports.map((report: any) => (
                        <div
                          key={report.id}
                          className="bg-card border border-border hover:border-primary/50 dark:hover:border-primary/40 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all duration-200 flex flex-col justify-between group relative overflow-hidden"
                        >
                          <div className="space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                                  <Icon className="w-4 h-4" />
                                </div>
                                <h4 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors leading-snug truncate">
                                  {report.name}
                                </h4>
                              </div>
                              <span className="px-2.5 py-0.5 text-[10px] font-extrabold rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
                                {cat.category}
                              </span>
                            </div>

                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {report.desc}
                            </p>

                            {/* Business Question Hook */}
                            {report.question && (
                              <div className="px-3 py-2 rounded-xl bg-muted/50 border border-border/60 text-[11px] text-muted-foreground flex items-center gap-2">
                                <HelpCircle className="w-3.5 h-3.5 text-primary shrink-0" />
                                <span className="italic font-medium text-foreground/90 leading-tight">"{report.question}"</span>
                              </div>
                            )}

                            {/* Tags & Key Metrics */}
                            <div className="flex items-center gap-1.5 flex-wrap pt-1">
                              {report.tags?.map((tag: string) => (
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
                              onClick={() => openReportModal(report, cat.category)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-2xs hover:shadow-xs active:scale-98 cursor-pointer shrink-0"
                              title="Open Full Enterprise Decision Support Report"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>View & Analyze Report</span>
                              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 1: EXECUTIVE PROJECT SUMMARY REPORT */}
        {/* ============================================================ */}
        {activeTab === "executive" && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl p-6 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-300 dark:border-slate-800">
                <div>
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Project Health Scorecard</span>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                    {projectName} Executive Overview
                  </h2>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-2xl font-black text-slate-900 dark:text-white">{completionRate}%</div>
                    <div className="text-xs text-slate-500">Overall Completed</div>
                  </div>
                  <div className="w-16 h-16 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 flex items-center justify-center font-bold text-sm text-emerald-600 dark:text-emerald-400">
                    {completionRate}%
                  </div>
                </div>
              </div>

              {/* KPI Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-6">
                {[
                  {
                    label: "Total Scope",
                    value: totalIssues,
                    sub: "All issues logged",
                    color: "border-blue-500/30",
                    onClick: () => openDrillDown({ title: "Total Project Scope", issues: activeIssues })
                  },
                  {
                    label: "Completed",
                    value: completedIssues.length,
                    sub: `${completionRate}% delivery`,
                    color: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
                    onClick: () => openDrillDown({ title: "Completed Work", issues: completedIssues })
                  },
                  {
                    label: "In Progress",
                    value: inProgressIssues.length,
                    sub: "Active execution",
                    color: "border-amber-500/30 text-amber-600 dark:text-amber-400",
                    onClick: () => openDrillDown({ title: "In Progress Work", issues: inProgressIssues })
                  },
                  {
                    label: "Open / To Do",
                    value: openIssues.length,
                    sub: "Ready in backlog",
                    color: "border-slate-500/30 text-slate-600 dark:text-slate-400",
                    onClick: () => openDrillDown({ title: "Open Issues", issues: openIssues })
                  },
                  {
                    label: "Total Story Pts",
                    value: totalPoints,
                    sub: `${completedPoints} pts burned`,
                    color: "border-purple-500/30 text-purple-600 dark:text-purple-400",
                    onClick: () => openDrillDown({ title: "Story Points Portfolio", issues: activeIssues })
                  },
                  {
                    label: "Overdue Items",
                    value: overdueIssues.length,
                    sub: overdueIssues.length > 0 ? "Requires action" : "On schedule",
                    color: overdueIssues.length > 0 ? "border-rose-500/30 text-rose-600 dark:text-rose-400" : "border-emerald-500/30 text-emerald-600",
                    onClick: () => openDrillDown({ title: "Overdue Tasks", issues: overdueIssues })
                  },
                ].map((kpi, idx) => (
                  <div
                    key={idx}
                    onClick={kpi.onClick}
                    className={`p-4 rounded-xl border ${kpi.color} bg-slate-50/50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition`}
                  >
                    <div className="text-xs font-medium text-slate-500">{kpi.label}</div>
                    <div className="text-xl font-bold mt-1 text-slate-900 dark:text-white">{kpi.value}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{kpi.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Delivery Progress */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Delivery Progress</h3>
                  <span className="text-xs font-medium text-slate-500">{completedIssues.length} of {totalIssues} items</span>
                </div>
                <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                  <div style={{ width: `${completionRate}%` }} className="bg-emerald-500 transition-all" />
                  <div style={{ width: `${totalIssues > 0 ? Math.round((inProgressIssues.length / totalIssues) * 100) : 0}%` }} className="bg-amber-500 transition-all" />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Done ({completionRate}%)</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> In Progress ({totalIssues > 0 ? Math.round((inProgressIssues.length / totalIssues) * 100) : 0}%)</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-700" /> To Do ({totalIssues > 0 ? Math.round((openIssues.length / totalIssues) * 100) : 0}%)</span>
                </div>

                <div className="mt-6 pt-5 border-t border-slate-300 dark:border-slate-800 space-y-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Story Points Burned</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{completedPoints} / {totalPoints} pts ({burnedPointsPct}%)</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div style={{ width: `${burnedPointsPct}%` }} className="bg-purple-600 h-full rounded-full" />
                  </div>
                </div>
              </div>

              {/* Active Sprint Highlights */}
              <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Active Sprint Status</h3>
                  {activeSprint ? (
                    <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      {activeSprint.name}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">No active sprint</span>
                  )}
                </div>

                {activeSprint ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                        <span className="text-slate-400">Sprint Issues</span>
                        <div className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                          {activeIssues.filter((i: any) => i.sprintId === activeSprint.id).length} items
                        </div>
                      </div>
                      <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                        <span className="text-slate-400">Sprint Points</span>
                        <div className="text-lg font-bold text-slate-900 dark:text-white mt-1">
                          {activeIssues.filter((i: any) => i.sprintId === activeSprint.id).reduce((s: number, i: any) => s + (i.estimatePoints || 0), 0)} pts
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-slate-500">
                      {activeSprint.startDate ? `Started ${new Date(activeSprint.startDate).toLocaleDateString()}` : ""}
                      {activeSprint.endDate ? ` • Target End ${new Date(activeSprint.endDate).toLocaleDateString()}` : ""}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-slate-400 text-xs">
                    Start a sprint in the Scrum & Backlog view to see live burndown and sprint velocity metrics.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 2: PROJECT PROGRESS & MILESTONES REPORT */}
        {/* ============================================================ */}
        {activeTab === "progress" && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-2">
                Milestones &amp; Epics Progress
              </h2>
              <p className="text-xs text-slate-500 mb-6">
                Status of all tracked project epics and release milestones based on real database deliverables.
              </p>

              <div className="space-y-4">
                {(apiData?.distributions?.byEpic || []).length > 0 ? (
                  apiData.distributions.byEpic.map((epic: any) => (
                    <div
                      key={epic.id}
                      onClick={() => openDrillDown({
                        title: `Epic: ${epic.name}`,
                        subtitle: `${epic.count} issues • ${epic.points} story points`,
                        issues: activeIssues.filter((i: any) => i.epicId === epic.id),
                      })}
                      className="p-4 rounded-xl border border-slate-300 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-500 bg-slate-50/50 dark:bg-slate-800/30 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: epic.color || "#8b5cf6" }} />
                          <span className="text-sm font-bold text-slate-900 dark:text-white">{epic.name}</span>
                        </div>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          {epic.completed} / {epic.count} Done ({epic.percentage}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${epic.percentage}%`, backgroundColor: epic.color || "#8b5cf6" }}
                          className="h-full rounded-full transition-all"
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-400 mt-2">
                        <span>{epic.points} Total Points</span>
                        <span>{epic.completed} Completed Tasks</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-10 text-slate-400 text-xs">
                    No epics found for this project. Create epics to track larger project initiatives.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 3: SPRINT & VELOCITY PERFORMANCE REPORT */}
        {/* ============================================================ */}
        {activeTab === "sprint" && (() => {
          const activeSp = apiData?.sprintAnalytics?.activeSprint || (activeSprint ? {
            id: activeSprint.id,
            name: activeSprint.name,
            status: activeSprint.status,
            goal: activeSprint.goal,
            startDate: activeSprint.startDate,
            endDate: activeSprint.endDate,
            totalIssues: activeIssues.filter((i: any) => i.sprintId === activeSprint.id).length,
            completedIssues: activeIssues.filter((i: any) => i.sprintId === activeSprint.id && (i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done"))).length,
            inProgressIssues: activeIssues.filter((i: any) => i.sprintId === activeSprint.id && (i.status?.category === "IN_PROGRESS" || i.status?.category === "REVIEW" || i.status?.category === "TESTING")).length,
            todoIssues: activeIssues.filter((i: any) => i.sprintId === activeSprint.id && (i.status?.category === "TO_DO" || (!i.status?.category && !i.status?.name?.toLowerCase().includes("done") && !i.status?.name?.toLowerCase().includes("prog")))).length,
            totalPoints: activeIssues.filter((i: any) => i.sprintId === activeSprint.id).reduce((s: number, i: any) => s + (i.estimatePoints || 0), 0),
            completedPoints: activeIssues.filter((i: any) => i.sprintId === activeSprint.id && (i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done"))).reduce((s: number, i: any) => s + (i.estimatePoints || 0), 0),
            inProgressPoints: activeIssues.filter((i: any) => i.sprintId === activeSprint.id && (i.status?.category === "IN_PROGRESS" || i.status?.category === "REVIEW" || i.status?.category === "TESTING")).reduce((s: number, i: any) => s + (i.estimatePoints || 0), 0),
            todoPoints: activeIssues.filter((i: any) => i.sprintId === activeSprint.id && (i.status?.category === "TO_DO" || (!i.status?.category && !i.status?.name?.toLowerCase().includes("done") && !i.status?.name?.toLowerCase().includes("prog")))).reduce((s: number, i: any) => s + (i.estimatePoints || 0), 0),
            completionRate: 0,
            burndown: apiData?.sprintAnalytics?.burndownPoints || [],
            burnup: apiData?.sprintAnalytics?.burnupPoints || [],
          } : null);

          if (activeSp && activeSp.totalPoints > 0) {
            activeSp.completionRate = Math.round((activeSp.completedPoints / activeSp.totalPoints) * 100);
          } else if (activeSp && activeSp.totalIssues > 0) {
            activeSp.completionRate = Math.round((activeSp.completedIssues / activeSp.totalIssues) * 100);
          }

          const allSpList: any[] = apiData?.sprintAnalytics?.allSprints || sprints.map((s: any) => {
            const sIssues = issues.filter((i: any) => i.sprintId === s.id);
            const doneIssues = sIssues.filter((i: any) => i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done"));
            const inProgIssues = sIssues.filter((i: any) => i.status?.category === "IN_PROGRESS" || i.status?.category === "REVIEW" || i.status?.category === "TESTING");
            const todoIssues = sIssues.length - doneIssues.length - inProgIssues.length;
            const plannedPts = sIssues.reduce((sum: number, i: any) => sum + (i.estimatePoints || 0), 0);
            const deliveredPts = doneIssues.reduce((sum: number, i: any) => sum + (i.estimatePoints || 0), 0);
            const inProgressPts = inProgIssues.reduce((sum: number, i: any) => sum + (i.estimatePoints || 0), 0);
            const todoPts = Math.max(0, plannedPts - deliveredPts - inProgressPts);
            const completionRate = plannedPts > 0 ? Math.round((deliveredPts / plannedPts) * 100) : sIssues.length > 0 ? Math.round((doneIssues.length / sIssues.length) * 100) : 0;
            return {
              id: s.id,
              name: s.name,
              status: s.status,
              goal: s.goal,
              startDate: s.startDate,
              endDate: s.endDate,
              totalIssues: sIssues.length,
              completedIssues: doneIssues.length,
              inProgressIssues: inProgIssues.length,
              todoIssues,
              plannedPts,
              deliveredPts,
              inProgressPts,
              todoPts,
              completionRate,
            };
          });

          const completedList = allSpList.filter((s) => s.status === "COMPLETED" || s.deliveredPts > 0);
          const avgVel = apiData?.sprintAnalytics?.avgVelocity || (completedList.length > 0 ? Math.round(completedList.reduce((sum: number, s: any) => sum + s.deliveredPts, 0) / completedList.length) : (activeSp?.completedPoints || 0));

          const burndownData = apiData?.sprintAnalytics?.burndownPoints || activeSp?.burndown || [];
          const burnupData = apiData?.sprintAnalytics?.burnupPoints || activeSp?.burnup || [];

          return (
            <div className="space-y-6">
              {/* Top Sprint & Velocity KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl p-5 shadow-xs">
                  <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold">
                    <span>Active Sprint Scope</span>
                    <Flame className="w-4 h-4 text-amber-500" />
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-2xl font-black text-slate-900 dark:text-white">
                      {activeSp ? `${activeSp.totalPoints} pts` : "0 pts"}
                    </span>
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      ({activeSp ? activeSp.totalIssues : 0} tasks)
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {activeSp ? `${activeSp.name} (${activeSp.completionRate}% Done)` : "No active sprint running"}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl p-5 shadow-xs">
                  <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold">
                    <span>Delivered Velocity</span>
                    <Zap className="w-4 h-4 text-indigo-500" />
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
                      {avgVel} pts
                    </span>
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      / sprint avg
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                    Across {completedList.length} completed &amp; active cycles
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl p-5 shadow-xs">
                  <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold">
                    <span>Commitment Delivery</span>
                    <Target className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                      {activeSp && activeSp.totalPoints > 0
                        ? `${Math.round((activeSp.completedPoints / activeSp.totalPoints) * 100)}%`
                        : "100%"}
                    </span>
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {activeSp ? `${activeSp.completedPoints} / ${activeSp.totalPoints} pts` : "0/0 pts"}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                    {activeSp?.completedIssues || 0} completed · {activeSp?.inProgressIssues || 0} in progress
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl p-5 shadow-xs">
                  <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-semibold">
                    <span>Remaining Workload</span>
                    <Clock className="w-4 h-4 text-blue-500" />
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-2xl font-black text-slate-900 dark:text-white">
                      {activeSp ? `${activeSp.todoPoints + activeSp.inProgressPoints} pts` : "0 pts"}
                    </span>
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                      ({activeSp ? activeSp.todoIssues + activeSp.inProgressIssues : 0} open)
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {activeSp?.endDate ? `Target End: ${new Date(activeSp.endDate).toLocaleDateString()}` : "Scheduled iteration scope"}
                  </div>
                </div>
              </div>

              {/* Active Sprint Deep Dive & Burndown/Burnup Visualizer */}
              {activeSp ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-300 dark:border-slate-800 pb-5">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          <span>{activeSp.name}</span>
                          <span className="px-2.5 py-0.5 text-[10px] font-black uppercase rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
                            {activeSp.status || "ACTIVE"}
                          </span>
                        </h2>
                      </div>
                      {activeSp.goal && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">
                          Goal: {activeSp.goal}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => openDrillDown({
                          title: `Active Sprint: ${activeSp.name}`,
                          subtitle: `${activeSp.totalIssues} issues • ${activeSp.totalPoints} total story points`,
                          category: "Sprint Scope",
                          metricLabel: `${activeSp.completedPoints}/${activeSp.totalPoints} pts`,
                          percentage: activeSp.completionRate,
                          issues: activeIssues.filter((i: any) => i.sprintId === activeSp.id),
                        })}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5 text-blue-500" />
                        <span>Inspect All {activeSp.totalIssues} Tasks</span>
                      </button>

                      {onSelectView && (
                        <button
                          onClick={() => onSelectView("scrum")}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white transition cursor-pointer"
                        >
                          <Flame className="w-3.5 h-3.5 text-amber-400" />
                          <span>Open Scrum Board</span>
                        </button>
                      )}

                      <button
                        onClick={() => handleDownloadReport("sprint-report", "pdf")}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download Sprint Report</span>
                      </button>
                    </div>
                  </div>

                  {/* 3-Phase Multi-Color Progress Bar */}
                  <div>
                    <div className="flex items-center justify-between text-xs font-semibold mb-2">
                      <div className="flex items-center gap-4">
                        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500" />
                          {activeSp.completedIssues} Done ({activeSp.completedPoints} pts)
                        </span>
                        <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-xs bg-blue-500" />
                          {activeSp.inProgressIssues} In Progress ({activeSp.inProgressPoints} pts)
                        </span>
                        <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-xs bg-slate-300 dark:bg-slate-700" />
                          {activeSp.todoIssues} To Do ({activeSp.todoPoints} pts)
                        </span>
                      </div>
                      <span className="font-bold text-slate-900 dark:text-white font-mono">
                        {activeSp.completionRate}% Completed
                      </span>
                    </div>

                    <div className="w-full h-3.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex shadow-inner">
                      <div
                        style={{
                          width: `${activeSp.totalPoints > 0 ? (activeSp.completedPoints / activeSp.totalPoints) * 100 : (activeSp.completedIssues / Math.max(1, activeSp.totalIssues)) * 100}%`,
                        }}
                        className="bg-emerald-500 h-full transition-all duration-300"
                        title={`Done: ${activeSp.completedIssues} tasks`}
                      />
                      <div
                        style={{
                          width: `${activeSp.totalPoints > 0 ? (activeSp.inProgressPoints / activeSp.totalPoints) * 100 : (activeSp.inProgressIssues / Math.max(1, activeSp.totalIssues)) * 100}%`,
                        }}
                        className="bg-blue-500 h-full transition-all duration-300"
                        title={`In Progress: ${activeSp.inProgressIssues} tasks`}
                      />
                      <div
                        style={{
                          width: `${activeSp.totalPoints > 0 ? (activeSp.todoPoints / activeSp.totalPoints) * 100 : (activeSp.todoIssues / Math.max(1, activeSp.totalIssues)) * 100}%`,
                        }}
                        className="bg-slate-300 dark:bg-slate-700 h-full transition-all duration-300"
                        title={`To Do: ${activeSp.todoIssues} tasks`}
                      />
                    </div>
                  </div>

                  {/* Sub-View Switcher for Burndown / Burnup / Priority Breakdown */}
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between border-b border-slate-300 dark:border-slate-800 pb-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSprintChartMode("burndown")}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                            sprintChartMode === "burndown"
                              ? "bg-slate-900 text-white dark:bg-blue-600 dark:text-white"
                              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                          }`}
                        >
                          Burndown Trajectory
                        </button>
                        <button
                          onClick={() => setSprintChartMode("burnup")}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                            sprintChartMode === "burnup"
                              ? "bg-slate-900 text-white dark:bg-blue-600 dark:text-white"
                              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                          }`}
                        >
                          Burnup Scope
                        </button>
                        <button
                          onClick={() => setSprintChartMode("breakdown")}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                            sprintChartMode === "breakdown"
                              ? "bg-slate-900 text-white dark:bg-blue-600 dark:text-white"
                              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                          }`}
                        >
                          Priority &amp; Status Breakdown
                        </button>
                      </div>

                      <div className="text-[11px] text-slate-500 font-mono hidden sm:block">
                        Active Iteration Scope: {activeSp.totalPoints} pts · {activeSp.totalIssues} tasks
                      </div>
                    </div>

                    {/* Chart Mode 1: Burndown */}
                    {sprintChartMode === "burndown" && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>Story Points Remaining vs Ideal Burndown Curve</span>
                          <div className="flex items-center gap-4 text-[11px]">
                            <span className="flex items-center gap-1.5">
                              <span className="w-3 h-0.5 bg-slate-400 border-dashed" />
                              Ideal Trajectory
                            </span>
                            <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-semibold">
                              <span className="w-3 h-1 bg-blue-600 rounded-full" />
                              Actual Remaining
                            </span>
                          </div>
                        </div>

                        {burndownData.length > 0 ? (
                          <div className="grid grid-cols-8 gap-2 items-end h-44 pt-6 pb-2 border-b border-l border-slate-300 dark:border-slate-800 px-3">
                            {burndownData.map((pt: any, idx: number) => {
                              const maxVal = Math.max(...burndownData.map((p: any) => Math.max(p.ideal || 0, p.actual || 0)), 10);
                              const actualPct = Math.max(4, Math.round((pt.actual / maxVal) * 100));
                              const idealPct = Math.max(4, Math.round((pt.ideal / maxVal) * 100));

                              return (
                                <div key={idx} className="flex flex-col items-center justify-end h-full group relative">
                                  <div className="absolute -top-7 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-mono px-2 py-0.5 rounded pointer-events-none z-10 whitespace-nowrap">
                                    Actual: {pt.actual} pts | Ideal: {pt.ideal} pts
                                  </div>
                                  <div className="w-full flex items-end justify-center gap-1.5 h-full">
                                    <div
                                      style={{ height: `${idealPct}%` }}
                                      className="w-2 bg-slate-300 dark:bg-slate-700/60 rounded-t-sm"
                                      title={`Ideal: ${pt.ideal} pts`}
                                    />
                                    <div
                                      style={{ height: `${actualPct}%` }}
                                      className="w-4 bg-gradient-to-t from-blue-600 to-indigo-500 rounded-t-sm shadow-xs"
                                      title={`Actual: ${pt.actual} pts`}
                                    />
                                  </div>
                                  <span className="text-[10px] font-mono text-slate-400 mt-2">{pt.label}</span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="h-40 flex items-center justify-center text-xs text-slate-400">
                            Burndown trajectory data is calculating...
                          </div>
                        )}
                      </div>
                    )}

                    {/* Chart Mode 2: Burnup */}
                    {sprintChartMode === "burnup" && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>Accumulated Delivered Points vs Total Planned Scope</span>
                          <div className="flex items-center gap-4 text-[11px]">
                            <span className="flex items-center gap-1.5 text-slate-500">
                              <span className="w-3 h-0.5 bg-slate-400" />
                              Total Scope ({activeSp.totalPoints} pts)
                            </span>
                            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                              <span className="w-3 h-1 bg-emerald-500 rounded-full" />
                              Delivered ({activeSp.completedPoints} pts)
                            </span>
                          </div>
                        </div>

                        {burnupData.length > 0 ? (
                          <div className="grid grid-cols-8 gap-2 items-end h-44 pt-6 pb-2 border-b border-l border-slate-300 dark:border-slate-800 px-3">
                            {burnupData.map((pt: any, idx: number) => {
                              const maxVal = Math.max(...burnupData.map((p: any) => Math.max(p.totalScope || 0, p.completed || 0)), 10);
                              const scopePct = Math.max(4, Math.round((pt.totalScope / maxVal) * 100));
                              const compPct = Math.max(4, Math.round((pt.completed / maxVal) * 100));

                              return (
                                <div key={idx} className="flex flex-col items-center justify-end h-full group relative">
                                  <div className="absolute -top-7 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-mono px-2 py-0.5 rounded pointer-events-none z-10 whitespace-nowrap">
                                    Done: {pt.completed} pts / Scope: {pt.totalScope} pts
                                  </div>
                                  <div className="w-full flex items-end justify-center gap-1.5 h-full">
                                    <div
                                      style={{ height: `${scopePct}%` }}
                                      className="w-2 bg-slate-300 dark:bg-slate-700/60 rounded-t-sm"
                                      title={`Scope: ${pt.totalScope} pts`}
                                    />
                                    <div
                                      style={{ height: `${compPct}%` }}
                                      className="w-4 bg-gradient-to-t from-emerald-600 to-teal-500 rounded-t-sm shadow-xs"
                                      title={`Completed: ${pt.completed} pts`}
                                    />
                                  </div>
                                  <span className="text-[10px] font-mono text-slate-400 mt-2">{pt.label}</span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="h-40 flex items-center justify-center text-xs text-slate-400">
                            Burnup scope data is calculating...
                          </div>
                        )}
                      </div>
                    )}

                    {/* Chart Mode 3: Priority & Status Breakdown */}
                    {sprintChartMode === "breakdown" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                        <div className="p-4 rounded-xl border border-slate-300 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
                          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-3">Status Composition</h4>
                          <div className="space-y-2 text-xs">
                            <div className="flex justify-between items-center py-1 border-b border-slate-300 dark:border-slate-800">
                              <span className="text-slate-600 dark:text-slate-400 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-500" /> Completed
                              </span>
                              <span className="font-bold text-slate-900 dark:text-white font-mono">{activeSp.completedIssues} issues ({activeSp.completedPoints} pts)</span>
                            </div>
                            <div className="flex justify-between items-center py-1 border-b border-slate-300 dark:border-slate-800">
                              <span className="text-slate-600 dark:text-slate-400 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-blue-500" /> In Progress
                              </span>
                              <span className="font-bold text-slate-900 dark:text-white font-mono">{activeSp.inProgressIssues} issues ({activeSp.inProgressPoints} pts)</span>
                            </div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-slate-600 dark:text-slate-400 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-slate-400" /> To Do / Backlog
                              </span>
                              <span className="font-bold text-slate-900 dark:text-white font-mono">{activeSp.todoIssues} issues ({activeSp.todoPoints} pts)</span>
                            </div>
                          </div>
                        </div>

                        <div className="p-4 rounded-xl border border-slate-300 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 flex flex-col justify-between">
                          <div>
                            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">Iteration Efficiency</h4>
                            <p className="text-[11px] text-slate-500 mb-4">
                              {activeSp.completedIssues > 0
                                ? `Delivering at ${activeSp.completedPoints} story points across ${activeSp.completedIssues} completed tickets.`
                                : "No completed issues yet in this active iteration cycle."}
                            </p>
                          </div>
                          <button
                            onClick={() => openDrillDown({
                              title: `Tasks for ${activeSp.name}`,
                              subtitle: `${activeSp.totalIssues} total tasks • ${activeSp.totalPoints} story points`,
                              issues: activeIssues.filter((i: any) => i.sprintId === activeSp.id),
                            })}
                            className="w-full py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-lg transition"
                          >
                            Open Detailed Task Ledger
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl p-8 shadow-sm text-center">
                  <Flame className="w-8 h-8 text-amber-500 mx-auto mb-3" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">No Active Sprint</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1 mb-4">
                    There is currently no active sprint iteration in progress for this project. Start a sprint from the Backlog &amp; Scrum planning workspace.
                  </p>
                  {onSelectView && (
                    <button
                      onClick={() => onSelectView("scrum")}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition"
                    >
                      Go to Sprint &amp; Backlog Planning
                    </button>
                  )}
                </div>
              )}

              {/* Historical Sprint Velocity Bar Chart */}
              <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      Historical Sprint Velocity
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Story points delivered per sprint iteration to guide capacity forecasting.
                    </p>
                  </div>
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-3 py-1 rounded-full border border-indigo-200 dark:border-indigo-800">
                    Avg: {avgVel} pts / sprint
                  </span>
                </div>

                {allSpList.length > 0 ? (
                  <div className="space-y-4 pt-2">
                    {/* Visual Comparison Bars */}
                    <div className="h-44 w-full flex items-end justify-around pt-6 pb-2 border-b border-l border-slate-300 dark:border-slate-800 px-3">
                      {allSpList.slice(0, 8).map((sp: any, idx: number) => {
                        const maxVal = Math.max(...allSpList.map((s: any) => Math.max(s.plannedPts || 0, s.deliveredPts || 0)), 20);
                        const plannedHeight = Math.max(8, Math.round((sp.plannedPts / maxVal) * 100));
                        const deliveredHeight = Math.max(8, Math.round((sp.deliveredPts / maxVal) * 100));

                        return (
                          <div
                            key={sp.id || idx}
                            onClick={() => openDrillDown({
                              title: `Sprint: ${sp.name}`,
                              subtitle: `${sp.totalIssues} issues • ${sp.deliveredPts} / ${sp.plannedPts} points delivered`,
                              category: "Sprint Velocity",
                              metricLabel: `${sp.deliveredPts} pts delivered`,
                              percentage: sp.completionRate,
                              issues: issues.filter((i: any) => i.sprintId === sp.id),
                            })}
                            className="flex flex-col items-center justify-end h-full group cursor-pointer relative"
                          >
                            <div className="absolute -top-8 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-mono px-2 py-1 rounded pointer-events-none z-10 whitespace-nowrap shadow-lg">
                              {sp.name}: Delivered {sp.deliveredPts} pts / Planned {sp.plannedPts} pts ({sp.completionRate}%)
                            </div>
                            <div className="w-full flex items-end justify-center gap-1.5 h-full">
                              <div
                                style={{ height: `${plannedHeight}%` }}
                                className="w-2.5 bg-slate-200 dark:bg-slate-700/60 rounded-t-sm group-hover:bg-slate-300 dark:group-hover:bg-slate-600 transition"
                                title={`Planned: ${sp.plannedPts} pts`}
                              />
                              <div
                                style={{ height: `${deliveredHeight}%` }}
                                className={`w-5 rounded-t-sm shadow-xs transition group-hover:brightness-110 ${
                                  sp.status === "ACTIVE"
                                    ? "bg-gradient-to-t from-amber-500 to-yellow-400"
                                    : sp.deliveredPts > 0
                                    ? "bg-gradient-to-t from-indigo-600 to-blue-500"
                                    : "bg-slate-300 dark:bg-slate-700"
                                }`}
                                title={`Delivered: ${sp.deliveredPts} pts`}
                              />
                            </div>
                            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-2 max-w-[80px] truncate text-center">
                              {sp.name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-400 text-xs">
                    No sprint iterations found. Sprints created in the planning workspace will appear here.
                  </div>
                )}
              </div>

              {/* All Sprints Performance & Commitment Ledger Table */}
              <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      All Sprints &amp; Iteration Performance
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Detailed ledger of all project iterations, commitment completion, and story point throughput.
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-slate-500">
                    {allSpList.length} Total Sprints
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 border-b border-slate-300 dark:border-slate-800">
                      <tr>
                        <th className="p-3">Sprint Name</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Schedule / Dates</th>
                        <th className="p-3">Task Completion</th>
                        <th className="p-3">Delivered Points</th>
                        <th className="p-3">Progress</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {allSpList.map((sp: any) => (
                        <tr key={sp.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                          <td className="p-3 font-bold text-slate-900 dark:text-white">
                            <div>{sp.name}</div>
                            {sp.goal && <div className="text-[10px] text-slate-400 font-normal italic truncate max-w-xs">{sp.goal}</div>}
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] uppercase border ${
                              sp.status === "ACTIVE"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-400 dark:border-emerald-800"
                                : sp.status === "COMPLETED"
                                ? "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/80 dark:text-blue-400 dark:border-blue-800"
                                : "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
                            }`}>
                              {sp.status}
                            </span>
                          </td>
                          <td className="p-3 text-slate-500 font-mono text-[11px]">
                            {sp.startDate && sp.endDate
                              ? `${new Date(sp.startDate).toLocaleDateString()} - ${new Date(sp.endDate).toLocaleDateString()}`
                              : "No dates set"}
                          </td>
                          <td className="p-3 text-slate-700 dark:text-slate-300">
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{sp.completedIssues}</span>
                            <span className="text-slate-400"> / {sp.totalIssues} tasks</span>
                          </td>
                          <td className="p-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {sp.deliveredPts} <span className="text-slate-400 font-normal">/ {sp.plannedPts} pts</span>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div
                                  style={{ width: `${Math.min(100, sp.completionRate)}%` }}
                                  className="h-full bg-indigo-500 rounded-full"
                                />
                              </div>
                              <span className="font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                {sp.completionRate}%
                              </span>
                            </div>
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => openDrillDown({
                                  title: `Sprint: ${sp.name}`,
                                  subtitle: `${sp.totalIssues} issues • ${sp.deliveredPts} pts delivered`,
                                  issues: issues.filter((i: any) => i.sprintId === sp.id),
                                })}
                                className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition"
                              >
                                View Tasks
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedSprintId(sp.id);
                                  handleDownloadReport("sprint-report", "csv");
                                }}
                                className="px-2 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-lg transition"
                                title="Download CSV"
                              >
                                CSV
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Sprint Reports Download & Export Hub */}
              <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Download className="w-4 h-4 text-blue-500" />
                      <span>Sprint Reports &amp; Downloads Hub</span>
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Export sprint data, burndown metrics, and velocity history in PDF, Excel, or CSV formats.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    { id: "sprint-report", name: "Sprint Report", desc: "Active iteration committed scope, delivery pace, and carryover items." },
                    { id: "sprint-burndown", name: "Sprint Burndown Report", desc: "Day-by-day remaining story points trajectory versus ideal slope." },
                    { id: "sprint-burnup", name: "Sprint Burnup Report", desc: "Total scope growth vs completed delivered story points curve." },
                    { id: "sprint-velocity", name: "Historical Sprint Velocity Report", desc: "Delivered story point throughput across completed iterations." },
                    { id: "sprint-comparison", name: "Sprint Comparison Report", desc: "Side-by-side efficiency and velocity metrics across all project sprints." },
                  ].map((rep) => (
                    <div
                      key={rep.id}
                      className="p-4 rounded-xl border border-slate-300 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 flex flex-col justify-between space-y-3"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-900 dark:text-white">{rep.name}</div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{rep.desc}</p>
                      </div>
                      <div className="flex items-center gap-1.5 pt-2 border-t border-slate-300 dark:border-slate-800">
                        <button
                          onClick={() => handleDownloadReport(rep.id, "pdf")}
                          className="flex-1 py-1.5 px-2 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-[11px] font-bold rounded-lg transition text-center"
                        >
                          PDF
                        </button>
                        <button
                          onClick={() => handleDownloadReport(rep.id, "excel")}
                          className="flex-1 py-1.5 px-2 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold rounded-lg transition text-center"
                        >
                          Excel
                        </button>
                        <button
                          onClick={() => handleDownloadReport(rep.id, "csv")}
                          className="flex-1 py-1.5 px-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-[11px] font-bold rounded-lg transition text-center"
                        >
                          CSV
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* TAB 4: TEAM WORKLOAD & CAPACITY REPORT */}
        {/* ============================================================ */}
        {activeTab === "team" && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-2">
                Team Member Capacity &amp; Allocation
              </h2>
              <p className="text-xs text-slate-500 mb-6">
                Active task allocation, completed output, and capacity utilization across contributors.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 border-b border-slate-300 dark:border-slate-800">
                    <tr>
                      <th className="p-3">Team Member</th>
                      <th className="p-3">Assigned Tasks</th>
                      <th className="p-3">Completed</th>
                      <th className="p-3">Story Points</th>
                      <th className="p-3">Completion Rate</th>
                      <th className="p-3">Capacity Utilization</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(apiData?.distributions?.byAssignee || []).map((m: any) => (
                      <tr
                        key={m.userId}
                        onClick={() => openDrillDown({
                          title: `Tasks for ${m.name}`,
                          subtitle: `${m.total} tasks assigned • ${m.points} pts`,
                          issues: activeIssues.filter((i: any) => (m.userId === "UNASSIGNED" ? !i.assigneeId : i.assigneeId === m.userId)),
                        })}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition"
                      >
                        <td className="p-3 font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                          <span className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 flex items-center justify-center font-bold text-xs">
                            {m.avatar}
                          </span>
                          <span>{m.name}</span>
                        </td>
                        <td className="p-3 text-slate-600 dark:text-slate-300">{m.total} items</td>
                        <td className="p-3 text-emerald-600 dark:text-emerald-400 font-medium">{m.completed} items</td>
                        <td className="p-3 font-bold text-slate-900 dark:text-white">{m.points} pts</td>
                        <td className="p-3">
                          <span className="font-semibold text-slate-700 dark:text-slate-300">{m.completionRate}%</span>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                              <div
                                style={{ width: `${Math.min(100, m.utilization)}%` }}
                                className={`h-full rounded-full ${
                                  m.utilization > 100
                                    ? "bg-rose-500"
                                    : m.utilization >= 80
                                    ? "bg-amber-500"
                                    : "bg-emerald-500"
                                }`}
                              />
                            </div>
                            <span className="text-slate-500 font-mono text-xs">{m.utilization}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 5: STATUS & PRIORITY ANALYSIS */}
        {/* ============================================================ */}
        {activeTab === "quality" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">
                Workflow Status Breakdown
              </h2>
              <div className="space-y-3">
                {(apiData?.distributions?.byStatus || []).map((s: any) => (
                  <div
                    key={s.id}
                    onClick={() => openDrillDown({
                      title: `Status: ${s.name}`,
                      subtitle: `${s.count} issues with status ${s.name}`,
                      issues: activeIssues.filter((i: any) => i.statusId === s.id),
                    })}
                    className="p-3 rounded-lg border border-slate-300 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{s.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="font-bold text-slate-900 dark:text-white">{s.count} items</span>
                      <span className="text-slate-400">({s.percentage}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">
                Priority Distribution
              </h2>
              <div className="space-y-3">
                {(apiData?.distributions?.byPriority || []).map((p: any) => (
                  <div
                    key={p.priority}
                    onClick={() => openDrillDown({
                      title: `Priority: ${p.label}`,
                      subtitle: `${p.count} issues marked ${p.label}`,
                      issues: activeIssues.filter((i: any) => (i.priority || "MEDIUM").toUpperCase() === p.priority),
                    })}
                    className="p-3 rounded-lg border border-slate-300 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{p.label}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="font-bold text-slate-900 dark:text-white">{p.count} items</span>
                      <span className="text-slate-400">({p.percentage}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 6: OVERDUE & RISK ASSESSMENT REPORT */}
        {/* ============================================================ */}
        {activeTab === "risk" && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900 border border-rose-200/80 dark:border-rose-900/40 rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between pb-4 border-b border-rose-100 dark:border-rose-950">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-xl">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      Overdue &amp; Risk Assessment
                    </h2>
                    <p className="text-xs text-slate-500">
                      Identifies unfinished tasks past their due date, unassigned items, and critical defects.
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-black text-rose-600 dark:text-rose-400">{overdueIssues.length}</div>
                  <div className="text-xs text-slate-400">Overdue Tasks</div>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {overdueIssues.length > 0 ? (
                  overdueIssues.map((issue: any) => (
                    <div
                      key={issue.id}
                      onClick={() => onSelectIssue && onSelectIssue(issue)}
                      className="p-3.5 rounded-lg border border-slate-300 dark:border-slate-800 hover:border-rose-400 bg-slate-50/50 dark:bg-slate-800/40 cursor-pointer transition flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                            {issue.issueKey}
                          </span>
                          <span className="text-xs font-semibold text-slate-900 dark:text-white">
                            {issue.title}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          Assignee: {issue.assignee ? `${issue.assignee.firstName} ${issue.assignee.lastName}` : "Unassigned"} • Due Date: {new Date(issue.dueDate).toLocaleDateString()}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 text-xs font-bold rounded bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
                        {issue.priority}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex flex-col items-center gap-2">
                    <CheckCircle2 className="w-8 h-8" />
                    <span>Great job! No overdue tasks detected for this project.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Drill-Down Modal */}
      <AnalyticsDrillDownModal
        isOpen={drillDownModal.isOpen}
        onClose={() => setDrillDownModal((prev) => ({ ...prev, isOpen: false }))}
        title={drillDownModal.title}
        subtitle={drillDownModal.subtitle}
        category={drillDownModal.category}
        metricLabel={drillDownModal.metricLabel}
        percentage={drillDownModal.percentage}
        issues={drillDownModal.issues}
        projectName={projectName}
        onSelectIssue={onSelectIssue}
      />

      {/* Report View Modal */}
      <ReportViewModal
        isOpen={reportModal.isOpen}
        onClose={() => setReportModal((prev) => ({ ...prev, isOpen: false }))}
        reportType={reportModal.reportType}
        reportTitle={reportModal.reportTitle}
        reportCategory={reportModal.reportCategory}
        reportDescription={reportModal.reportDescription}
        issues={reportModal.issues}
        projectName={projectName}
        projectId={projectId}
        activeFilters={{
          sprintId: selectedSprintId,
          timeRange,
        }}
        onSelectIssue={onSelectIssue}
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
            openReportModal(found, '');
          }
        }}
      />
    </div>
  );
}
