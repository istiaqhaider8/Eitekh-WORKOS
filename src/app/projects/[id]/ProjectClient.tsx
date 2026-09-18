"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { KanbanBoardView } from "@/components/views/KanbanBoardView";
import { ListView } from "@/components/views/ListView";
import { ScrumBacklogView } from "@/components/views/ScrumBacklogView";
import { TimelineGanttView } from "@/components/views/TimelineGanttView";
import { CalendarView } from "@/components/views/CalendarView";
import { WorkloadView } from "@/components/views/WorkloadView";
import { DashboardView } from "@/components/views/DashboardView";
import { AnalyticsChartsView } from "@/components/views/AnalyticsChartsView";
import { IssueDetailModal } from "@/components/issues/IssueDetailModal";
import { TeamManagementModal } from "@/components/teams/TeamManagementModal";
import { CommandPalette } from "@/components/common/CommandPalette";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import {
  Plus,
  X,
  Search,
  Filter,
  User,
  RotateCcw,
  Users,
  Settings,
  UserPlus,
  Trash2,
  Calendar,
  Shield,
  Edit3,
  AlertCircle,
  Check,
  CheckCircle2,
  Mail,
  Send,
  ArrowLeft,
  Kanban,
  ListTodo,
  Layers,
  Clock,
  BarChart3,
  PieChart,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
import { showSuccess, showError } from "@/lib/toast";

interface ProjectClientProps {
  currentUser: any;
  currentOrg: any;
  project: any;
  allProjects: any[];
}

export function ProjectClient({
  currentUser,
  currentOrg,
  project,
  allProjects,
}: ProjectClientProps) {
  const router = useRouter();
  const [currentProject, setCurrentProject] = useState<any>(project);
  const [activeView, setActiveView] = useState("board");
  const [viewHistory, setViewHistory] = useState<string[]>([]);
  const [issues, setIssues] = useState<any[]>(project.issues || []);
  const [sprints, setSprints] = useState<any[]>(project.sprints || []);
  const [epics, setEpics] = useState<any[]>(project.epics || []);
  const [members, setMembers] = useState<any[]>(project.members || []);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [delegations, setDelegations] = useState<any[]>([]);
  // The server embeds only the first page of issues to bound the HTML payload.
  // If the project has more, fetch the full set once on mount — the board,
  // timeline and workload views all filter client-side and would otherwise
  // silently render an incomplete picture.
  const embeddedIssueCount = (project.issues || []).length;
  const totalIssueCount = project._count?.issues ?? embeddedIssueCount;
  const issuesWereTruncated = totalIssueCount > embeddedIssueCount;

  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [createInitialStatusId, setCreateInitialStatusId] = useState<string | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<number>(Date.now());

  // Deep link support: notifications and emails link to
  // /projects/<projectId>?issue=<issueId> and expect that issue to open.
  // The backend has always generated these links; without this the param was
  // ignored and the user landed on the board with nothing opened.
  const searchParams = useSearchParams();
  const deepLinkIssueId = searchParams.get("issue");

  useEffect(() => {
    if (!deepLinkIssueId) return;
    setSelectedIssueId(deepLinkIssueId);
    // Consume the param straight away rather than on modal close. Clicking the
    // same notification twice would otherwise push an identical URL, leaving
    // deepLinkIssueId unchanged so this effect never re-fired and the issue
    // did not reopen. Clearing it here guarantees a null -> id transition
    // every time.
    router.replace(`/projects/${project.id}`, { scroll: false });
  }, [deepLinkIssueId, project.id, router]);

  const fetchAvailability = useCallback(async () => {
    if (!project?.id) return;
    try {
      const res = await fetch(`/api/projects/${project.id}/availability`);
      if (res.ok) {
        const data = await res.json();
        setLeaves(data.leaves || []);
      }
      const delRes = await fetch(`/api/projects/${project.id}/delegations`);
      if (delRes.ok) {
        const delData = await delRes.json();
        setDelegations(delData.delegations || []);
      }
    } catch (e) {
      console.error("Failed to fetch availability & delegations", e);
    }
  }, [project?.id]);

  // Initial data load consolidated into single effect below (lines ~468)


  const [showCreateIssueModal, setShowCreateIssueModal] = useState(false);
  const [showCreateProjectModal, setShowCreateProjectModal] = useState(false);
  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [showProjectMembersModal, setShowProjectMembersModal] = useState(false);
  const [showTeamsModal, setShowTeamsModal] = useState(false);
  const [teams, setTeams] = useState<any[]>([]);
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  const userMember = members.find((m: any) => m.userId === currentUser?.id);
  const userRoleInProject = userMember?.role || (project.ownerId === currentUser?.id ? "PROJECT_ADMIN" : "MEMBER");
  const isProjectAdminRole = currentUser?.isSuperAdmin || userRoleInProject === "PROJECT_ADMIN" || userRoleInProject === "PROJECT_MANAGER";
  
  const canEditProject = currentUser?.isSuperAdmin || (
    Array.isArray(currentUser?.capabilities)
      ? currentUser.capabilities.includes("projects:edit")
      : isProjectAdminRole
  );

  const canCreateIssue = currentUser?.isSuperAdmin || (
    Array.isArray(currentUser?.capabilities)
      ? currentUser.capabilities.includes("issues:create")
      : userRoleInProject !== "VIEWER"
  );

  const canAccessView = (viewId: string) => {
    if (!currentUser || currentUser?.isSuperAdmin || !Array.isArray(currentUser?.capabilities)) return true;
    const permMap: Record<string, string> = {
      board: "kanban:view",
      list: "list:view",
      scrum: "backlog:view",
      timeline: "timeline:view",
      calendar: "calendar:view",
      workload: "workload:view",
      charts: "analytics:view",
      dashboard: "reports:view",
    };
    const perm = permMap[viewId];
    return perm ? currentUser.capabilities.includes(perm) : true;
  };

  useEffect(() => {
    if (project?.id) {
      localStorage.setItem("eitekh_last_project_id", project.id);
    }
  }, [project?.id]);

  const handleViewChange = (newView: string) => {
    if (newView !== activeView) {
      setViewHistory((prev) => [...prev, activeView]);
      setActiveView(newView);
    }
  };

  const handleSmartBack = () => {
    // 1. Close open modal if any
    if (selectedIssueId) {
      setSelectedIssueId(null);
      return;
    }
    if (showCreateIssueModal) {
      setShowCreateIssueModal(false);
      return;
    }
    if (showTeamsModal) {
      setShowTeamsModal(false);
      return;
    }
    if (showEditProjectModal) {
      setShowEditProjectModal(false);
      return;
    }
    if (showProjectMembersModal) {
      setShowProjectMembersModal(false);
      return;
    }
    if (showCreateProjectModal) {
      setShowCreateProjectModal(false);
      return;
    }
    if (showCommandPalette) {
      setShowCommandPalette(false);
      return;
    }

    // 2. Clear any active quick filters if any
    if (searchFilter || onlyMyIssues || priorityFilter !== "ALL" || statusFilter !== "ALL" || typeFilter !== "ALL") {
      setSearchFilter("");
      setOnlyMyIssues(false);
      setPriorityFilter("ALL");
      setStatusFilter("ALL");
      setTypeFilter("ALL");
      return;
    }

    // 3. Step back in local view history if any
    if (viewHistory.length > 0) {
      const prevView = viewHistory[viewHistory.length - 1];
      setViewHistory((prev) => prev.slice(0, -1));
      setActiveView(prevView);
      return;
    }

    // 4. If on another view other than board, switch to board
    if (activeView !== "board") {
      setActiveView("board");
      return;
    }

    // 5. If browser history exists and came from a different path (e.g., Settings), go back safely
    if (
      typeof window !== "undefined" &&
      window.history.length > 1 &&
      document.referrer &&
      document.referrer.includes(window.location.host) &&
      !document.referrer.includes("/super-admin")
    ) {
      router.back();
      return;
    }
  };

  // Quick Filter State
  const [searchFilter, setSearchFilter] = useState("");
  const [onlyMyIssues, setOnlyMyIssues] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");

  // Project Priorities State (custom + defaults)
  const [projectPriorities, setProjectPriorities] = useState<any[]>([
    { name: "Critical", value: "CRITICAL", color: "#f43f5e" },
    { name: "High", value: "HIGH", color: "#f59e0b" },
    { name: "Medium", value: "MEDIUM", color: "#3b82f6" },
    { name: "Low", value: "LOW", color: "#10b981" },
  ]);

  // Quick create issue fields
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState("TASK");
  const [newStatusId, setNewStatusId] = useState("");
  const [newPriority, setNewPriority] = useState("MEDIUM");
  const [newPoints, setNewPoints] = useState("");
  const [newAssigneeId, setNewAssigneeId] = useState("");
  const [newTeamId, setNewTeamId] = useState("");
  const [newStartDate, setNewStartDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [newDueDate, setNewDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split("T")[0];
  });
  const [createIssueError, setCreateIssueError] = useState("");

  // Create project fields
  const [projName, setProjName] = useState("");
  const [projKey, setProjKey] = useState("");
  const [projDesc, setProjDesc] = useState("");
  const [projTemplate, setProjTemplate] = useState("SCRUM");
  const [projLoading, setProjLoading] = useState(false);
  const [projError, setProjError] = useState("");

  // Edit project fields
  const [editName, setEditName] = useState(project.name || "");
  const [editDesc, setEditDesc] = useState(project.description || "");
  const [editStatus, setEditStatus] = useState(project.status || "ACTIVE");
  const [editPriority, setEditPriority] = useState(project.priority || "MEDIUM");
  const [editStartDate, setEditStartDate] = useState(
    project.startDate ? new Date(project.startDate).toISOString().split("T")[0] : ""
  );
  const [editTargetDate, setEditTargetDate] = useState(
    project.targetDate ? new Date(project.targetDate).toISOString().split("T")[0] : ""
  );
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");

  // Member management state
  const [memberTab, setMemberTab] = useState<"EXISTING" | "INVITE">("EXISTING");
  const [orgMembers, setOrgMembers] = useState<any[]>([]);
  const [pbacRoles, setPbacRoles] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUserRole, setSelectedUserRole] = useState("member");
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberError, setMemberError] = useState("");

  // Invite by email fields
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteCreatedUser, setInviteCreatedUser] = useState<{ email: string; tempPassword?: string } | null>(null);

  const statuses = currentProject.workflows?.[0]?.statuses || project.workflows?.[0]?.statuses || [];

  // Hotkey listener for 'C', '/', 'G+B', 'G+L', 'G+S', 'Ctrl+K', and 'Escape'
  useEffect(() => {
    let lastKey = "";
    let lastKeyTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Allow Escape to close modals even if focused on an input
      if (e.key === "Escape") {
        setShowCreateIssueModal(false);
        setShowCommandPalette(false);
        setSelectedIssueId(null);
        return;
      }
      
      // Don't trigger if user is typing in an input or textarea
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) {
        return;
      }
      
      const now = Date.now();
      const key = e.key.toLowerCase();

      if (lastKey === "g" && (now - lastKeyTime < 1000)) {
        if (key === "b") { e.preventDefault(); setActiveView("board"); lastKey = ""; return; }
        if (key === "l") { e.preventDefault(); setActiveView("list"); lastKey = ""; return; }
        if (key === "s") { e.preventDefault(); setActiveView("scrum"); lastKey = ""; return; }
      }

      if (key === "g") {
        lastKey = "g";
        lastKeyTime = now;
      } else {
        lastKey = "";
      }

      if (key === "c") {
        e.preventDefault();
        if (canCreateIssue) {
          setSelectedIssueId("new");
        } else {
          showError("You do not have permission to create issues");
        }
      }
      
      if (e.key === "/") {
        e.preventDefault();
        setShowCommandPalette(true);
      }
      
      if ((e.ctrlKey || e.metaKey) && key === "k") {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canCreateIssue]);

  const refreshPriorities = useCallback(async () => {
    if (!project?.id) return;
    try {
      const res = await fetch(`/api/projects/${project.id}/priorities`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.priorities)) {
          setProjectPriorities(data.priorities);
        }
      }
    } catch (e) {
      console.error("Error fetching priorities:", e);
    }
  }, [project?.id]);

  const refreshProjectAndStatuses = useCallback(async () => {
    if (!project?.id) return;
    try {
      const pRes = await fetch(`/api/projects/${project.id}`);
      if (pRes.ok) {
        const pData = await pRes.json();
        setCurrentProject((prev: any) => ({ ...prev, ...pData }));
      }
      const wfRes = await fetch(`/api/workflows?projectId=${project.id}`);
      if (wfRes.ok) {
        const wfData = await wfRes.json();
        if (Array.isArray(wfData) && wfData.length > 0) {
          setCurrentProject((prev: any) => ({
            ...prev,
            workflows: wfData,
          }));
        }
      }
    } catch (e) {
      console.error("Error refreshing project and statuses:", e);
    }
  }, [project?.id]);

  const refreshIssues = async () => {
    try {
      const [res, sRes, eRes] = await Promise.all([
        fetch(`/api/projects/${project.id}/issues`),
        fetch(`/api/sprints?projectId=${project.id}`),
        fetch(`/api/epics?projectId=${project.id}`),
      ]);
      if (res.ok) {
        const data = await res.json();
        setIssues(data.issues || []);
      }
      if (sRes.ok) {
        const sData = await sRes.json();
        setSprints(sData.sprints || []);
      }
      if (eRes.ok) {
        const eData = await eRes.json();
        setEpics(Array.isArray(eData) ? eData : eData.epics || []);
      }
      refreshPriorities();
      refreshProjectAndStatuses();
    } catch (e) {
      console.error(e);
    }
  };

  // Top up the truncated server payload. Runs only when the project actually
  // has more issues than were embedded, so small projects pay nothing.
  useEffect(() => {
    if (!issuesWereTruncated) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/issues?limit=all`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.issues)) setIssues(data.issues);
      } catch (e) {
        console.error("Failed to load the remaining issues", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [issuesWereTruncated, project.id]);

  const handleUpdateIssueStatus = async (issueId: string, statusId: string) => {
    // Optimistic UI update
    setIssues((prev) =>
      prev.map((i) => (i.id === issueId ? { ...i, statusId } : i))
    );

    try {
      await fetch(`/api/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusId }),
      });
      refreshIssues();
    } catch (e) {
      console.error(e);
      refreshIssues();
    }
  };

  const handleUpdateIssuePriority = async (issueId: string, priority: string) => {
    // Optimistic UI update
    setIssues((prev) =>
      prev.map((i) => (i.id === issueId ? { ...i, priority } : i))
    );

    try {
      await fetch(`/api/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      });
      refreshIssues();
    } catch (e) {
      console.error(e);
      refreshIssues();
    }
  };

  const refreshTeams = useCallback(async () => {
    if (!project?.id) return;
    try {
      const res = await fetch(`/api/teams?projectId=${project.id}`);
      if (res.ok) {
        const data = await res.json();
        setTeams(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error(e);
    }
  }, [project?.id]);

  useEffect(() => {
    fetchAvailability();
    refreshTeams();
    refreshPriorities();
    refreshProjectAndStatuses();
  }, [fetchAvailability, refreshTeams, refreshPriorities, refreshProjectAndStatuses]);

  // REAL-TIME DATA SYNCHRONIZATION:
  // Listens for project-scoped events from SSE hub and updates all views instantly
  const handleRealtimeEvent = useCallback(
    (event: any) => {
      if (!event || event.projectId !== project.id) return;

      if (event.eventType === "ISSUE_CREATED" && event.data) {
        setIssues((prev) => {
          // Skip if real issue already exists; also evict any matching optimistic placeholder
          if (prev.some((i) => i.id === event.data.id && !i._isOptimistic)) return prev;
          return [event.data, ...prev.filter((i) => i.id !== event.data.id)];
        });
      } else if (event.eventType === "ISSUE_UPDATED" && event.data) {
        const targetId = event.data.id || event.data.issueId || event.entityId;
        setIssues((prev) =>
          prev.map((i) => (i.id === targetId ? { ...i, ...event.data } : i))
        );
      } else if (event.eventType === "ISSUE_DELETED" && (event.entityId || event.data?.id)) {
        const deletedId = event.entityId || event.data?.id;
        setIssues((prev) => prev.filter((i) => i.id !== deletedId));
      } else if (
        event.eventType === "BULK_ISSUES_UPDATED" ||
        event.eventType?.startsWith("SPRINT_") ||
        event.eventType?.startsWith("WORKFLOW_") ||
        event.eventType?.startsWith("EPIC_") ||
        event.eventType?.startsWith("COMPONENT_") ||
        event.eventType?.startsWith("COMMENT_") ||
        event.eventType?.startsWith("SUBTASK_") ||
        event.eventType?.startsWith("DEPENDENCY_")
      ) {
        refreshIssues();
      } else if (event.eventType?.startsWith("LEAVE_")) {
        fetchAvailability();
      }
      setLastSyncTimestamp(Date.now());
    },
    [project.id, refreshIssues, fetchAvailability]
  );

  const { status: syncStatus } = useRealtimeSync({
    projectId: project.id,
    onEvent: handleRealtimeEvent,
    onReconnect: () => {
      refreshIssues();
      fetchAvailability();
      setLastSyncTimestamp(Date.now());
    },
  });

  const handleCreateIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateIssueError("");

    if (!newTitle.trim()) {
      setCreateIssueError("Issue title is required");
      return;
    }

    const effectiveStatusId = newStatusId || statuses[0]?.id;
    if (!effectiveStatusId) {
      setCreateIssueError("Status is a mandatory field");
      return;
    }

    if (!newPriority) {
      setCreateIssueError("Priority is a mandatory field");
      return;
    }

    if (!newStartDate) {
      setCreateIssueError("Start Date is a mandatory field");
      return;
    }

    if (!newDueDate) {
      setCreateIssueError("Due Date is a mandatory field");
      return;
    }

    if (new Date(newDueDate) < new Date(newStartDate)) {
      setCreateIssueError("Due Date cannot be earlier than Start Date");
      return;
    }

    try {
      const res = await fetch(`/api/projects/${project.id}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          issueType: newType,
          priority: newPriority,
          estimatePoints: newPoints ? Number(newPoints) : null,
          statusId: effectiveStatusId,
          assigneeId: newAssigneeId || undefined,
          teamId: newTeamId || undefined,
          startDate: new Date(newStartDate).toISOString(),
          dueDate: new Date(newDueDate).toISOString(),
        }),
      });

      if (res.ok) {
        setNewTitle("");
        setNewPoints("");
        setNewAssigneeId("");
        setNewTeamId("");
        const today = new Date().toISOString().split("T")[0];
        const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        setNewStartDate(today);
        setNewDueDate(nextWeek);
        setNewStatusId("");
        setCreateIssueError("");
        setShowCreateIssueModal(false);
        refreshIssues();
      } else {
        const data = await res.json();
        setCreateIssueError(data.error || "Failed to create issue");
      }
    } catch (e: any) {
      console.error(e);
      setCreateIssueError(e.message || "Failed to create issue");
    }
  };

  const handleQuickCreateIssue = async (payload: {
    statusId: string;
    title: string;
    issueType?: string;
    priority?: string;
    assigneeId?: string;
    estimatePoints?: number;
    teamId?: string;
    dueDate?: string;
  }) => {
    // Optimistic update: show issue immediately before server confirms
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const optimisticIssue = {
      id: tempId,
      issueKey: `${currentProject.key}-?`,
      title: payload.title,
      priority: payload.priority || "MEDIUM",
      issueType: payload.issueType || "TASK",
      statusId: payload.statusId,
      status: statuses.find((s: any) => s.id === payload.statusId) ?? null,
      assigneeId: payload.assigneeId ?? null,
      assignee: members.find((m: any) => m.userId === payload.assigneeId)?.user ?? null,
      estimatePoints: payload.estimatePoints ?? null,
      teamId: payload.teamId ?? null,
      dueDate: payload.dueDate ?? null,
      projectId: currentProject.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _isOptimistic: true,
    };
    setIssues((prev) => [optimisticIssue, ...prev]);

    try {
      const res = await fetch(`/api/projects/${currentProject.id}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        const realIssue = data.issue;
        // Replace optimistic entry with real server-confirmed issue
        setIssues((prev) =>
          prev.map((i) => (i.id === tempId ? { ...realIssue, _isOptimistic: false } : i))
        );
        showSuccess("Task created successfully");
      } else {
        // Rollback optimistic update
        setIssues((prev) => prev.filter((i) => i.id !== tempId));
        const data = await res.json();
        showError(data.error || "Failed to create task");
      }
    } catch (err: any) {
      // Rollback optimistic update
      setIssues((prev) => prev.filter((i) => i.id !== tempId));
      showError(err.message || "Failed to create task");
    }
  };

  const refreshMembers = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data || []);
      }
    } catch (e) {
      console.error(e);
    }
  }, [currentProject.id]);

  const fetchOrgMembers = useCallback(async () => {
    if (!currentOrg?.id) return;
    try {
      const res = await fetch(`/api/orgs/${currentOrg.id}/members`);
      if (res.ok) {
        const data = await res.json();
        setOrgMembers(data || []);
      }
    } catch (e) {
      console.error(e);
    }
  }, [currentOrg?.id]);

  const fetchPbacRoles = useCallback(async () => {
    if (!currentOrg?.id) return;
    try {
      const res = await fetch(`/api/pbac/roles?orgId=${currentOrg.id}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.roles)) {
          setPbacRoles(data.roles);
        }
      }
    } catch (e) {
      console.error("Failed to fetch PBAC roles", e);
    }
  }, [currentOrg?.id]);

  useEffect(() => {
    if (showProjectMembersModal) {
      fetchOrgMembers();
      refreshMembers();
      fetchPbacRoles();
    }
  }, [showProjectMembersModal, fetchOrgMembers, refreshMembers, fetchPbacRoles]);

  const handleEditProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) return;
    setEditLoading(true);
    setEditError("");

    try {
      const res = await fetch(`/api/projects/${currentProject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDesc.trim(),
          status: editStatus,
          priority: editPriority,
          startDate: editStartDate ? editStartDate : null,
          targetDate: editTargetDate ? editTargetDate : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update project details");
      }

      setCurrentProject((prev: any) => ({
        ...prev,
        ...data,
      }));
      showSuccess("Project details updated successfully");
      setShowEditProjectModal(false);
      router.refresh();
    } catch (err: any) {
      setEditError(err.message);
      showError(err.message || "Failed to update project details");
    } finally {
      setEditLoading(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) {
      setMemberError("Please select a user to assign");
      return;
    }
    setMemberLoading(true);
    setMemberError("");

    try {
      const res = await fetch(`/api/projects/${currentProject.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUserId,
          role: selectedUserRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to assign member to project");
      }

      showSuccess("Team member assigned to project");
      setSelectedUserId("");
      setSelectedUserRole("member");
      refreshMembers();
    } catch (err: any) {
      setMemberError(err.message);
      showError(err.message || "Failed to assign member");
    } finally {
      setMemberLoading(false);
    }
  };

  const handleUpdateMemberRole = async (userId: string, role: string) => {
    // Optimistic UI update
    setMembers((prev: any[]) =>
      prev.map((m) =>
        (m.userId === userId || m.user?.id === userId) ? { ...m, role } : m
      )
    );

    try {
      const res = await fetch(`/api/projects/${currentProject.id}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update member role");
      }

      showSuccess("Member role updated successfully");
      refreshMembers();
    } catch (err: any) {
      showError(err.message || "Failed to update member role");
      refreshMembers();
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm("Are you sure you want to remove this member from the project?")) return;
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove member");
      }

      showSuccess("Member removed from project");
      refreshMembers();
    } catch (err: any) {
      showError(err.message || "Failed to remove member");
    }
  };

  const handleInviteMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      setMemberError("Please enter an email address");
      return;
    }
    setMemberLoading(true);
    setMemberError("");
    setInviteCreatedUser(null);

    try {
      const res = await fetch(`/api/projects/${currentProject.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          firstName: inviteFirstName.trim(),
          lastName: inviteLastName.trim(),
          role: inviteRole,
          password: invitePassword.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to invite member");
      }

      showSuccess("Invitation sent & member assigned to project!");
      if (data.isNewUserCreated) {
        setInviteCreatedUser({
          email: inviteEmail.trim(),
          tempPassword: data.tempPassword,
        });
      }
      setInviteEmail("");
      setInviteFirstName("");
      setInviteLastName("");
      setInvitePassword("");
      refreshMembers();
      fetchOrgMembers();
    } catch (err: any) {
      setMemberError(err.message);
      showError(err.message || "Failed to invite member");
    } finally {
      setMemberLoading(false);
    }
  };

  const isProjectAdmin =
    currentUser?.isSuperAdmin ||
    currentOrg?.role === "OWNER" ||
    currentOrg?.role === "ADMIN" ||
    currentProject?.ownerId === currentUser?.id ||
    project?.ownerId === currentUser?.id ||
    members.length <= 1 ||
    members.some(
      (m: any) =>
        (m.userId === currentUser?.id || m.user?.id === currentUser?.id) &&
        m.role !== "VIEWER"
    );

  const handleCreateProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projName.trim() || !projKey.trim()) return;
    setProjLoading(true);
    setProjError("");

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: project.workspaceId,
          name: projName,
          key: projKey.toUpperCase(),
          description: projDesc,
          template: projTemplate,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create project");
      }

      setShowCreateProjectModal(false);
      setProjName("");
      setProjKey("");
      setProjDesc("");
      router.push(`/projects/${data.project?.id || data.id}`);
      router.refresh();
    } catch (err: any) {
      setProjError(err.message);
    } finally {
      setProjLoading(false);
    }
  };

  // Computed filtered issues
  const displayedIssues = issues.filter((issue) => {
    if (!issue) return false;
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      const keyMatch = issue.issueKey ? issue.issueKey.toLowerCase().includes(q) : false;
      const titleMatch = issue.title ? issue.title.toLowerCase().includes(q) : false;
      const descMatch = issue.description ? issue.description.toLowerCase().includes(q) : false;
      if (!keyMatch && !titleMatch && !descMatch) return false;
    }
    if (onlyMyIssues && issue.assigneeId !== currentUser?.id) {
      return false;
    }
    if (priorityFilter !== "ALL" && issue.priority !== priorityFilter) {
      return false;
    }
    if (statusFilter !== "ALL" && issue.statusId !== statusFilter) {
      return false;
    }
    if (typeFilter !== "ALL" && issue.issueType !== typeFilter) {
      return false;
    }
    return true;
  });

  const hasActiveFilters = Boolean(
    searchFilter ||
    onlyMyIssues ||
    priorityFilter !== "ALL" ||
    statusFilter !== "ALL" ||
    typeFilter !== "ALL"
  );

  return (
    <div className="flex flex-col h-screen bg-slate-100/60 dark:bg-slate-950 font-sans antialiased text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* Top Application Header */}
      <AppHeader
        currentUser={currentUser}
        currentOrg={currentOrg}
        workspaces={project.workspace ? [project.workspace] : []}
        breadcrumbs={[
          { label: currentOrg?.name || "Org" },
          { label: project.workspace?.name || "Workspace" },
          { label: project.name, href: `/projects/${project.id}` },
          { label: activeView === "charts" ? "Charts & Analytics" : activeView.charAt(0).toUpperCase() + activeView.slice(1) }
        ]}
        canCreateIssue={canCreateIssue}
        onCreateIssueClick={() => canCreateIssue && setSelectedIssueId("new")}
        onOpenCommandPalette={() => setShowCommandPalette(true)}
        onBack={handleSmartBack}
        onToggleMobileSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
      />

      {/* Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <AppSidebar
          projects={allProjects}
          activeProjectId={project.id}
          activeView={activeView}
          onSelectView={handleViewChange}
          onCreateProjectClick={() => setShowCreateProjectModal(true)}
          currentUser={currentUser}
          isMobileOpen={isMobileSidebarOpen}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
        />

        {/* View Content Area */}
        <main className="flex-1 flex flex-col overflow-y-auto">
          {/* Project Title Bar & Quick Filter Toolbar */}
          <div className="px-3 sm:px-6 py-2.5 sm:py-3.5 border-b border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900/90 backdrop-blur-md flex flex-col xl:flex-row xl:items-center justify-between gap-3 sticky top-0 z-10 shadow-2xs">
            <div className="flex items-center flex-wrap gap-2.5 sm:gap-3.5">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-sky-500 text-white font-black flex items-center justify-center text-xs shadow-md shadow-blue-500/20 ring-2 ring-blue-500/20 shrink-0">
                {currentProject.key}
              </div>
              <div className="min-w-0 flex-1 sm:flex-initial">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-tight tracking-tight truncate max-w-[200px] sm:max-w-none">
                    {currentProject.name}
                  </h1>
                  <span
                    className={`px-2 py-0.2 sm:px-2.5 sm:py-0.5 text-[9px] sm:text-[10px] font-bold rounded-full uppercase tracking-wider border shadow-2xs ${
                      currentProject.status === "ACTIVE"
                        ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800"
                        : currentProject.status === "COMPLETED"
                        ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-800"
                        : currentProject.status === "PLANNING"
                        ? "bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-800"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400 border-slate-300 dark:border-slate-700"
                    }`}
                  >
                    {currentProject.status}
                  </span>

                  {/* Real-time Data Synchronization Live Indicator */}
                  <div
                    className={`hidden md:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide border shadow-2xs transition-all ${
                      syncStatus === "connected"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700"
                        : syncStatus === "reconnecting"
                        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 border-amber-300 dark:border-amber-700 animate-pulse"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 border-slate-300 dark:border-slate-700"
                    }`}
                    title={
                      syncStatus === "connected"
                        ? "Real-time project synchronization active"
                        : "Reconnecting to live project event stream..."
                    }
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        syncStatus === "connected"
                          ? "bg-emerald-500 animate-pulse"
                          : syncStatus === "reconnecting"
                          ? "bg-amber-500"
                          : "bg-slate-400"
                      }`}
                    />
                    <span>{syncStatus === "connected" ? "LIVE SYNC" : syncStatus.toUpperCase()}</span>
                  </div>
                </div>
                <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 font-medium truncate">
                  {currentProject.template} Project · Key: <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">{currentProject.key}</span>
                </p>
              </div>

              {/* Members Avatar Stack & Manage People Button */}
              <div className="flex items-center gap-1.5 sm:gap-2 sm:pl-3 sm:border-l border-slate-300 dark:border-slate-800 flex-wrap">
                <button
                  type="button"
                  onClick={() => setShowProjectMembersModal(true)}
                  className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition-all font-semibold shadow-2xs hover:shadow-xs active:translate-y-px cursor-pointer"
                  title="Assign and manage project members"
                >
                  <div className="flex -space-x-1.5 overflow-hidden">
                    {members.slice(0, 3).map((m: any, idx: number) => {
                      const userObj = m.user || {};
                      const name =
                        `${userObj.firstName || ""} ${userObj.lastName || ""}`.trim() ||
                        userObj.email ||
                        "Member";
                      const initials = userObj.firstName
                        ? `${userObj.firstName[0]}${userObj.lastName?.[0] || ""}`.toUpperCase()
                        : name.slice(0, 2).toUpperCase();
                      return (
                        <div
                          key={m.id || idx}
                          className="w-4 h-4 sm:w-5 sm:h-5 rounded-full ring-2 ring-white dark:ring-slate-900 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-[8px] sm:text-[9px] flex items-center justify-center uppercase shadow-2xs"
                          title={`${name} (${m.role})`}
                        >
                          {initials}
                        </div>
                      );
                    })}
                  </div>
                  <Users className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span className="hidden xs:inline">
                    {members.length} {members.length === 1 ? "Member" : "Members"}
                  </span>
                  <span className="text-[10px] text-blue-600 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded-md border border-blue-200 dark:border-blue-800/60">
                    + Assign
                  </span>
                </button>

                {/* Project Settings Button */}
                {canEditProject && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditName(currentProject.name || "");
                      setEditDesc(currentProject.description || "");
                      setEditStatus(currentProject.status || "ACTIVE");
                      setEditPriority(currentProject.priority || "MEDIUM");
                      setEditStartDate(
                        currentProject.startDate
                          ? new Date(currentProject.startDate).toISOString().split("T")[0]
                          : ""
                      );
                      setEditTargetDate(
                        currentProject.targetDate
                          ? new Date(currentProject.targetDate).toISOString().split("T")[0]
                          : ""
                      );
                      setShowEditProjectModal(true);
                    }}
                    className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition-all font-semibold shadow-2xs hover:shadow-xs active:translate-y-px cursor-pointer group"
                    title="Edit project details and settings"
                  >
                    <Settings className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-transform group-hover:rotate-45" />
                    <span className="hidden sm:inline">Settings</span>
                  </button>
                )}

                {/* Teams Management Button */}
                <button
                  type="button"
                  onClick={() => setShowTeamsModal(true)}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition-all font-semibold shadow-2xs hover:shadow-xs active:translate-y-px cursor-pointer group"
                  title="Manage workspace teams and members"
                >
                  <Users className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform" />
                  <span className="hidden sm:inline">Teams</span>
                  {teams.length > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-full text-[10px] font-bold border border-blue-200 dark:border-blue-800/50">
                      {teams.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Quick Filters Toolbar (Hidden on Calendar View to eliminate redundant stacked filter bars) */}
            {activeView !== "calendar" && (
              <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 text-xs">
                {/* Mobile Filter Header Toggle */}
                <div className="md:hidden flex items-center justify-between gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Filter issues..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 font-medium"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowMobileFilters(!showMobileFilters)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold shrink-0 cursor-pointer shadow-2xs ${
                      hasActiveFilters
                        ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800 font-bold"
                        : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700"
                    }`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
                    <span>Filters</span>
                    {hasActiveFilters && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
                    )}
                    <ChevronDown className={`w-3 h-3 transition-transform ${showMobileFilters ? "rotate-180" : ""}`} />
                  </button>
                </div>

                {/* Filter Controls (Collapsible on Mobile, Inline on Desktop) */}
                <div className={`${showMobileFilters ? "flex" : "hidden"} md:flex flex-wrap items-center gap-2 pt-1 md:pt-0`}>
                  <div className="hidden md:flex relative items-center">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3" />
                    <input
                      type="text"
                      placeholder="Filter issues..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 hover:border-slate-400 dark:hover:border-slate-600 transition-all w-36 sm:w-44 shadow-2xs font-medium"
                    />
                  </div>

                  <button
                    onClick={() => setOnlyMyIssues(!onlyMyIssues)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-semibold transition-all shadow-2xs cursor-pointer ${
                      onlyMyIssues
                        ? "bg-blue-50 dark:bg-indigo-950/70 border-blue-500 dark:border-indigo-600 text-blue-700 dark:text-indigo-300 shadow-2xs"
                        : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-600"
                    }`}
                  >
                    <User className="w-3.5 h-3.5 text-slate-500" />
                    <span>My Issues</span>
                  </button>

                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    aria-label="Filter by priority"
                    className="px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold outline-none cursor-pointer hover:border-slate-400 dark:hover:border-slate-600 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all shadow-2xs"
                  >
                    <option value="ALL" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">All Priorities</option>
                    {projectPriorities.map((p) => (
                      <option key={p.value} value={p.value} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
                        {p.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    aria-label="Filter by status"
                    className="px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold outline-none cursor-pointer hover:border-slate-400 dark:hover:border-slate-600 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all shadow-2xs"
                  >
                    <option value="ALL" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">All Statuses</option>
                    {statuses.map((s: any) => (
                      <option key={s.id} value={s.id} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
                        {s.name}
                      </option>
                    ))}
                  </select>

                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    aria-label="Filter by type"
                    className="px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold outline-none cursor-pointer hover:border-slate-400 dark:hover:border-slate-600 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all shadow-2xs"
                  >
                    <option value="ALL" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">All Types</option>
                    <option value="TASK" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">Task</option>
                    <option value="BUG" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">Bug</option>
                    <option value="STORY" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">Story</option>
                    <option value="EPIC" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">Epic</option>
                  </select>

                  <select
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "MY_ISSUES") {
                        setOnlyMyIssues(true);
                        setPriorityFilter("ALL");
                        setStatusFilter("ALL");
                        setTypeFilter("ALL");
                      } else if (val === "HIGH_PRIORITY") {
                        setOnlyMyIssues(false);
                        setPriorityFilter("HIGH");
                        setStatusFilter("ALL");
                        setTypeFilter("ALL");
                      } else if (val === "CRITICAL_PRIORITY") {
                        setOnlyMyIssues(false);
                        setPriorityFilter("CRITICAL");
                        setStatusFilter("ALL");
                        setTypeFilter("ALL");
                      } else if (val === "CLEAR") {
                        setOnlyMyIssues(false);
                        setPriorityFilter("ALL");
                        setStatusFilter("ALL");
                        setTypeFilter("ALL");
                        setSearchFilter("");
                      }
                    }}
                    aria-label="Quick filter presets"
                    className="px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold outline-none cursor-pointer hover:border-slate-400 dark:hover:border-slate-600 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition-all shadow-2xs"
                  >
                    <option value="">Presets</option>
                    <option value="MY_ISSUES">My Assigned Issues</option>
                    <option value="HIGH_PRIORITY">High Priority Items</option>
                    <option value="CRITICAL_PRIORITY">Critical Bugs & Incidents</option>
                    <option value="CLEAR">Clear Presets</option>
                  </select>

                  {hasActiveFilters && (
                    <button
                      onClick={() => {
                        setSearchFilter("");
                        setOnlyMyIssues(false);
                        setPriorityFilter("ALL");
                        setStatusFilter("ALL");
                        setTypeFilter("ALL");
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 text-xs rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-semibold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer"
                      title="Clear all filters"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Clear</span>
                    </button>
                  )}

                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-full ml-1 border border-slate-300 dark:border-slate-700 font-mono">
                    {displayedIssues.length} / {issues.length}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Horizontal View Switcher Tabs (Accessible on Mobile, Tablet & Desktop) */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-2 px-3 sm:px-6 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/40 shrink-0">
            {[
              { id: "board", label: "Board", icon: Kanban, count: issues.length },
              { id: "list", label: "List", icon: ListTodo },
              { id: "scrum", label: "Backlog", icon: Layers, count: sprints.length > 0 ? sprints.length : undefined },
              { id: "timeline", label: "Timeline", icon: Clock },
              { id: "calendar", label: "Calendar", icon: Calendar },
              { id: "workload", label: "Workload", icon: Users },
              { id: "charts", label: "Analytics", icon: PieChart },
              { id: "dashboard", label: "Reports", icon: BarChart3 },
            ].filter((v) => canAccessView(v.id)).map((v) => {
              const Icon = v.icon;
              const isSelected = activeView === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => handleViewChange(v.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl transition-all cursor-pointer shrink-0 border shadow-2xs ${
                    isSelected
                      ? "bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-slate-300 dark:border-slate-700 font-bold shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border-transparent hover:bg-white/60 dark:hover:bg-slate-800/60"
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isSelected ? "text-blue-600 dark:text-blue-400" : "text-slate-400"}`} />
                  <span>{v.label}</span>
                  {v.count !== undefined && (
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      isSelected ? "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300" : "bg-slate-200/60 dark:bg-slate-800 text-slate-500"
                    }`}>
                      {v.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Active View Rendering */}
          {!canAccessView(activeView) ? (
            <div className="flex-1 flex items-center justify-center p-8 bg-slate-50 dark:bg-slate-950">
              <div className="max-w-md w-full text-center space-y-4 bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-300 dark:border-slate-800 shadow-sm">
                <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto text-xl font-bold">
                  🔒
                </div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">View Access Restricted</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Your PBAC permissions do not allow viewing this section (<strong>{activeView}</strong>). Contact your organization administrator to update your role permissions.
                </p>
                <button
                  onClick={() => setActiveView("board")}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer shadow-2xs"
                >
                  Return to Kanban Board
                </button>
              </div>
            </div>
          ) : (
            <>
              {activeView === "board" && (
                <KanbanBoardView
                  issues={displayedIssues}
                  statuses={statuses}
                  priorities={projectPriorities}
                  members={members}
                  teams={teams}
                  leaves={leaves}
                  sprints={sprints}
                  epics={epics}
                  delegations={delegations}
                  currentUser={currentUser}
                  canCreateIssue={canCreateIssue}
                  onSelectIssue={(issue) => {
                    if (typeof issue === "object" && issue?.id === "new" && issue?.statusId) {
                      setCreateInitialStatusId(issue.statusId);
                      setSelectedIssueId("new");
                    } else {
                      setCreateInitialStatusId(null);
                      setSelectedIssueId(typeof issue === "string" ? issue : (issue?.id || "new"));
                    }
                  }}
                  onUpdateIssueStatus={handleUpdateIssueStatus}
                  onQuickCreateIssue={handleQuickCreateIssue}
                />
              )}

              {activeView === "list" && (
                <ListView
                  issues={displayedIssues}
                  statuses={statuses}
                  priorities={projectPriorities}
                  members={members}
                  teams={teams}
                  epics={epics}
                  delegations={delegations}
                  currentUser={currentUser}
                  canCreateIssue={canCreateIssue}
                  onSelectIssue={(issue) => setSelectedIssueId(typeof issue === "string" ? issue : (issue?.id || "new"))}
                  onUpdateIssueStatus={handleUpdateIssueStatus}
                  onUpdateIssuePriority={handleUpdateIssuePriority}
                  onQuickCreateIssue={handleQuickCreateIssue}
                  onRefresh={refreshIssues}
                />
              )}

              {activeView === "scrum" && (
                <ScrumBacklogView
                  projectId={currentProject.id}
                  sprints={sprints}
                  issues={issues}
                  statuses={statuses}
                  priorities={projectPriorities}
                  members={members}
                  teams={teams}
                  currentUser={currentUser}
                  isProjectAdmin={isProjectAdmin}
                  canCreateIssue={canCreateIssue}
                  onSelectIssue={(issue) => setSelectedIssueId(typeof issue === "string" ? issue : (issue?.id || "new"))}
                  onUpdateStatus={handleUpdateIssueStatus}
                  onRefresh={refreshIssues}
                />
              )}

              {activeView === "timeline" && (
                <TimelineGanttView
                  issues={displayedIssues}
                  statuses={statuses}
                  priorities={projectPriorities}
                  leaves={leaves}
                  delegations={delegations}
                  projectId={currentProject.id}
                  onSelectIssue={(issue) => setSelectedIssueId(typeof issue === "string" ? issue : (issue?.id || "new"))}
                  onRefresh={refreshIssues}
                />
              )}

              {activeView === "calendar" && (
                <CalendarView
                  issues={issues}
                  statuses={statuses}
                  priorities={projectPriorities}
                  members={members}
                  teams={teams}
                  sprints={sprints}
                  projects={allProjects}
                  leaves={leaves}
                  delegations={delegations}
                  projectId={currentProject.id}
                  projectName={currentProject.name}
                  currentUser={currentUser}
                  onSelectProject={(pId) => router.push(`/projects/${pId}`)}
                  onSelectIssue={(issue) => setSelectedIssueId(typeof issue === "string" ? issue : (issue?.id || "new"))}
                  onRefresh={refreshIssues}
                />
              )}

              {activeView === "workload" && (
                <WorkloadView
                  issues={issues}
                  statuses={statuses}
                  priorities={projectPriorities}
                  members={members}
                  teams={teams}
                  sprints={sprints}
                  projects={allProjects}
                  leaves={leaves}
                  delegations={delegations}
                  projectId={currentProject.id}
                  projectName={currentProject.name}
                  currentUser={currentUser}
                  onSelectProject={(pId) => router.push(`/projects/${pId}`)}
                  onSelectIssue={(issue) => setSelectedIssueId(typeof issue === "string" ? issue : (issue?.id || "new"))}

                  onRefresh={refreshIssues}

                />
              )}

              {activeView === "charts" && (
                <AnalyticsChartsView
                  issues={issues}
                  statuses={statuses}
                  priorities={projectPriorities}
                  sprints={sprints}
                  teams={teams}
                  members={members}
                  projects={allProjects}
                  projectId={currentProject.id}
                  projectName={currentProject.name}
                  currentUserId={currentUser?.id}
                  onSelectProject={(pId) => router.push(`/projects/${pId}`)}
                  onSelectIssue={(issue) => setSelectedIssueId(typeof issue === "string" ? issue : (issue?.id || "new"))}
                  onRefresh={refreshIssues}
                  lastSyncTimestamp={lastSyncTimestamp}
                  syncStatus={syncStatus}
                />
              )}

              {activeView === "dashboard" && (
                <DashboardView
                  issues={issues}
                  statuses={statuses}
                  priorities={projectPriorities}
                  sprints={sprints}
                  teams={teams}
                  members={members}
                  projects={allProjects}
                  projectId={currentProject.id}
                  projectName={currentProject.name}
                  currentUser={currentUser}
                  onSelectProject={(pId) => router.push(`/projects/${pId}`)}
                  onOpenCharts={() => setActiveView("charts")}
                  onCreateIssue={() => canCreateIssue && setSelectedIssueId("new")}
                  onSelectView={setActiveView}
                  onSelectIssue={(issue) => setSelectedIssueId(typeof issue === "string" ? issue : issue?.id || issue)}
                  onRefresh={refreshIssues}
                  lastSyncTimestamp={lastSyncTimestamp}
                  syncStatus={syncStatus}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Issue Detail Modal / Drawer (Handles both View/Edit and Create New Task) */}
      <IssueDetailModal
        issueId={selectedIssueId}
        projectId={currentProject.id}
        currentUser={currentUser}
        initialStatusId={createInitialStatusId}
        onClose={() => {
          setSelectedIssueId(null);
          setCreateInitialStatusId(null);
        }}
        onIssueUpdated={refreshIssues}
      />

      {/* Global Command Palette */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        issues={issues}
        projects={allProjects}
        onSelectIssue={(issue) => setSelectedIssueId(typeof issue === "string" ? issue : issue?.id || issue)}
        onCreateIssue={() => canCreateIssue && setSelectedIssueId("new")}
      />
      {/* Create Project Modal */}
      {showCreateProjectModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleCreateProjectSubmit}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-300 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Create New Project
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateProjectModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {projError && (
              <div className="p-2.5 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-lg text-xs text-red-600 dark:text-red-400">
                {projError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Next-Gen Mobile App"
                  value={projName}
                  onChange={(e) => {
                    setProjName(e.target.value);
                    if (!projKey) {
                      const words = e.target.value.trim().split(/\s+/);
                      if (words.length >= 2) {
                        setProjKey((words[0][0] + words[1][0]).toUpperCase());
                      } else if (words[0]?.length >= 2) {
                        setProjKey(words[0].substring(0, 3).toUpperCase());
                      }
                    }
                  }}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Project Key (2-5 uppercase)
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={5}
                    placeholder="e.g. NMA"
                    value={projKey}
                    onChange={(e) => setProjKey(e.target.value.toUpperCase())}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono uppercase"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Template
                  </label>
                  <select
                    value={projTemplate}
                    onChange={(e) => setProjTemplate(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium"
                  >
                    <option value="SCRUM">Scrum (Sprints + Backlog)</option>
                    <option value="KANBAN">Kanban (Continuous Flow)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Optional project description..."
                  value={projDesc}
                  onChange={(e) => setProjDesc(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-300 dark:border-slate-800/80">
              <button
                type="button"
                onClick={() => setShowCreateProjectModal(false)}
                className="btn-secondary px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={projLoading}
                className="btn-primary px-4 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50 cursor-pointer"
              >
                {projLoading ? "Creating..." : "Create Project"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Project Details Modal */}
      {showEditProjectModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-100">
          <form
            onSubmit={handleEditProjectSubmit}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-300 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs">
                  {currentProject.key}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Project Settings & Details
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Update project name, description, status, and dates
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEditProjectModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-xl text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <div className="space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Project Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Eitekh Core Platform"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Project Status
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                  >
                    <option value="ACTIVE">Active (In Progress)</option>
                    <option value="PLANNING">Planning</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="ARCHIVED">Archived</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Priority
                  </label>
                  <select
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                  >
                    <option value="CRITICAL">Critical</option>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={editStartDate}
                    onChange={(e) => setEditStartDate(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Target / Due Date
                  </label>
                  <input
                    type="date"
                    value={editTargetDate}
                    onChange={(e) => setEditTargetDate(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Describe the scope, objectives, or requirements for this project..."
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-normal"
                />
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-slate-300 dark:border-slate-800/80">
              <span className="text-[11px] text-slate-400">
                Key: <code className="font-mono text-blue-600 dark:text-blue-400 font-semibold">{currentProject.key}</code> · Template: {currentProject.template}
              </span>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowEditProjectModal(false)}
                  className="btn-secondary px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="btn-primary px-4 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  {editLoading ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Project Members / Assign People Modal */}
      {showProjectMembersModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-100">
          <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-xl p-6 space-y-5 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-300 dark:border-slate-800 pb-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Project Members & Access
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Assign people to <span className="font-semibold text-slate-700 dark:text-slate-300">{currentProject.name}</span> and manage their roles
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowProjectMembersModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs & Forms for Assign Existing vs Invite New */}
            {isProjectAdmin && (
              <div className="space-y-3 shrink-0">
                <div className="flex items-center gap-1 border-b border-slate-300 dark:border-slate-800 pb-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMemberTab("EXISTING");
                      setMemberError("");
                      setInviteCreatedUser(null);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      memberTab === "EXISTING"
                        ? "bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900 shadow-2xs"
                        : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Assign Existing Member</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMemberTab("INVITE");
                      setMemberError("");
                      setInviteCreatedUser(null);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                      memberTab === "INVITE"
                        ? "bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900 shadow-2xs"
                        : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>Invite New Member by Email</span>
                  </button>
                </div>

                {memberError && (
                  <div className="p-2.5 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-xl text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{memberError}</span>
                  </div>
                )}

                {inviteCreatedUser && (
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 space-y-1 animate-in fade-in">
                    <div className="flex items-center gap-1.5 font-bold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span>Invitation Sent & User Provisioned!</span>
                    </div>
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                      An invitation email has been sent to <strong>{inviteCreatedUser.email}</strong>.
                    </p>
                    {inviteCreatedUser.tempPassword && (
                      <p className="text-[11px] font-mono bg-white dark:bg-slate-900 p-2 rounded border border-emerald-200 dark:border-emerald-900 text-slate-800 dark:text-slate-200">
                        Temp Password: <strong>{inviteCreatedUser.tempPassword}</strong>
                      </p>
                    )}
                  </div>
                )}

                {memberTab === "EXISTING" ? (
                  <form
                    onSubmit={handleAddMember}
                    className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700/80 rounded-xl space-y-3"
                  >
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <UserPlus className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>Select from Organization ({currentOrg?.name || "Org"})</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMemberTab("INVITE")}
                        className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-normal"
                      >
                        Not in list? Invite new person →
                      </button>
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <div className="sm:col-span-7">
                        <select
                          value={selectedUserId}
                          onChange={(e) => setSelectedUserId(e.target.value)}
                          className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                        >
                          <option value="">-- Select Person from {currentOrg?.name || "Org"} --</option>
                          {orgMembers
                            .filter((om: any) => !members.some((pm: any) => pm.userId === (om.userId || om.user?.id)))
                            .map((om: any) => {
                              const u = om.user || om;
                              const name = `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email;
                              return (
                                <option key={u.id} value={u.id}>
                                  {name} ({u.email})
                                </option>
                              );
                            })}
                        </select>
                      </div>

                      <div className="sm:col-span-3">
                        <select
                          value={selectedUserRole}
                          onChange={(e) => setSelectedUserRole(e.target.value)}
                          className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium cursor-pointer"
                        >
                          {pbacRoles
                            .filter((r: any) => r.scope === "PROJECT")
                            .map((r: any) => (
                              <option key={r.id} value={r.slug || r.id}>
                                {r.name} {r.isSystem ? "(System)" : ""}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div className="sm:col-span-2">
                        <button
                          type="submit"
                          disabled={memberLoading || !selectedUserId}
                          className="btn-primary w-full py-2 px-3 text-xs font-semibold rounded-lg disabled:opacity-50 transition-all whitespace-nowrap cursor-pointer"
                        >
                          {memberLoading ? "Adding..." : "+ Add"}
                        </button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <form
                    onSubmit={handleInviteMemberSubmit}
                    className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700/80 rounded-xl space-y-3"
                  >
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>Invite New Person to Organization & Project</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-normal">Sends credentials via email</span>
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">
                          First Name
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Jane"
                          value={inviteFirstName}
                          onChange={(e) => setInviteFirstName(e.target.value)}
                          className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">
                          Last Name
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Doe"
                          value={inviteLastName}
                          onChange={(e) => setInviteLastName(e.target.value)}
                          className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <div className="sm:col-span-7">
                        <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">
                          Email Address <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="email"
                          required
                          placeholder="colleague@company.com"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                        />
                      </div>

                      <div className="sm:col-span-5">
                        <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">
                          Project Role
                        </label>
                        <select
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value)}
                          className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium cursor-pointer"
                        >
                          {pbacRoles
                            .filter((r: any) => r.scope === "PROJECT")
                            .map((r: any) => (
                              <option key={r.id} value={r.slug || r.id}>
                                {r.name} {r.isSystem ? "(System)" : ""}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        type="submit"
                        disabled={memberLoading || !inviteEmail}
                        className="btn-primary py-2 px-4 text-xs font-semibold rounded-lg disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <Send className="w-3 h-3" />
                        <span>{memberLoading ? "Sending Invite..." : "Send Invite & Assign"}</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* Existing Project Members List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 px-1">
                <span>Current Members ({members.length})</span>
                <span>Role & Permissions</span>
              </div>

              {members.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs border border-dashed border-slate-300 dark:border-slate-800 rounded-xl">
                  No members assigned yet. Use the form above to assign team members.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-300 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900/60 overflow-hidden">
                  {members.map((member: any) => {
                    const userObj = member.user || {};
                    const fullName = `${userObj.firstName || ""} ${userObj.lastName || ""}`.trim() || userObj.email || "Member";
                    const initials = userObj.firstName
                      ? `${userObj.firstName[0]}${userObj.lastName?.[0] || ""}`.toUpperCase()
                      : fullName.slice(0, 2).toUpperCase();
                    const isSelf = member.userId === currentUser?.id || member.user?.id === currentUser?.id;

                    return (
                      <div
                        key={member.id || member.userId}
                        className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0 uppercase shadow-2xs">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                {fullName}
                              </span>
                              {isSelf && (
                                <span className="text-[10px] bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-semibold px-1.5 py-0.2 rounded border border-blue-200 dark:border-blue-900">
                                  You
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400 truncate">{userObj.email}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {isProjectAdmin ? (
                            <>
                              {(() => {
                                const normRole = member.role === "MEMBER" ? "member" : member.role === "ADMIN" ? "project-admin" : member.role === "MANAGER" ? "project-manager" : member.role === "PROJECT_MEMBER" ? "member" : member.role === "PROJECT_ADMIN" ? "project-admin" : member.role === "PROJECT_MANAGER" ? "project-manager" : member.role === "VIEWER" ? "viewer" : member.role;
                                return (
                                  <select
                                    value={normRole}
                                    onChange={(e) =>
                                      handleUpdateMemberRole(member.userId || member.user?.id, e.target.value)
                                    }
                                    className="text-xs py-1 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-semibold outline-none cursor-pointer focus:border-blue-500 shadow-2xs"
                                  >
                                    {pbacRoles
                                      .filter((r: any) => r.scope === "PROJECT")
                                      .map((r: any) => (
                                        <option key={r.id} value={r.slug || r.id}>
                                          {r.name} {r.isSystem ? "(System)" : ""}
                                        </option>
                                      ))}
                                  </select>
                                );
                              })()}

                              <button
                                type="button"
                                onClick={() => handleRemoveMember(member.userId || member.user?.id)}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
                                title="Remove member from project"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <span className="text-xs font-semibold px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                              {(() => {
                                const r = member.role;
                                const match = pbacRoles.find((pr: any) => pr.slug === r || pr.id === r);
                                if (match) return match.name;
                                if (r === "PROJECT_ADMIN" || r === "ADMIN") return "PROJECT ADMIN";
                                if (r === "PROJECT_MANAGER" || r === "MANAGER") return "PROJECT MANAGER";
                                if (r === "PROJECT_MEMBER" || r === "MEMBER") return "MEMBER";
                                return r;
                              })()}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-300 dark:border-slate-800/80 shrink-0">
              <button
                type="button"
                onClick={() => setShowProjectMembersModal(false)}
                className="btn-secondary px-4 py-1.5 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Team Management Modal */}
      <TeamManagementModal
        isOpen={showTeamsModal}
        onClose={() => setShowTeamsModal(false)}
        workspaceId={currentProject.workspaceId || currentProject.workspace?.id || ""}
        projectId={currentProject.id}
        onTeamsUpdated={() => {
          refreshTeams();
          refreshIssues();
        }}
      />
    </div>
  );
}
