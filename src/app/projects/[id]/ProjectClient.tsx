"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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
  const [members, setMembers] = useState<any[]>(project.members || []);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
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
      localStorage.setItem("zenith_last_project_id", project.id);
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
    { name: "Highest", value: "HIGHEST", color: "#f97316" },
    { name: "High", value: "HIGH", color: "#f59e0b" },
    { name: "Medium", value: "MEDIUM", color: "#3b82f6" },
    { name: "Low", value: "LOW", color: "#10b981" },
    { name: "Lowest", value: "LOWEST", color: "#64748b" },
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
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUserRole, setSelectedUserRole] = useState("PROJECT_MEMBER");
  const [memberLoading, setMemberLoading] = useState(false);
  const [memberError, setMemberError] = useState("");

  // Invite by email fields
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [inviteRole, setInviteRole] = useState("PROJECT_MEMBER");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteCreatedUser, setInviteCreatedUser] = useState<{ email: string; tempPassword?: string } | null>(null);

  const statuses = currentProject.workflows?.[0]?.statuses || project.workflows?.[0]?.statuses || [];

  // Hotkey listener for 'C', '/', 'Ctrl+K', and 'Escape'
  useEffect(() => {
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
      
      if (e.key.toLowerCase() === "c") {
        e.preventDefault();
        setShowCreateIssueModal(true);
      }
      
      if (e.key === "/") {
        e.preventDefault();
        setShowCommandPalette(true);
      }
      
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
      const res = await fetch(`/api/projects/${project.id}/issues`);
      if (res.ok) {
        const data = await res.json();
        setIssues(data.issues || []);
      }
      const sRes = await fetch(`/api/sprints?projectId=${project.id}`);
      if (sRes.ok) {
        const sData = await sRes.json();
        setSprints(sData.sprints || []);
      }
      refreshPriorities();
      refreshProjectAndStatuses();
    } catch (e) {
      console.error(e);
    }
  };

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
    refreshTeams();
    refreshPriorities();
    refreshProjectAndStatuses();
  }, [refreshTeams, refreshPriorities, refreshProjectAndStatuses]);

  // REAL-TIME DATA SYNCHRONIZATION:
  // Listens for project-scoped events from SSE hub and updates all views instantly
  const handleRealtimeEvent = useCallback(
    (event: any) => {
      if (!event || event.projectId !== project.id) return;

      if (event.eventType === "ISSUE_CREATED" && event.data) {
        setIssues((prev) => {
          if (prev.some((i) => i.id === event.data.id)) return prev;
          return [event.data, ...prev];
        });
      } else if (event.eventType === "ISSUE_UPDATED" && event.data) {
        setIssues((prev) =>
          prev.map((i) => (i.id === event.data.id ? { ...i, ...event.data } : i))
        );
      } else if (event.eventType === "ISSUE_DELETED" && event.entityId) {
        setIssues((prev) => prev.filter((i) => i.id !== event.entityId));
      } else if (
        event.eventType === "BULK_ISSUES_UPDATED" ||
        event.eventType?.startsWith("SPRINT_") ||
        event.eventType?.startsWith("WORKFLOW_")
      ) {
        refreshIssues();
      }
    },
    [project.id]
  );

  const { status: syncStatus } = useRealtimeSync({
    projectId: project.id,
    onEvent: handleRealtimeEvent,
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
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        showSuccess("Task created successfully");
        refreshIssues();
      } else {
        const data = await res.json();
        showError(data.error || "Failed to create task");
      }
    } catch (err: any) {
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

  useEffect(() => {
    if (showProjectMembersModal) {
      fetchOrgMembers();
      refreshMembers();
    }
  }, [showProjectMembersModal, fetchOrgMembers, refreshMembers]);

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
      setSelectedUserRole("PROJECT_MEMBER");
      refreshMembers();
    } catch (err: any) {
      setMemberError(err.message);
      showError(err.message || "Failed to assign member");
    } finally {
      setMemberLoading(false);
    }
  };

  const handleUpdateMemberRole = async (userId: string, role: string) => {
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

      showSuccess("Member role updated");
      refreshMembers();
    } catch (err: any) {
      showError(err.message || "Failed to update member role");
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
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      const matches =
        issue.issueKey.toLowerCase().includes(q) ||
        issue.title.toLowerCase().includes(q) ||
        (issue.description && issue.description.toLowerCase().includes(q));
      if (!matches) return false;
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
        onCreateIssueClick={() => setShowCreateIssueModal(true)}
        onOpenCommandPalette={() => setShowCommandPalette(true)}
        onBack={handleSmartBack}
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
        />

        {/* View Content Area */}
        <main className="flex-1 flex flex-col overflow-y-auto">
          {/* Project Title Bar & Quick Filter Toolbar */}
          <div className="px-6 py-3.5 border-b border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900/90 backdrop-blur-md flex flex-col xl:flex-row xl:items-center justify-between gap-3 sticky top-0 z-10 shadow-2xs">
            <div className="flex items-center flex-wrap gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-sky-500 text-white font-black flex items-center justify-center text-xs shadow-md shadow-blue-500/20 ring-2 ring-blue-500/20">
                {currentProject.key}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-sm font-bold text-slate-900 dark:text-white leading-tight tracking-tight">
                    {currentProject.name}
                  </h1>
                  <span
                    className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider border shadow-2xs ${
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
                    className={`hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide border shadow-2xs transition-all ${
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
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  {currentProject.template} Project · Key: <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">{currentProject.key}</span>
                </p>
              </div>

              {/* Members Avatar Stack & Manage People Button */}
              <div className="flex items-center gap-2 pl-3 border-l border-slate-300 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowProjectMembersModal(true)}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition-all font-semibold shadow-2xs hover:shadow-xs active:translate-y-px cursor-pointer"
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
                          className="w-5 h-5 rounded-full ring-2 ring-white dark:ring-slate-900 bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-[9px] flex items-center justify-center uppercase shadow-2xs"
                          title={`${name} (${m.role})`}
                        >
                          {initials}
                        </div>
                      );
                    })}
                  </div>
                  <Users className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>
                    {members.length} {members.length === 1 ? "Member" : "Members"}
                  </span>
                  <span className="text-[10px] text-blue-600 dark:text-blue-400 font-bold ml-0.5 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded-md border border-blue-200 dark:border-blue-800/60">
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
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition-all font-semibold shadow-2xs hover:shadow-xs active:translate-y-px cursor-pointer group"
                    title="Edit project details and settings"
                  >
                    <Settings className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-transform group-hover:rotate-45" />
                    <span>Settings</span>
                  </button>
                )}

                {/* Teams Management Button */}
                <button
                  type="button"
                  onClick={() => setShowTeamsModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition-all font-semibold shadow-2xs hover:shadow-xs active:translate-y-px cursor-pointer group"
                  title="Manage workspace teams and members"
                >
                  <Users className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform" />
                  <span>Teams</span>
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
              <div className="flex items-center flex-wrap gap-2 text-xs">
              <div className="relative flex items-center">
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
                <option value="FEATURE" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">Feature</option>
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
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 text-xs rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-semibold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
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
          )}
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
                  onSelectIssue={(issue) => setSelectedIssueId(issue.id)}
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
                  onSelectIssue={(issue) => setSelectedIssueId(issue.id)}
                  onUpdateIssueStatus={handleUpdateIssueStatus}
                  onUpdateIssuePriority={handleUpdateIssuePriority}
                />
              )}

              {activeView === "scrum" && (
                <ScrumBacklogView
                  projectId={project.id}
                  sprints={sprints}
                  issues={displayedIssues}
                  statuses={statuses}
                  priorities={projectPriorities}
                  members={members}
                  teams={teams}
                  currentUser={currentUser}
                  isProjectAdmin={isProjectAdmin}
                  onSelectIssue={(issue) => setSelectedIssueId(issue.id)}
                  onUpdateStatus={handleUpdateIssueStatus}
                  onRefresh={refreshIssues}
                />
              )}

              {activeView === "timeline" && (
                <TimelineGanttView
                  issues={displayedIssues}
                  statuses={statuses}
                  priorities={projectPriorities}
                  onSelectIssue={(issue) => setSelectedIssueId(issue.id)}
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
                  projectId={currentProject.id}
                  projectName={currentProject.name}
                  currentUser={currentUser}
                  onSelectProject={(pId) => router.push(`/projects/${pId}`)}
                  onSelectIssue={(issue) => setSelectedIssueId(issue.id)}
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
                  projectId={currentProject.id}
                  projectName={currentProject.name}
                  currentUser={currentUser}
                  onSelectProject={(pId) => router.push(`/projects/${pId}`)}
                  onSelectIssue={(issue) => setSelectedIssueId(issue.id)}
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
                  onSelectIssue={(issue) => setSelectedIssueId(issue.id)}
                  onRefresh={refreshIssues}
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
                  onCreateIssue={() => setShowCreateIssueModal(true)}
                  onSelectView={setActiveView}
                  onSelectIssue={(issue) => setSelectedIssueId(issue.id)}
                  onRefresh={refreshIssues}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Issue Detail Modal / Drawer */}
      <IssueDetailModal
        issueId={selectedIssueId}
        onClose={() => setSelectedIssueId(null)}
        onIssueUpdated={refreshIssues}
      />

      {/* Global Command Palette */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        issues={issues}
        projects={allProjects}
        onSelectIssue={(issue) => setSelectedIssueId(issue.id)}
        onCreateIssue={() => setShowCreateIssueModal(true)}
      />

      {/* Global Create Issue Modal */}
      {showCreateIssueModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleCreateIssueSubmit}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-300 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Create Issue in {project.key}</h3>
              <button
                type="button"
                onClick={() => setShowCreateIssueModal(false)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Issue Title <span className="text-rose-500 font-bold">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="Summary of what needs to be accomplished..."
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Status <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <select
                    required
                    value={newStatusId || statuses[0]?.id || ""}
                    onChange={(e) => setNewStatusId(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium cursor-pointer outline-none focus:border-blue-500"
                  >
                    {statuses.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Priority <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <select
                    required
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium cursor-pointer outline-none focus:border-blue-500"
                  >
                    {projectPriorities.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Type
                  </label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium cursor-pointer outline-none focus:border-blue-500"
                  >
                    <option value="TASK">Task</option>
                    <option value="BUG">Bug</option>
                    <option value="STORY">Story</option>
                    <option value="FEATURE">Feature</option>
                    <option value="EPIC">Epic</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Story Points
                  </label>
                  <input
                    type="number"
                    placeholder="Pts"
                    value={newPoints}
                    onChange={(e) => setNewPoints(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Start Date <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={newStartDate}
                    onChange={(e) => setNewStartDate(e.target.value)}
                    className={`w-full text-xs p-2 rounded-lg border ${
                      !newStartDate
                        ? "border-rose-400 dark:border-rose-600 ring-1 ring-rose-400/30"
                        : "border-slate-300 dark:border-slate-700"
                    } bg-white dark:bg-slate-900 outline-none focus:border-blue-500 font-medium`}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Due Date <span className="text-rose-500 font-bold">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className={`w-full text-xs p-2 rounded-lg border ${
                      !newDueDate || (newStartDate && newDueDate && newDueDate < newStartDate)
                        ? "border-rose-400 dark:border-rose-600 ring-1 ring-rose-400/30"
                        : "border-slate-300 dark:border-slate-700"
                    } bg-white dark:bg-slate-900 outline-none focus:border-blue-500 font-medium`}
                  />
                  {newStartDate && newDueDate && newDueDate < newStartDate && (
                    <p className="text-[10px] text-rose-500 font-semibold mt-1">Due date cannot be earlier than start date</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Assign to Member (Optional)
                  </label>
                  <select
                    value={newAssigneeId}
                    onChange={(e) => setNewAssigneeId(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium text-slate-800 dark:text-slate-200 outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="">👤 Unassigned</option>
                    {members.map((m: any) => {
                      const u = m.user || m;
                      const name = `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || "Member";
                      return (
                        <option key={u.id || m.userId} value={u.id || m.userId}>
                          👤 {name} ({m.role || "MEMBER"})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Assign to Team (Optional)
                  </label>
                  <select
                    value={newTeamId}
                    onChange={(e) => setNewTeamId(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium text-slate-800 dark:text-slate-200 outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="">👥 No Team Assigned (Unassigned)</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        👥 {t.name} ({t._count?.members ?? t.members?.length ?? 0} members)
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {newTeamId && (
                <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-1 flex items-center gap-1 font-medium bg-blue-50 dark:bg-blue-950/60 p-1.5 rounded-md border border-blue-200/50 dark:border-blue-900/50">
                  <span>🔔</span> All team members will receive an instant in-app and email notification.
                </p>
              )}

              {createIssueError && (
                <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs font-semibold border border-rose-200 dark:border-rose-900/50 flex items-center gap-1.5">
                  <span>⚠️</span>
                  <span>{createIssueError}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-300 dark:border-slate-800/80">
              <button
                type="button"
                onClick={() => setShowCreateIssueModal(false)}
                className="btn-secondary px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary px-4 py-1.5 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Create Issue
              </button>
            </div>
          </form>
        </div>
      )}
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
                  placeholder="e.g. Zenith Core Platform"
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
                          className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                        >
                          <option value="PROJECT_MEMBER">Member (Read/Write)</option>
                          <option value="PROJECT_MANAGER">Project Manager (Sprints/Epics/Roadmaps)</option>
                          <option value="PROJECT_ADMIN">Admin (Full Control)</option>
                          <option value="VIEWER">Viewer (Read-Only)</option>
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
                          className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                        >
                          <option value="PROJECT_MEMBER">Member (Read/Write)</option>
                          <option value="PROJECT_MANAGER">Project Manager (Sprints/Epics/Roadmaps)</option>
                          <option value="PROJECT_ADMIN">Admin (Full Control)</option>
                          <option value="VIEWER">Viewer (Read-Only)</option>
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
                              <select
                                value={member.role}
                                onChange={(e) =>
                                  handleUpdateMemberRole(member.userId || member.user?.id, e.target.value)
                                }
                                className="text-xs py-1 px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-medium outline-none cursor-pointer focus:border-blue-500"
                              >
                                <option value="PROJECT_ADMIN">Admin</option>
                                <option value="PROJECT_MANAGER">Project Manager</option>
                                <option value="PROJECT_MEMBER">Member</option>
                                <option value="VIEWER">Viewer</option>
                              </select>

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
                              {member.role === "PROJECT_ADMIN" ? "Admin" : member.role === "PROJECT_MANAGER" ? "Manager" : member.role === "PROJECT_MEMBER" || member.role === "MEMBER" ? "Member" : "Viewer"}
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
