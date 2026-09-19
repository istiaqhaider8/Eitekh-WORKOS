"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Users,
  UserPlus,
  Plus,
  X,
  Shield,
  Trash2,
  ChevronRight,
  ChevronDown,
  Crown,
  Briefcase,
  AlertCircle,
  CheckCircle2,
  Edit3,
  Check,
} from "lucide-react";

interface TeamManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  projectId?: string;
  onTeamsUpdated?: () => void;
}

export function TeamManagementModal({
  isOpen,
  onClose,
  workspaceId,
  projectId,
  onTeamsUpdated,
}: TeamManagementModalProps) {
  const [teams, setTeams] = useState<any[]>([]);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New Team Form State
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamDesc, setTeamDesc] = useState("");
  const [teamLeadId, setTeamLeadId] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);

  // Selected Team for Detail / Member Management
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [addMemberUserId, setAddMemberUserId] = useState("");
  const [addMemberRole, setAddMemberRole] = useState("MEMBER");
  const [addingMember, setAddingMember] = useState(false);

  // Edit Team Details State
  const [isEditingTeam, setIsEditingTeam] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editLeadId, setEditLeadId] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete Team State
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingTeam, setDeletingTeam] = useState(false);

  // Fetch teams (project-wise strictly when projectId is provided)
  const fetchTeams = useCallback(async () => {
    if (!workspaceId && !projectId) return;
    setLoading(true);
    setError(null);
    try {
      const url = projectId
        ? `/api/teams?projectId=${projectId}`
        : `/api/teams?workspaceId=${workspaceId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch teams");
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setTeams(list);
      if (list.length > 0) {
        setExpandedTeamId((prev) => (prev && list.some((t) => t.id === prev) ? prev : list[0].id));
      } else {
        setExpandedTeamId(null);
      }
    } catch (err: any) {
      setError(err.message || "Error loading teams");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, projectId]);

  // Fetch available users to assign as lead or add to team (ONLY assigned project members when projectId is provided)
  const fetchUsers = useCallback(async () => {
    try {
      if (projectId) {
        const res = await fetch(`/api/projects/${projectId}/members`);
        if (res.ok) {
          const members = await res.json();
          const users = members
            .map((m: any) => m.user || m)
            .filter((u: any) => Boolean(u && u.id));
          setAvailableUsers(users);
          return;
        }
      }
      if (workspaceId) {
        const res = await fetch(`/api/workspaces/${workspaceId}/members`);
        if (res.ok) {
          const members = await res.json();
          setAvailableUsers(members.map((m: any) => m.user || m).filter(Boolean));
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, [projectId, workspaceId]);

  useEffect(() => {
    if (isOpen) {
      fetchTeams();
      fetchUsers();
    }
  }, [isOpen, fetchTeams, fetchUsers]);

  // Create Team (project-wise)
  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamName.trim()) return;

    setCreatingTeam(true);
    setError(null);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projectId || undefined,
          workspaceId: workspaceId || undefined,
          name: teamName.trim(),
          description: teamDesc.trim() || undefined,
          leadId: teamLeadId || undefined,
        }),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to create team");
      }

      const newTeam = await res.json();
      setTeamName("");
      setTeamDesc("");
      setTeamLeadId("");
      setShowCreateTeam(false);
      setSuccessMsg(`Team "${newTeam.name}" created successfully!`);
      setTimeout(() => setSuccessMsg(null), 3000);
      await fetchTeams();
      setExpandedTeamId(newTeam.id);
      if (onTeamsUpdated) onTeamsUpdated();
    } catch (err: any) {
      setError(err.message || "Failed to create team");
    } finally {
      setCreatingTeam(false);
    }
  };

  // Edit Team Details
  const handleStartEditTeam = (team: any) => {
    setEditName(team.name || "");
    setEditDesc(team.description || "");
    setEditLeadId(team.leadId || "");
    setIsEditingTeam(true);
    setShowDeleteConfirm(false);
  };

  const handleCancelEditTeam = () => {
    setIsEditingTeam(false);
  };

  const handleSaveTeamEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim() || !expandedTeamId) return;

    setSavingEdit(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${expandedTeamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDesc.trim() || null,
          leadId: editLeadId || null,
        }),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to update team details");
      }

      setSuccessMsg("Team details updated successfully!");
      setTimeout(() => setSuccessMsg(null), 3000);
      setIsEditingTeam(false);
      await fetchTeams();
      if (onTeamsUpdated) onTeamsUpdated();
    } catch (err: any) {
      setError(err.message || "Failed to update team details");
    } finally {
      setSavingEdit(false);
    }
  };

  // Delete Team
  const handleDeleteTeam = async (teamId: string) => {
    setDeletingTeam(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to delete team");
      }

      setSuccessMsg("Team deleted successfully!");
      setTimeout(() => setSuccessMsg(null), 3000);
      setShowDeleteConfirm(false);
      setIsEditingTeam(false);
      await fetchTeams();
      if (onTeamsUpdated) onTeamsUpdated();
    } catch (err: any) {
      setError(err.message || "Failed to delete team");
    } finally {
      setDeletingTeam(false);
    }
  };

  // Add Member to Team
  const handleAddMember = async (teamId: string) => {
    if (!addMemberUserId) return;
    setAddingMember(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${teamId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: addMemberUserId,
          role: addMemberRole,
        }),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to add team member");
      }

      setAddMemberUserId("");
      setSuccessMsg("Member added to team!");
      setTimeout(() => setSuccessMsg(null), 3000);
      await fetchTeams();
      if (onTeamsUpdated) onTeamsUpdated();
    } catch (err: any) {
      setError(err.message || "Failed to add member");
    } finally {
      setAddingMember(false);
    }
  };

  // Remove Member from Team
  const handleRemoveMember = async (teamId: string, userId: string) => {
    if (!confirm("Are you sure you want to remove this member from the team?")) return;
    try {
      const res = await fetch(`/api/teams/${teamId}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to remove member");
      }

      setSuccessMsg("Member removed from team");
      setTimeout(() => setSuccessMsg(null), 3000);
      await fetchTeams();
      if (onTeamsUpdated) onTeamsUpdated();
    } catch (err: any) {
      setError(err.message || "Failed to remove member");
    }
  };

  if (!isOpen) return null;

  const currentExpandedTeam = teams.find((t) => t.id === expandedTeamId);

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-100"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/[0.08] rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-300 dark:border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Team Management</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Create squads, assign members, and enable team-wide task notifications
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Feedback Messages */}
        {error && (
          <div className="mx-6 mt-3 p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-xl text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="mx-6 mt-3 p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 rounded-xl text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Main Content Body */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-6">
          {/* Left Column: Teams List & Create Button */}
          <div className="w-full md:w-5/12 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Teams ({teams.length})
              </span>
              <button
                type="button"
                onClick={() => setShowCreateTeam(!showCreateTeam)}
                className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showCreateTeam ? "Cancel" : "New Team"}</span>
              </button>
            </div>

            {/* Create Team Inline Form */}
            {showCreateTeam && (
              <form
                onSubmit={handleCreateTeam}
                className="p-3.5 bg-blue-50/60 dark:bg-slate-800/80 border border-blue-200 dark:border-blue-900/60 rounded-xl space-y-2.5 animate-in fade-in zoom-in-95 duration-150 text-xs"
              >
                <span className="font-bold text-slate-900 dark:text-white block">Create New Team</span>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Team Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Backend Squad, UI/UX Crew"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    placeholder="Team mission or scope..."
                    value={teamDesc}
                    onChange={(e) => setTeamDesc(e.target.value)}
                    className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Team Lead
                  </label>
                  <select
                    value={teamLeadId}
                    onChange={(e) => setTeamLeadId(e.target.value)}
                    className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none cursor-pointer"
                  >
                    <option value="">Select Team Lead (Optional)...</option>
                    {availableUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName ? `${u.firstName} ${u.lastName || ""}` : u.email}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowCreateTeam(false)}
                    className="btn-secondary px-3 py-1 text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingTeam || !teamName.trim()}
                    className="btn-primary px-3.5 py-1 text-xs font-semibold rounded-lg disabled:opacity-50 cursor-pointer"
                  >
                    {creatingTeam ? "Creating..." : "Save Team"}
                  </button>
                </div>
              </form>
            )}

            {/* Teams List */}
            {loading ? (
              <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">Loading teams...</div>
            ) : teams.length === 0 ? (
              <div className="py-8 border-2 border-dashed border-slate-300 dark:border-slate-800 rounded-xl text-center p-4">
                <Users className="w-6 h-6 text-slate-300 dark:text-slate-600 mx-auto mb-1.5" />
                <p className="text-xs text-slate-500 dark:text-slate-400">No teams created yet.</p>
                <button
                  onClick={() => setShowCreateTeam(true)}
                  className="mt-2 text-xs text-blue-600 font-semibold hover:underline"
                >
                  + Create your first team
                </button>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-1">
                {teams.map((t) => {
                  const isSelected = t.id === expandedTeamId;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setExpandedTeamId(t.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between ${
                        isSelected
                          ? "bg-blue-50/80 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 shadow-2xs"
                          : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      }`}
                    >
                      <div className="truncate pr-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                            {t.name}
                          </span>
                        </div>
                        {t.description && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{t.description}</p>
                        )}
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
                        {t.members?.length || t._count?.members || 0} members
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Team Detail & Member Management */}
          <div className="flex-1 border-t md:border-t-0 md:border-l border-slate-300 dark:border-slate-800 pt-4 md:pt-0 md:pl-6 space-y-4">
            {currentExpandedTeam ? (
              <>
                {/* Team Header & Action Buttons */}
                <div className="pb-3 border-b border-slate-300 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">
                          {currentExpandedTeam.name}
                        </h3>
                        {projectId && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                            Project Squad
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {currentExpandedTeam.description || "No description provided."}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded flex items-center gap-1 border border-emerald-200 dark:border-emerald-800">
                          <CheckCircle2 className="w-3 h-3" />
                          Team Task Notifications Active
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEditTeam(currentExpandedTeam)}
                        className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer"
                        title="Edit team name, description, or lead"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                        <span>Edit Details</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setShowDeleteConfirm(true);
                          setIsEditingTeam(false);
                        }}
                        className="btn-danger flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer"
                        title="Delete this team"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Team</span>
                      </button>
                    </div>
                  </div>

                  {/* Delete Confirmation Banner */}
                  {showDeleteConfirm && (
                    <div className="mt-3 p-3.5 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 rounded-xl space-y-2 text-xs animate-in fade-in zoom-in-95 duration-150">
                      <div className="flex items-center gap-2 font-bold text-red-800 dark:text-red-200">
                        <Trash2 className="w-4 h-4 text-red-600 shrink-0" />
                        <span>Delete Team "{currentExpandedTeam.name}"?</span>
                      </div>
                      <p className="text-[11px] text-red-600 dark:text-red-300">
                        Are you sure? This will delete the team. Any assigned tasks will automatically be unassigned.
                        Team members will remain assigned members of the project.
                      </p>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setShowDeleteConfirm(false)}
                          className="btn-secondary px-3 py-1 text-xs font-semibold rounded-lg cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={deletingTeam}
                          onClick={() => handleDeleteTeam(currentExpandedTeam.id)}
                          className="btn-danger px-3.5 py-1 text-xs font-semibold rounded-lg disabled:opacity-50 cursor-pointer"
                        >
                          {deletingTeam ? "Deleting..." : "Yes, Delete Team"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Inline Edit Form */}
                  {isEditingTeam && (
                    <form
                      onSubmit={handleSaveTeamEdit}
                      className="mt-3 p-3.5 bg-blue-50/50 dark:bg-slate-800/80 border border-blue-200 dark:border-slate-700 rounded-xl space-y-2.5 text-xs animate-in fade-in zoom-in-95 duration-150"
                    >
                      <div className="flex items-center justify-between font-bold text-slate-900 dark:text-white">
                        <span>Edit Team Details</span>
                        <button
                          type="button"
                          onClick={handleCancelEditTeam}
                          className="text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Team Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Description
                        </label>
                        <input
                          type="text"
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          placeholder="Team mission or scope..."
                          className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                          Team Lead (Assigned Project Member)
                        </label>
                        <select
                          value={editLeadId}
                          onChange={(e) => setEditLeadId(e.target.value)}
                          className="w-full p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none cursor-pointer font-medium"
                        >
                          <option value="">No Lead Assigned</option>
                          {availableUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.firstName ? `${u.firstName} ${u.lastName || ""}` : u.email} ({u.email})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={handleCancelEditTeam}
                          className="btn-secondary px-3 py-1 text-xs font-semibold rounded-lg cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={savingEdit || !editName.trim()}
                          className="btn-primary px-3.5 py-1 text-xs font-semibold rounded-lg disabled:opacity-50 cursor-pointer"
                        >
                          {savingEdit ? "Saving..." : "Save Changes"}
                        </button>
                      </div>
                    </form>
                  )}
                </div>

                {/* Add Member Form */}
                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-300 dark:border-slate-800 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 dark:text-slate-200 block">
                      Add Member to Team
                    </span>
                    <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded">
                      Assigned Project Members Only
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={addMemberUserId}
                      onChange={(e) => setAddMemberUserId(e.target.value)}
                      className="flex-1 p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none cursor-pointer"
                    >
                      <option value="">Select an assigned project member...</option>
                      {availableUsers
                        .filter(
                          (u) =>
                            !currentExpandedTeam.members?.some(
                              (m: any) => m.userId === u.id || m.user?.id === u.id
                            )
                        )
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.firstName ? `${u.firstName} ${u.lastName || ""}` : u.email} ({u.email})
                          </option>
                        ))}
                    </select>

                    <select
                      value={addMemberRole}
                      onChange={(e) => setAddMemberRole(e.target.value)}
                      className="w-28 p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg outline-none cursor-pointer font-medium"
                    >
                      <option value="MEMBER">Member</option>
                      <option value="LEAD">Lead</option>
                    </select>

                    <button
                      type="button"
                      disabled={addingMember || !addMemberUserId}
                      onClick={() => handleAddMember(currentExpandedTeam.id)}
                      className="btn-primary px-3.5 py-2 disabled:opacity-50 text-xs font-semibold rounded-lg shrink-0 cursor-pointer"
                    >
                      {addingMember ? "Adding..." : "Add Member"}
                    </button>
                  </div>
                  {availableUsers.length === 0 && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      ⚠️ No members are currently assigned to this project. Please assign members to the project first before adding them to teams.
                    </p>
                  )}
                </div>

                {/* Team Members List */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                    Team Members ({currentExpandedTeam.members?.length || 0})
                  </span>

                  {(!currentExpandedTeam.members || currentExpandedTeam.members.length === 0) ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400 italic py-4 text-center">
                      No members assigned to this team yet.
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {currentExpandedTeam.members.map((m: any) => {
                        const userObj = m.user || {};
                        const name =
                          `${userObj.firstName || ""} ${userObj.lastName || ""}`.trim() ||
                          userObj.email ||
                          "Team Member";
                        const initials = userObj.firstName
                          ? `${userObj.firstName[0]}${userObj.lastName?.[0] || ""}`.toUpperCase()
                          : name.slice(0, 2).toUpperCase();

                        const isLead = m.role === "LEAD" || currentExpandedTeam.leadId === m.userId;

                        return (
                          <div
                            key={m.id || m.userId}
                            className="p-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-2.5 truncate">
                              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0">
                                {initials}
                              </div>
                              <div className="truncate">
                                <span className="font-semibold text-slate-900 dark:text-white block truncate">
                                  {name}
                                </span>
                                <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate block">
                                  {userObj.email}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {isLead ? (
                                <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                                  <Crown className="w-3 h-3 fill-current" />
                                  Lead
                                </span>
                              ) : (
                                <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                  Member
                                </span>
                              )}

                              <button
                                type="button"
                                onClick={() => handleRemoveMember(currentExpandedTeam.id, m.userId)}
                                className="p-1 text-slate-500 dark:text-slate-400 hover:text-red-600 rounded"
                                title="Remove from team"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400">
                Select a team from the left to view its roster and manage members.
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-300 dark:border-white/[0.08] bg-slate-50/80 dark:bg-slate-900/50 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-blue-500" />
            When a task is assigned to any team, all team members receive automatic notifications.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary px-4 py-1.5 text-xs font-semibold rounded-lg cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
