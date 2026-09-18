'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Search,
  Filter,
  KeyRound,
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FolderGit2,
  Building2,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Eye,
  Check,
  X,
  Sparkles,
  Sliders,
  UserPlus,
  UserMinus,
  Lock,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';

interface UsersTabProps {
  orgId: string;
  roles: any[];
  projects?: any[];
  selectedProjectId?: string;
  onInspectUser: (userId: string) => void;
  onRefresh: () => void;
}

export function UsersTab({
  orgId,
  roles,
  projects = [],
  selectedProjectId = 'ALL',
  onInspectUser,
  onRefresh,
}: UsersTabProps) {
  // Data State
  const [users, setUsers] = useState<any[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<'25' | '50' | '100' | '150' | '250' | '500' | 'all'>('25');

  // Multi-Selection State
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  // Bulk Assign Role Modal & Simulation
  const [isBulkAssignOpen, setIsBulkAssignOpen] = useState(false);
  const [bulkRoleId, setBulkRoleId] = useState('');
  const [simulation, setSimulation] = useState<any>(null);
  const [simulating, setSimulating] = useState(false);
  const [applyingBulk, setApplyingBulk] = useState(false);

  // Single User Access Profile Drawer & Inline Role Picker
  const [selectedUserProfile, setSelectedUserProfile] = useState<any>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [assigningSingleRole, setAssigningSingleRole] = useState(false);
  const [singleRoleToAdd, setSingleRoleToAdd] = useState('');
  const [inlineDropdownUserId, setInlineDropdownUserId] = useState<string | null>(null);

  // Local Roles Fetching Fallback (Ensures roles are always available in dropdowns)
  const [allRoles, setAllRoles] = useState<any[]>(roles && roles.length > 0 ? roles : []);

  const loadAllRoles = useCallback(async () => {
    try {
      const res = await fetch(`/api/pbac/roles?orgId=${orgId}`);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.roles) && json.roles.length > 0) {
          setAllRoles(json.roles);
        }
      }
    } catch (e) {
      console.error('Failed to load roles in UsersTab', e);
    }
  }, [orgId]);

  useEffect(() => {
    loadAllRoles();
  }, [loadAllRoles]);

  useEffect(() => {
    if (roles && roles.length > 0) {
      setAllRoles(roles);
    }
  }, [roles]);

  const activeRoles = allRoles && allRoles.length > 0 ? allRoles : (roles || []);

  // Quick Assign Role Inline
  const handleAssignRoleInline = async (userId: string, roleId: string) => {
    try {
      const res = await fetch(`/api/pbac/roles/${roleId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, userId }),
      });
      if (!res.ok) throw new Error('Failed to assign role');
      const roleObj = activeRoles.find((r) => r.id === roleId);
      showSuccess(`Assigned role '${roleObj?.name || 'Permission Role'}'`);
      setInlineDropdownUserId(null);
      loadUsers();
      onRefresh();
    } catch (e: any) {
      showError(e.message || 'Failed to assign role');
    }
  };

  // Quick Unassign Role Inline
  const handleRemoveRoleInline = async (userId: string, roleId: string, roleName: string) => {
    try {
      const res = await fetch(`/api/pbac/roles/${roleId}/users`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, userId }),
      });
      if (!res.ok) throw new Error('Failed to remove role');
      showSuccess(`Unassigned role '${roleName}'`);
      loadUsers();
      onRefresh();
    } catch (e: any) {
      showError(e.message || 'Failed to remove role');
    }
  };

  // Load Users
  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        orgId,
        search,
        roleId: roleFilter,
        status: statusFilter,
        projectId: selectedProjectId || 'ALL',
        page: String(page),
        limit: String(limit),
      });

      const res = await fetch(`/api/pbac/users?${query.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setUsers(json.users || []);
        setTotalRecords(json.totalRecords || 0);
      }
    } catch (e: any) {
      showError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [orgId, search, roleFilter, statusFilter, selectedProjectId, page, limit]);

  useEffect(() => {
    loadUsers();
    const handleUpdate = () => {
      loadUsers();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pbac:updated', handleUpdate);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('pbac:updated', handleUpdate);
      }
    };
  }, [loadUsers]);

  // Handle Multi-Select All on Current Page
  const handleSelectPage = () => {
    const pageUserIds = users.map((u) => u.id);
    const allSelected = pageUserIds.every((id) => selectedUserIds.includes(id));
    if (allSelected) {
      setSelectedUserIds((prev) => prev.filter((id) => !pageUserIds.includes(id)));
    } else {
      setSelectedUserIds((prev) => Array.from(new Set([...prev, ...pageUserIds])));
    }
  };

  // Open Bulk Assign Modal & Run Simulation
  const handleOpenBulkAssign = async () => {
    if (selectedUserIds.length === 0) {
      showError('Please select at least one user');
      return;
    }

    const defaultRole = roles[0]?.id || '';
    setBulkRoleId(defaultRole);
    setIsBulkAssignOpen(true);
    if (defaultRole) {
      runSimulation(defaultRole);
    }
  };

  const runSimulation = async (roleIdToSimulate: string) => {
    setSimulating(true);
    try {
      const res = await fetch('/api/pbac/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          userIds: selectedUserIds,
          roleId: roleIdToSimulate,
          simulate: true,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setSimulation(json.simulation);
      }
    } catch (e) {
      console.error('Simulation error', e);
    } finally {
      setSimulating(false);
    }
  };

  const handleApplyBulkAssign = async () => {
    if (!bulkRoleId) return;
    setApplyingBulk(true);
    try {
      const res = await fetch('/api/pbac/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          action: 'ASSIGN_ROLE',
          userIds: selectedUserIds,
          roleId: bulkRoleId,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to bulk assign role');
      }

      const json = await res.json();
      showSuccess(`Role assigned to ${json.result?.addedCount || selectedUserIds.length} users`);
      setIsBulkAssignOpen(false);
      setSelectedUserIds([]);
      loadUsers();
      onRefresh();
    } catch (e: any) {
      showError(e.message);
    } finally {
      setApplyingBulk(false);
    }
  };

  // Open User Access Profile Drawer
  const handleOpenProfile = (user: any) => {
    setSelectedUserProfile(user);
    setSingleRoleToAdd('');
    setIsProfileOpen(true);
  };

  // Add Single Role to User Profile
  const handleAddRoleToUserProfile = async () => {
    if (!selectedUserProfile || !singleRoleToAdd) return;
    setAssigningSingleRole(true);
    try {
      const res = await fetch(`/api/pbac/roles/${singleRoleToAdd}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          userId: selectedUserProfile.id,
        }),
      });

      if (!res.ok) throw new Error('Failed to assign role');
      showSuccess('Permission Role assigned');
      setSingleRoleToAdd('');
      loadUsers();
      onRefresh();

      // Update local profile state
      const addedRole = roles.find((r) => r.id === singleRoleToAdd);
      if (addedRole) {
        setSelectedUserProfile((prev: any) => ({
          ...prev,
          assignedRoles: [...(prev.assignedRoles || []), addedRole],
        }));
      }
    } catch (e: any) {
      showError(e.message);
    } finally {
      setAssigningSingleRole(false);
    }
  };

  // Remove Single Role from User Profile
  const handleRemoveRoleFromUserProfile = async (roleId: string, roleName: string) => {
    if (!selectedUserProfile) return;
    try {
      const res = await fetch(`/api/pbac/roles/${roleId}/users`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          userId: selectedUserProfile.id,
        }),
      });

      if (!res.ok) throw new Error('Failed to remove role');
      showSuccess(`Removed '${roleName}'`);
      loadUsers();
      onRefresh();

      setSelectedUserProfile((prev: any) => ({
        ...prev,
        assignedRoles: (prev.assignedRoles || []).filter((r: any) => r.id !== roleId),
      }));
    } catch (e: any) {
      showError(e.message);
    }
  };

  const totalPages = limit === 'all' ? 1 : Math.ceil(totalRecords / Number(limit));

  return (
    <div className="space-y-4">
      {/* Top Header & Search */}
      <div className="bg-white dark:bg-slate-900/80 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-600" />
            Existing Users Directory ({totalRecords})
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            View existing accounts, manage multiple Permission Roles per user, and perform bulk role assignments.
          </p>
        </div>

        {selectedUserIds.length > 0 && (
          <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-lg text-xs animate-in fade-in">
            <span className="font-bold text-indigo-700">{selectedUserIds.length} user(s) selected</span>
            <button
              onClick={handleOpenBulkAssign}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-semibold shadow-sm"
            >
              + Assign Role
            </button>
            <button
              onClick={() => setSelectedUserIds([])}
              className="px-2 py-1 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Filter & Pagination Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name, email, or User ID..."
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 font-medium">Role:</span>
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
              className="bg-transparent text-slate-700 dark:text-slate-300 font-semibold outline-none cursor-pointer max-w-[140px]"
            >
              <option value="all" className="bg-white dark:bg-slate-900">All Roles</option>
              {activeRoles.map((r) => (
                <option key={r.id} value={r.id} className="bg-white dark:bg-slate-900">
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 font-medium">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="bg-transparent text-slate-700 dark:text-slate-300 font-semibold outline-none cursor-pointer"
            >
              <option value="all" className="bg-white dark:bg-slate-900">All Statuses</option>
              <option value="ACTIVE" className="bg-white dark:bg-slate-900">ACTIVE</option>
              <option value="SUSPENDED" className="bg-white dark:bg-slate-900">SUSPENDED</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 font-medium">Page Size:</span>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(e.target.value as any);
                setPage(1);
              }}
              className="bg-transparent text-slate-700 dark:text-slate-300 font-semibold outline-none cursor-pointer"
            >
              <option value="25" className="bg-white dark:bg-slate-900">25</option>
              <option value="50" className="bg-white dark:bg-slate-900">50</option>
              <option value="100" className="bg-white dark:bg-slate-900">100</option>
              <option value="150" className="bg-white dark:bg-slate-900">150</option>
              <option value="250" className="bg-white dark:bg-slate-900">250</option>
              <option value="500" className="bg-white dark:bg-slate-900">500</option>
              <option value="all" className="bg-white dark:bg-slate-900">All</option>
            </select>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 uppercase tracking-wider text-[10px]">
                <th className="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={users.length > 0 && users.every((u) => selectedUserIds.includes(u.id))}
                    onChange={handleSelectPage}
                    className="rounded bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-indigo-600 cursor-pointer"
                  />
                </th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300">User Details</th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300">Assigned Permission Roles</th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300">Effective Perms</th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300">Projects</th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300">Status</th>
                <th className="p-3 font-bold text-slate-700 dark:text-slate-300 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    Loading users...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    No users found matching your filters.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isSelected = selectedUserIds.includes(u.id);

                  return (
                    <tr
                      key={u.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        isSelected ? 'bg-indigo-50' : ''
                      }`}
                    >
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            setSelectedUserIds((prev) =>
                              e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                            );
                          }}
                          className="rounded bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-indigo-600 cursor-pointer"
                        />
                      </td>

                      <td className="p-3">
                        <div className="font-bold text-slate-800 dark:text-slate-200">{u.name}</div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-400">{u.email}</div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          ID: {u.id.slice(0, 10)}... • {u.jobTitle}
                        </div>
                      </td>

                      <td className="p-3 relative">
                        <div className="flex flex-wrap items-center gap-1.5 max-w-sm">
                          {u.assignedRoles && u.assignedRoles.length > 0 ? (
                            u.assignedRoles.map((r: any) => (
                              <span
                                key={r.id}
                                className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold rounded text-[10px] group"
                              >
                                {r.name}
                                <button
                                  onClick={() => handleRemoveRoleInline(u.id, r.id, r.name)}
                                  title={`Remove ${r.name}`}
                                  className="text-indigo-600 hover:text-rose-600 ml-0.5 font-bold"
                                >
                                  ×
                                </button>
                              </span>
                            ))
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-500/10 text-slate-500 border border-slate-500/20 font-semibold rounded text-[10px]">
                              VIEWER (Default)
                            </span>
                          )}

                          {/* Quick Inline + Assign Role Button */}
                          <div className="relative inline-block">
                            <button
                              onClick={() =>
                                setInlineDropdownUserId(inlineDropdownUserId === u.id ? null : u.id)
                              }
                              className="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded text-[10px] font-bold flex items-center gap-1 transition-colors"
                            >
                              + Assign Role
                            </button>

                            {/* Inline Role Selector Dropdown */}
                            {inlineDropdownUserId === u.id && (
                              <div className="absolute left-0 top-full mt-1 z-40 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg shadow-2xl p-2 min-w-[200px] space-y-1">
                                <div className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider px-2 py-1 border-b border-slate-200 dark:border-slate-800">
                                  Assign Permission Role
                                </div>
                                {(() => {
                                  const unassigned = activeRoles.filter(
                                    (r) => !u.assignedRoles?.some((ar: any) => ar.id === r.id || ar.name === r.name)
                                  );
                                  const list = unassigned.length > 0 ? unassigned : activeRoles;
                                  return list.map((r) => (
                                    <button
                                      key={r.id}
                                      onClick={() => handleAssignRoleInline(u.id, r.id)}
                                      className="w-full text-left px-2 py-1.5 hover:bg-indigo-100 hover:text-indigo-800 text-slate-700 dark:text-slate-300 rounded text-xs flex items-center justify-between transition-colors"
                                    >
                                      <span className="font-semibold">{r.name}</span>
                                      <span className="text-[10px] text-slate-500 font-mono">
                                        +{r.permissions?.length || r.permissionCount || 0}
                                      </span>
                                    </button>
                                  ));
                                })()}
                                <div className="pt-1 border-t border-slate-200 dark:border-slate-800 flex justify-end">
                                  <button
                                    onClick={() => setInlineDropdownUserId(null)}
                                    className="text-[10px] text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 px-2 py-0.5"
                                  >
                                    Close
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="p-3">
                        <span className="font-mono font-bold text-indigo-600">
                          {u.effectivePermissionsCount || 0}
                        </span>
                        <span className="text-[10px] text-slate-500 ml-1">capabilities</span>
                      </td>

                      <td className="p-3">
                        <div className="text-slate-700 dark:text-slate-300 font-medium">{u.projects?.length || 0} Projects</div>
                        <div className="text-[10px] text-slate-500">{u.workspaces?.length || 0} Workspaces</div>
                      </td>

                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            u.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-rose-50 text-rose-600 border border-rose-200'
                          }`}
                        >
                          {u.status}
                        </span>
                      </td>

                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenProfile(u)}
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold shadow-sm flex items-center gap-1 border border-indigo-200"
                          >
                            <UserPlus className="w-3 h-3" />
                            Assign Roles
                          </button>
                          <button
                            onClick={() => onInspectUser(u.id)}
                            title="Inspect Access Provenance"
                            className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded text-xs font-medium border border-slate-300 dark:border-slate-700 flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5 text-indigo-600" />
                            Inspect Provenance
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
          <div>
            Showing <span className="font-bold text-slate-800 dark:text-slate-200">{users.length}</span> of{' '}
            <span className="font-bold text-slate-800 dark:text-slate-200">{totalRecords}</span> users
          </div>

          {limit !== 'all' && totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage(1)}
                className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded disabled:opacity-40 hover:bg-slate-100 dark:bg-slate-800"
              >
                First
              </button>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded disabled:opacity-40 hover:bg-slate-100 dark:bg-slate-800"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="px-3 py-1 font-semibold text-slate-800 dark:text-slate-200">
                Page {page} of {totalPages}
              </span>

              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded disabled:opacity-40 hover:bg-slate-100 dark:bg-slate-800"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(totalPages)}
                className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded disabled:opacity-40 hover:bg-slate-100 dark:bg-slate-800"
              >
                Last
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 1. BULK ROLE ASSIGNMENT & PRE-FLIGHT PREVIEW MODAL */}
      {isBulkAssignOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-indigo-600" />
                  Bulk Assign Permission Role
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Assign an existing Permission Role to {selectedUserIds.length} selected users.
                </p>
              </div>
              <button
                onClick={() => setIsBulkAssignOpen(false)}
                className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Select Role */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">Select Existing Permission Role *</label>
              <select
                value={bulkRoleId}
                onChange={(e) => {
                  setBulkRoleId(e.target.value);
                  runSimulation(e.target.value);
                }}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500 font-semibold"
              >
                {activeRoles.map((r) => (
                  <option key={r.id} value={r.id} className="bg-white dark:bg-slate-900">
                    {r.name} ({r.permissions?.length || r.permissionCount || 0} permissions)
                  </option>
                ))}
              </select>
            </div>

            {/* Pre-Flight Impact Preview */}
            <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                <span>Pre-Flight Impact Assessment</span>
                {simulating && <span className="text-indigo-600 text-[10px]">Calculating...</span>}
              </div>

              {simulation ? (
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                    <div className="text-lg font-bold text-emerald-700">
                      {simulation.newAssignments}
                    </div>
                    <span className="text-[10px] text-slate-600 dark:text-slate-400">New Assignments</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                    <div className="text-lg font-bold text-slate-700 dark:text-slate-300">
                      {simulation.alreadyAssigned}
                    </div>
                    <span className="text-[10px] text-slate-600 dark:text-slate-400">Already Assigned</span>
                  </div>

                  <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                    <div className="text-lg font-bold text-rose-600">
                      {simulation.cannotBeAssigned}
                    </div>
                    <span className="text-[10px] text-slate-600 dark:text-slate-400">Cannot Assign</span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-3 text-xs text-slate-500">Calculating simulation impact...</div>
              )}

              {simulation?.conflicts?.length > 0 && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs space-y-1">
                  <div className="font-bold text-rose-600 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Conflict Warnings:
                  </div>
                  {simulation.conflicts.map((c: string, idx: number) => (
                    <div key={idx} className="text-[11px] text-rose-700">• {c}</div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsBulkAssignOpen(false)}
                className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={applyingBulk || !bulkRoleId}
                onClick={handleApplyBulkAssign}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-sm"
              >
                {applyingBulk ? 'Applying Changes...' : 'Apply Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. USER ACCESS PROFILE DRAWER */}
      {isProfileOpen && selectedUserProfile && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex justify-end" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 w-full max-w-lg h-full flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-600" />
                  User Access Profile
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400">{selectedUserProfile.name} ({selectedUserProfile.email})</p>
              </div>
              <button
                onClick={() => setIsProfileOpen(false)}
                className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* User Identity Info */}
              <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700 dark:text-slate-300 text-sm">{selectedUserProfile.name}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      selectedUserProfile.status === 'ACTIVE'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-rose-50 text-rose-600'
                    }`}
                  >
                    {selectedUserProfile.status}
                  </span>
                </div>
                <div className="text-slate-600 dark:text-slate-400">{selectedUserProfile.email}</div>
                <div className="text-slate-500 font-mono text-[10px]">ID: {selectedUserProfile.id}</div>
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>Job Title: <strong className="text-slate-800 dark:text-slate-200">{selectedUserProfile.jobTitle}</strong></span>
                  <span>Company: <strong className="text-slate-800 dark:text-slate-200">{selectedUserProfile.company}</strong></span>
                </div>
              </div>

              {/* Assigned Roles List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                    Assigned Permission Roles ({selectedUserProfile.assignedRoles?.length || 0})
                  </h4>
                  <button
                    onClick={() => onInspectUser(selectedUserProfile.id)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Inspect Effective Access
                  </button>
                </div>

                {/* Add Role Picker */}
                <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-2">
                  <select
                    value={singleRoleToAdd}
                    onChange={(e) => setSingleRoleToAdd(e.target.value)}
                    className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">+ Select Existing Role to Assign...</option>
                    {(() => {
                      const unassigned = activeRoles.filter(
                        (r) => !selectedUserProfile.assignedRoles?.some((ar: any) => ar.id === r.id || ar.name === r.name)
                      );
                      const displayList = unassigned.length > 0 ? unassigned : activeRoles;
                      return displayList.map((r: any) => (
                        <option key={r.id} value={r.id} className="bg-white dark:bg-slate-900">
                          {r.name} ({r.permissions?.length || r.permissionCount || 0} permissions)
                        </option>
                      ));
                    })()}
                  </select>

                  <button
                    disabled={!singleRoleToAdd || assigningSingleRole}
                    onClick={handleAddRoleToUserProfile}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold shrink-0"
                  >
                    {assigningSingleRole ? 'Assigning...' : 'Assign'}
                  </button>
                </div>

                {/* Assigned Roles List */}
                <div className="space-y-2">
                  {(selectedUserProfile.assignedRoles || []).length === 0 ? (
                    <div className="text-center py-6 text-xs text-slate-500 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800">
                      No Permission Roles assigned to this user.
                    </div>
                  ) : (
                    selectedUserProfile.assignedRoles.map((role: any) => (
                      <div
                        key={role.id}
                        className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                            {role.name}
                            <span className="text-[10px] text-indigo-600 font-mono">
                              ({role.permissions?.length || role.permissionCount || 0} perms)
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500">{role.description}</p>
                        </div>

                        <button
                          onClick={() => handleRemoveRoleFromUserProfile(role.id, role.name)}
                          className="p-1 text-slate-500 hover:text-rose-600 hover:bg-rose-100 rounded"
                          title="Remove Role"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Resource Access (Where User Can Do It) */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  Resource Boundaries (Where Access is Valid)
                </h4>
                <div className="bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                  <div>
                    <span className="font-bold text-slate-700 dark:text-slate-300">Projects ({selectedUserProfile.projects?.length || 0}):</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {(selectedUserProfile.projects || []).map((p: any) => (
                        <span key={p.id} className="px-2 py-0.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 rounded text-[10px] border border-slate-200 dark:border-slate-800 font-mono">
                          {p.name} ({p.key})
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                    <span className="font-bold text-slate-700 dark:text-slate-300">Workspaces ({selectedUserProfile.workspaces?.length || 0}):</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {(selectedUserProfile.workspaces || []).map((w: any) => (
                        <span key={w.id} className="px-2 py-0.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 rounded text-[10px] border border-slate-200 dark:border-slate-800">
                          {w.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-right">
              <button
                onClick={() => setIsProfileOpen(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
