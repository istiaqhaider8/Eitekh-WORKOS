"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  RotateCcw,
  CheckSquare,
  AlertCircle,
  Bookmark,
  Zap,
  Flame,
  TrendingUp,
  Sparkles,
  Users,
  Calendar,
  Plus,
  X,
  Check,
  Loader2,
  ExternalLink,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";

import { isDelegationActive } from "@/lib/delegation-engine";
import { isIssueDone, getIssueKeyClass } from "@/lib/designSystem";

interface ListViewProps {
  issues: any[];
  statuses: any[];
  priorities?: any[];
  members?: any[];
  teams?: any[];
  epics?: any[];
  delegations?: any[];
  currentUser?: any;
  canCreateIssue?: boolean;
  onSelectIssue: (issue: any) => void;
  onUpdateIssueStatus: (issueId: string, statusId: string) => void;
  onUpdateIssuePriority?: (issueId: string, priority: string) => void;
  onQuickCreateIssue?: (payload: {
    statusId: string;
    title: string;
    issueType?: string;
    priority?: string;
    assigneeId?: string;
    estimatePoints?: number;
    teamId?: string;
    dueDate?: string;
  }) => Promise<void> | void;
  onOpenCreateModal?: (defaultStatusId?: string, defaultTitle?: string) => void;
}

const DEFAULT_PRIORITIES = [
  { name: "Critical", value: "CRITICAL", color: "#f43f5e" },
  { name: "Highest", value: "HIGHEST", color: "#f97316" },
  { name: "High", value: "HIGH", color: "#f59e0b" },
  { name: "Medium", value: "MEDIUM", color: "#3b82f6" },
  { name: "Low", value: "LOW", color: "#10b981" },
  { name: "Lowest", value: "LOWEST", color: "#64748b" },
];

const ISSUE_TYPES = [
  { value: "TASK", label: "Task", icon: CheckSquare, color: "text-sky-600 dark:text-sky-400 bg-sky-100/70 dark:bg-sky-950/60 border-sky-200 dark:border-sky-800" },
  { value: "BUG", label: "Bug", icon: AlertCircle, color: "text-rose-600 dark:text-rose-400 bg-rose-100/70 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800" },
  { value: "STORY", label: "Story", icon: Bookmark, color: "text-emerald-600 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800" },
  { value: "FEATURE", label: "Feature", icon: Sparkles, color: "text-indigo-600 dark:text-indigo-400 bg-indigo-100/70 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800" },
  { value: "IMPROVEMENT", label: "Improvement", icon: TrendingUp, color: "text-amber-600 dark:text-amber-400 bg-amber-100/70 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800" },
  { value: "INCIDENT", label: "Incident", icon: Flame, color: "text-red-600 dark:text-red-400 bg-red-100/70 dark:bg-red-950/60 border-red-200 dark:border-red-800" },
  { value: "EPIC", label: "Epic", icon: Zap, color: "text-purple-600 dark:text-purple-400 bg-purple-100/70 dark:bg-purple-950/60 border-purple-200 dark:border-purple-800" },
];

export function ListView({
  issues,
  statuses,
  priorities = DEFAULT_PRIORITIES,
  members = [],
  teams = [],
  epics = [],
  delegations = [],
  currentUser,
  canCreateIssue,
  onSelectIssue,
  onUpdateIssueStatus,
  onUpdateIssuePriority,
  onQuickCreateIssue,
  onOpenCreateModal,
}: ListViewProps) {
  const userCanCreate = canCreateIssue !== false && (
    currentUser?.isSuperAdmin ||
    !Array.isArray(currentUser?.capabilities) ||
    currentUser.capabilities.includes("issues:create")
  );
  const [filterType, setFilterType] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [filterPriority, setFilterPriority] = useState<string>("");

  // Inline Task Creation State
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState("TASK");
  const [newStatusId, setNewStatusId] = useState(statuses[0]?.id || "");
  const [newPriority, setNewPriority] = useState("MEDIUM");
  const [newAssigneeId, setNewAssigneeId] = useState("");
  const [newTeamId, setNewTeamId] = useState("");
  const [newPoints, setNewPoints] = useState<string>("");
  const [newDueDate, setNewDueDate] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sorting state
  type SortField = "type" | "key" | "title" | "status" | "priority" | "assignee" | "team" | "points" | "dueDate";
  type SortDirection = "asc" | "desc";
  const [sortField, setSortField] = useState<SortField>("key");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const priorityList = priorities && priorities.length > 0 ? priorities : DEFAULT_PRIORITIES;

  const getPriorityInfo = (pri: string) => {
    const found = priorityList.find(
      (p) => p.value?.toUpperCase() === pri?.toUpperCase() || p.name?.toUpperCase() === pri?.toUpperCase()
    );
    const color = found?.color || (
      pri === "CRITICAL" ? "#f43f5e" :
      pri === "HIGHEST" ? "#f97316" :
      pri === "HIGH" ? "#f59e0b" :
      pri === "MEDIUM" ? "#3b82f6" :
      pri === "LOW" ? "#10b981" : "#64748b"
    );
    return {
      name: found?.name || pri,
      color,
    };
  };

  const handleCreateSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTitle.trim() || !onQuickCreateIssue || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onQuickCreateIssue({
        title: newTitle.trim(),
        statusId: newStatusId || statuses[0]?.id,
        issueType: newType,
        priority: newPriority,
        assigneeId: newAssigneeId || undefined,
        teamId: newTeamId || undefined,
        estimatePoints: newPoints ? parseInt(newPoints, 10) : undefined,
        dueDate: newDueDate || undefined,
      });

      setNewTitle("");
      setNewPoints("");
      setNewDueDate("");
      setIsAddingTask(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredIssues = useMemo(() => {
    const list = issues.filter((i) => {
      if (!i) return false;
      if (filterPriority && i.priority !== filterPriority) return false;
      if (filterType && i.issueType !== filterType) return false;
      if (
        searchTerm &&
        !String(i.title || "").toLowerCase().includes(searchTerm.toLowerCase()) &&
        !String(i.issueKey || "").toLowerCase().includes(searchTerm.toLowerCase())
      )
        return false;
      return true;
    });

    return list.sort((a, b) => {
      let valA: any = "";
      let valB: any = "";

      switch (sortField) {
        case "type":
          valA = a.issueType || "";
          valB = b.issueType || "";
          break;
        case "key":
          valA = a.keyNumber || parseInt(String(a.issueKey || "").replace(/\D/g, ""), 10) || 0;
          valB = b.keyNumber || parseInt(String(b.issueKey || "").replace(/\D/g, ""), 10) || 0;
          return sortDirection === "asc" ? valA - valB : valB - valA;
        case "title":
          valA = (a.title || "").toLowerCase();
          valB = (b.title || "").toLowerCase();
          break;
        case "status":
          const statusA = statuses.find((s) => s.id === a.statusId)?.name || "";
          const statusB = statuses.find((s) => s.id === b.statusId)?.name || "";
          valA = statusA.toLowerCase();
          valB = statusB.toLowerCase();
          break;
        case "priority":
          const pOrder: Record<string, number> = { CRITICAL: 6, HIGHEST: 5, HIGH: 4, MEDIUM: 3, LOW: 2, LOWEST: 1 };
          valA = pOrder[a.priority] || 0;
          valB = pOrder[b.priority] || 0;
          return sortDirection === "asc" ? valA - valB : valB - valA;
        case "assignee":
          valA = a.assignee?.firstName || "";
          valB = b.assignee?.firstName || "";
          break;
        case "team":
          valA = a.team?.name || "";
          valB = b.team?.name || "";
          break;
        case "points":
          valA = a.estimatePoints ?? -1;
          valB = b.estimatePoints ?? -1;
          return sortDirection === "asc" ? valA - valB : valB - valA;
        case "dueDate":
          valA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
          valB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
          return sortDirection === "asc" ? valA - valB : valB - valA;
      }

      if (valA < valB) return sortDirection === "asc" ? -1 : 1;
      if (valA > valB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [issues, filterPriority, filterType, searchTerm, sortField, sortDirection, statuses]);

  const renderTypeIcon = (type: string) => {
    const found = ISSUE_TYPES.find((t) => t.value === type) || ISSUE_TYPES[0];
    const Icon = found.icon;
    return (
      <span className={"flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border shadow-2xs " + found.color} title={found.label}>
        <Icon className="w-3 h-3 shrink-0" />
        <span>{found.label}</span>
      </span>
    );
  };

  const hasFilters = searchTerm || filterPriority || filterType;

  return (
    <div className="flex-1 p-3 sm:p-4 md:p-6 space-y-3 sm:space-y-4 max-w-7xl mx-auto w-full">
      {/* Table Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 bg-white/70 dark:bg-slate-900/60 p-2.5 sm:p-3 rounded-2xl border border-slate-300 dark:border-slate-800 shadow-xs backdrop-blur-xs">
        <div className="flex items-center flex-wrap gap-2">
          <div className="relative flex-1 sm:flex-initial">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter issues..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="text-xs pl-8 pr-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all w-full sm:w-56 shadow-2xs text-slate-800 dark:text-slate-100 font-medium"
            />
          </div>

          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            aria-label="Filter priority"
            className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold outline-none cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 shadow-2xs"
          >
            <option value="">All Priorities</option>
            {priorityList.map((p) => (
              <option key={p.value} value={p.value}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            aria-label="Filter issue type"
            className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold outline-none cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 shadow-2xs"
          >
            <option value="">All Types</option>
            {ISSUE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          {hasFilters && (
            <button
              onClick={() => {
                setSearchTerm("");
                setFilterPriority("");
                setFilterType("");
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 text-xs rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-semibold cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          )}

          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full ml-auto sm:ml-1 shrink-0">
            {filteredIssues.length} / {issues.length}
          </span>
        </div>

        {userCanCreate && (
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => onSelectIssue ? onSelectIssue("new") : (onOpenCreateModal && onOpenCreateModal())}
              className="btn-primary px-3 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Task</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-300 dark:border-slate-800 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider select-none">
                <th onClick={() => handleSort("type")} className="py-3 px-2.5 sm:px-3.5 w-16 sm:w-24 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                  <div className="flex items-center gap-1">
                    <span>Type</span>
                    {sortField === "type" ? (sortDirection === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </div>
                </th>
                <th onClick={() => handleSort("key")} className="py-3 px-2 sm:px-3 w-20 sm:w-28 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                  <div className="flex items-center gap-1">
                    <span>Key</span>
                    {sortField === "key" ? (sortDirection === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </div>
                </th>
                <th onClick={() => handleSort("title")} className="py-3 px-3 sm:px-4 min-w-[180px] sm:min-w-[240px] cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                  <div className="flex items-center gap-1">
                    <span>Summary</span>
                    {sortField === "title" ? (sortDirection === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </div>
                </th>
                <th onClick={() => handleSort("status")} className="py-3 px-2 sm:px-3 w-28 sm:w-32 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                  <div className="flex items-center gap-1">
                    <span>Status</span>
                    {sortField === "status" ? (sortDirection === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </div>
                </th>
                <th onClick={() => handleSort("priority")} className="py-3 px-3 w-32 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors hidden sm:table-cell">
                  <div className="flex items-center gap-1">
                    <span>Priority</span>
                    {sortField === "priority" ? (sortDirection === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </div>
                </th>
                <th onClick={() => handleSort("assignee")} className="py-3 px-3 w-36 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors hidden sm:table-cell">
                  <div className="flex items-center gap-1">
                    <span>Assignee</span>
                    {sortField === "assignee" ? (sortDirection === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </div>
                </th>
                <th onClick={() => handleSort("team")} className="py-3 px-3 w-28 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors hidden md:table-cell">
                  <div className="flex items-center gap-1">
                    <span>Team</span>
                    {sortField === "team" ? (sortDirection === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </div>
                </th>
                <th onClick={() => handleSort("points")} className="py-3 px-3 w-20 text-center cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors hidden md:table-cell">
                  <div className="flex items-center justify-center gap-1">
                    <span>Pts</span>
                    {sortField === "points" ? (sortDirection === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </div>
                </th>
                <th onClick={() => handleSort("dueDate")} className="py-3 px-3.5 w-28 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors hidden lg:table-cell">
                  <div className="flex items-center gap-1">
                    <span>Due Date</span>
                    {sortField === "dueDate" ? (sortDirection === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80 font-normal">
              {filteredIssues.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 italic">
                    No issues match your current filters.
                  </td>
                </tr>
              ) : (
                filteredIssues.map((issue) => (
                  <tr
                    key={issue.id}
                    onClick={() => onSelectIssue(issue)}
                    className="hover:bg-blue-50/40 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group"
                  >
                    {/* Type */}
                    <td className="py-3 px-3.5">{renderTypeIcon(issue.issueType)}</td>

                    {/* Key */}
                    <td className="py-3 px-3">
                      <span className={getIssueKeyClass(isIssueDone(issue, statuses))}>
                        {issue.issueKey}
                      </span>
                    </td>

                    {/* Title */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1">
                          {issue.title}
                        </span>
                        {(() => {
                          const epic = issue.epic || epics.find((e: any) => e.id === issue.epicId);
                          if (!epic) return null;
                          return (
                            <div className="flex items-center gap-1.5 flex-wrap mt-1">
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold text-white shadow-2xs"
                                style={{ backgroundColor: epic.color || "#8b5cf6" }}
                                title={`Epic: ${epic.name}`}
                              >
                                <Zap className="w-2.5 h-2.5" />
                                <span>{epic.name}</span>
                              </span>
                              {epic.status && (
                                <span
                                  className="inline-flex items-center px-1.5 py-0.2 rounded text-[8.5px] font-bold uppercase tracking-wider bg-purple-100/90 text-purple-700 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shadow-2xs"
                                  title={`Epic Status: ${epic.status}`}
                                >
                                  {epic.status}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </td>

                    {/* Status Dropdown */}
                    <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={issue.statusId}
                        onChange={(e) => onUpdateIssueStatus(issue.id, e.target.value)}
                        className="text-[11px] font-bold py-1 px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 outline-none cursor-pointer hover:border-blue-400 transition-all shadow-2xs"
                      >
                        {statuses.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Priority Dropdown */}
                    <td className="py-3 px-3 hidden sm:table-cell" onClick={(e) => e.stopPropagation()}>
                      {onUpdateIssuePriority ? (
                        <select
                          value={issue.priority}
                          onChange={(e) => onUpdateIssuePriority(issue.id, e.target.value)}
                          className="text-[11px] font-bold py-1 px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none cursor-pointer hover:border-blue-400 transition-all shadow-2xs"
                          style={{ color: getPriorityInfo(issue.priority).color }}
                        >
                          {priorityList.map((p) => (
                            <option key={p.value} value={p.value} className="text-slate-900 dark:text-slate-100">
                              {p.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className="px-2 py-0.5 rounded-full border text-[10px] font-bold inline-flex items-center gap-1.5 shadow-2xs"
                          style={{
                            color: getPriorityInfo(issue.priority).color,
                            backgroundColor: getPriorityInfo(issue.priority).color + "15",
                            borderColor: getPriorityInfo(issue.priority).color + "40",
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: getPriorityInfo(issue.priority).color }}
                          />
                          {getPriorityInfo(issue.priority).name}
                        </span>
                      )}
                    </td>

                    {/* Assignee with Delegation Support */}
                    <td className="py-3 px-3 hidden sm:table-cell">
                      {(() => {
                        const activeDel = (delegations || []).find(
                          (d: any) => d.issueId === issue.id && isDelegationActive(d) && d.status === "ACTIVE"
                        );
                        if (activeDel) {
                          return (
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                                <span>{issue.assignee?.firstName} {issue.assignee?.lastName || ""}</span>
                                <span className="text-[9px] font-bold text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950 px-1 py-0.2 rounded border border-indigo-200 dark:border-indigo-800">↗ Delegated</span>
                              </div>
                              <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium">
                                ↳ {activeDel.delegateUser?.firstName} {activeDel.delegateUser?.lastName || ""}
                              </div>
                            </div>
                          );
                        }
                        return issue.assignee ? (
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full ring-1 ring-white dark:ring-slate-800 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-[9px] flex items-center justify-center uppercase shadow-2xs shrink-0">
                              {issue.assignee.firstName[0]}
                            </div>
                            <span className="text-slate-700 dark:text-slate-300 truncate font-medium">
                              {issue.assignee.firstName} {issue.assignee.lastName || ""}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500 font-medium italic">Unassigned</span>
                        );
                      })()}
                    </td>

                    {/* Team */}
                    <td className="py-3 px-3 hidden md:table-cell">
                      {issue.team ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/50 dark:border-blue-800/50">
                          <Users className="w-2.5 h-2.5" />
                          <span>{issue.team.name}</span>
                        </span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">-</span>
                      )}
                    </td>

                    {/* Points */}
                    <td className="py-3 px-3 font-mono font-bold text-center text-slate-700 dark:text-slate-300 hidden md:table-cell">
                      {issue.estimatePoints != null ? (
                        <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">
                          {issue.estimatePoints}
                        </span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">-</span>
                      )}
                    </td>

                    {/* Due Date */}
                    <td className="py-3 px-3.5 text-slate-500 dark:text-slate-400 text-[11px] font-medium hidden lg:table-cell">
                      {issue.dueDate ? (
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>{new Date(issue.dueDate).toLocaleDateString()}</span>
                        </div>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
