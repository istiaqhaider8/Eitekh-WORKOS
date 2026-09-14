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
  Calendar,
} from "lucide-react";

import { isDelegationActive } from "@/lib/delegation-engine";

interface KanbanBoardViewProps {
  statuses: any[];
  issues: any[];
  priorities?: any[];
  members?: any[];
  teams?: any[];
  sprints?: any[];
  epics?: any[];
  leaves?: any[];
  delegations?: any[];
  currentUser?: any;
  onSelectIssue: (issue: any) => void;
  onUpdateIssueStatus: (issueId: string, statusId: string) => void;
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
  canCreateIssue?: boolean;
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
  epics = [],
  leaves = [],
  delegations = [],
  currentUser,
  canCreateIssue,
  onSelectIssue,
  onUpdateIssueStatus,
  onQuickCreateIssue,
  onOpenCreateModal,
}: KanbanBoardViewProps) {
  const [swimlaneMode, setSwimlaneMode] = useState<SwimlaneMode>("none");
  const [collapsedSwimlanes, setCollapsedSwimlanes] = useState<Record<string, boolean>>({});
  
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

  const toggleSwimlane = (id: string) => {
    setCollapsedSwimlanes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const userCanCreate = canCreateIssue !== false && (
    currentUser?.isSuperAdmin ||
    !Array.isArray(currentUser?.capabilities) ||
    currentUser.capabilities.includes("issues:create")
  );

  const handleStartQuickAdd = (statusId?: string) => {
    if (!userCanCreate) return;
    if (onSelectIssue) {
      if (statusId) {
        onSelectIssue({ id: "new", statusId });
      } else {
        onSelectIssue("new");
      }
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
      const groups: Record<string, { id: string; title: string; color?: string; status?: string; issues: any[] }> = {};
      
      groups["no-epic"] = {
        id: "no-epic",
        title: "Issues without Epic",
        issues: [],
      };

      // Populate known epics first
      epics.forEach((ep: any) => {
        groups[ep.id] = {
          id: ep.id,
          title: ep.name,
          color: ep.color || "#8b5cf6",
          status: ep.status,
          issues: [],
        };
      });

      issues.forEach((issue) => {
        const epic = issue.epic || epics.find((e: any) => e.id === issue.epicId);
        if (!epic) {
          groups["no-epic"].issues.push(issue);
        } else {
          const key = epic.id;
          if (!groups[key]) {
            groups[key] = {
              id: key,
              title: epic.name,
              color: epic.color || "#8b5cf6",
              status: epic.status,
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
  }, [swimlaneMode, issues, priorityList, epics]);

  const renderIssueCard = (issue: any) => {
    const prioInfo = getPriorityInfo(issue.priority);
    const typeInfo = ISSUE_TYPES.find((t) => t.value === (issue.issueType || "TASK")) || ISSUE_TYPES[0];
    const activeDel = (delegations || []).find(
      (d: any) => d.issueId === issue.id && isDelegationActive(d) && d.status === "ACTIVE"
    );

    return (
      <div
        key={issue.id}
        onClick={() => onSelectIssue(issue)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", issue.id);
        }}
        onDragEnd={() => setDragOverColumnId(null)}
        className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-300 dark:border-slate-800 shadow-xs hover:shadow-md transition-all cursor-pointer group hover:border-blue-500/60 dark:hover:border-blue-500/60 active:scale-[0.99] space-y-2 relative"
      >
        {/* Top Bar: Issue Key & Priority */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {typeInfo.icon && (
              <typeInfo.icon className={"w-3.5 h-3.5 " + (typeInfo.color ? typeInfo.color.split(" ")[0] : "text-blue-500")} />
            )}
            <span className="text-[11px] font-mono font-bold text-slate-600 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
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

        {/* Epic Badge & Epic Status */}
        {(() => {
          const epic = issue.epic || epics.find((e: any) => e.id === issue.epicId);
          if (!epic) return null;
          return (
            <div className="mb-2 flex items-center gap-1.5 flex-wrap">
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold text-white shadow-2xs"
                style={{ backgroundColor: epic.color || "#8b5cf6" }}
                title={`Epic: ${epic.name}`}
              >
                <Zap className="w-2.5 h-2.5" />
                <span className="truncate max-w-[140px]">{epic.name}</span>
              </span>
              {epic.status && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-purple-100/90 text-purple-700 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shadow-2xs"
                  title={`Epic Status: ${epic.status}`}
                >
                  {epic.status}
                </span>
              )}
            </div>
          );
        })()}

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

          {/* Assignee Avatar with Delegation Support */}
          {activeDel ? (
            <div
              className="flex items-center gap-1 bg-indigo-50 dark:bg-indigo-950/70 px-1.5 py-0.5 rounded-full border border-indigo-300 dark:border-indigo-800 text-[9px] font-bold text-indigo-700 dark:text-indigo-300"
              title={`Original Assignee: ${issue.assignee?.firstName || "Assignee"} ↳ Temporary Delegate: ${activeDel.delegateUser?.firstName || "Delegate"}`}
            >
              <span>{issue.assignee?.firstName?.[0] || "U"} ↳ {activeDel.delegateUser?.firstName?.[0] || "D"}</span>
              <span className="text-[8px] bg-indigo-600 text-white px-1 rounded uppercase tracking-tighter">↗ Delegated</span>
            </div>
          ) : issue.assignee ? (
            <div
              className="w-5 h-5 rounded-full ring-1 ring-white dark:ring-slate-900 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-[9px] flex items-center justify-center uppercase shadow-2xs"
              title={"Assigned to " + (issue.assignee.firstName || "") + " " + (issue.assignee.lastName || "")}
            >
              {issue.assignee.firstName?.[0] || "U"}
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
    <div className="flex-1 flex flex-col p-3 sm:p-4 md:p-6 space-y-3 sm:space-y-4 max-w-full overflow-hidden">
      {/* Kanban Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 bg-white dark:bg-slate-900 p-2.5 sm:p-3 rounded-2xl border border-slate-300 dark:border-slate-800 shadow-2xs backdrop-blur-xs">
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <span className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5 shrink-0">
            <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="hidden xs:inline">Swimlanes:</span>
          </span>

          <div className="inline-flex p-0.5 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold overflow-x-auto max-w-full no-scrollbar">
            <button
              onClick={() => setSwimlaneMode("none")}
              className={"px-2.5 sm:px-3 py-1 rounded-lg transition-all cursor-pointer " + (
                swimlaneMode === "none"
                  ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs font-bold border border-slate-300 dark:border-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              None
            </button>

            <button
              onClick={() => setSwimlaneMode("assignee")}
              className={"px-2.5 sm:px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer " + (
                swimlaneMode === "assignee"
                  ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs font-bold border border-slate-300 dark:border-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Assignee</span>
            </button>

            <button
              onClick={() => setSwimlaneMode("epic")}
              className={"px-2.5 sm:px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer " + (
                swimlaneMode === "epic"
                  ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs font-bold border border-slate-300 dark:border-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Epic</span>
            </button>

            <button
              onClick={() => setSwimlaneMode("priority")}
              className={"px-2.5 sm:px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer " + (
                swimlaneMode === "priority"
                  ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs font-bold border border-slate-300 dark:border-slate-700"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Priority</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end">
          {userCanCreate && (
            <button
              type="button"
              onClick={() => onSelectIssue("new")}
              className="btn-primary px-3 sm:px-3.5 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Task</span>
            </button>
          )}

          <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 px-2.5 sm:px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 shadow-2xs shrink-0">
            Total: <span className="font-bold text-slate-900 dark:text-white">{issues.length}</span>
          </div>
        </div>
      </div>

      {/* Mobile Column Quick Navigation Switcher */}
      <div className="sm:hidden flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 shrink-0">
        {statuses.map((s) => {
          const colCount = issues.filter((i) => i.statusId === s.id).length;
          return (
            <button
              key={s.id}
              onClick={() => {
                const el = document.getElementById(`kanban-col-${s.id}`);
                if (el) el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 shrink-0 shadow-2xs cursor-pointer active:scale-95 transition-all"
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color || "#3b82f6" }} />
              <span className="truncate max-w-[90px]">{s.name}</span>
              <span className="text-[9px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 rounded-full font-mono text-slate-500">
                {colCount}
              </span>
            </button>
          );
        })}
      </div>

      {/* Kanban Board Container */}
      <div className="flex-1 overflow-x-auto pb-4 snap-x snap-mandatory scroll-smooth">
        {swimlaneMode === "none" ? (
          /* Standard Columns Layout */
          <div className="flex gap-3 sm:gap-4 min-w-max h-[calc(100vh-250px)] items-stretch">
            {statuses.map((status) => {
              const columnIssues = issues.filter((i) => i.statusId === status.id);
              const isOverWip = status.wipLimit && columnIssues.length > status.wipLimit;
              const isDragOver = dragOverColumnId === status.id;

              return (
                <div
                  key={status.id}
                  id={`kanban-col-${status.id}`}
                  className={"w-[84vw] max-w-[340px] sm:w-80 shrink-0 snap-center rounded-2xl flex flex-col transition-colors border shadow-2xs " + (
                    isDragOver
                      ? "bg-blue-50/70 dark:bg-blue-950/20 border-blue-400 dark:border-blue-600 ring-2 ring-blue-300/50 dark:ring-blue-700/50"
                      : isOverWip
                        ? "bg-rose-50/70 dark:bg-rose-950/20 border-rose-300 dark:border-rose-900/50"
                        : "bg-slate-100/90 dark:bg-slate-900/60 border-slate-300 dark:border-slate-800"
                  )}
                  onDragOver={(e) => e.preventDefault()}
                  onDragEnter={(e) => { e.preventDefault(); setDragOverColumnId(status.id); }}
                  onDragLeave={(e) => {
                    // Only clear if leaving the column entirely (not entering a child)
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOverColumnId(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverColumnId(null);
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

                    {userCanCreate && (
                      <button
                        onClick={() => handleStartQuickAdd(status.id)}
                        className="p-1 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-white dark:hover:bg-slate-800 transition-colors cursor-pointer border border-transparent hover:border-slate-300"
                        title="Quick add task to this column"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Issues List */}
                  <div className="p-2.5 space-y-2.5 overflow-y-auto flex-1">
                    {columnIssues.map(renderIssueCard)}

                    {userCanCreate && (
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
                    <div className="p-2 sm:p-3 overflow-x-auto snap-x snap-mandatory scroll-smooth">
                      <div className="flex gap-3 sm:gap-4 min-w-max">
                        {statuses.map((status) => {
                          const columnIssues = lane.issues.filter((i: any) => i.statusId === status.id);

                          return (
                            <div
                              key={status.id}
                              className={"w-[84vw] max-w-[320px] sm:w-72 shrink-0 snap-center rounded-xl flex flex-col p-2.5 min-h-[160px] border shadow-2xs transition-colors " + (
                                dragOverColumnId === status.id
                                  ? "bg-blue-50/70 dark:bg-blue-950/20 border-blue-400 dark:border-blue-600 ring-2 ring-blue-300/50 dark:ring-blue-700/50"
                                  : "bg-slate-100/90 dark:bg-slate-900/70 border-slate-300 dark:border-slate-800"
                              )}
                              onDragOver={(e) => e.preventDefault()}
                              onDragEnter={(e) => { e.preventDefault(); setDragOverColumnId(status.id); }}
                              onDragLeave={(e) => {
                                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                  setDragOverColumnId(null);
                                }
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                setDragOverColumnId(null);
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
