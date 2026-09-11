"use client";

import React, { useState } from "react";
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
} from "lucide-react";

interface ListViewProps {
  issues: any[];
  statuses: any[];
  priorities?: any[];
  members?: any[];
  teams?: any[];
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
  onSelectIssue,
  onUpdateIssueStatus,
  onUpdateIssuePriority,
  onQuickCreateIssue,
  onOpenCreateModal,
}: ListViewProps) {
  const [filterPriority, setFilterPriority] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");

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

  const filteredIssues = issues.filter((i) => {
    if (filterPriority && i.priority !== filterPriority) return false;
    if (filterType && i.issueType !== filterType) return false;
    if (
      searchTerm &&
      !i.title.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !i.issueKey.toLowerCase().includes(searchTerm.toLowerCase())
    )
      return false;
    return true;
  });

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
    <div className="flex-1 p-6 space-y-4 max-w-7xl mx-auto w-full">
      {/* Table Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white/70 dark:bg-slate-900/60 p-3 rounded-2xl border border-slate-300 dark:border-slate-800 shadow-xs backdrop-blur-xs">
        <div className="flex items-center flex-wrap gap-2.5">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3" />
            <input
              type="text"
              placeholder="Filter by key or summary..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="text-xs pl-8 pr-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all w-60 shadow-2xs text-slate-800 dark:text-slate-100"
            />
          </div>

          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
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
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 text-xs rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-semibold"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          )}

          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-full ml-1">
            {filteredIssues.length} / {issues.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onQuickCreateIssue && (
            <button
              type="button"
              onClick={() => setIsAddingTask((prev) => !prev)}
              className="btn-primary px-3 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Task</span>
            </button>
          )}

          {onOpenCreateModal && (
            <button
              type="button"
              onClick={() => onOpenCreateModal()}
              className="btn-secondary px-3 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer"
              title="Open full creation form"
            >
              <span>Full Form</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Inline Quick Add Card in List View */}
      {isAddingTask && (
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border-2 border-blue-500/80 dark:border-blue-500/80 shadow-lg animate-in fade-in zoom-in-95 duration-150 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-300 dark:border-slate-800">
            <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-blue-600" />
              Create New Task
            </span>
            <button
              type="button"
              onClick={() => setIsAddingTask(false)}
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleCreateSubmit} className="space-y-3">
            <div>
              <input
                type="text"
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Task summary or title... (Press Enter to create)"
                className="w-full text-xs p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/80 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
              {/* Type */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Type</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="w-full text-xs p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold outline-none cursor-pointer"
                >
                  {ISSUE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Status</label>
                <select
                  value={newStatusId || statuses[0]?.id}
                  onChange={(e) => setNewStatusId(e.target.value)}
                  className="w-full text-xs p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold outline-none cursor-pointer"
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Priority */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Priority</label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value)}
                  className="w-full text-xs p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold outline-none cursor-pointer"
                  style={{ color: getPriorityInfo(newPriority).color }}
                >
                  {priorityList.map((p) => (
                    <option key={p.value} value={p.value}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Assignee */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Assignee</label>
                <select
                  value={newAssigneeId}
                  onChange={(e) => setNewAssigneeId(e.target.value)}
                  className="w-full text-xs p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium outline-none cursor-pointer truncate"
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
              </div>

              {/* Team */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Team</label>
                <select
                  value={newTeamId}
                  onChange={(e) => setNewTeamId(e.target.value)}
                  className="w-full text-xs p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium outline-none cursor-pointer truncate"
                >
                  <option value="">👥 No Team</option>
                  {teams.map((t: any) => (
                    <option key={t.id} value={t.id}>{"👥 " + t.name}</option>
                  ))}
                </select>
              </div>

              {/* Points */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 block mb-0.5">Points</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="pts"
                  value={newPoints}
                  onChange={(e) => setNewPoints(e.target.value)}
                  className="w-full text-xs p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none font-mono font-bold"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-300 dark:border-slate-800">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[11px] text-slate-400">Due:</span>
                <input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="text-xs bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddingTask(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newTitle.trim() || isSubmitting}
                  className="btn-primary px-4 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-1.5 disabled:opacity-50 shadow-xs"
                >
                  {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>Add Task</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Main Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-300 dark:border-slate-800 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                <th className="py-3 px-3.5 w-24">Type</th>
                <th className="py-3 px-3 w-28">Key</th>
                <th className="py-3 px-4 min-w-[240px]">Summary</th>
                <th className="py-3 px-3 w-32">Status</th>
                <th className="py-3 px-3 w-32">Priority</th>
                <th className="py-3 px-3 w-36">Assignee</th>
                <th className="py-3 px-3 w-28">Team</th>
                <th className="py-3 px-3 w-20 text-center">Pts</th>
                <th className="py-3 px-3.5 w-28">Due Date</th>
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
                    <td className="py-3 px-3 font-mono font-bold text-slate-600 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {issue.issueKey}
                    </td>

                    {/* Title */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1">
                          {issue.title}
                        </span>
                        {issue.epic && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold text-white w-max mt-1"
                            style={{ backgroundColor: issue.epic.color || "#8b5cf6" }}
                          >
                            <Zap className="w-2.5 h-2.5" />
                            {issue.epic.name}
                          </span>
                        )}
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
                    <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
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

                    {/* Assignee */}
                    <td className="py-3 px-3">
                      {issue.assignee ? (
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
                      )}
                    </td>

                    {/* Team */}
                    <td className="py-3 px-3">
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
                    <td className="py-3 px-3 font-mono font-bold text-center text-slate-700 dark:text-slate-300">
                      {issue.estimatePoints != null ? (
                        <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">
                          {issue.estimatePoints}
                        </span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">-</span>
                      )}
                    </td>

                    {/* Due Date */}
                    <td className="py-3 px-3.5 text-slate-500 dark:text-slate-400 text-[11px] font-medium">
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
