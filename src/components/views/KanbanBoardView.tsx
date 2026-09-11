"use client";

import React, { useState, useMemo } from "react";
import {
  Plus,
  User,
  ChevronDown,
  ChevronRight,
  Layers,
  UserCheck,
  ShieldAlert,
  Sparkles,
  CheckSquare,
  AlertCircle,
  Bookmark,
  Zap,
  Flame,
  TrendingUp,
  Users,
  MessageSquare,
  Check,
  Calendar,
  ExternalLink,
  Loader2,
} from "lucide-react";

interface KanbanBoardViewProps {
  statuses: any[];
  issues: any[];
  priorities?: any[];
  members?: any[];
  teams?: any[];
  sprints?: any[];
  onSelectIssue: (issue: any) => void;
  onUpdateIssueStatus: (issueId: string, statusId: string) => void;
  onQuickCreateIssue: (payload: {
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

type SwimlaneMode = "none" | "assignee" | "epic" | "priority";

const ISSUE_TYPES = [
  { value: "TASK", label: "Task", icon: CheckSquare, color: "text-sky-600 dark:text-sky-400 bg-sky-100/70 dark:bg-sky-950/60 border-sky-200 dark:border-sky-800" },
  { value: "BUG", label: "Bug", icon: AlertCircle, color: "text-rose-600 dark:text-rose-400 bg-rose-100/70 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800" },
  { value: "STORY", label: "Story", icon: Bookmark, color: "text-emerald-600 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800" },
  { value: "FEATURE", label: "Feature", icon: Sparkles, color: "text-indigo-600 dark:text-indigo-400 bg-indigo-100/70 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800" },
  { value: "IMPROVEMENT", label: "Improvement", icon: TrendingUp, color: "text-amber-600 dark:text-amber-400 bg-amber-100/70 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800" },
  { value: "INCIDENT", label: "Incident", icon: Flame, color: "text-red-600 dark:text-red-400 bg-red-100/70 dark:bg-red-950/60 border-red-200 dark:border-red-800" },
  { value: "EPIC", label: "Epic", icon: Zap, color: "text-purple-600 dark:text-purple-400 bg-purple-100/70 dark:bg-purple-950/60 border-purple-200 dark:border-purple-800" },
];

export function KanbanBoardView({
  statuses,
  issues,
  priorities = [],
  members = [],
  teams = [],
  sprints = [],
  onSelectIssue,
  onUpdateIssueStatus,
  onQuickCreateIssue,
  onOpenCreateModal,
}: KanbanBoardViewProps) {
  const [swimlaneMode, setSwimlaneMode] = useState<SwimlaneMode>("none");
  const [collapsedSwimlanes, setCollapsedSwimlanes] = useState<Record<string, boolean>>({});
  
  // Enhanced Quick Task Creator State
  const [addingToStatusId, setAddingToStatusId] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickType, setQuickType] = useState("TASK");
  const [quickPriority, setQuickPriority] = useState("MEDIUM");
  const [quickAssigneeId, setQuickAssigneeId] = useState("");
  const [quickTeamId, setQuickTeamId] = useState("");
  const [quickPoints, setQuickPoints] = useState<number | null>(null);
  const [quickDueDate, setQuickDueDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleSwimlane = (id: string) => {
    setCollapsedSwimlanes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleStartQuickAdd = (statusId: string) => {
    setAddingToStatusId(statusId);
    setQuickTitle("");
    setQuickType("TASK");
    setQuickPriority("MEDIUM");
    setQuickAssigneeId("");
    setQuickTeamId("");
    setQuickPoints(null);
    setQuickDueDate("");
  };

  const handleCancelQuickAdd = () => {
    setAddingToStatusId(null);
    setQuickTitle("");
    setIsSubmitting(false);
  };

  const handleQuickAddSubmit = async (statusId: string) => {
    if (!quickTitle.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onQuickCreateIssue({
        statusId,
        title: quickTitle.trim(),
        issueType: quickType,
        priority: quickPriority,
        assigneeId: quickAssigneeId || undefined,
        teamId: quickTeamId || undefined,
        estimatePoints: quickPoints != null ? quickPoints : undefined,
        dueDate: quickDueDate || undefined,
      });
      setQuickTitle("");
      setQuickPoints(null);
      setAddingToStatusId(null);
    } catch (err) {
      console.error("Quick create error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const priorityList = useMemo(() => {
    return priorities.length > 0
      ? priorities
      : [
          { value: "CRITICAL", name: "Critical", color: "#ef4444" },
          { value: "HIGHEST", name: "Highest", color: "#f97316" },
          { value: "HIGH", name: "High", color: "#f59e0b" },
          { value: "MEDIUM", name: "Medium", color: "#3b82f6" },
          { value: "LOW", name: "Low", color: "#10b981" },
          { value: "LOWEST", name: "Lowest", color: "#64748b" },
        ];
  }, [priorities]);

  const getPriorityInfo = (priority: string) => {
    const found = priorityList.find(
      (p) => p.value === priority || p.name?.toUpperCase() === priority?.toUpperCase()
    );
    if (found?.color) {
      return {
        color: found.color,
        name: found.name || priority,
        custom: true,
      };
    }
    return {
      color: "#3b82f6",
      name: priority,
      custom: false,
    };
  };

  const priorityColors: Record<string, string> = {
    CRITICAL: "text-rose-700 bg-rose-50 border-rose-200/90 dark:bg-rose-950/50 dark:border-rose-900/70 dark:text-rose-300 shadow-2xs",
    HIGHEST: "text-orange-700 bg-orange-50 border-orange-200/90 dark:bg-orange-950/50 dark:border-orange-900/70 dark:text-orange-300 shadow-2xs",
    HIGH: "text-amber-700 bg-amber-50 border-amber-200/90 dark:bg-amber-950/50 dark:border-amber-900/70 dark:text-amber-300 shadow-2xs",
    MEDIUM: "text-blue-700 bg-blue-50 border-blue-200/90 dark:bg-blue-950/50 dark:border-blue-900/70 dark:text-blue-300 shadow-2xs",
    LOW: "text-emerald-700 bg-emerald-50 border-emerald-200/90 dark:bg-emerald-950/50 dark:border-emerald-900/70 dark:text-emerald-300 shadow-2xs",
    LOWEST: "text-slate-600 bg-slate-100 border-slate-300 dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300 shadow-2xs",
  };

  const priorityDots: Record<string, string> = {
    CRITICAL: "bg-rose-500 shadow-xs shadow-rose-500/50",
    HIGHEST: "bg-orange-500 shadow-xs shadow-orange-500/50",
    HIGH: "bg-amber-500 shadow-xs shadow-amber-500/50",
    MEDIUM: "bg-blue-500 shadow-xs shadow-blue-500/50",
    LOW: "bg-emerald-500 shadow-xs shadow-emerald-500/50",
    LOWEST: "bg-slate-400",
  };

  const renderTypeBadge = (type: string) => {
    const found = ISSUE_TYPES.find((t) => t.value === type) || ISSUE_TYPES[0];
    const Icon = found.icon;
    return (
      <span className={"flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border shadow-2xs " + found.color} title={found.label}>
        <Icon className="w-3 h-3 shrink-0" />
        <span>{found.label}</span>
      </span>
    );
  };

  // Build swimlane groups
  const swimlanes = useMemo(() => {
    if (swimlaneMode === "none") {
      return [{ id: "all", title: "All Issues", issues }];
    }

    if (swimlaneMode === "assignee") {
      const groups: Record<string, { id: string; title: string; subtitle?: string; avatar?: string; issues: any[] }> = {};
      
      groups["unassigned"] = {
        id: "unassigned",
        title: "Unassigned",
        issues: [],
      };

      issues.forEach((issue) => {
        if (!issue.assignee) {
          groups["unassigned"].issues.push(issue);
        } else {
          const key = issue.assignee.id;
          if (!groups[key]) {
            groups[key] = {
              id: key,
              title: (issue.assignee.firstName + " " + (issue.assignee.lastName || "")).trim(),
              subtitle: issue.assignee.email,
              avatar: issue.assignee.firstName?.[0] || "?",
              issues: [],
            };
          }
          groups[key].issues.push(issue);
        }
      });

      return Object.values(groups).filter((g) => g.issues.length > 0 || g.id === "unassigned");
    }

    if (swimlaneMode === "epic") {
      const groups: Record<string, { id: string; title: string; color?: string; issues: any[] }> = {};
      
      groups["no-epic"] = {
        id: "no-epic",
        title: "Issues without Epic",
        issues: [],
      };

      issues.forEach((issue) => {
        if (!issue.epic) {
          groups["no-epic"].issues.push(issue);
        } else {
          const key = issue.epic.id;
          if (!groups[key]) {
            groups[key] = {
              id: key,
              title: issue.epic.name,
              color: issue.epic.color || "#3b82f6",
              issues: [],
            };
          }
          groups[key].issues.push(issue);
        }
      });

      return Object.values(groups).filter((g) => g.issues.length > 0 || g.id === "no-epic");
    }

    if (swimlaneMode === "priority") {
      const allPrios = Array.from(
        new Set([
          ...priorityList.map((p) => p.value),
          ...issues.map((i) => i.priority).filter(Boolean),
        ])
      );
      return allPrios
        .map((p) => {
          const found = priorityList.find(
            (pl) => pl.value === p || pl.name?.toUpperCase() === p?.toUpperCase()
          );
          const name = found?.name || (p.charAt(0) + p.slice(1).toLowerCase());
          return {
            id: p,
            title: name + " Priority",
            color: found?.color,
            issues: issues.filter((i) => i.priority === p),
          };
        })
        .filter((g) => g.issues.length > 0);
    }

    return [{ id: "all", title: "All Issues", issues }];
  }, [swimlaneMode, issues, priorityList]);

  const renderIssueCard = (issue: any) => {
    const prioInfo = getPriorityInfo(issue.priority);

    return (
      <div
        key={issue.id}
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/plain", issue.id)}
        onClick={() => onSelectIssue(issue)}
        className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-300 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-md hover:border-blue-500 dark:hover:border-blue-500 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group relative"
      >
        {/* Top Meta */}
        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-2">
          <div className="flex items-center gap-1.5">
            {renderTypeBadge(issue.issueType || "TASK")}
            <span className="font-mono font-bold text-slate-700 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {issue.issueKey}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span
              className={"px-2 py-0.5 rounded-full border text-[10px] font-bold flex items-center gap-1.5 " + (prioInfo.custom ? "" : priorityColors[issue.priority] || "")}
              style={
                prioInfo.custom
                  ? {
                      backgroundColor: prioInfo.color + "15",
                      borderColor: prioInfo.color + "40",
                      color: prioInfo.color,
                    }
                  : undefined
              }
            >
              <span
                className={"w-1.5 h-1.5 rounded-full " + (prioInfo.custom ? "" : priorityDots[issue.priority] || "bg-slate-400")}
                style={prioInfo.custom ? { backgroundColor: prioInfo.color } : undefined}
              />
              {prioInfo.name}
            </span>
          </div>
        </div>

        {/* Title */}
        <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-snug mb-2 line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
          {issue.title}
        </h4>

        {/* Epic Badge */}
        {issue.epic && (
          <div className="mb-2">
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold text-white shadow-2xs"
              style={{ backgroundColor: issue.epic.color || "#8b5cf6" }}
            >
              <Zap className="w-2.5 h-2.5" />
              <span className="truncate max-w-[140px]">{issue.epic.name}</span>
            </span>
          </div>
        )}

        {/* Team Tag if assigned */}
        {issue.team && (
          <div className="mb-2">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50">
              <Users className="w-2.5 h-2.5" />
              <span>{issue.team.name}</span>
            </span>
          </div>
        )}

        {/* Bottom Meta Bar */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-300 dark:border-slate-700/60 text-[11px]">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            {/* Story Points */}
            {issue.estimatePoints != null && (
              <span className="px-1.5 py-0.2 bg-slate-100 dark:bg-slate-700/80 rounded font-mono font-bold text-[10px] text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600/50">
                {issue.estimatePoints} pts
              </span>
            )}

            {/* Subtask progress count */}
            {issue.subtasks && issue.subtasks.length > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-slate-600 dark:text-slate-400 font-medium">
                <CheckSquare className="w-3 h-3 text-emerald-600 dark:text-emerald-500" />
                <span>
                  {issue.subtasks.filter((s: any) => s.isCompleted).length}/{issue.subtasks.length}
                </span>
              </span>
            )}

            {/* Comment count */}
            {issue._count?.comments > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                <MessageSquare className="w-2.5 h-2.5" />
                <span>{issue._count.comments}</span>
              </span>
            )}

            {/* Due date indicator */}
            {issue.dueDate && (
              <span className="flex items-center gap-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                <Calendar className="w-2.5 h-2.5" />
                <span>{new Date(issue.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              </span>
            )}
          </div>

          {/* Assignee Avatar */}
          {issue.assignee ? (
            <div
              className="w-5 h-5 rounded-full ring-1 ring-white dark:ring-slate-900 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-[9px] flex items-center justify-center uppercase shadow-2xs"
              title={"Assigned to " + issue.assignee.firstName + " " + (issue.assignee.lastName || "")}
            >
              {issue.assignee.firstName[0]}
            </div>
          ) : (
            <div
              className="w-5 h-5 rounded-full border border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center text-slate-400"
              title="Unassigned"
            >
              <User className="w-2.5 h-2.5" />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col p-6 space-y-4 max-w-full overflow-hidden">
      {/* Kanban Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-300 dark:border-slate-800 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            Swimlanes:
          </span>

          <div className="inline-flex p-0.5 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold">
            <button
              onClick={() => setSwimlaneMode("none")}
              className={"px-3 py-1 rounded-lg transition-all cursor-pointer " + (
                swimlaneMode === "none"
                  ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs font-bold border border-slate-300 dark:border-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              None
            </button>

            <button
              onClick={() => setSwimlaneMode("assignee")}
              className={"px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer " + (
                swimlaneMode === "assignee"
                  ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs font-bold border border-slate-300 dark:border-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              <UserCheck className="w-3.5 h-3.5" />
              Assignee
            </button>

            <button
              onClick={() => setSwimlaneMode("epic")}
              className={"px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer " + (
                swimlaneMode === "epic"
                  ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs font-bold border border-slate-300 dark:border-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Epic
            </button>

            <button
              onClick={() => setSwimlaneMode("priority")}
              className={"px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer " + (
                swimlaneMode === "priority"
                  ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs font-bold border border-slate-300 dark:border-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              Priority
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onOpenCreateModal && (
            <button
              type="button"
              onClick={() => onOpenCreateModal()}
              className="btn-primary px-3.5 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Task</span>
            </button>
          )}

          <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 shadow-2xs">
            Total: <span className="font-bold text-slate-900 dark:text-white">{issues.length}</span> issues
          </div>
        </div>
      </div>

      {/* Kanban Board Container */}
      <div className="flex-1 overflow-x-auto pb-4">
        {swimlaneMode === "none" ? (
          /* Standard Columns Layout */
          <div className="flex gap-4 min-w-max h-[calc(100vh-250px)] items-stretch">
            {statuses.map((status) => {
              const columnIssues = issues.filter((i) => i.statusId === status.id);
              const isOverWip = status.wipLimit && columnIssues.length > status.wipLimit;
              const isAdding = addingToStatusId === status.id;

              return (
                <div
                  key={status.id}
                  className={"w-80 shrink-0 rounded-2xl flex flex-col transition-colors border shadow-2xs " + (
                    isOverWip
                      ? "bg-rose-50/70 dark:bg-rose-950/20 border-rose-300 dark:border-rose-900/50"
                      : "bg-slate-100/90 dark:bg-slate-900/60 border-slate-300 dark:border-slate-800"
                  )}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const issueId = e.dataTransfer.getData("text/plain");
                    if (issueId) onUpdateIssueStatus(issueId, status.id);
                  }}
                >
                  {/* Column Header */}
                  <div className="p-3.5 border-b border-slate-300/80 dark:border-slate-800 flex items-center justify-between bg-white/70 dark:bg-slate-900/50 rounded-t-2xl">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shadow-xs"
                        style={{ backgroundColor: status.color || "#3b82f6" }}
                      />
                      <span className="text-xs font-bold text-slate-900 dark:text-white tracking-wide uppercase">
                        {status.name}
                      </span>
                      <span
                        className={"px-2 py-0.5 rounded-full text-[10px] font-bold border " + (
                          isOverWip
                            ? "bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-900 dark:text-rose-300 dark:border-rose-800"
                            : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700"
                        )}
                      >
                        {columnIssues.length}
                        {status.wipLimit ? " / " + status.wipLimit : ""}
                      </span>
                    </div>

                    <button
                      onClick={() => handleStartQuickAdd(status.id)}
                      className="p-1 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-white dark:hover:bg-slate-800 transition-colors cursor-pointer border border-transparent hover:border-slate-300"
                      title="Quick add task to this column"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Issues List */}
                  <div className="p-2.5 space-y-2.5 overflow-y-auto flex-1">
                    {columnIssues.map(renderIssueCard)}

                    {/* Rich Inline Quick Task Creator Card */}
                    {isAdding ? (
                      <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border-2 border-blue-500/80 dark:border-blue-500/80 shadow-lg space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
                        {/* Type & Priority Header Bar */}
                        <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-300 dark:border-slate-800">
                          <div className="flex items-center gap-1.5">
                            {/* Type Selector */}
                            <select
                              value={quickType}
                              onChange={(e) => setQuickType(e.target.value)}
                              aria-label="Issue type"
                              className="text-[11px] font-bold px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 outline-none cursor-pointer hover:border-blue-400 transition-all"
                            >
                              {ISSUE_TYPES.map((t) => (
                                <option key={t.value} value={t.value}>
                                  {t.label}
                                </option>
                              ))}
                            </select>

                            {/* Priority Selector */}
                            <select
                              value={quickPriority}
                              onChange={(e) => setQuickPriority(e.target.value)}
                              aria-label="Issue priority"
                              className="text-[11px] font-bold px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none cursor-pointer hover:border-blue-400 transition-all"
                              style={{ color: getPriorityInfo(quickPriority).color }}
                            >
                              {priorityList.map((p) => (
                                <option key={p.value} value={p.value} className="text-slate-900 dark:text-slate-100">
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Story Points Quick Chips */}
                          <div className="flex items-center gap-1">
                            {[1, 2, 3, 5, 8].map((pts) => (
                              <button
                                key={pts}
                                type="button"
                                onClick={() => setQuickPoints(quickPoints === pts ? null : pts)}
                                className={"w-5 h-5 rounded text-[10px] font-mono font-bold transition-all " + (
                                  quickPoints === pts
                                    ? "bg-blue-600 text-white shadow-2xs scale-105"
                                    : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                )}
                                title={pts + " Story Points"}
                              >
                                {pts}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Title Input / Textarea */}
                        <div>
                          <textarea
                            value={quickTitle}
                            onChange={(e) => setQuickTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleQuickAddSubmit(status.id);
                              }
                              if (e.key === "Escape") {
                                handleCancelQuickAdd();
                              }
                            }}
                            placeholder="What needs to be done? (Enter to create)..."
                            autoFocus
                            rows={2}
                            className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/80 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400 resize-none font-medium"
                          />
                        </div>

                        {/* Secondary Assignee / Team / Due Date Selectors */}
                        <div className="grid grid-cols-2 gap-1.5 text-xs">
                          {/* Assignee Selector */}
                          <select
                            value={quickAssigneeId}
                            onChange={(e) => setQuickAssigneeId(e.target.value)}
                            aria-label="Assignee"
                            className="text-[11px] px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium outline-none cursor-pointer truncate"
                          >
                            <option value="">👤 Unassigned</option>
                            {members.map((m: any) => {
                              const u = m.user || m;
                              const name = (u.firstName || "" + " " + (u.lastName || "")).trim() || u.email || "Member";
                              return (
                                <option key={u.id} value={u.id}>
                                  {"👤 " + name}
                                </option>
                              );
                            })}
                          </select>

                          {/* Team Selector */}
                          <select
                            value={quickTeamId}
                            onChange={(e) => setQuickTeamId(e.target.value)}
                            aria-label="Team"
                            className="text-[11px] px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium outline-none cursor-pointer truncate"
                          >
                            <option value="">👥 No Team</option>
                            {teams.map((t: any) => (
                              <option key={t.id} value={t.id}>
                                {"👥 " + t.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Due Date row */}
                        <div className="flex items-center justify-between gap-1.5 pt-0.5 text-[11px]">
                          <div className="flex items-center gap-1 text-slate-400">
                            <Calendar className="w-3 h-3" />
                            <input
                              type="date"
                              value={quickDueDate}
                              onChange={(e) => setQuickDueDate(e.target.value)}
                              aria-label="Due date"
                              className="text-[10px] font-medium bg-transparent text-slate-600 dark:text-slate-300 outline-none cursor-pointer"
                            />
                          </div>

                          {onOpenCreateModal && (
                            <button
                              type="button"
                              onClick={() => {
                                onOpenCreateModal(status.id, quickTitle);
                                handleCancelQuickAdd();
                              }}
                              className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 font-medium cursor-pointer"
                            >
                              <span>More Details</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>

                        {/* Action Buttons Footer */}
                        <div className="flex items-center justify-between pt-1.5 border-t border-slate-300 dark:border-slate-800">
                          <span className="text-[10px] text-slate-400 font-mono">
                            Enter ↵ to save
                          </span>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={handleCancelQuickAdd}
                              className="px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={!quickTitle.trim() || isSubmitting}
                              onClick={() => handleQuickAddSubmit(status.id)}
                              className="btn-primary px-3.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
                            >
                              {isSubmitting ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Check className="w-3 h-3" />
                              )}
                              <span>Add Task</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleStartQuickAdd(status.id)}
                        className="w-full py-2 text-xs font-semibold text-slate-600 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 bg-white/80 hover:bg-white dark:bg-slate-800/60 dark:hover:bg-slate-800 rounded-xl flex items-center justify-center gap-1.5 transition-all border border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 cursor-pointer shadow-2xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Task</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Horizontal Swimlanes Layout */
          <div className="space-y-6">
            {swimlanes.map((lane: any) => {
              const isCollapsed = !!collapsedSwimlanes[lane.id];
              const totalPoints = lane.issues.reduce((sum: number, i: any) => sum + (i.estimatePoints || 0), 0);

              return (
                <div
                  key={lane.id}
                  className="bg-white/50 dark:bg-slate-900/40 rounded-2xl border border-slate-300 dark:border-slate-800 overflow-hidden shadow-xs"
                >
                  {/* Swimlane Header Banner */}
                  <div
                    onClick={() => toggleSwimlane(lane.id)}
                    className="p-3 bg-slate-100/80 dark:bg-slate-800/80 border-b border-slate-300 dark:border-slate-800 flex items-center justify-between cursor-pointer hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {isCollapsed ? (
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      )}

                      {lane.avatar && (
                        <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
                          {lane.avatar}
                        </div>
                      )}

                      {lane.color && (
                        <span className="w-3 h-3 rounded-md" style={{ backgroundColor: lane.color }} />
                      )}

                      <div>
                        <span className="text-xs font-bold text-slate-900 dark:text-white mr-2">
                          {lane.title}
                        </span>
                        {lane.subtitle && (
                          <span className="text-[11px] text-slate-400">{lane.subtitle}</span>
                        )}
                      </div>

                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                        {lane.issues.length} {lane.issues.length === 1 ? "issue" : "issues"}
                      </span>

                      {totalPoints > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                          {totalPoints} pts
                        </span>
                      )}
                    </div>

                    <span className="text-[11px] text-slate-400 font-medium">
                      {isCollapsed ? "Click to expand" : "Click to collapse"}
                    </span>
                  </div>

                  {/* Swimlane Grid Content */}
                  {!isCollapsed && (
                    <div className="p-3 overflow-x-auto">
                      <div className="flex gap-4 min-w-max">
                        {statuses.map((status) => {
                          const columnIssues = lane.issues.filter((i: any) => i.statusId === status.id);

                          return (
                            <div
                              key={status.id}
                              className="w-72 shrink-0 bg-slate-100/90 dark:bg-slate-900/70 rounded-xl flex flex-col p-2.5 min-h-[160px] border border-slate-300 dark:border-slate-800 shadow-2xs"
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault();
                                const issueId = e.dataTransfer.getData("text/plain");
                                if (issueId) onUpdateIssueStatus(issueId, status.id);
                              }}
                            >
                              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-300/80 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                <span className="text-[11px] uppercase tracking-wider font-bold">{status.name}</span>
                                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                                  {columnIssues.length}
                                </span>
                              </div>

                              <div className="space-y-2 flex-1">
                                {columnIssues.map(renderIssueCard)}
                                {columnIssues.length === 0 && (
                                  <div className="h-20 border-2 border-dashed border-slate-300 dark:border-slate-800/60 rounded-lg flex items-center justify-center text-[11px] text-slate-400 italic">
                                    Drop here
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
