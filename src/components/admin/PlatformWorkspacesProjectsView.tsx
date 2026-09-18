"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  FolderGit2,
  Building2,
  Plus,
  Search,
  Edit2,
  Trash2,
  RefreshCw,
  Archive,
  Layers,
  Users,
  CheckCircle2,
  AlertTriangle,
  X,
  ExternalLink,
  Calendar,
  Sparkles,
} from "lucide-react";
import { showSuccess, showError } from "@/lib/toast";

interface PlatformWorkspacesProjectsViewProps {
  orgs: any[];
  onRefreshParent?: () => void;
}

export function PlatformWorkspacesProjectsView({ orgs, onRefreshParent }: PlatformWorkspacesProjectsViewProps) {
  const [subTab, setSubTab] = useState<"workspaces" | "projects">("workspaces");
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState<string>("all");

  // Workspace Modals
  const [showCreateWsModal, setShowCreateWsModal] = useState(false);
  const [showEditWsModal, setShowEditWsModal] = useState(false);
  const [showDeleteWsModal, setShowDeleteWsModal] = useState(false);
  const [activeWs, setActiveWs] = useState<any>(null);
  const [wsForm, setWsForm] = useState({
    orgId: "",
    name: "",
    slug: "",
    description: "",
    isArchived: false,
  });
  const [submittingWs, setSubmittingWs] = useState(false);

  // Project Modals
  const [showCreateProjModal, setShowCreateProjModal] = useState(false);
  const [showEditProjModal, setShowEditProjModal] = useState(false);
  const [showDeleteProjModal, setShowDeleteProjModal] = useState(false);
  const [activeProj, setActiveProj] = useState<any>(null);
  const [projForm, setProjForm] = useState({
    workspaceId: "",
    name: "",
    key: "",
    description: "",
    template: "SCRUM",
    status: "ACTIVE",
    priority: "MEDIUM",
    startDate: "",
    targetDate: "",
  });
  const [submittingProj, setSubmittingProj] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [wsRes, projRes] = await Promise.all([
        fetch(`/api/super-admin/workspaces?orgId=${selectedOrgId}`),
        fetch(`/api/super-admin/projects?orgId=${selectedOrgId}`),
      ]);

      if (wsRes.ok) {
        const data = await wsRes.json();
        setWorkspaces(data.workspaces || []);
      }
      if (projRes.ok) {
        const data = await projRes.json();
        setProjects(data.projects || []);
      }
    } catch (e: any) {
      console.error(e);
      showError("Failed to load workspaces and projects");
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Create Workspace
  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wsForm.orgId || !wsForm.name.trim()) {
      showError("Organization and Workspace name are required");
      return;
    }
    setSubmittingWs(true);
    try {
      const res = await fetch("/api/super-admin/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wsForm),
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || "Workspace created successfully");
        setShowCreateWsModal(false);
        setWsForm({ orgId: "", name: "", slug: "", description: "", isArchived: false });
        loadData();
        onRefreshParent?.();
      } else {
        showError(data.error || "Failed to create workspace");
      }
    } catch (err: any) {
      showError(err.message || "Error creating workspace");
    } finally {
      setSubmittingWs(false);
    }
  };

  // Handle Edit Workspace
  const handleEditWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWs) return;
    setSubmittingWs(true);
    try {
      const res = await fetch("/api/super-admin/workspaces", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeWs.id,
          name: wsForm.name,
          slug: wsForm.slug,
          description: wsForm.description,
          isArchived: wsForm.isArchived,
          orgId: wsForm.orgId,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || "Workspace updated successfully");
        setShowEditWsModal(false);
        setActiveWs(null);
        loadData();
        onRefreshParent?.();
      } else {
        showError(data.error || "Failed to update workspace");
      }
    } catch (err: any) {
      showError(err.message || "Error updating workspace");
    } finally {
      setSubmittingWs(false);
    }
  };

  // Handle Delete Workspace
  const handleDeleteWorkspace = async () => {
    if (!activeWs) return;
    setSubmittingWs(true);
    try {
      const res = await fetch(`/api/super-admin/workspaces?workspaceId=${activeWs.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || "Workspace deleted permanently");
        setShowDeleteWsModal(false);
        setActiveWs(null);
        loadData();
        onRefreshParent?.();
      } else {
        showError(data.error || "Failed to delete workspace");
      }
    } catch (err: any) {
      showError(err.message || "Error deleting workspace");
    } finally {
      setSubmittingWs(false);
    }
  };

  // Handle Create Project
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projForm.workspaceId || !projForm.name.trim() || !projForm.key.trim()) {
      showError("Workspace, Project Name, and Key are required");
      return;
    }
    setSubmittingProj(true);
    try {
      const res = await fetch("/api/super-admin/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projForm),
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || "Project created successfully");
        setShowCreateProjModal(false);
        setProjForm({
          workspaceId: "",
          name: "",
          key: "",
          description: "",
          template: "SCRUM",
          status: "ACTIVE",
          priority: "MEDIUM",
          startDate: "",
          targetDate: "",
        });
        loadData();
        onRefreshParent?.();
      } else {
        showError(data.error || "Failed to create project");
      }
    } catch (err: any) {
      showError(err.message || "Error creating project");
    } finally {
      setSubmittingProj(false);
    }
  };

  // Handle Edit Project
  const handleEditProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProj) return;
    setSubmittingProj(true);
    try {
      const res = await fetch("/api/super-admin/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProj.id,
          name: projForm.name,
          key: projForm.key,
          description: projForm.description,
          template: projForm.template,
          status: projForm.status,
          priority: projForm.priority,
          startDate: projForm.startDate || null,
          targetDate: projForm.targetDate || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || "Project updated successfully");
        setShowEditProjModal(false);
        setActiveProj(null);
        loadData();
        onRefreshParent?.();
      } else {
        showError(data.error || "Failed to update project");
      }
    } catch (err: any) {
      showError(err.message || "Error updating project");
    } finally {
      setSubmittingProj(false);
    }
  };

  // Handle Delete Project
  const handleDeleteProject = async () => {
    if (!activeProj) return;
    setSubmittingProj(true);
    try {
      const res = await fetch(`/api/super-admin/projects?projectId=${activeProj.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || "Project deleted permanently");
        setShowDeleteProjModal(false);
        setActiveProj(null);
        loadData();
        onRefreshParent?.();
      } else {
        showError(data.error || "Failed to delete project");
      }
    } catch (err: any) {
      showError(err.message || "Error deleting project");
    } finally {
      setSubmittingProj(false);
    }
  };

  const filteredWorkspaces = workspaces.filter((w) => {
    const matchesSearch =
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      w.slug.toLowerCase().includes(search.toLowerCase()) ||
      w.organization?.name?.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  const filteredProjects = projects.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.key.toLowerCase().includes(search.toLowerCase()) ||
      p.workspace?.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.workspace?.organization?.name?.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header & Sub-Tabs */}
      <div className="bg-white dark:bg-slate-900/90 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-2xs dark:shadow-xs">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FolderGit2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Platform Workspaces & Projects Authority
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            Super Administrator global CRUD controls for all tenant workspaces and isolated projects.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {subTab === "workspaces" ? (
            <button
              onClick={() => {
                setWsForm({
                  orgId: orgs[0]?.id || "",
                  name: "",
                  slug: "",
                  description: "",
                  isArchived: false,
                });
                setShowCreateWsModal(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-2xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Workspace</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setProjForm({
                  workspaceId: workspaces[0]?.id || "",
                  name: "",
                  key: "",
                  description: "",
                  template: "SCRUM",
                  status: "ACTIVE",
                  priority: "MEDIUM",
                  startDate: "",
                  targetDate: "",
                });
                setShowCreateProjModal(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-2xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Project</span>
            </button>
          )}

          <button
            onClick={loadData}
            className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-600 dark:text-indigo-400" : ""}`} />
          </button>
        </div>
      </div>

      {/* Filter and Switch Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-900/90 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs dark:shadow-xs">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSubTab("workspaces")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              subTab === "workspaces"
                ? "bg-indigo-600 text-white shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800/80"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Workspaces ({workspaces.length})</span>
          </button>
          <button
            onClick={() => setSubTab("projects")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              subTab === "projects"
                ? "bg-purple-600 text-white shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800/80"
            }`}
          >
            <FolderGit2 className="w-3.5 h-3.5" />
            <span>Projects ({projects.length})</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Org Filter */}
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1 text-xs">
            <Building2 className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="bg-transparent border-none outline-none text-slate-800 dark:text-slate-200 font-medium cursor-pointer"
            >
              <option value="all" className="bg-white dark:bg-slate-900">All Organizations</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id} className="bg-white dark:bg-slate-900">
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          {/* Search input */}
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 w-48 sm:w-64 focus-within:border-indigo-500 transition-colors">
            <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <input
              type="text"
              placeholder={`Search ${subTab}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent border-none outline-none w-full text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
            />
          </div>
        </div>
      </div>

      {/* Subtab Content: WORKSPACES */}
      {subTab === "workspaces" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredWorkspaces.map((ws) => (
            <div
              key={ws.id}
              className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:border-slate-300 dark:border-slate-700 transition-colors"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      {ws.name}
                      {ws.isArchived && (
                        <span className="px-1.5 py-0.2 bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[9px] font-bold rounded">
                          ARCHIVED
                        </span>
                      )}
                    </h3>
                    <span className="text-[11px] text-slate-600 dark:text-slate-400 font-mono">slug: {ws.slug}</span>
                  </div>
                  <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 rounded text-[10px] font-semibold">
                    {ws.organization?.name || "Global"}
                  </span>
                </div>
                {ws.description && <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{ws.description}</p>}
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="text-[11px] text-slate-500">
                  {ws._count?.projects || 0} projects · {ws._count?.members || 0} members
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setActiveWs(ws);
                      setWsForm({
                        orgId: ws.orgId,
                        name: ws.name,
                        slug: ws.slug,
                        description: ws.description || "",
                        isArchived: Boolean(ws.isArchived),
                      });
                      setShowEditWsModal(true);
                    }}
                    className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-indigo-300 hover:bg-slate-100 dark:bg-slate-800 rounded transition-colors cursor-pointer"
                    title="Edit Workspace"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setActiveWs(ws);
                      setShowDeleteWsModal(true);
                    }}
                    className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 rounded transition-colors cursor-pointer"
                    title="Delete Workspace Permanently"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {filteredWorkspaces.length === 0 && !loading && (
            <div className="col-span-full text-center py-12 text-slate-500 text-xs">
              No workspaces found matching filter criteria.
            </div>
          )}
        </div>
      )}

      {/* Subtab Content: PROJECTS */}
      {subTab === "projects" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((p) => (
            <div
              key={p.id}
              className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:border-slate-300 dark:border-slate-700 transition-colors"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <span>{p.name}</span>
                      <span className="px-1.5 py-0.2 bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-mono rounded">
                        [{p.key}]
                      </span>
                    </h3>
                    <span className="text-[11px] text-slate-600 dark:text-slate-400">
                      {p.workspace?.name} · {p.workspace?.organization?.name}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      p.status === "ACTIVE"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : p.status === "COMPLETED"
                        ? "bg-blue-500/20 text-blue-300"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {p.status}
                  </span>
                </div>
                {p.description && <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{p.description}</p>}
                <div className="flex items-center gap-2 text-[10px] text-slate-600 dark:text-slate-400">
                  <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">{p.template}</span>
                  <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">{p.priority}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="text-[11px] text-slate-500">
                  {p._count?.issues || 0} issues · {p._count?.members || 0} members
                </span>
                <div className="flex items-center gap-1.5">
                  <a
                    href={`/projects/${p.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:bg-slate-800 rounded transition-colors cursor-pointer"
                    title="Open Project"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    onClick={() => {
                      setActiveProj(p);
                      setProjForm({
                        workspaceId: p.workspaceId,
                        name: p.name,
                        key: p.key,
                        description: p.description || "",
                        template: p.template || "SCRUM",
                        status: p.status || "ACTIVE",
                        priority: p.priority || "MEDIUM",
                        startDate: p.startDate ? p.startDate.split("T")[0] : "",
                        targetDate: p.targetDate ? p.targetDate.split("T")[0] : "",
                      });
                      setShowEditProjModal(true);
                    }}
                    className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-purple-300 hover:bg-slate-100 dark:bg-slate-800 rounded transition-colors cursor-pointer"
                    title="Edit Project"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setActiveProj(p);
                      setShowDeleteProjModal(true);
                    }}
                    className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 rounded transition-colors cursor-pointer"
                    title="Delete Project Permanently"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {filteredProjects.length === 0 && !loading && (
            <div className="col-span-full text-center py-12 text-slate-500 text-xs">
              No projects found matching filter criteria.
            </div>
          )}
        </div>
      )}

      {/* Modal: Create Workspace */}
      {showCreateWsModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-600" />
                Create New Workspace
              </h3>
              <button onClick={() => setShowCreateWsModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateWorkspace} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Organization *</label>
                <select
                  required
                  value={wsForm.orgId}
                  onChange={(e) => setWsForm({ ...wsForm, orgId: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                >
                  <option value="">Select Organization</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.slug})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Workspace Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Core Engineering"
                  value={wsForm.name}
                  onChange={(e) => setWsForm({ ...wsForm, name: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Slug (URL-friendly)</label>
                <input
                  type="text"
                  placeholder="Leave blank to auto-generate"
                  value={wsForm.slug}
                  onChange={(e) => setWsForm({ ...wsForm, slug: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Description</label>
                <textarea
                  rows={2}
                  value={wsForm.description}
                  onChange={(e) => setWsForm({ ...wsForm, description: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateWsModal(false)}
                  className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingWs}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {submittingWs ? "Creating..." : "Create Workspace"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Workspace */}
      {showEditWsModal && activeWs && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-indigo-600" />
                Edit Workspace: {activeWs.name}
              </h3>
              <button onClick={() => setShowEditWsModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditWorkspace} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Workspace Name *</label>
                <input
                  type="text"
                  required
                  value={wsForm.name}
                  onChange={(e) => setWsForm({ ...wsForm, name: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Slug</label>
                <input
                  type="text"
                  value={wsForm.slug}
                  onChange={(e) => setWsForm({ ...wsForm, slug: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Description</label>
                <textarea
                  rows={2}
                  value={wsForm.description}
                  onChange={(e) => setWsForm({ ...wsForm, description: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="archiveWs"
                  checked={wsForm.isArchived}
                  onChange={(e) => setWsForm({ ...wsForm, isArchived: e.target.checked })}
                  className="rounded border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-indigo-600"
                />
                <label htmlFor="archiveWs" className="text-slate-700 dark:text-slate-300">
                  Archive this workspace
                </label>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditWsModal(false)}
                  className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingWs}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {submittingWs ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Workspace Confirmation */}
      {showDeleteWsModal && activeWs && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 border border-rose-900/60 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-500/20 text-rose-600 rounded-lg">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Delete Workspace Permanently</h3>
                <p className="text-xs text-rose-600 font-semibold">Irreversible Platform Action</p>
              </div>
            </div>

            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              Are you sure you want to permanently delete workspace{" "}
              <strong className="text-white font-mono">{activeWs.name}</strong>? This will cascade and delete all
              associated projects, tasks, issues, and memberships under this workspace.
            </p>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteWsModal(false)}
                className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteWorkspace}
                disabled={submittingWs}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs disabled:opacity-50"
              >
                {submittingWs ? "Deleting..." : "Permanently Delete Workspace"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Project */}
      {showCreateProjModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Plus className="w-4 h-4 text-purple-600" />
                Create New Project
              </h3>
              <button onClick={() => setShowCreateProjModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Target Workspace *</label>
                <select
                  required
                  value={projForm.workspaceId}
                  onChange={(e) => setProjForm({ ...projForm, workspaceId: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                >
                  <option value="">Select Workspace</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.organization?.name})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Project Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. NextGen Mobile App"
                    value={projForm.name}
                    onChange={(e) => setProjForm({ ...projForm, name: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Key *</label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    placeholder="e.g. MOB"
                    value={projForm.key}
                    onChange={(e) => setProjForm({ ...projForm, key: e.target.value.toUpperCase() })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none font-mono uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Template</label>
                  <select
                    value={projForm.template}
                    onChange={(e) => setProjForm({ ...projForm, template: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  >
                    <option value="SCRUM">Scrum (Sprints & Backlog)</option>
                    <option value="KANBAN">Kanban (Continuous Flow)</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Priority</label>
                  <select
                    value={projForm.priority}
                    onChange={(e) => setProjForm({ ...projForm, priority: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  >
                    <option value="CRITICAL">Critical</option>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Project purpose, scope, and objectives"
                  value={projForm.description}
                  onChange={(e) => setProjForm({ ...projForm, description: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateProjModal(false)}
                  className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingProj}
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {submittingProj ? "Creating..." : "Create Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Project */}
      {showEditProjModal && activeProj && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-purple-600" />
                Edit Project: {activeProj.name}
              </h3>
              <button onClick={() => setShowEditProjModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditProject} className="space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Project Name *</label>
                  <input
                    type="text"
                    required
                    value={projForm.name}
                    onChange={(e) => setProjForm({ ...projForm, name: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Key *</label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    value={projForm.key}
                    onChange={(e) => setProjForm({ ...projForm, key: e.target.value.toUpperCase() })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none font-mono uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Status</label>
                  <select
                    value={projForm.status}
                    onChange={(e) => setProjForm({ ...projForm, status: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="PLANNING">PLANNING</option>
                    <option value="ON_HOLD">ON_HOLD</option>
                    <option value="COMPLETED">COMPLETED</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Priority</label>
                  <select
                    value={projForm.priority}
                    onChange={(e) => setProjForm({ ...projForm, priority: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  >
                    <option value="CRITICAL">Critical</option>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Description</label>
                <textarea
                  rows={2}
                  value={projForm.description}
                  onChange={(e) => setProjForm({ ...projForm, description: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditProjModal(false)}
                  className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingProj}
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {submittingProj ? "Saving..." : "Save Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Project Confirmation */}
      {showDeleteProjModal && activeProj && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 border border-rose-900/60 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-500/20 text-rose-600 rounded-lg">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Delete Project Permanently</h3>
                <p className="text-xs text-rose-600 font-semibold">Irreversible Platform Action</p>
              </div>
            </div>

            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              Are you sure you want to permanently delete project{" "}
              <strong className="text-white font-mono">
                {activeProj.name} [{activeProj.key}]
              </strong>
              ? All associated issues, subtasks, epics, sprints, and comments will be permanently erased.
            </p>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteProjModal(false)}
                className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteProject}
                disabled={submittingProj}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs disabled:opacity-50"
              >
                {submittingProj ? "Deleting..." : "Permanently Delete Project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
