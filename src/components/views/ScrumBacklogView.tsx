"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Plus,
  Play,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Layers,
  ArrowRight,
  Pencil,
  Trash2,
  X,
  AlertCircle,
  Check,
  MoreHorizontal,
  User,
  Search,
  Filter,
  Sparkles,
  CheckSquare,
  Square,
  MinusSquare,
  GripVertical,
  UserCheck,
  AlertTriangle,
  Loader2,
  RotateCcw,
  ArrowUpRight,
  Users,
  Zap,
  Target,
} from "lucide-react";
import { showSuccess, showError } from "@/lib/toast";
import { StartSprintModal } from "@/components/sprints/StartSprintModal";

function highlightMatch(text: string, query: string) {
  if (!text || !query.trim()) return text;
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return text;
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="bg-blue-100 dark:bg-blue-900/80 text-blue-800 dark:text-blue-200 font-bold px-0.5 rounded"
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

interface ScrumBacklogViewProps {
  projectId: string;
  sprints: any[];
  issues: any[];
  statuses?: any[];
  priorities?: any[];
  members?: any[];
  teams?: any[];
  currentUser?: any;
  isProjectAdmin?: boolean;
  canCreateIssue?: boolean;
  onSelectIssue: (issue: any) => void;
  onUpdateStatus?: (issueId: string, statusId: string) => void;
  onRefresh: () => void;
}

export function ScrumBacklogView({
  projectId,
  sprints,
  issues,
  statuses = [],
  priorities = [],
  members = [],
  teams = [],
  currentUser,
  isProjectAdmin = false,
  canCreateIssue,
  onSelectIssue,
  onUpdateStatus,
  onRefresh,
}: ScrumBacklogViewProps) {
  // Sprint Modals state
  const [showCreateSprintModal, setShowCreateSprintModal] = useState(false);
  const [newSprintName, setNewSprintName] = useState("");
  const [newSprintGoal, setNewSprintGoal] = useState("");
  const [startingSprint, setStartingSprint] = useState<any | null>(null);
  const [completingSprint, setCompletingSprint] = useState<any | null>(null);
  const [retroNotes, setRetroNotes] = useState<string>("");
  const [velocityData, setVelocityData] = useState<any | null>(null);

  useEffect(() => {
    if (!projectId || projectId === "default") return;
    fetch(`/api/projects/${projectId}/velocity?limit=5`)
      .then((res) => res.json())
      .then((data) => {
        if (data.velocity) setVelocityData(data.velocity);
      })
      .catch(() => {});
  }, [projectId]);

  // Sprint Edit state
  const [editingSprint, setEditingSprint] = useState<any | null>(null);
  const [editSprintName, setEditSprintName] = useState("");
  const [editSprintGoal, setEditSprintGoal] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  // Inline Add Task to Sprint state
  const [inlineSprintId, setInlineSprintId] = useState<string | null>(null);
  const [inlineMode, setInlineMode] = useState<"existing" | "new">("existing");
  const [inlineTitle, setInlineTitle] = useState("");
  const [isExistingDropdownOpen, setIsExistingDropdownOpen] = useState(false);
  const [existingSearchQuery, setExistingSearchQuery] = useState("");
  const [inlineLoading, setInlineLoading] = useState(false);

  // Search & Navigation in Existing Task Dropdown
  const [activeSearchIndex, setActiveSearchIndex] = useState<number>(0);
  const [searchFilterTag, setSearchFilterTag] = useState<string>("ALL");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownListRef = useRef<HTMLDivElement>(null);

  // Multi-Selection State
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  // Multi-selection state for adding existing tasks to sprint
  const [selectedExistingIds, setSelectedExistingIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [activeBulkDropdown, setActiveBulkDropdown] = useState<"sprint" | "status" | "priority" | "assignee" | "team" | null>(null);

  // Drag and Drop State
  const [draggedIssueIds, setDraggedIssueIds] = useState<string[]>([]);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);

  // Interactive Dropdown States
  const [activeStatusMenu, setActiveStatusMenu] = useState<string | null>(null);
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);

  // Collapsible Sprint Sections
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const activeSprint = sprints.find((s) => s.status === "ACTIVE");
  const futureSprints = sprints.filter((s) => s.status === "FUTURE");
  const backlogIssues = useMemo(() => issues.filter((i) => !i.sprintId), [issues]);

  const userCanCreate = canCreateIssue ?? (
    currentUser?.isSuperAdmin || (
      Array.isArray(currentUser?.capabilities)
        ? currentUser.capabilities.includes("issues:create")
        : isProjectAdmin
    )
  );

  // Priority metadata helper
  const priorityList = useMemo(() => {
    return priorities.length > 0
      ? priorities
      : [
          { value: "CRITICAL", name: "Critical", color: "#ef4444" },
          { value: "HIGH", name: "High", color: "#f97316" },
          { value: "MEDIUM", name: "Medium", color: "#3b82f6" },
          { value: "LOW", name: "Low", color: "#64748b" },
        ];
  }, [priorities]);

  const getPriorityColor = (priority: string) => {
    const found = priorityList.find(
      (p) => p.value === priority || p.name?.toUpperCase() === priority?.toUpperCase()
    );
    if (found?.color) return found.color;
    switch (priority) {
      case "CRITICAL":
      case "HIGHEST":
        return "#ef4444";
      case "HIGH":
        return "#f97316";
      case "MEDIUM":
        return "#3b82f6";
      case "LOW":
      case "LOWEST":
        return "#64748b";
      default:
        return "#3b82f6";
    }
  };

  const getPriorityName = (priority: string) => {
    const found = priorityList.find(
      (p) => p.value === priority || p.name?.toUpperCase() === priority?.toUpperCase()
    );
    return found?.name || priority;
  };

  // Selection Helper Functions
  const toggleSelectIssue = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedIssueIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const isSectionAllSelected = (sectionIssues: any[]) => {
    if (sectionIssues.length === 0) return false;
    return sectionIssues.every((i) => selectedIssueIds.has(i.id));
  };

  const isSectionPartiallySelected = (sectionIssues: any[]) => {
    if (sectionIssues.length === 0) return false;
    const count = sectionIssues.filter((i) => selectedIssueIds.has(i.id)).length;
    return count > 0 && count < sectionIssues.length;
  };

  const toggleSelectSection = (sectionIssues: any[]) => {
    if (sectionIssues.length === 0) return;
    const allSelected = isSectionAllSelected(sectionIssues);
    setSelectedIssueIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        sectionIssues.forEach((i) => next.delete(i.id));
      } else {
        sectionIssues.forEach((i) => next.add(i.id));
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIssueIds(new Set());
    setActiveBulkDropdown(null);
  };

  const toggleSelectExisting = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedExistingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllExisting = (filteredList: any[]) => {
    const allSelected = filteredList.length > 0 && filteredList.every((i) => selectedExistingIds.has(i.id));
    setSelectedExistingIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        filteredList.forEach((i) => next.delete(i.id));
      } else {
        filteredList.forEach((i) => next.add(i.id));
      }
      return next;
    });
  };

  const handleBulkAddExistingToSprint = async (sprintId: string) => {
    if (selectedExistingIds.size === 0) return;
    const ids = Array.from(selectedExistingIds);
    setInlineLoading(true);
    try {
      const res = await fetch("/api/issues/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueIds: ids,
          updates: { sprintId },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(`Added ${ids.length} ${ids.length === 1 ? "task" : "tasks"} to sprint`);
        setSelectedExistingIds(new Set());
        setIsExistingDropdownOpen(false);
        setExistingSearchQuery("");
        setInlineSprintId(null);
        onRefresh();
      } else {
        showError(data.error || "Failed to add tasks to sprint");
      }
    } catch (err) {
      showError("Error adding tasks to sprint");
    } finally {
      setInlineLoading(false);
    }
  };

  const selectAllIssues = () => {
    setSelectedIssueIds(new Set(issues.map((i) => i.id)));
  };

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, issue: any) => {
    // If the dragged issue is in the selected set, drag all selected issues!
    const idsToDrag = selectedIssueIds.has(issue.id)
      ? Array.from(selectedIssueIds)
      : [issue.id];

    setDraggedIssueIds(idsToDrag);
    e.dataTransfer.setData("application/json", JSON.stringify({ issueIds: idsToDrag }));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    setDraggedIssueIds([]);
    setDragOverSectionId(null);
  };

  const handleDragOver = (e: React.DragEvent, sectionId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverSectionId !== sectionId) {
      setDragOverSectionId(sectionId);
    }
  };

  const handleDragLeave = (sectionId: string) => {
    if (dragOverSectionId === sectionId) {
      setDragOverSectionId(null);
    }
  };

  const handleDropOnSection = async (e: React.DragEvent, targetSprintId: string | null) => {
    e.preventDefault();
    setDragOverSectionId(null);

    let issueIds: string[] = [];
    try {
      const raw = e.dataTransfer.getData("application/json");
      if (raw) {
        const parsed = JSON.parse(raw);
        issueIds = parsed.issueIds || [];
      }
    } catch {
      // Fallback to state
      issueIds = draggedIssueIds;
    }

    if (!issueIds || issueIds.length === 0) return;

    // Execute bulk sprint assignment
    await executeBulkSprintMove(issueIds, targetSprintId);
  };

  // Bulk Operations Handlers
  const executeBulkSprintMove = async (ids: string[], sprintId: string | null) => {
    setBulkLoading(true);
    try {
      const res = await fetch("/api/issues/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueIds: ids,
          updates: { sprintId: sprintId || null },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const destName = sprintId
          ? sprints.find((s) => s.id === sprintId)?.name || "Sprint"
          : "Product Backlog";
        showSuccess(`Moved ${ids.length} ${ids.length === 1 ? "issue" : "issues"} to ${destName}`);
        clearSelection();
        onRefresh();
      } else {
        showError(data.error || "Failed to move issues");
      }
    } catch (err) {
      showError("Network error during bulk move");
    } finally {
      setBulkLoading(false);
      setActiveBulkDropdown(null);
    }
  };

  const handleBulkChangeStatus = async (statusId: string) => {
    if (selectedIssueIds.size === 0) return;
    const ids = Array.from(selectedIssueIds);
    setBulkLoading(true);
    try {
      const res = await fetch("/api/issues/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueIds: ids,
          updates: { statusId },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const stName = statuses.find((s) => s.id === statusId)?.name || "Status";
        showSuccess(`Set status to "${stName}" for ${ids.length} ${ids.length === 1 ? "issue" : "issues"}`);
        clearSelection();
        onRefresh();
      } else {
        showError(data.error || "Failed to update status");
      }
    } catch (err) {
      showError("Network error updating status");
    } finally {
      setBulkLoading(false);
      setActiveBulkDropdown(null);
    }
  };

  const handleBulkChangePriority = async (priority: string) => {
    if (selectedIssueIds.size === 0) return;
    const ids = Array.from(selectedIssueIds);
    setBulkLoading(true);
    try {
      const res = await fetch("/api/issues/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueIds: ids,
          updates: { priority },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(`Set priority to ${getPriorityName(priority)} for ${ids.length} ${ids.length === 1 ? "issue" : "issues"}`);
        clearSelection();
        onRefresh();
      } else {
        showError(data.error || "Failed to update priority");
      }
    } catch (err) {
      showError("Network error updating priority");
    } finally {
      setBulkLoading(false);
      setActiveBulkDropdown(null);
    }
  };

  const handleBulkChangeAssignee = async (assigneeId: string | null) => {
    if (selectedIssueIds.size === 0) return;
    const ids = Array.from(selectedIssueIds);
    setBulkLoading(true);
    try {
      const res = await fetch("/api/issues/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueIds: ids,
          updates: { assigneeId: assigneeId || null },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        let assigneeName = "Unassigned";
        if (assigneeId) {
          const m = members.find((mem: any) => mem.userId === assigneeId || mem.user?.id === assigneeId);
          assigneeName = m?.user?.firstName ? `${m.user.firstName} ${m.user.lastName || ""}`.trim() : "Member";
        }
        showSuccess(`Assigned ${ids.length} ${ids.length === 1 ? "issue" : "issues"} to ${assigneeName}`);
        clearSelection();
        onRefresh();
      } else {
        showError(data.error || "Failed to update assignee");
      }
    } catch (err) {
      showError("Network error updating assignee");
    } finally {
      setBulkLoading(false);
      setActiveBulkDropdown(null);
    }
  };

  const handleBulkChangeTeam = async (teamId: string | null) => {
    if (selectedIssueIds.size === 0) return;
    const ids = Array.from(selectedIssueIds);
    setBulkLoading(true);
    try {
      const res = await fetch("/api/issues/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueIds: ids,
          updates: { teamId: teamId || null },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        let teamName = "No Team (Unassigned)";
        if (teamId) {
          const t = teams.find((tm: any) => tm.id === teamId);
          teamName = t?.name || "Team";
        }
        showSuccess(`Assigned ${ids.length} ${ids.length === 1 ? "issue" : "issues"} to ${teamName}`);
        clearSelection();
        onRefresh();
      } else {
        showError(data.error || "Failed to update team");
      }
    } catch (err) {
      showError("Network error updating team");
    } finally {
      setBulkLoading(false);
      setActiveBulkDropdown(null);
    }
  };

  const handleBulkDeleteConfirm = async () => {
    if (selectedIssueIds.size === 0) return;
    const ids = Array.from(selectedIssueIds);
    setBulkLoading(true);
    try {
      const res = await fetch("/api/issues/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueIds: ids }),
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(`Deleted ${data.deletedCount || ids.length} ${ids.length === 1 ? "issue" : "issues"} successfully`);
        setShowBulkDeleteModal(false);
        clearSelection();
        onRefresh();
      } else {
        showError(data.error || "Failed to delete issues");
      }
    } catch (err) {
      showError("Network error deleting issues");
    } finally {
      setBulkLoading(false);
    }
  };

  // Sprint CRUD Handlers
  const handleCreateSprint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSprintName.trim()) return;

    try {
      const res = await fetch("/api/sprints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name: newSprintName, goal: newSprintGoal }),
      });
      if (res.ok) {
        setNewSprintName("");
        setNewSprintGoal("");
        setShowCreateSprintModal(false);
        showSuccess("Sprint created successfully");
        onRefresh();
      } else {
        showError("Failed to create sprint");
      }
    } catch (e) {
      showError("Error creating sprint");
    }
  };

  const handleEditSprintSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSprint || !editSprintName.trim()) return;

    setEditLoading(true);
    try {
      const res = await fetch("/api/sprints", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sprintId: editingSprint.id,
          name: editSprintName.trim(),
          goal: editSprintGoal.trim() || null,
        }),
      });
      if (res.ok) {
        showSuccess("Sprint details updated");
        setEditingSprint(null);
        onRefresh();
      } else {
        showError("Failed to update sprint details");
      }
    } catch (err) {
      showError("Network error while updating sprint");
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteSprint = async (sprint: any) => {
    if (
      !confirm(
        `Are you sure you want to delete "${sprint.name}"?\n\nAny assigned issues will be safely moved back to the Product Backlog.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/sprints?sprintId=${sprint.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        showSuccess(`Sprint "${sprint.name}" deleted successfully`);
        if (editingSprint?.id === sprint.id) setEditingSprint(null);
        onRefresh();
      } else {
        showError("Failed to delete sprint");
      }
    } catch (err) {
      showError("Network error while deleting sprint");
    }
  };

  const handleStartSprint = async (sprintId: string) => {
    try {
      const res = await fetch("/api/sprints", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sprintId, status: "ACTIVE" }),
      });
      if (res.ok) {
        showSuccess("Sprint started successfully");
        onRefresh();
      } else {
        showError("Failed to start sprint");
      }
    } catch (e) {
      showError("Error starting sprint");
    }
  };

  const handleCompleteSprint = async (
    sprintId: string,
    rolloverToSprintId?: string,
    retrospectiveNotes?: string
  ) => {
    try {
      const res = await fetch("/api/sprints", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sprintId,
          status: "COMPLETED",
          rolloverToSprintId: rolloverToSprintId || null,
          retrospectiveNotes: retrospectiveNotes || null,
        }),
      });
      if (res.ok) {
        showSuccess("Sprint completed and velocity recorded!");
        setCompletingSprint(null);
        setRetroNotes("");
        onRefresh();
      } else {
        const data = await res.json();
        showError(data.error || "Failed to complete sprint");
      }
    } catch (e) {
      showError("Error completing sprint");
    }
  };

  const handleQuickCreateIssue = async (e: React.FormEvent, sprintId: string | null) => {
    e.preventDefault();
    if (!inlineTitle.trim()) return;

    setInlineLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: inlineTitle.trim(),
          sprintId: sprintId || undefined,
        }),
      });
      if (res.ok) {
        showSuccess("Task created successfully");
        setInlineTitle("");
        setInlineSprintId(null);
        onRefresh();
      } else {
        showError("Failed to create task");
      }
    } catch (err) {
      showError("Error creating task");
    } finally {
      setInlineLoading(false);
    }
  };

  const handleAddExistingToSprint = async (issueId: string, sprintId: string) => {
    if (!issueId) return;
    const issueToMove = issues.find((i) => i.id === issueId);
    setInlineLoading(true);
    try {
      const res = await fetch(`/api/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sprintId }),
      });
      if (res.ok) {
        showSuccess(`Added ${issueToMove?.issueKey || "task"} to sprint`);
        setIsExistingDropdownOpen(false);
        setExistingSearchQuery("");
        setInlineSprintId(null);
        onRefresh();
      } else {
        showError("Failed to add task to sprint");
      }
    } catch (e) {
      showError("Error adding task to sprint");
    } finally {
      setInlineLoading(false);
    }
  };

  const handleDirectStatusChange = async (issueId: string, statusId: string) => {
    setActiveStatusMenu(null);
    if (onUpdateStatus) {
      onUpdateStatus(issueId, statusId);
      showSuccess("Status updated");
    } else {
      try {
        const res = await fetch(`/api/issues/${issueId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statusId }),
        });
        if (res.ok) {
          showSuccess("Status updated");
          onRefresh();
        } else {
          showError("Failed to update status");
        }
      } catch (err) {
        showError("Error updating status");
      }
    }
  };

  const handleDeleteSingleIssue = async (issueId: string, issueKey: string) => {
    setActiveActionMenu(null);
    if (!confirm(`Are you sure you want to delete ${issueKey}?`)) return;

    try {
      const res = await fetch(`/api/issues/${issueId}`, { method: "DELETE" });
      if (res.ok) {
        showSuccess(`Deleted ${issueKey}`);
        selectedIssueIds.delete(issueId);
        onRefresh();
      } else {
        showError("Failed to delete issue");
      }
    } catch (err) {
      showError("Error deleting issue");
    }
  };

  const handlePriorityChangeSingle = async (issueId: string, priority: string) => {
    setActiveActionMenu(null);
    try {
      const res = await fetch(`/api/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      });
      if (res.ok) {
        showSuccess(`Priority set to ${getPriorityName(priority)}`);
        onRefresh();
      }
    } catch (e) {
      showError("Error updating priority");
    }
  };

  // Render Section Header Checkbox
  const renderSectionSelectCheckbox = (sectionIssues: any[]) => {
    const isAll = isSectionAllSelected(sectionIssues);
    const isPartial = isSectionPartiallySelected(sectionIssues);

    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleSelectSection(sectionIssues);
        }}
        className="p-1 rounded-md text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        title={isAll ? "Deselect all in section" : "Select all in section"}
        aria-label="Select all issues in section"
      >
        {isAll ? (
          <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        ) : isPartial ? (
          <MinusSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        ) : (
          <Square className="w-4 h-4 text-slate-300 dark:text-slate-600 hover:text-slate-400" />
        )}
      </button>
    );
  };

  // Render Single Issue Row with Checkbox, Drag Handle, and Dropdowns
  const renderIssueRow = (issue: any) => {
    const isSelected = selectedIssueIds.has(issue.id);
    const isDone =
      issue.status?.category === "DONE" ||
      issue.status?.name?.toLowerCase().includes("done") ||
      issue.status?.name?.toLowerCase().includes("closed");
    const isInProgress =
      issue.status?.category === "IN_PROGRESS" ||
      issue.status?.name?.toLowerCase().includes("progress");

    const userObj = issue.assignee;
    const fullName = userObj ? `${userObj.firstName || ""} ${userObj.lastName || ""}`.trim() || userObj.email : "";
    const initials = userObj?.firstName ? `${userObj.firstName[0]}${userObj.lastName?.[0] || ""}`.toUpperCase() : "??";

    return (
      <div
        key={issue.id}
        draggable
        onDragStart={(e) => handleDragStart(e, issue)}
        onDragEnd={handleDragEnd}
        onClick={() => onSelectIssue(issue)}
        className={`flex items-center justify-between p-2.5 rounded-xl text-xs cursor-pointer border transition-all shadow-2xs group gap-2.5 sm:gap-3 ${
          isSelected
            ? "bg-blue-50/90 dark:bg-blue-950/50 border-blue-400 dark:border-blue-700 shadow-sm ring-1 ring-blue-400/40"
            : "bg-white dark:bg-slate-900/90 hover:bg-slate-50 dark:hover:bg-slate-800/80 border-slate-300 dark:border-slate-800"
        }`}
      >
        {/* Left: Drag handle + Checkbox + Priority + Key + Title */}
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
          {/* Drag Handle */}
          <div
            className="text-slate-300 dark:text-slate-600 hover:text-slate-500 cursor-grab active:cursor-grabbing p-0.5"
            title="Drag to reorder or move between sprints"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="w-3.5 h-3.5" />
          </div>

          {/* Row Checkbox */}
          <div onClick={(e) => toggleSelectIssue(issue.id, e)} className="shrink-0">
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400 cursor-pointer" />
            ) : (
              <Square className="w-4 h-4 text-slate-300 dark:text-slate-600 hover:text-blue-500 cursor-pointer" />
            )}
          </div>

          {/* Priority Dot */}
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: getPriorityColor(issue.priority) }}
            title={`Priority: ${getPriorityName(issue.priority)}`}
          />

          {/* Issue Key */}
          <span className="font-mono font-bold text-blue-600 dark:text-blue-400 shrink-0">
            {issue.issueKey}
          </span>

          {/* Title */}
          <span className={`font-medium truncate transition-colors ${
            isSelected
              ? "text-blue-950 dark:text-blue-100 font-semibold"
              : "text-slate-800 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400"
          }`}>
            {issue.title}
          </span>

          {/* Epic & Epic Status */}
          {issue.epic && (
            <div className="hidden md:flex items-center gap-1 shrink-0 ml-1">
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-white shadow-2xs"
                style={{ backgroundColor: issue.epic.color || "#8b5cf6" }}
                title={`Epic: ${issue.epic.name}`}
              >
                <Zap className="w-2.5 h-2.5" />
                <span className="truncate max-w-[110px]">{issue.epic.name}</span>
              </span>
              {issue.epic.status && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-purple-100/90 text-purple-700 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shadow-2xs"
                  title={`Epic Status: ${issue.epic.status}`}
                >
                  {issue.epic.status}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: Interactive Dropdowns & Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          {/* Story Points */}
          <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-700/60 hidden sm:inline-block">
            {issue.estimatePoints ? `${issue.estimatePoints} pts` : "—"}
          </span>

          {/* Assignee Avatar */}
          {userObj ? (
            <div
              className="w-5 h-5 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-[9px] flex items-center justify-center shrink-0 uppercase shadow-2xs"
              title={`Assigned to: ${fullName}`}
            >
              {initials}
            </div>
          ) : (
            <div
              className="w-5 h-5 rounded-full border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-400"
              title="Unassigned"
            >
              <User className="w-3 h-3" />
            </div>
          )}

          {/* 1. Interactive Status Change Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setActiveStatusMenu(activeStatusMenu === issue.id ? null : issue.id);
                setActiveActionMenu(null);
              }}
              className="px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1.5 border transition-all cursor-pointer"
              style={
                issue.status?.color
                  ? {
                      backgroundColor: `${issue.status?.color}15`,
                      borderColor: `${issue.status?.color}40`,
                      color: issue.status?.color,
                    }
                  : undefined
              }
              title="Click to change status"
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  backgroundColor:
                    issue.status?.color ||
                    (isDone ? "#10b981" : isInProgress ? "#3b82f6" : "#94a3b8"),
                }}
              />
              <span className="truncate max-w-[80px] sm:max-w-none">{issue.status?.name || "To Do"}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>

            {activeStatusMenu === issue.id && (
              <div className="absolute right-0 top-full mt-1.5 w-44 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl shadow-2xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-300 dark:border-slate-800">
                  Change Status
                </div>
                {statuses.map((st) => {
                  const isCur = st.id === issue.statusId;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => handleDirectStatusChange(issue.id, st.id)}
                      className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                        isCur
                          ? "bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-bold"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: st.color || "#94a3b8" }}
                        />
                        <span>{st.name}</span>
                      </div>
                      {isCur && <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2. Move to Sprint Dropdown */}
          <select
            value={issue.sprintId || ""}
            onChange={(e) => executeBulkSprintMove([issue.id], e.target.value || null)}
            className="text-[10px] font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 outline-none cursor-pointer hover:border-slate-400 text-slate-700 dark:text-slate-300 max-w-[110px] sm:max-w-none"
            title="Move issue to another sprint or backlog"
          >
            <option value="">Backlog</option>
            {activeSprint && (
              <option value={activeSprint.id}>
                {activeSprint.name} (Active)
              </option>
            )}
            {futureSprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* 3. Task Dropdown Actions Menu (...) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setActiveActionMenu(activeActionMenu === issue.id ? null : issue.id);
                setActiveStatusMenu(null);
              }}
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="More task actions"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {activeActionMenu === issue.id && (
              <div className="absolute right-0 top-full mt-1.5 w-44 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl shadow-2xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
                <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-300 dark:border-slate-800">
                  Priority
                </div>
                {priorityList.map((prio) => (
                  <button
                    key={prio.value}
                    type="button"
                    onClick={() => handlePriorityChangeSingle(issue.id, prio.value)}
                    className={`w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer ${
                      issue.priority === prio.value
                        ? "font-bold text-blue-600 dark:text-blue-400"
                        : "text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: prio.color || getPriorityColor(prio.value) }}
                      />
                      <span>{prio.name || prio.value}</span>
                    </div>
                    {issue.priority === prio.value && <Check className="w-3 h-3 text-blue-600" />}
                  </button>
                ))}

                <div className="my-1 border-t border-slate-300 dark:border-slate-800" />

                <button
                  type="button"
                  onClick={() => handleDeleteSingleIssue(issue.id, issue.issueKey)}
                  className="w-full px-3 py-1.5 text-left text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-2 cursor-pointer font-medium"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Issue</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Sprint Capacity Guidance Badge (Planned vs Rolling Velocity)
  const renderSprintCapacityBadge = (sprintIssues: any[]) => {
    const primaryIssues = sprintIssues.filter((i) => !i.parentIssueId);
    const plannedPoints = primaryIssues.reduce((acc, i) => acc + (i.estimatePoints || 0), 0);
    const unestimatedCount = primaryIssues.filter((i) => i.estimatePoints == null || i.estimatePoints === 0).length;
    const avgVelocity = velocityData?.rolling3SprintAverage || velocityData?.averageVelocity || 0;

    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {avgVelocity > 0 ? (
          plannedPoints > avgVelocity * 1.15 ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60 shadow-2xs"
              title={`Planned: ${plannedPoints} pts exceeds rolling team velocity (${avgVelocity} pts) by +${plannedPoints - avgVelocity} pts`}
            >
              <AlertTriangle className="w-3 h-3 text-rose-500" />
              <span>Overcommitted ({plannedPoints}/{avgVelocity} pts)</span>
            </span>
          ) : plannedPoints >= avgVelocity * 0.75 ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60 shadow-2xs"
              title={`Planned: ${plannedPoints} pts aligns with rolling team velocity (${avgVelocity} pts)`}
            >
              <Target className="w-3 h-3 text-emerald-500" />
              <span>Optimal Scope ({plannedPoints}/{avgVelocity} pts)</span>
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700 shadow-2xs"
              title={`Planned: ${plannedPoints} pts • Team Velocity: ${avgVelocity} pts (Available room for +${avgVelocity - plannedPoints} pts)`}
            >
              <Zap className="w-3 h-3 text-amber-500" />
              <span>{plannedPoints} / {avgVelocity} pts velocity</span>
            </span>
          )
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            <span>{plannedPoints} pts</span>
          </span>
        )}

        {unestimatedCount > 0 && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60"
            title={`${unestimatedCount} issues in this sprint have no story point estimates`}
          >
            <span>{unestimatedCount} unestimated</span>
          </span>
        )}
      </div>
    );
  };

  // Sprint Progress Bar
  const renderSprintProgress = (sprintIssues: any[]) => {
    if (sprintIssues.length === 0) return null;
    const doneCount = sprintIssues.filter(
      (i) =>
        i.status?.category === "DONE" ||
        i.status?.name?.toLowerCase().includes("done") ||
        i.status?.name?.toLowerCase().includes("closed")
    ).length;
    const inProgressCount = sprintIssues.filter(
      (i) =>
        i.status?.category === "IN_PROGRESS" ||
        i.status?.name?.toLowerCase().includes("progress")
    ).length;
    const todoCount = sprintIssues.length - doneCount - inProgressCount;
    const pct = Math.round((doneCount / sprintIssues.length) * 100);

    return (
      <div className="flex items-center gap-2 mt-2">
        <div className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden flex">
          <div className="bg-emerald-500 h-full transition-all" style={{ width: `${pct}%` }} />
          <div
            className="bg-blue-500 h-full transition-all"
            style={{ width: `${Math.round((inProgressCount / sprintIssues.length) * 100)}%` }}
          />
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 shrink-0">
          <span className="text-slate-600 dark:text-slate-300">{todoCount} To Do</span>
          <span>·</span>
          <span className="text-blue-600 dark:text-blue-400">{inProgressCount} In Prog</span>
          <span>·</span>
          <span className="text-emerald-600 dark:text-emerald-400">{doneCount} Done</span>
          <span>({pct}%)</span>
        </div>
      </div>
    );
  };

  // Add Task to Sprint Inline Box
  const renderSprintAddTaskBox = (sprint: any) => {
    if (!userCanCreate) return null;
    const isAdding = inlineSprintId === sprint.id;
    const availableIssues = issues.filter((i) => i.sprintId !== sprint.id);
    const filteredIssues = availableIssues.filter((i) => {
      if (searchFilterTag === "BACKLOG" && i.sprintId) return false;
      if (searchFilterTag === "BUGS" && i.issueType !== "BUG") return false;
      if (searchFilterTag === "STORIES" && i.issueType !== "STORY") return false;
      if (searchFilterTag === "HIGH" && !["CRITICAL", "HIGHEST", "HIGH"].includes(i.priority)) return false;

      if (!existingSearchQuery.trim()) return true;
      const tokens = existingSearchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const searchableText = [
        i.issueKey,
        i.title,
        i.priority,
        i.issueType,
        i.status?.name || "",
        i.estimatePoints ? `${i.estimatePoints} pts` : "",
      ]
        .join(" ")
        .toLowerCase();

      return tokens.every((token) => searchableText.includes(token));
    });

    if (!isAdding) {
      return (
        <button
          type="button"
          onClick={() => {
            if (onSelectIssue) onSelectIssue("new");
          }}
          className="w-full mt-2 py-2 border border-dashed border-slate-300 dark:border-slate-800 hover:border-blue-400 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer bg-slate-50/50 dark:bg-slate-900/40"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Task to Sprint</span>
        </button>
      );
    }

    return (
      <div className="pt-3 pb-2 border-t border-slate-300 dark:border-slate-800/80 space-y-2.5 animate-in fade-in duration-150 relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-300 dark:border-slate-700/60">
            <button
              type="button"
              onClick={() => {
                setInlineMode("existing");
                setIsExistingDropdownOpen(true);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                inlineMode === "existing"
                  ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>Select Existing Task ({availableIssues.length})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setInlineMode("new");
                setIsExistingDropdownOpen(false);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                inlineMode === "new"
                  ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Plus className="w-3 h-3" />
              <span>Create New Task</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setInlineSprintId(null);
              setInlineTitle("");
              setIsExistingDropdownOpen(false);
              setExistingSearchQuery("");
            }}
            className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer font-medium"
          >
            Cancel
          </button>
        </div>

        {inlineMode === "existing" ? (
          <div className="relative">
            {/* Searchable Dropdown Trigger */}
            <button
              type="button"
              onClick={() => setIsExistingDropdownOpen(!isExistingDropdownOpen)}
              className="w-full flex items-center justify-between text-xs py-2.5 px-3.5 rounded-xl border border-blue-400/80 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:border-blue-500 transition-colors cursor-pointer shadow-2xs group text-left"
            >
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 min-w-0">
                <Search className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span className="truncate">
                  {selectedExistingIds.size > 0
                    ? `${selectedExistingIds.size} tasks selected for addition`
                    : existingSearchQuery
                    ? `Search: "${existingSearchQuery}"`
                    : "Search task by key or title..."}
                </span>
                {selectedExistingIds.size > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/80 dark:text-blue-300">
                    {selectedExistingIds.size} selected
                  </span>
                )}
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-blue-500 transition-colors shrink-0" />
            </button>

            {isExistingDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setIsExistingDropdownOpen(false)}
                />
                <div className="absolute left-0 right-0 top-full mt-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl shadow-2xl p-3.5 z-40 animate-in fade-in zoom-in-95 duration-150 space-y-3">
                  {/* Search bar */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Type to search tasks..."
                      value={existingSearchQuery}
                      onChange={(e) => setExistingSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-8 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                    />
                    {existingSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setExistingSearchQuery("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Multi-Select Toolbar Controls */}
                  <div className="flex items-center justify-between gap-2 px-1 py-1.5 bg-slate-50/80 dark:bg-slate-800/50 rounded-xl border border-slate-300 dark:border-slate-800/80">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleSelectAllExisting(filteredIssues)}
                        className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 hover:text-blue-600 font-semibold cursor-pointer pl-1.5"
                        title="Toggle selection of all filtered tasks"
                      >
                        {filteredIssues.length > 0 && filteredIssues.every((i) => selectedExistingIds.has(i.id)) ? (
                          <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        ) : filteredIssues.some((i) => selectedExistingIds.has(i.id)) ? (
                          <MinusSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400" />
                        )}
                        <span>Select All ({filteredIssues.length})</span>
                      </button>

                      {selectedExistingIds.size > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedExistingIds(new Set())}
                          className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 underline cursor-pointer"
                        >
                          Clear ({selectedExistingIds.size})
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={inlineLoading || selectedExistingIds.size === 0}
                      onClick={() => handleBulkAddExistingToSprint(sprint.id)}
                      className="btn-primary px-3 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-1.5 disabled:opacity-40 cursor-pointer shadow-2xs"
                    >
                      {inlineLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Adding...</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add {selectedExistingIds.size > 0 ? `(${selectedExistingIds.size})` : ""} to Sprint</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Task List with Checkboxes */}
                  <div
                    ref={dropdownListRef}
                    className="max-h-60 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar"
                  >
                    {filteredIssues.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400">
                        No matching tasks found
                      </div>
                    ) : (
                      filteredIssues.map((issue, idx) => {
                        const isSelected = selectedExistingIds.has(issue.id);
                        return (
                          <div
                            key={issue.id}
                            data-index={idx}
                            onClick={() => toggleSelectExisting(issue.id)}
                            className={`p-2.5 rounded-xl text-xs flex items-center justify-between cursor-pointer transition-all border ${
                              isSelected
                                ? "bg-blue-50/90 dark:bg-blue-950/60 border-blue-400 dark:border-blue-700 text-blue-950 dark:text-blue-100 font-semibold shadow-2xs"
                                : idx === activeSearchIndex
                                ? "bg-slate-100/90 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700/60 text-slate-900 dark:text-slate-100"
                                : "hover:bg-slate-50 dark:hover:bg-slate-800/50 border-transparent text-slate-700 dark:text-slate-200"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              {/* Checkbox */}
                              <div onClick={(e) => toggleSelectExisting(issue.id, e)} className="shrink-0">
                                {isSelected ? (
                                  <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400 cursor-pointer" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-300 dark:text-slate-600 hover:text-blue-500 cursor-pointer" />
                                )}
                              </div>

                              {/* Priority Dot */}
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: getPriorityColor(issue.priority) }}
                                title={`Priority: ${getPriorityName(issue.priority)}`}
                              />

                              {/* Issue Key */}
                              <span className="font-mono font-bold text-blue-600 dark:text-blue-400 shrink-0">
                                {issue.issueKey}
                              </span>

                              {/* Title */}
                              <span className="truncate">
                                {highlightMatch(issue.title, existingSearchQuery)}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                              {/* Story Points */}
                              <span className="text-[10px] text-slate-400 font-mono">
                                {issue.estimatePoints ? `${issue.estimatePoints} pts` : ""}
                              </span>

                              {/* Instant Add Single Task Button */}
                              <button
                                type="button"
                                title="Add only this task immediately"
                                onClick={() => handleAddExistingToSprint(issue.id, sprint.id)}
                                className="px-2 py-0.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded-lg transition-colors cursor-pointer border border-blue-200/80 dark:border-blue-800/80 shrink-0"
                              >
                                + Add
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Sticky Footer when multiple items selected */}
                  {selectedExistingIds.size > 0 && (
                    <div className="pt-2 border-t border-slate-300 dark:border-slate-800 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {selectedExistingIds.size} {selectedExistingIds.size === 1 ? "task" : "tasks"} selected
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedExistingIds(new Set())}
                          className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          disabled={inlineLoading}
                          onClick={() => handleBulkAddExistingToSprint(sprint.id)}
                          className="btn-primary px-3.5 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add {selectedExistingIds.size} Tasks to Sprint</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <form
            onSubmit={(e) => handleQuickCreateIssue(e, sprint.id)}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              autoFocus
              placeholder="New task title... press Enter to create"
              value={inlineTitle}
              onChange={(e) => setInlineTitle(e.target.value)}
              className="flex-1 text-xs py-2 px-3 rounded-xl border border-blue-400 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 shadow-2xs text-slate-800 dark:text-slate-100 font-medium"
            />
            <button
              type="submit"
              disabled={inlineLoading || !inlineTitle.trim()}
              className="btn-primary px-4 py-2 text-xs font-semibold rounded-xl disabled:opacity-50 cursor-pointer shadow-2xs whitespace-nowrap"
            >
              {inlineLoading ? "Creating..." : "+ Add"}
            </button>
          </form>
        )}
      </div>
    );
  };

  return (
    <div
      className="w-full max-w-7xl mx-auto p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6 pb-28 relative"
      onClick={() => {
        setActiveStatusMenu(null);
        setActiveActionMenu(null);
        setActiveBulkDropdown(null);
      }}
    >
      {/* Top Header & Overview Bar (Sticky) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md p-3 sm:p-4 rounded-2xl border border-slate-300 dark:border-slate-800 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Sprint & Backlog Planning</h2>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
              {issues.length} {issues.length === 1 ? "Issue" : "Issues"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Organize iterations, estimate team capacity, and drag tasks between sprints
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {selectedIssueIds.size === 0 ? (
            <button
              type="button"
              onClick={selectAllIssues}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-300 dark:border-slate-700 transition-colors cursor-pointer"
            >
              Select All ({issues.length})
            </button>
          ) : (
            <button
              type="button"
              onClick={clearSelection}
              className="px-3 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 rounded-xl border border-blue-200 dark:border-blue-800 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Deselect ({selectedIssueIds.size})</span>
            </button>
          )}

          {userCanCreate && (
            <button
              onClick={() => setShowCreateSprintModal(true)}
              className="btn-primary flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-xl cursor-pointer shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Sprint</span>
            </button>
          )}
        </div>
      </div>

      {/* ACTIVE SPRINT */}
      {activeSprint && (() => {
        const sprintIssues = issues.filter((i) => i.sprintId === activeSprint.id);
        const totalPoints = sprintIssues.reduce((acc, i) => acc + (i.estimatePoints || 0), 0);
        const isCollapsed = Boolean(collapsed[activeSprint.id]);
        const isDragTarget = dragOverSectionId === activeSprint.id;

        return (
          <div
            onDragOver={(e) => handleDragOver(e, activeSprint.id)}
            onDragLeave={() => handleDragLeave(activeSprint.id)}
            onDrop={(e) => handleDropOnSection(e, activeSprint.id)}
            className={`bg-white dark:bg-slate-900/90 rounded-2xl border p-4 shadow-sm space-y-3 transition-all ${
              isDragTarget
                ? "border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/30 bg-blue-50/20 dark:bg-blue-950/20 shadow-md"
                : "border-blue-200 dark:border-blue-900/80"
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-300 dark:border-slate-800/80 gap-2 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Section Checkbox */}
                {renderSectionSelectCheckbox(sprintIssues)}

                <button
                  type="button"
                  onClick={() => toggleCollapse(activeSprint.id)}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 transition-colors cursor-pointer"
                >
                  {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <h3 className="text-xs font-bold text-slate-900 dark:text-white truncate">{activeSprint.name}</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/80 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/60 shrink-0">
                  ACTIVE
                </span>
                <span className="text-[11px] text-slate-400 font-mono shrink-0">
                  ({sprintIssues.length} issues · {totalPoints} pts)
                </span>
                {renderSprintCapacityBadge(sprintIssues)}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setEditingSprint(activeSprint);
                    setEditSprintName(activeSprint.name || "");
                    setEditSprintGoal(activeSprint.goal || "");
                  }}
                  className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                  title="Edit Sprint details"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSprint(activeSprint)}
                  className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                  title="Delete Sprint"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setCompletingSprint(activeSprint)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/70 dark:text-emerald-300 rounded-xl border border-emerald-200 dark:border-emerald-800/80 cursor-pointer shadow-2xs"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Complete Sprint</span>
                </button>
              </div>
            </div>

            {activeSprint.goal && (
              <p className="text-xs text-slate-500 dark:text-slate-400 italic">Goal: {activeSprint.goal}</p>
            )}

            {renderSprintProgress(sprintIssues)}

            {!isCollapsed && (
              <div className="mt-3 space-y-1.5">
                {sprintIssues.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-300 dark:border-slate-800 rounded-xl">
                    No tasks in this sprint yet. Drag issues here or use the button below.
                  </div>
                ) : (
                  sprintIssues.map((issue) => renderIssueRow(issue))
                )}

                {/* Inline Add Task to Active Sprint */}
                {renderSprintAddTaskBox(activeSprint)}
              </div>
            )}
          </div>
        );
      })()}

      {/* FUTURE SPRINTS */}
      {futureSprints.map((sprint) => {
        const sprintIssues = issues.filter((i) => i.sprintId === sprint.id);
        const totalPoints = sprintIssues.reduce((acc, i) => acc + (i.estimatePoints || 0), 0);
        const isCollapsed = Boolean(collapsed[sprint.id]);
        const isDragTarget = dragOverSectionId === sprint.id;

        return (
          <div
            key={sprint.id}
            onDragOver={(e) => handleDragOver(e, sprint.id)}
            onDragLeave={() => handleDragLeave(sprint.id)}
            onDrop={(e) => handleDropOnSection(e, sprint.id)}
            className={`bg-white dark:bg-slate-900/90 rounded-2xl border p-4 shadow-2xs space-y-3 transition-all ${
              isDragTarget
                ? "border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/30 bg-blue-50/20 dark:bg-blue-950/20 shadow-md"
                : "border-slate-300 dark:border-slate-800"
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-300 dark:border-slate-800/80 gap-2 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Section Checkbox */}
                {renderSectionSelectCheckbox(sprintIssues)}

                <button
                  type="button"
                  onClick={() => toggleCollapse(sprint.id)}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 transition-colors cursor-pointer"
                >
                  {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{sprint.name}</h3>
                <span className="text-[11px] text-slate-400 font-mono shrink-0">
                  ({sprintIssues.length} issues · {totalPoints} pts)
                </span>
                {renderSprintCapacityBadge(sprintIssues)}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setEditingSprint(sprint);
                    setEditSprintName(sprint.name || "");
                    setEditSprintGoal(sprint.goal || "");
                  }}
                  className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                  title="Edit Sprint details"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSprint(sprint)}
                  className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                  title="Delete Sprint"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setStartingSprint(sprint)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300 rounded-xl border border-blue-200 dark:border-blue-800/80 cursor-pointer transition-colors shadow-2xs"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Start Sprint</span>
                </button>
              </div>
            </div>

            {sprint.goal && (
              <p className="text-xs text-slate-500 dark:text-slate-400 italic">Goal: {sprint.goal}</p>
            )}

            {renderSprintProgress(sprintIssues)}

            {!isCollapsed && (
              <div className="mt-3 space-y-1.5">
                {sprintIssues.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-300 dark:border-slate-800 rounded-xl">
                    Plan this sprint by dragging backlog issues here, or click Add Task below.
                  </div>
                ) : (
                  sprintIssues.map((issue) => renderIssueRow(issue))
                )}

                {/* Inline Add Task to this Sprint */}
                {renderSprintAddTaskBox(sprint)}
              </div>
            )}
          </div>
        );
      })}

      {/* PRODUCT BACKLOG POOL */}
      {(() => {
        const isCollapsed = Boolean(collapsed["BACKLOG"]);
        const totalPoints = backlogIssues.reduce((acc, i) => acc + (i.estimatePoints || 0), 0);
        const isDragTarget = dragOverSectionId === "BACKLOG";

        return (
          <div
            onDragOver={(e) => handleDragOver(e, "BACKLOG")}
            onDragLeave={() => handleDragLeave("BACKLOG")}
            onDrop={(e) => handleDropOnSection(e, null)}
            className={`bg-white dark:bg-slate-900/90 rounded-2xl border p-4 shadow-2xs space-y-3 transition-all ${
              isDragTarget
                ? "border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/30 bg-blue-50/20 dark:bg-blue-950/20 shadow-md"
                : "border-slate-300 dark:border-slate-800"
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-300 dark:border-slate-800/80 gap-2 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Section Checkbox */}
                {renderSectionSelectCheckbox(backlogIssues)}

                <button
                  type="button"
                  onClick={() => toggleCollapse("BACKLOG")}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 transition-colors cursor-pointer"
                >
                  {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">Product Backlog</h3>
                <span className="text-[11px] text-slate-400 font-mono">
                  ({backlogIssues.length} issues · {totalPoints} pts)
                </span>
              </div>
            </div>

            {!isCollapsed && (
              <div className="mt-3 space-y-1.5">
                {backlogIssues.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    Product Backlog is empty. Drag tasks here to return them from sprints.
                  </div>
                ) : (
                  backlogIssues.map((issue) => renderIssueRow(issue))
                )}

                {/* Inline Add Task to Product Backlog */}
                {userCanCreate && (
                  inlineSprintId === "BACKLOG" ? (
                    <form
                      onSubmit={(e) => handleQuickCreateIssue(e, null)}
                      className="flex items-center gap-2 pt-2 border-t border-slate-300 dark:border-slate-800/80"
                    >
                      <input
                        type="text"
                        autoFocus
                        placeholder="Backlog item title... press Enter to create"
                        value={inlineTitle}
                        onChange={(e) => setInlineTitle(e.target.value)}
                        className="flex-1 text-xs py-2 px-3 rounded-xl border border-blue-400 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 shadow-2xs"
                      />
                      <button
                        type="submit"
                        disabled={inlineLoading || !inlineTitle.trim()}
                        className="btn-primary px-3.5 py-2 text-xs font-semibold rounded-xl disabled:opacity-50 cursor-pointer shadow-2xs"
                      >
                        {inlineLoading ? "Adding..." : "+ Add"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setInlineSprintId(null);
                          setInlineTitle("");
                        }}
                        className="px-3 py-2 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer font-medium"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setInlineSprintId("BACKLOG");
                        setInlineTitle("");
                      }}
                      className="w-full mt-2 py-2 border border-dashed border-slate-300 dark:border-slate-800 hover:border-blue-400 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer bg-slate-50/50 dark:bg-slate-900/40"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Task to Backlog</span>
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* FLOATING / STICKY BULK ACTIONS TOOLBAR */}
      {selectedIssueIds.size > 0 && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-4xl w-[calc(100%-2rem)] bg-slate-900/95 dark:bg-slate-950/95 text-white backdrop-blur-xl border border-white/[0.15] dark:border-white/[0.1] rounded-2xl p-3 sm:px-4 sm:py-3 shadow-2xl shadow-black/40 flex items-center justify-between gap-3 animate-in slide-in-from-bottom-5 duration-200"
        >
          {/* Left: Counter & Clear */}
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-xs font-bold font-mono">
              {selectedIssueIds.size} <span className="font-sans font-medium text-slate-300">selected</span>
            </span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer"
            >
              Clear
            </button>
          </div>

          {/* Right: Bulk Action Popovers */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            {/* 1. Move to Sprint Dropdown */}
            <div className="relative">
              <button
                type="button"
                disabled={bulkLoading}
                onClick={() => setActiveBulkDropdown(activeBulkDropdown === "sprint" ? null : "sprint")}
                className="px-2.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Layers className="w-3.5 h-3.5 text-blue-400" />
                <span>Move to Sprint</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {activeBulkDropdown === "sprint" && (
                <div className="absolute bottom-full mb-2 left-0 w-52 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-2xl shadow-2xl border border-slate-300 dark:border-slate-800 p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
                  <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-300 dark:border-slate-800 mb-1">
                    Select Target Destination
                  </div>
                  {activeSprint && (
                    <button
                      type="button"
                      onClick={() => executeBulkSprintMove(Array.from(selectedIssueIds), activeSprint.id)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/60 hover:text-blue-600 flex items-center justify-between cursor-pointer font-medium"
                    >
                      <span className="truncate">{activeSprint.name}</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 shrink-0">
                        Active
                      </span>
                    </button>
                  )}
                  {futureSprints.map((fs) => (
                    <button
                      key={fs.id}
                      type="button"
                      onClick={() => executeBulkSprintMove(Array.from(selectedIssueIds), fs.id)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between cursor-pointer font-medium"
                    >
                      <span className="truncate">{fs.name}</span>
                      <span className="text-[10px] text-slate-400 font-mono shrink-0">Future</span>
                    </button>
                  ))}
                  <div className="my-1 border-t border-slate-300 dark:border-slate-800" />
                  <button
                    type="button"
                    onClick={() => executeBulkSprintMove(Array.from(selectedIssueIds), null)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium cursor-pointer"
                  >
                    Product Backlog (Unassign)
                  </button>
                </div>
              )}
            </div>

            {/* 2. Change Status Dropdown */}
            <div className="relative">
              <button
                type="button"
                disabled={bulkLoading}
                onClick={() => setActiveBulkDropdown(activeBulkDropdown === "status" ? null : "status")}
                className="px-2.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Status</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {activeBulkDropdown === "status" && (
                <div className="absolute bottom-full mb-2 left-0 w-44 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-2xl shadow-2xl border border-slate-300 dark:border-slate-800 p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
                  <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-300 dark:border-slate-800 mb-1">
                    Set Status
                  </div>
                  {statuses.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => handleBulkChangeStatus(st.id)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer font-medium"
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: st.color || "#94a3b8" }} />
                      <span>{st.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 3. Change Priority Dropdown */}
            <div className="relative">
              <button
                type="button"
                disabled={bulkLoading}
                onClick={() => setActiveBulkDropdown(activeBulkDropdown === "priority" ? null : "priority")}
                className="px-2.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Priority</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {activeBulkDropdown === "priority" && (
                <div className="absolute bottom-full mb-2 left-0 w-44 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-2xl shadow-2xl border border-slate-300 dark:border-slate-800 p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
                  <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-300 dark:border-slate-800 mb-1">
                    Set Priority
                  </div>
                  {priorityList.map((prio) => (
                    <button
                      key={prio.value}
                      type="button"
                      onClick={() => handleBulkChangePriority(prio.value)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer font-medium"
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: prio.color || getPriorityColor(prio.value) }} />
                      <span>{prio.name || prio.value}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 4. Change Assignee Dropdown */}
            <div className="relative">
              <button
                type="button"
                disabled={bulkLoading}
                onClick={() => setActiveBulkDropdown(activeBulkDropdown === "assignee" ? null : "assignee")}
                className="px-2.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
                <span>Assignee</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {activeBulkDropdown === "assignee" && (
                <div className="absolute bottom-full mb-2 right-0 w-48 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-2xl shadow-2xl border border-slate-300 dark:border-slate-800 p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
                  <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-300 dark:border-slate-800 mb-1">
                    Assign To
                  </div>
                  <button
                    type="button"
                    onClick={() => handleBulkChangeAssignee(null)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 flex items-center gap-2 cursor-pointer font-medium"
                  >
                    <User className="w-3.5 h-3.5" />
                    <span>Unassigned</span>
                  </button>
                  {members.map((m: any) => {
                    const u = m.user || {};
                    const name = `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || "Member";
                    return (
                      <button
                        key={m.id || m.userId}
                        type="button"
                        onClick={() => handleBulkChangeAssignee(m.userId || u.id)}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer font-medium truncate"
                      >
                        <div className="w-4 h-4 rounded-full bg-blue-600 text-white font-bold text-[8px] flex items-center justify-center uppercase shrink-0">
                          {u.firstName?.[0] || "M"}
                        </div>
                        <span className="truncate">{name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 5. Change Team Dropdown */}
            <div className="relative">
              <button
                type="button"
                disabled={bulkLoading}
                onClick={() => setActiveBulkDropdown(activeBulkDropdown === "team" ? null : "team")}
                className="px-2.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Users className="w-3.5 h-3.5 text-teal-400" />
                <span>Team</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {activeBulkDropdown === "team" && (
                <div className="absolute bottom-full mb-2 right-0 w-48 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-2xl shadow-2xl border border-slate-300 dark:border-slate-800 p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
                  <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-300 dark:border-slate-800 mb-1">
                    Assign Team
                  </div>
                  <button
                    type="button"
                    onClick={() => handleBulkChangeTeam(null)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 flex items-center gap-2 cursor-pointer font-medium"
                  >
                    <Users className="w-3.5 h-3.5 opacity-50" />
                    <span>No Team (Unassigned)</span>
                  </button>
                  {teams.map((t: any) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleBulkChangeTeam(t.id)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer font-medium truncate"
                    >
                      <div className="w-4 h-4 rounded-md bg-teal-600 text-white font-bold text-[8px] flex items-center justify-center uppercase shrink-0">
                        {t.name?.[0] || "T"}
                      </div>
                      <span className="truncate">{t.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 6. Delete Selected */}
            <button
              type="button"
              disabled={bulkLoading}
              onClick={() => setShowBulkDeleteModal(true)}
              className="px-2.5 py-1.5 text-xs font-semibold bg-rose-600/90 hover:bg-rose-600 text-white rounded-xl border border-rose-500/50 flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              title="Permanently delete selected issues"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* BULK DELETE CONFIRMATION MODAL */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-100">
          <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Delete {selectedIssueIds.size} {selectedIssueIds.size === 1 ? "Issue" : "Issues"}?
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  This action will permanently remove all selected tasks.
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-300 dark:border-slate-800">
              All linked subtasks, comments, dependencies, and time entries for the selected issues will also be deleted. This cannot be undone.
            </p>

            {/* List of selected items */}
            <div className="max-h-36 overflow-y-auto space-y-1 p-2 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-300 dark:border-slate-800 text-xs">
              {Array.from(selectedIssueIds).map((id) => {
                const is = issues.find((i) => i.id === id);
                return (
                  <div key={id} className="flex items-center gap-2 truncate text-slate-700 dark:text-slate-300">
                    <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{is?.issueKey || id}</span>
                    <span className="truncate">{is?.title || "Untitled"}</span>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-300 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowBulkDeleteModal(false)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bulkLoading}
                onClick={handleBulkDeleteConfirm}
                className="px-4 py-1.5 text-xs font-bold bg-rose-600 text-white rounded-xl hover:bg-rose-700 shadow-sm transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {bulkLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Confirm Delete ({selectedIssueIds.size})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete Sprint Rollover Modal */}
      {completingSprint && (() => {
        const sprintIssues = issues.filter((i) => i.sprintId === completingSprint.id);
        const completedIssues = sprintIssues.filter(
          (i) => i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done") || i.status?.name?.toLowerCase().includes("completed")
        );
        const incompleteIssues = sprintIssues.filter((i) => !completedIssues.includes(i));
        const completedPoints = completedIssues.reduce((sum: number, i: any) => sum + (i.estimatePoints || 0), 0);
        const incompletePoints = incompleteIssues.reduce((sum: number, i: any) => sum + (i.estimatePoints || 0), 0);
        const completionRate = sprintIssues.length > 0 ? Math.round((completedIssues.length / sprintIssues.length) * 100) : 0;

        return (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-100">
            <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Complete {completingSprint.name}</h3>
                  <p className="text-xs text-slate-500">Sprint Retrospective & Velocity Summary</p>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-300 dark:border-slate-800 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Sprint Delivery Rate</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">{completionRate}%</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden flex">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-300"
                    style={{ width: `${completionRate}%` }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="p-2.5 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60">
                    <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      Completed
                    </div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-base font-bold text-slate-900 dark:text-white font-mono">{completedIssues.length}</span>
                      <span className="text-[11px] text-slate-500">issues ({completedPoints} pts)</span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60">
                    <div className="text-[11px] font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      Open / Incomplete
                    </div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-base font-bold text-slate-900 dark:text-white font-mono">{incompleteIssues.length}</span>
                      <span className="text-[11px] text-slate-500">issues ({incompletePoints} pts)</span>
                    </div>
                  </div>
                </div>

                {/* Velocity Contribution Summary */}
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/60">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <div>
                      <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 block">
                        Sprint Velocity Delivered
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        Historical rolling avg: {velocityData?.rolling3SprintAverage || velocityData?.averageVelocity || 0} pts
                      </span>
                    </div>
                  </div>
                  <span className="text-base font-black text-indigo-600 dark:text-indigo-400 font-mono">
                    +{completedPoints} pts
                  </span>
                </div>
              </div>

              {/* Sprint Retrospective Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                  Sprint Retrospective Notes <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
                </label>
                <textarea
                  rows={2}
                  value={retroNotes}
                  onChange={(e) => setRetroNotes(e.target.value)}
                  placeholder="Key takeaways: What went well? What could be improved for next sprint?"
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              {incompleteIssues.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                    Move {incompleteIssues.length} incomplete {incompleteIssues.length === 1 ? "issue" : "issues"} to:
                  </label>
                  <select
                    id="rolloverSelect"
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Product Backlog</option>
                    {futureSprints.map((fs) => (
                      <option key={fs.id} value={fs.id}>
                        {fs.name} (Future Sprint)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-300 dark:border-slate-800">
                <button
                  onClick={() => {
                    setCompletingSprint(null);
                    setRetroNotes("");
                  }}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const sel = document.getElementById("rolloverSelect") as HTMLSelectElement;
                    handleCompleteSprint(completingSprint.id, sel?.value, retroNotes);
                  }}
                  className="px-4 py-2 text-xs font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 shadow-sm transition-all cursor-pointer"
                >
                  Complete Sprint
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Start Sprint Modal */}
      <StartSprintModal
        sprint={startingSprint}
        issues={issues}
        averageVelocity={velocityData?.rolling3SprintAverage || velocityData?.averageVelocity || 0}
        isOpen={Boolean(startingSprint)}
        onClose={() => setStartingSprint(null)}
        onSprintStarted={() => {
          setStartingSprint(null);
          onRefresh();
        }}
      />

      {/* Create Sprint Modal */}
      {showCreateSprintModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <form onSubmit={handleCreateSprint} className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Create New Sprint</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Sprint Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sprint 3: Polish & Automation"
                  value={newSprintName}
                  onChange={(e) => setNewSprintName(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Sprint Goal</label>
                <input
                  type="text"
                  placeholder="What is the objective of this sprint?"
                  value={newSprintGoal}
                  onChange={(e) => setNewSprintGoal(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateSprintModal(false)}
                className="px-3.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary px-4 py-1.5 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Create Sprint
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Sprint Modal */}
      {editingSprint && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-100">
          <form
            onSubmit={handleEditSprintSubmit}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between border-b border-slate-300 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Edit Sprint Details</h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Update sprint name, goal, or delete sprint</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingSprint(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Sprint Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sprint 2: Core Foundation"
                  value={editSprintName}
                  onChange={(e) => setEditSprintName(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Sprint Goal
                </label>
                <textarea
                  rows={2}
                  placeholder="What is the deliverable or objective of this sprint?"
                  value={editSprintGoal}
                  onChange={(e) => setEditSprintGoal(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-normal"
                />
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-slate-300 dark:border-slate-800">
              <button
                type="button"
                onClick={() => handleDeleteSprint(editingSprint)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Sprint</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingSprint(null)}
                  className="btn-secondary px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="btn-primary px-4 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50 cursor-pointer"
                >
                  {editLoading ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
