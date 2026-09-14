'use client';

import React, { useState, useMemo } from 'react';
import {
  KeyRound,
  Plus,
  Search,
  Users,
  Shield,
  Copy,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Layers,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Sparkles,
  Sliders,
  Filter,
  Eye,
  Lock,
  Unlock,
  ShieldAlert,
  ArrowRight,
  UserPlus,
  UserMinus,
  ArrowLeftRight,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';

interface RolesTabProps {
  orgId: string;
  roles: any[];
  categories: any[];
  allKeys: string[];
  highRiskKeys: string[];
  projects?: any[];
  selectedProjectId?: string;
  onRefresh: () => void;
  onOpenCreateRole?: () => void;
}

export function RolesTab({
  orgId,
  roles,
  categories,
  allKeys,
  highRiskKeys,
  projects = [],
  selectedProjectId = 'ALL',
  onRefresh,
}: RolesTabProps) {
  // Search & Filter
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Role Drawer (Create / Edit)
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [roleForm, setRoleForm] = useState<{
    name: string;
    description: string;
    scope: 'PROJECT' | 'WORKSPACE' | 'ORG';
    projectId: string | null;
    projectName: string | null;
    status: 'ACTIVE' | 'INACTIVE';
    permissions: string[];
  }>({
    name: '',
    description: '',
    scope: 'PROJECT',
    projectId: null,
    projectName: null,
    status: 'ACTIVE',
    permissions: [],
  });
  const [editorSearch, setEditorSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Add Existing Users Modal
  const [addUserModalRole, setAddUserModalRole] = useState<any>(null);
  const [existingUsers, setExistingUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState('ALL');
  const [assigningUsers, setAssigningUsers] = useState(false);

  // View Assigned Users Modal
  const [viewUsersRole, setViewUsersRole] = useState<any>(null);
  const [roleAssignedUsers, setRoleAssignedUsers] = useState<any[]>([]);
  const [loadingRoleUsers, setLoadingRoleUsers] = useState(false);
  const [selectedRoleUserIds, setSelectedRoleUserIds] = useState<string[]>([]);

  // Clone Role Modal
  const [cloneModalRole, setCloneModalRole] = useState<any>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneDescription, setCloneDescription] = useState('');
  const [cloning, setCloning] = useState(false);

  // Delete Role Modal
  const [deleteModalRole, setDeleteModalRole] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);

  // Role Comparison Modal
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [selectedCompareRoleIds, setSelectedCompareRoleIds] = useState<string[]>([]);

  // Filtered Roles
  const filteredRoles = useMemo(() => {
    if (!Array.isArray(roles)) return [];
    const searchLower = (search || '').toLowerCase().trim();

    return roles.filter((r) => {
      if (!r || typeof r !== 'object') return false;

      const roleName = String(r.name || '').toLowerCase();
      const roleDesc = String(r.description || '').toLowerCase();
      const permissions = Array.isArray(r.permissions) ? r.permissions : [];

      const matchQuery =
        !searchLower ||
        roleName.includes(searchLower) ||
        roleDesc.includes(searchLower) ||
        permissions.some((p: any) => {
          if (!p) return false;
          if (typeof p === 'string') return p.toLowerCase().includes(searchLower);
          if (typeof p === 'object' && p.key) return String(p.key).toLowerCase().includes(searchLower);
          return false;
        });

      const matchScope = scopeFilter === 'ALL' || r.scope === scopeFilter;
      const matchStatus = statusFilter === 'ALL' || r.status === statusFilter;

      return Boolean(matchQuery && matchScope && matchStatus);
    });
  }, [roles, search, scopeFilter, statusFilter]);

  // Open Create Role
  const handleOpenCreate = () => {
    setEditingRole(null);
    const currProj = selectedProjectId && selectedProjectId !== 'ALL' ? projects.find((p) => p.id === selectedProjectId) : null;
    setRoleForm({
      name: '',
      description: '',
      scope: 'PROJECT',
      projectId: currProj ? currProj.id : null,
      projectName: currProj ? currProj.name : null,
      status: 'ACTIVE',
      permissions: [],
    });
    setEditorSearch('');
    setIsEditorOpen(true);
  };

  // Open Edit Role
  const handleOpenEdit = (role: any) => {
    setEditingRole(role);
    setRoleForm({
      name: role.name,
      description: role.description || '',
      scope: role.scope || 'PROJECT',
      projectId: role.projectId || null,
      projectName: role.projectName || null,
      status: role.status || 'ACTIVE',
      permissions: [...(role.permissions || [])],
    });
    setEditorSearch('');
    setIsEditorOpen(true);
  };

  // Toggle Single Permission in Form
  const togglePermission = (key: string) => {
    setRoleForm((prev) => {
      const exists = prev.permissions.includes(key);
      return {
        ...prev,
        permissions: exists
          ? prev.permissions.filter((p) => p !== key)
          : [...prev.permissions, key],
      };
    });
  };

  // Toggle Category Permissions
  const toggleCategory = (cat: any) => {
    const catKeys = cat.permissions.map((p: any) => p.key);
    const allSelected = catKeys.every((k: string) => roleForm.permissions.includes(k));

    setRoleForm((prev) => {
      if (allSelected) {
        return {
          ...prev,
          permissions: prev.permissions.filter((p) => !catKeys.includes(p)),
        };
      } else {
        return {
          ...prev,
          permissions: Array.from(new Set([...prev.permissions, ...catKeys])),
        };
      }
    });
  };

  // Select All / Presets / Clear All Permissions
  const handleSelectAllPerms = () => {
    const keysFromCats = (categories || []).flatMap((c: any) => (c.permissions || []).map((p: any) => p.key));
    const combined = Array.from(new Set([...(allKeys || []), ...keysFromCats]));
    setRoleForm((prev) => ({ ...prev, permissions: combined }));
    showSuccess(`Added all ${combined.length} permissions to role`);
  };

  const handleClearAllPerms = () => {
    setRoleForm((prev) => ({ ...prev, permissions: [] }));
    showSuccess('Cleared all permissions');
  };

  const handleApplyPreset = (presetType: 'ADMIN' | 'MEMBER' | 'VIEWER') => {
    let keys: string[] = [];
    if (presetType === 'ADMIN') {
      keys = (categories || []).flatMap((c: any) => (c.permissions || []).map((p: any) => p.key));
    } else if (presetType === 'MEMBER') {
      keys = [
        'projects:view',
        'issues:view', 'issues:create', 'issues:edit', 'issues:transition', 'issues:assign', 'issues:comment',
        'tasks:view', 'tasks:create', 'tasks:edit', 'tasks:delete',
        'epics:view', 'sprints:view', 'backlog:view', 'backlog:estimate',
        'kanban:view', 'list:view', 'calendar:view', 'timeline:view', 'workload:view', 'reports:view', 'analytics:view', 'teams:view', 'export:csv'
      ];
    } else if (presetType === 'VIEWER') {
      keys = [
        'projects:view', 'issues:view', 'tasks:view', 'epics:view', 'sprints:view', 'backlog:view',
        'kanban:view', 'list:view', 'calendar:view', 'timeline:view', 'workload:view', 'reports:view', 'analytics:view'
      ];
    }

    setRoleForm((prev) => ({ ...prev, permissions: Array.from(new Set(keys)) }));
    showSuccess(`Applied ${presetType} preset (${keys.length} permissions)`);
  };

  // Save Role
  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleForm.name.trim()) {
      showError('Role name is required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/pbac/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          id: editingRole?.id,
          name: roleForm.name,
          description: roleForm.description,
          scope: roleForm.scope,
          projectId: roleForm.projectId,
          projectName: roleForm.projectName,
          status: roleForm.status,
          permissions: roleForm.permissions,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save role');
      }

      showSuccess(editingRole ? 'Permission Role updated' : 'Permission Role created');
      setIsEditorOpen(false);
      onRefresh();
    } catch (e: any) {
      showError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Open Add Existing Users Modal
  const handleOpenAddUsers = async (role: any) => {
    setAddUserModalRole(role);
    setSelectedUserIds([]);
    setUserSearch('');
    setUserStatusFilter('ALL');
    setLoadingUsers(true);

    try {
      const res = await fetch(`/api/pbac/users?orgId=${orgId}&limit=all`);
      if (res.ok) {
        const json = await res.json();
        setExistingUsers(json.users || []);
      }
    } catch (e) {
      console.error('Failed to load existing users', e);
    } finally {
      setLoadingUsers(false);
    }
  };

  // Submit Add Existing Users
  const handleAddUsersSubmit = async () => {
    if (!addUserModalRole || selectedUserIds.length === 0) return;

    setAssigningUsers(true);
    try {
      const res = await fetch(`/api/pbac/roles/${addUserModalRole.id}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          userIds: selectedUserIds,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to assign users to role');
      }

      const json = await res.json();
      showSuccess(`Added ${json.addedCount || selectedUserIds.length} user(s) to '${addUserModalRole.name}'`);
      setAddUserModalRole(null);
      setSelectedUserIds([]);
      onRefresh();
    } catch (e: any) {
      showError(e.message);
    } finally {
      setAssigningUsers(false);
    }
  };

  // Open View Users Modal
  const handleOpenViewUsers = async (role: any) => {
    setViewUsersRole(role);
    setSelectedRoleUserIds([]);
    setLoadingRoleUsers(true);
    try {
      const res = await fetch(`/api/pbac/roles/${role.id}/users?orgId=${orgId}`);
      if (res.ok) {
        const json = await res.json();
        setRoleAssignedUsers(json.users || []);
      }
    } catch (e) {
      console.error('Failed to load role users', e);
    } finally {
      setLoadingRoleUsers(false);
    }
  };

  // Remove Single User from Role
  const handleRemoveUserFromRole = async (userId: string, userName: string) => {
    if (!viewUsersRole) return;
    try {
      const res = await fetch(`/api/pbac/roles/${viewUsersRole.id}/users`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, userId }),
      });

      if (!res.ok) throw new Error('Failed to remove user from role');
      showSuccess(`Removed ${userName} from role`);
      setRoleAssignedUsers((prev) => prev.filter((u) => u.id !== userId));
      onRefresh();
    } catch (e: any) {
      showError(e.message);
    }
  };

  // Bulk Remove Users from Role
  const handleBulkRemoveUsersFromRole = async () => {
    if (!viewUsersRole || selectedRoleUserIds.length === 0) return;
    try {
      const res = await fetch(`/api/pbac/roles/${viewUsersRole.id}/users`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, userIds: selectedRoleUserIds }),
      });

      if (!res.ok) throw new Error('Failed to remove selected users');
      showSuccess(`Removed ${selectedRoleUserIds.length} users from role`);
      setRoleAssignedUsers((prev) => prev.filter((u) => !selectedRoleUserIds.includes(u.id)));
      setSelectedRoleUserIds([]);
      onRefresh();
    } catch (e: any) {
      showError(e.message);
    }
  };

  // Open Clone Modal
  const handleOpenClone = (role: any) => {
    setCloneModalRole(role);
    setCloneName(`${role.name} (Copy)`);
    setCloneDescription(`Cloned from ${role.name}`);
  };

  // Submit Clone
  const handleCloneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneModalRole || !cloneName.trim()) return;

    setCloning(true);
    try {
      const res = await fetch('/api/pbac/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          cloneFromId: cloneModalRole.id,
          name: cloneName,
          description: cloneDescription,
          permissions: cloneModalRole.permissions,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to clone role');
      }

      showSuccess(`Role cloned as '${cloneName}'`);
      setCloneModalRole(null);
      onRefresh();
    } catch (e: any) {
      showError(e.message);
    } finally {
      setCloning(false);
    }
  };

  // Toggle Active/Inactive Status
  const handleToggleStatus = async (role: any) => {
    const nextStatus = role.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      const res = await fetch(`/api/pbac/roles/${role.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, status: nextStatus }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to toggle status');
      }

      showSuccess(`Role ${role.name} marked as ${nextStatus}`);
      onRefresh();
    } catch (e: any) {
      showError(e.message);
    }
  };

  // Open Delete Role Modal
  const handleOpenDelete = (role: any) => {
    setDeleteModalRole(role);
  };

  // Confirm Delete Role
  const handleConfirmDeleteRole = async (force: boolean = false) => {
    if (!deleteModalRole) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/pbac/roles/${deleteModalRole.id}?orgId=${orgId}${force ? '&force=true' : ''}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete role');
      }

      showSuccess(`Role '${deleteModalRole.name}' deleted successfully`);
      setDeleteModalRole(null);
      if (editingRole?.id === deleteModalRole.id) {
        setIsEditorOpen(false);
      }
      onRefresh();
    } catch (e: any) {
      showError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  // Role Comparison Helper
  const compareRoles = useMemo(() => {
    return roles.filter((r) => selectedCompareRoleIds.includes(r.id));
  }, [roles, selectedCompareRoleIds]);

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-indigo-400" />
            Permission Roles ({filteredRoles.length})
          </h3>
          <p className="text-xs text-slate-400">
            Define role capabilities across 18 canonical permission modules and assign existing users directly.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setSelectedCompareRoleIds(roles.slice(0, 3).map((r) => r.id));
              setIsCompareOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-indigo-400" />
            <span>Compare Roles</span>
          </button>

          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Create Permission Role</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search roles by name, description, or permission key..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
            <span className="text-slate-500 font-medium">Scope:</span>
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              className="bg-transparent text-slate-300 font-semibold outline-none cursor-pointer"
            >
              <option value="ALL" className="bg-slate-900">All Scopes</option>
              <option value="PROJECT" className="bg-slate-900">Project</option>
              <option value="WORKSPACE" className="bg-slate-900">Workspace</option>
              <option value="ORG" className="bg-slate-900">Organization</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
            <span className="text-slate-500 font-medium">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent text-slate-300 font-semibold outline-none cursor-pointer"
            >
              <option value="ALL" className="bg-slate-900">All Statuses</option>
              <option value="ACTIVE" className="bg-slate-900">Active</option>
              <option value="INACTIVE" className="bg-slate-900">Inactive</option>
            </select>
          </div>
        </div>
      </div>

      {/* Role Cards Grid */}
      {filteredRoles.length === 0 ? (
        <div className="text-center py-12 bg-slate-900/40 rounded-xl border border-slate-800/80 space-y-3">
          <KeyRound className="w-8 h-8 text-slate-600 mx-auto" />
          <h4 className="text-sm font-bold text-slate-300">No Permission Roles Found</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            No roles matched your search or filters. Create a new Permission Role to get started.
          </p>
          <button
            onClick={handleOpenCreate}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium"
          >
            Create Role
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRoles.map((role) => {
            const hasHighRisk = (role.permissions || []).some((p: string) => highRiskKeys.includes(p));
            return (
              <div
                key={role.id}
                className="bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-xl p-4.5 flex flex-col justify-between gap-4 transition-all shadow-xs"
              >
                <div className="space-y-3">
                  {/* Title & Badges */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-100">{role.name}</h4>
                        {role.isSystem && (
                          <span className="px-1.5 py-0.5 bg-slate-800 text-slate-400 font-mono text-[9px] font-bold rounded">
                            SYSTEM
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                        {role.description || 'No description provided.'}
                      </p>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                        role.status === 'ACTIVE'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      {role.status}
                    </span>
                  </div>

                  {/* Stats Badges */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                    <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-300 font-semibold rounded-md border border-indigo-500/20 flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      {role.permissionCount || (role.permissions || []).length} Perms
                    </span>

                    <button
                      onClick={() => handleOpenViewUsers(role)}
                      className="px-2 py-0.5 bg-slate-800 hover:bg-slate-750 text-slate-300 font-semibold rounded-md border border-slate-700 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Users className="w-3 h-3 text-blue-400" />
                      {role.assignedUserCount || 0} Users
                    </button>

                    <span className="px-2 py-0.5 bg-slate-800/80 text-slate-400 font-mono text-[10px] rounded-md">
                      Scope: {role.scope}
                    </span>

                    {role.projectId ? (
                      <span className="px-2 py-0.5 bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 font-mono text-[10px] rounded-md font-semibold flex items-center gap-1">
                        🎯 {role.projectName || 'Scoped Project'}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-slate-800/80 text-slate-400 font-mono text-[10px] rounded-md">
                        🌐 All Projects
                      </span>
                    )}

                    {hasHighRisk && (
                      <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-300 text-[10px] font-bold rounded flex items-center gap-1 border border-amber-500/20">
                        <AlertTriangle className="w-3 h-3" />
                        High Risk
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Footer Actions */}
                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleOpenAddUsers(role)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 hover:text-indigo-200 border border-indigo-500/30 rounded-lg text-xs font-semibold transition-all"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Add Existing Users</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleOpenClone(role)}
                      title="Clone Role"
                      className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleOpenEdit(role)}
                      title="Edit Role & Permissions"
                      className="p-1.5 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded-lg transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    {!role.isSystem && (
                      <button
                        onClick={() => handleToggleStatus(role)}
                        title={role.status === 'ACTIVE' ? 'Deactivate Role' : 'Activate Role'}
                        className="p-1.5 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg transition-colors"
                      >
                        {role.status === 'ACTIVE' ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      </button>
                    )}

                    <button
                      onClick={() => handleOpenDelete(role)}
                      title="Delete Permission Role"
                      className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 1. ADD EXISTING USERS TO ROLE MODAL */}
      {addUserModalRole && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-indigo-400" />
                  Add Existing Users to Role: <span className="text-indigo-300">{addUserModalRole.name}</span>
                </h4>
                <p className="text-xs text-slate-400">
                  Select existing registered users to grant this Permission Role.
                </p>
              </div>
              <button
                onClick={() => setAddUserModalRole(null)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Filter Bar in Modal */}
            <div className="p-3 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search by name, email, or User ID..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    const assignable = existingUsers
                      .filter((u) => !u.assignedRoles?.some((r: any) => r.id === addUserModalRole.id))
                      .map((u) => u.id);
                    setSelectedUserIds(assignable);
                  }}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs"
                >
                  Select All Assignable
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedUserIds([])}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded text-xs"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Users List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loadingUsers ? (
                <div className="text-center py-8 text-xs text-slate-500">Loading directory users...</div>
              ) : (
                existingUsers
                  .filter((u) => {
                    if (!u) return false;
                    const searchLower = (userSearch || '').toLowerCase().trim();
                    if (!searchLower) return true;
                    const userName = String(u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || '').toLowerCase();
                    const userEmail = String(u.email || '').toLowerCase();
                    const userId = String(u.id || '').toLowerCase();
                    return userName.includes(searchLower) || userEmail.includes(searchLower) || userId.includes(searchLower);
                  })
                  .map((u) => {
                    const isAlreadyAssigned = u.assignedRoles?.some((r: any) => r.id === addUserModalRole.id);
                    const isSelected = selectedUserIds.includes(u.id);

                    return (
                      <div
                        key={u.id}
                        onClick={() => {
                          if (isAlreadyAssigned) return;
                          setSelectedUserIds((prev) =>
                            prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                          );
                        }}
                        className={`p-3 rounded-lg border flex items-center justify-between gap-3 text-xs transition-all ${
                          isAlreadyAssigned
                            ? 'bg-slate-950/40 border-slate-900 opacity-60 cursor-not-allowed'
                            : isSelected
                            ? 'bg-indigo-600/10 border-indigo-500/50 cursor-pointer'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700 cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            disabled={isAlreadyAssigned}
                            checked={isSelected || isAlreadyAssigned}
                            onChange={() => {}}
                            className="rounded bg-slate-900 border-slate-700 text-indigo-600 cursor-pointer"
                          />
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-200">{u.name}</span>
                              <span className="text-slate-500 text-[11px]">({u.email})</span>
                              {u.status === 'SUSPENDED' && (
                                <span className="px-1.5 py-0.2 bg-rose-500/20 text-rose-300 text-[9px] rounded font-bold">
                                  SUSPENDED
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-slate-400">
                              <span>ID: <span className="font-mono text-slate-500">{u.id.slice(0, 8)}...</span></span>
                              <span>•</span>
                              <span>Role: {u.jobTitle || 'Member'}</span>
                              <span>•</span>
                              <span>Current Roles: {u.assignedRoles?.map((r: any) => r.name).join(', ') || 'None'}</span>
                            </div>
                          </div>
                        </div>

                        {isAlreadyAssigned && (
                          <span className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded text-[10px] font-semibold">
                            Already Assigned
                          </span>
                        )}
                      </div>
                    );
                  })
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between">
              <div className="text-xs text-slate-400">
                Selected: <span className="font-bold text-indigo-400">{selectedUserIds.length}</span> Users
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAddUserModalRole(null)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={selectedUserIds.length === 0 || assigningUsers}
                  onClick={handleAddUsersSubmit}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs"
                >
                  {assigningUsers ? 'Assigning...' : 'Assign Role'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. VIEW ASSIGNED ROLE USERS MODAL */}
      {viewUsersRole && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-400" />
                  Assigned Users: <span className="text-indigo-300">{viewUsersRole.name}</span>
                </h4>
                <p className="text-xs text-slate-400">
                  {roleAssignedUsers.length} total user(s) currently hold this Permission Role.
                </p>
              </div>
              <button
                onClick={() => setViewUsersRole(null)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {selectedRoleUserIds.length > 0 && (
              <div className="p-2.5 bg-rose-500/10 border-b border-rose-500/20 flex items-center justify-between px-4 text-xs">
                <span className="text-rose-300 font-medium">
                  {selectedRoleUserIds.length} user(s) selected
                </span>
                <button
                  onClick={handleBulkRemoveUsersFromRole}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-bold"
                >
                  Remove Selected from Role
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loadingRoleUsers ? (
                <div className="text-center py-8 text-xs text-slate-500">Loading role users...</div>
              ) : roleAssignedUsers.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">No users currently assigned to this role.</div>
              ) : (
                roleAssignedUsers.map((u) => (
                  <div
                    key={u.id}
                    className="p-3 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedRoleUserIds.includes(u.id)}
                        onChange={(e) => {
                          setSelectedRoleUserIds((prev) =>
                            e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                          );
                        }}
                        className="rounded bg-slate-900 border-slate-700 text-indigo-600 cursor-pointer"
                      />
                      <div>
                        <div className="font-bold text-slate-200">{u.firstName} {u.lastName}</div>
                        <div className="text-slate-400 text-[11px]">{u.email} • {u.jobTitle || 'Member'}</div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleRemoveUserFromRole(u.id, `${u.firstName} ${u.lastName}`)}
                      className="px-2 py-1 text-rose-400 hover:bg-rose-500/10 rounded text-[11px] font-medium border border-rose-500/20"
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="p-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between">
              <button
                onClick={() => {
                  setViewUsersRole(null);
                  handleOpenAddUsers(viewUsersRole);
                }}
                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add More Users</span>
              </button>

              <button
                onClick={() => setViewUsersRole(null)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. CLONE ROLE MODAL */}
      {cloneModalRole && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCloneSubmit}
            className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md shadow-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Copy className="w-4 h-4 text-indigo-400" />
                Clone Role: {cloneModalRole.name}
              </h4>
              <button
                type="button"
                onClick={() => setCloneModalRole(null)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              This will create a new Permission Role with all <span className="font-bold text-indigo-400">{cloneModalRole.permissions?.length || 0} permissions</span> copied from '{cloneModalRole.name}'. The original role will not be modified.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">New Role Name *</label>
                <input
                  type="text"
                  required
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Description</label>
                <textarea
                  rows={3}
                  value={cloneDescription}
                  onChange={(e) => setCloneDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setCloneModalRole(null)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={cloning}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold shadow-xs"
              >
                {cloning ? 'Cloning...' : 'Save Cloned Role'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 4. ROLE COMPARISON MODAL */}
      {isCompareOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-indigo-400" />
                  Permission Role Comparison Matrix
                </h4>
                <p className="text-xs text-slate-400">
                  Side-by-side comparison across all 18 canonical modules.
                </p>
              </div>
              <button
                onClick={() => setIsCompareOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Select Roles to Compare */}
            <div className="p-3 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-slate-400">Compare Roles:</span>
              {roles.map((r) => {
                const isSelected = selectedCompareRoleIds.includes(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() => {
                      setSelectedCompareRoleIds((prev) =>
                        isSelected ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                      );
                    }}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all border ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-500'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    {r.name}
                  </button>
                );
              })}
            </div>

            {/* Comparison Matrix Table */}
            <div className="flex-1 overflow-y-auto p-4">
              {compareRoles.length === 0 ? (
                <div className="text-center py-12 text-xs text-slate-500">Select at least one role to compare.</div>
              ) : (
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950 sticky top-0">
                      <th className="p-2.5 text-slate-300 font-bold w-1/3">Permission Module & Capability</th>
                      {compareRoles.map((r) => (
                        <th key={r.id} className="p-2.5 text-center text-slate-200 font-bold border-l border-slate-800">
                          {r.name}
                          <span className="block text-[10px] text-slate-400 font-normal">
                            ({r.permissions?.length || 0} perms)
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {categories.map((cat) => (
                      <React.Fragment key={cat.id}>
                        <tr className="bg-slate-950/90 font-bold text-indigo-300 text-[11px]">
                          <td colSpan={compareRoles.length + 1} className="p-2 pl-3">
                            {cat.name}
                          </td>
                        </tr>
                        {cat.permissions.map((p: any) => (
                          <tr key={p.key} className="hover:bg-slate-850/50">
                            <td className="p-2 pl-6 text-slate-300">
                              <div className="font-medium">{p.label}</div>
                              <div className="text-[10px] text-slate-500 font-mono">{p.key}</div>
                            </td>
                            {compareRoles.map((r) => {
                              const has = (r.permissions || []).includes(p.key);
                              return (
                                <td key={r.id} className="p-2 text-center border-l border-slate-800/60">
                                  {has ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                                  ) : (
                                    <span className="text-slate-600 font-mono">-</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="p-3 border-t border-slate-800 bg-slate-950 text-right">
              <button
                onClick={() => setIsCompareOpen(false)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium"
              >
                Close Comparison
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. CREATE / EDIT ROLE DRAWER */}
      {isEditorOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex justify-end">
          <div className="bg-slate-900 border-l border-slate-800 w-full max-w-2xl h-full flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <div>
                <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-indigo-400" />
                  {editingRole ? `Edit Role: ${editingRole.name}` : 'Create New Permission Role'}
                </h4>
                <p className="text-xs text-slate-400">
                  Configure role attributes and select capabilities across 18 canonical modules.
                </p>
              </div>
              <button
                onClick={() => setIsEditorOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRole} className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* Role Details */}
                <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">Role Name *</label>
                    <input
                      type="text"
                      required
                      value={roleForm.name}
                      onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
                      placeholder="e.g. Lead Product Designer"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">Description</label>
                    <textarea
                      rows={2}
                      value={roleForm.description}
                      onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
                      placeholder="Summary of responsibilities and intended access..."
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">Scope</label>
                      <select
                        value={roleForm.scope}
                        onChange={(e) => setRoleForm({ ...roleForm, scope: e.target.value as any })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                      >
                        <option value="PROJECT">Project Level</option>
                        <option value="WORKSPACE">Workspace Level</option>
                        <option value="ORG">Organization Level</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">Status</label>
                      <select
                        value={roleForm.status}
                        onChange={(e) => setRoleForm({ ...roleForm, status: e.target.value as any })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="INACTIVE">INACTIVE</option>
                      </select>
                    </div>
                  </div>

                  {roleForm.scope === 'PROJECT' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1">Target Project (Project-Wise Scoping)</label>
                      <select
                        value={roleForm.projectId || 'ALL'}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'ALL') {
                            setRoleForm({ ...roleForm, projectId: null, projectName: null });
                          } else {
                            const proj = projects.find((p) => p.id === val);
                            setRoleForm({ ...roleForm, projectId: val, projectName: proj ? proj.name : null });
                          }
                        }}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-medium"
                      >
                        <option value="ALL">🌐 All Projects (Org-Wide)</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            🎯 {p.name} ({p.key})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* 18 Permission Categories Section */}
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
                    <div>
                      <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                        Role Permissions ({roleForm.permissions.length} Selected)
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        18 canonical modules (68 total backend capabilities)
                      </p>
                    </div>

                    {/* Presets & Quick Select Bar */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleSelectAllPerms}
                        className="px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-lg text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer transition-all"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Add Every Permission</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleApplyPreset('ADMIN')}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
                      >
                        Admin Preset
                      </button>

                      <button
                        type="button"
                        onClick={() => handleApplyPreset('MEMBER')}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-blue-300 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
                      >
                        Member Preset
                      </button>

                      <button
                        type="button"
                        onClick={() => handleApplyPreset('VIEWER')}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
                      >
                        Viewer Preset
                      </button>

                      <button
                        type="button"
                        onClick={handleClearAllPerms}
                        className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-medium rounded-lg border border-slate-800 transition-colors"
                      >
                        Clear All
                      </button>
                    </div>
                  </div>

                  {/* Search in permissions */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={editorSearch}
                      onChange={(e) => setEditorSearch(e.target.value)}
                      placeholder="Filter permissions by keyword..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  {/* Categories Accordions */}
                  <div className="space-y-3 pt-1">
                    {categories.map((cat) => {
                      const searchLower = (editorSearch || '').toLowerCase().trim();
                      const matchingPerms = (cat.permissions || []).filter(
                        (p: any) => {
                          if (!p) return false;
                          if (!searchLower) return true;
                          const label = String(p.label || '').toLowerCase();
                          const key = String(p.key || '').toLowerCase();
                          const desc = String(p.description || '').toLowerCase();
                          return label.includes(searchLower) || key.includes(searchLower) || desc.includes(searchLower);
                        }
                      );

                      if (matchingPerms.length === 0 && editorSearch) return null;

                      const catKeys = cat.permissions.map((p: any) => p.key);
                      const selectedCount = catKeys.filter((k: string) => roleForm.permissions.includes(k)).length;
                      const allSelected = selectedCount === catKeys.length;

                      return (
                        <div
                          key={cat.id}
                          className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden"
                        >
                          <div className="p-3 bg-slate-900/60 flex items-center justify-between border-b border-slate-800/80">
                            <div>
                              <span className="text-xs font-bold text-slate-200">{cat.name}</span>
                              <span className="ml-2 text-[10px] text-slate-500">
                                ({selectedCount}/{cat.permissions.length} active)
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => toggleCategory(cat)}
                              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-300 rounded"
                            >
                              {allSelected ? 'Deselect Category' : 'Select Category'}
                            </button>
                          </div>

                          <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {matchingPerms.map((p: any) => {
                              const checked = roleForm.permissions.includes(p.key);
                              const isHighRisk = p.riskLevel === 'HIGH' || p.riskLevel === 'CRITICAL';

                              return (
                                <label
                                  key={p.key}
                                  className={`p-2.5 rounded-lg border flex items-start gap-2.5 cursor-pointer transition-all ${
                                    checked
                                      ? 'bg-indigo-600/10 border-indigo-500/40 text-slate-200'
                                      : 'bg-slate-900/40 border-slate-800/60 hover:border-slate-700 text-slate-400'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => togglePermission(p.key)}
                                    className="mt-0.5 rounded bg-slate-900 border-slate-700 text-indigo-600 cursor-pointer"
                                  />
                                  <div className="space-y-0.5 text-xs">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-semibold text-slate-200">{p.label}</span>
                                      {isHighRisk && (
                                        <span className="px-1 py-0.2 bg-rose-500/20 text-rose-300 text-[8px] font-bold rounded">
                                          {p.riskLevel}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[10px] text-slate-500 leading-tight">
                                      {p.description}
                                    </p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Drawer Footer */}
              <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="text-xs text-slate-400">
                    <span className="font-bold text-indigo-400">{roleForm.permissions.length}</span> Permissions Selected
                  </div>

                  {editingRole && (
                    <button
                      type="button"
                      onClick={() => handleOpenDelete(editingRole)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/20 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Role</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditorOpen(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs"
                  >
                    {saving ? 'Saving...' : editingRole ? 'Save Changes' : 'Create Role'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. DELETE ROLE CONFIRMATION MODAL */}
      {deleteModalRole && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-100">
                  Delete Permission Role?
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Are you sure you want to permanently delete <span className="text-slate-200 font-bold">'{deleteModalRole.name}'</span>? This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Scope:</span>
                <span className="font-semibold text-slate-200">{deleteModalRole.scope}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Assigned Users:</span>
                <span className="font-semibold text-indigo-300">{deleteModalRole.assignedUserCount || 0} user(s)</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Permission Count:</span>
                <span className="font-semibold text-slate-200">{deleteModalRole.permissionCount || (deleteModalRole.permissions || []).length} perms</span>
              </div>
            </div>

            {deleteModalRole.isSystem && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-start gap-2 text-xs text-rose-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <span>
                  <strong>System-Defined Role:</strong> Deleting <strong className="text-rose-200">{deleteModalRole.name}</strong> will remove default system role capabilities for this organization.
                </span>
              </div>
            )}

            {(deleteModalRole.assignedUserCount || 0) > 0 && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-2 text-xs text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  This role is currently assigned to <strong className="text-amber-200">{deleteModalRole.assignedUserCount} user(s)</strong>. Selecting "Force Delete & Unassign Users" will remove this role from all assigned members before deleting it.
                </span>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteModalRole(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
              >
                Cancel
              </button>

              {(deleteModalRole.assignedUserCount || 0) > 0 || deleteModalRole.isSystem ? (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => handleConfirmDeleteRole(true)}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {deleting ? 'Deleting...' : 'Force Delete Role'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => handleConfirmDeleteRole(false)}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {deleting ? 'Deleting...' : 'Delete Role'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
