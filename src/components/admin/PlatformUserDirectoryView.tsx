'use client';

import React, { useState, useMemo } from 'react';
import {
  Users,
  Search,
  Filter,
  UserPlus,
  KeyRound,
  Edit2,
  Trash2,
  CheckCircle2,
  Ban,
  Shield,
  ShieldAlert,
  Building2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Copy,
  Check,
  X,
  Sparkles,
  Lock,
  RefreshCw,
  Mail,
  Sliders,
  AlertTriangle,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';

interface PlatformUserDirectoryViewProps {
  users: any[];
  orgs: any[];
  onRefresh: () => void;
  currentUserId?: string;
}

export function PlatformUserDirectoryView({
  users,
  orgs,
  onRefresh,
  currentUserId,
}: PlatformUserDirectoryViewProps) {
  // Search & Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'user'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'SUSPENDED'>('all');
  const [mfaFilter, setMfaFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [orgFilter, setOrgFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<'10' | '25' | '50' | '100' | 'all'>('25');

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);

  // Form States
  const [createForm, setCreateForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    jobTitle: '',
    company: '',
    timezone: 'UTC',
    language: 'en',
    orgId: '',
    role: 'MEMBER',
    isSuperAdmin: false,
    status: 'ACTIVE',
  });
  const [creating, setCreating] = useState(false);

  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    jobTitle: '',
    company: '',
    timezone: 'UTC',
    language: 'en',
    isSuperAdmin: false,
    status: 'ACTIVE',
  });
  const [updating, setUpdating] = useState(false);

  // Set Password State
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [revokeSessions, setRevokeSessions] = useState(true);
  const [settingPassword, setSettingPassword] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);

  // Delete State
  const [deleting, setDeleting] = useState(false);

  // Copied Email Tooltip State
  const [copiedEmailId, setCopiedEmailId] = useState<string | null>(null);

  // Filtered Users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchSearch =
        search === '' ||
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(search.toLowerCase()) ||
        (u.jobTitle || '').toLowerCase().includes(search.toLowerCase()) ||
        (u.company || '').toLowerCase().includes(search.toLowerCase());

      const matchRole =
        roleFilter === 'all' ||
        (roleFilter === 'admin' && u.isSuperAdmin) ||
        (roleFilter === 'user' && !u.isSuperAdmin);

      const matchStatus = statusFilter === 'all' || u.status === statusFilter;

      const matchMfa =
        mfaFilter === 'all' ||
        (mfaFilter === 'enabled' && u.mfaEnabled) ||
        (mfaFilter === 'disabled' && !u.mfaEnabled);

      const matchOrg =
        orgFilter === 'all' ||
        (u.orgMemberships || []).some((m: any) => m.orgId === orgFilter);

      return matchSearch && matchRole && matchStatus && matchMfa && matchOrg;
    });
  }, [users, search, roleFilter, statusFilter, mfaFilter, orgFilter]);

  // Pagination calculations
  const totalRecords = filteredUsers.length;
  const currentLimit = pageSize === 'all' ? totalRecords || 1 : Number(pageSize);
  const totalPages = Math.ceil(totalRecords / currentLimit) || 1;
  const paginatedUsers =
    pageSize === 'all'
      ? filteredUsers
      : filteredUsers.slice((page - 1) * currentLimit, page * currentLimit);

  // Password Generator Helper
  const generateStrongPassword = () => {
    const specials = '!@#$%&*';
    const numbers = '0123456789';
    const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lowers = 'abcdefghijkmnpqrstuvwxyz';
    let pwd = 'Eitekh#';
    for (let i = 0; i < 4; i++) pwd += numbers[Math.floor(Math.random() * numbers.length)];
    pwd += specials[Math.floor(Math.random() * specials.length)];
    for (let i = 0; i < 3; i++) pwd += uppers[Math.floor(Math.random() * uppers.length)];
    for (let i = 0; i < 3; i++) pwd += lowers[Math.floor(Math.random() * lowers.length)];
    setNewPassword(pwd);
    navigator.clipboard.writeText(pwd);
    setCopiedPassword(true);
    setTimeout(() => setCopiedPassword(false), 3000);
    showSuccess('Strong password generated and copied to clipboard');
  };

  // Password Strength Evaluator
  const getPasswordStrength = (pwd: string) => {
    if (!pwd) return { score: 0, label: 'None', color: 'bg-slate-700' };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    if (score <= 2) return { score: 1, label: 'Weak', color: 'bg-rose-500' };
    if (score === 3 || score === 4) return { score: 2, label: 'Good', color: 'bg-amber-500' };
    return { score: 3, label: 'Strong', color: 'bg-emerald-500' };
  };

  // 1. CREATE USER
  const handleOpenCreate = () => {
    setCreateForm({
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      jobTitle: '',
      company: '',
      timezone: 'UTC',
      language: 'en',
      orgId: orgs[0]?.id || '',
      role: 'MEMBER',
      isSuperAdmin: false,
      status: 'ACTIVE',
    });
    setIsCreateOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.email || !createForm.firstName) {
      showError('Please provide name and email');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/super-admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create user');
      }

      const data = await res.json();
      showSuccess(data.message || 'User account created successfully');
      setIsCreateOpen(false);
      onRefresh();
    } catch (e: any) {
      showError(e.message);
    } finally {
      setCreating(false);
    }
  };

  // 2. EDIT USER
  const handleOpenEdit = (user: any) => {
    setSelectedUser(user);
    setEditForm({
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || '',
      jobTitle: user.jobTitle || '',
      company: user.company || '',
      timezone: user.timezone || 'UTC',
      language: user.language || 'en',
      isSuperAdmin: Boolean(user.isSuperAdmin),
      status: user.status || 'ACTIVE',
    });
    setIsEditOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    setUpdating(true);
    try {
      const res = await fetch('/api/super-admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          ...editForm,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update user');
      }

      showSuccess('User account updated successfully');
      setIsEditOpen(false);
      onRefresh();
    } catch (e: any) {
      showError(e.message);
    } finally {
      setUpdating(false);
    }
  };

  // 3. SET / RESET PASSWORD
  const handleOpenPassword = (user: any) => {
    setSelectedUser(user);
    setNewPassword('');
    setShowPassword(false);
    setRevokeSessions(true);
    setIsPasswordOpen(true);
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !newPassword) {
      showError('Please enter or generate a new password');
      return;
    }

    if (newPassword.length < 6) {
      showError('Password must be at least 6 characters');
      return;
    }

    setSettingPassword(true);
    try {
      const res = await fetch('/api/super-admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          password: newPassword,
          revokeSessions,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to set password');
      }

      showSuccess(`Password successfully updated for ${selectedUser.email}`);
      setIsPasswordOpen(false);
      onRefresh();
    } catch (e: any) {
      showError(e.message);
    } finally {
      setSettingPassword(false);
    }
  };

  // 4. QUICK TOGGLE STATUS
  const handleToggleStatus = async (user: any) => {
    const newStatus = user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      const res = await fetch('/api/super-admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          status: newStatus,
          revokeSessions: newStatus === 'SUSPENDED',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to toggle status');
      }

      showSuccess(`User account set to ${newStatus}`);
      onRefresh();
    } catch (e: any) {
      showError(e.message);
    }
  };

  // 5. QUICK TOGGLE SUPER ADMIN
  const handleToggleSuperAdmin = async (user: any) => {
    const newAdminStatus = !user.isSuperAdmin;
    try {
      const res = await fetch('/api/super-admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          isSuperAdmin: newAdminStatus,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to toggle authority');
      }

      showSuccess(`Super Admin authority ${newAdminStatus ? 'granted' : 'revoked'} for ${user.email}`);
      onRefresh();
    } catch (e: any) {
      showError(e.message);
    }
  };

  // 6. DELETE USER
  const handleOpenDelete = (user: any) => {
    setSelectedUser(user);
    setIsDeleteOpen(true);
  };

  const handleDeleteSubmit = async () => {
    if (!selectedUser) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/super-admin/users?userId=${selectedUser.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete user');
      }

      showSuccess(`User ${selectedUser.email} deleted permanently`);
      setIsDeleteOpen(false);
      onRefresh();
    } catch (e: any) {
      showError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  // Copy Email Helper
  const copyEmail = (email: string, id: string) => {
    navigator.clipboard.writeText(email);
    setCopiedEmailId(id);
    setTimeout(() => setCopiedEmailId(null), 2000);
    showSuccess('Email copied to clipboard');
  };

  const strength = getPasswordStrength(newPassword);

  return (
    <div className="space-y-4">
      {/* Top Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/80 p-4 rounded-xl border border-slate-800 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-400" />
              Platform User Directory & Identity Governance
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
              {totalRecords} Accounts
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Global identity administration, user lifecycle management, administrative password resets, and role governance.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Create User Account</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name, email, job title, company..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Role Filter */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
            <span className="text-slate-500 font-medium">Authority:</span>
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value as any);
                setPage(1);
              }}
              className="bg-transparent text-slate-200 font-semibold outline-none cursor-pointer"
            >
              <option value="all" className="bg-slate-900">All Roles</option>
              <option value="admin" className="bg-slate-900">Super Admin Only</option>
              <option value="user" className="bg-slate-900">Standard User Only</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
            <span className="text-slate-500 font-medium">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as any);
                setPage(1);
              }}
              className="bg-transparent text-slate-200 font-semibold outline-none cursor-pointer"
            >
              <option value="all" className="bg-slate-900">All Statuses</option>
              <option value="ACTIVE" className="bg-slate-900">Active Only</option>
              <option value="SUSPENDED" className="bg-slate-900">Suspended Only</option>
            </select>
          </div>

          {/* Org Filter */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
            <Building2 className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={orgFilter}
              onChange={(e) => {
                setOrgFilter(e.target.value);
                setPage(1);
              }}
              className="bg-transparent text-slate-200 font-semibold outline-none cursor-pointer max-w-[140px] truncate"
            >
              <option value="all" className="bg-slate-900">All Tenants</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id} className="bg-slate-900">
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          {/* Page Size */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
            <span className="text-slate-500">Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(e.target.value as any);
                setPage(1);
              }}
              className="bg-transparent text-slate-200 font-semibold outline-none cursor-pointer"
            >
              <option value="10" className="bg-slate-900">10</option>
              <option value="25" className="bg-slate-900">25</option>
              <option value="50" className="bg-slate-900">50</option>
              <option value="100" className="bg-slate-900">100</option>
              <option value="all" className="bg-slate-900">All</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Directory Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-3.5">User / Identity</th>
                <th className="p-3.5">Email</th>
                <th className="p-3.5">Role / Authority</th>
                <th className="p-3.5">Tenant Organizations</th>
                <th className="p-3.5">MFA Status</th>
                <th className="p-3.5">Account Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {paginatedUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    <Users className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                    <p className="text-xs">No users matching search filters</p>
                  </td>
                </tr>
              ) : (
                paginatedUsers.map((u) => {
                  const isSusp = u.status === 'SUSPENDED';
                  const initials = `${(u.firstName || '')[0] || ''}${(u.lastName || '')[0] || ''}`.toUpperCase() || 'U';

                  return (
                    <tr key={u.id} className="hover:bg-slate-800/40 transition-colors">
                      {/* Name & Identity */}
                      <td className="p-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-[10px] font-bold text-indigo-300">
                            {initials}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                              <span>{u.firstName} {u.lastName}</span>
                              {u.id === currentUserId && (
                                <span className="text-[9px] px-1 bg-indigo-500/20 text-indigo-300 rounded font-normal">
                                  You
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {u.jobTitle || 'Team Member'} {u.company ? `• ${u.company}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td className="p-3.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-300 font-mono text-[11px]">{u.email}</span>
                          <button
                            onClick={() => copyEmail(u.email, u.id)}
                            className="text-slate-500 hover:text-slate-300 transition-colors"
                            title="Copy email"
                          >
                            {copiedEmailId === u.id ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Authority */}
                      <td className="p-3.5">
                        {u.isSuperAdmin ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded text-[10px] font-bold">
                            <Shield className="w-3 h-3 text-indigo-400" />
                            SUPER ADMIN
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-800 text-slate-300 rounded text-[10px] font-medium border border-slate-700/50">
                            USER
                          </span>
                        )}
                      </td>

                      {/* Tenant Orgs */}
                      <td className="p-3.5">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {(u.orgMemberships || []).length === 0 ? (
                            <span className="text-slate-500 text-[10px] italic">None</span>
                          ) : (
                            (u.orgMemberships || []).map((m: any) => (
                              <span
                                key={m.id}
                                className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded text-[10px] font-medium border border-slate-700 truncate max-w-[130px]"
                                title={`${m.organization?.name} (${m.role})`}
                              >
                                {m.organization?.name}
                              </span>
                            ))
                          )}
                        </div>
                      </td>

                      {/* MFA */}
                      <td className="p-3.5">
                        {u.mfaEnabled ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold text-[11px]">
                            <CheckCircle2 className="w-3 h-3" />
                            Active
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[11px]">Disabled</span>
                        )}
                      </td>

                      {/* Account Status */}
                      <td className="p-3.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            isSusp
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isSusp ? 'bg-rose-400' : 'bg-emerald-400'}`}></span>
                          {u.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="p-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Set Password Button */}
                          <button
                            onClick={() => handleOpenPassword(u)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 rounded-lg text-xs font-medium border border-slate-700 transition-colors"
                            title="Set or Reset Password"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>

                          {/* Edit User Button */}
                          <button
                            onClick={() => handleOpenEdit(u)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-100 rounded-lg text-xs font-medium border border-slate-700 transition-colors"
                            title="Edit User Details"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {/* Toggle Status Button */}
                          <button
                            onClick={() => handleToggleStatus(u)}
                            className={`px-2 py-1 rounded text-[10px] font-semibold border transition-colors ${
                              isSusp
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20'
                            }`}
                            title={isSusp ? 'Reactivate Account' : 'Suspend Account'}
                          >
                            {isSusp ? 'Reactivate' : 'Suspend'}
                          </button>

                          {/* Delete Button */}
                          <button
                            onClick={() => handleOpenDelete(u)}
                            disabled={u.id === currentUserId}
                            className="p-1.5 bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-300 rounded-lg text-xs font-medium border border-slate-700 disabled:opacity-30 transition-colors"
                            title={u.id === currentUserId ? 'Cannot delete current session' : 'Delete Account'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
        {totalRecords > 0 && (
          <div className="flex items-center justify-between p-3.5 bg-slate-950 border-t border-slate-800 text-xs text-slate-400">
            <div>
              Showing <span className="font-semibold text-slate-200">{Math.min(totalRecords, (page - 1) * currentLimit + 1)}</span> to{' '}
              <span className="font-semibold text-slate-200">{Math.min(totalRecords, page * currentLimit)}</span> of{' '}
              <span className="font-semibold text-slate-200">{totalRecords}</span> users
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 py-0.5 text-xs text-slate-300 font-mono">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: CREATE USER ACCOUNT */}
      {/* ========================================================================= */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-indigo-400" />
                Create New Platform User Account
              </h3>
              <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">First Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="John"
                    value={createForm.firstName}
                    onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Last Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="Doe"
                    value={createForm.lastName}
                    onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  placeholder="john.doe@company.com"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Job Title</label>
                  <input
                    type="text"
                    placeholder="Senior Developer"
                    value={createForm.jobTitle}
                    onChange={(e) => setCreateForm({ ...createForm, jobTitle: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Company</label>
                  <input
                    type="text"
                    placeholder="Acme Corp"
                    value={createForm.company}
                    onChange={(e) => setCreateForm({ ...createForm, company: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Initial Password */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-400">Initial Password (Optional — auto-generated if blank)</label>
                  <button
                    type="button"
                    onClick={() => {
                      const pwd = 'Eitekh#' + Math.floor(1000 + Math.random() * 9000) + '!kL';
                      setCreateForm({ ...createForm, password: pwd });
                    }}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Generate</span>
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="e.g. Eitekh#9482!kL"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 font-mono outline-none focus:border-indigo-500"
                />
              </div>

              {/* Organization Tenant & Role */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Tenant Organization</label>
                  <select
                    value={createForm.orgId}
                    onChange={(e) => setCreateForm({ ...createForm, orgId: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="">None (Standalone Account)</option>
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Tenant Role</label>
                  <select
                    value={createForm.role}
                    onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                    disabled={!createForm.orgId}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-40"
                  >
                    <option value="MEMBER">MEMBER</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="OWNER">OWNER</option>
                    <option value="GUEST">GUEST</option>
                  </select>
                </div>
              </div>

              {/* Authority & Status */}
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="createSuperAdmin"
                    checked={createForm.isSuperAdmin}
                    onChange={(e) => setCreateForm({ ...createForm, isSuperAdmin: e.target.checked })}
                    className="rounded border-slate-800 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="createSuperAdmin" className="text-slate-200 font-semibold cursor-pointer">
                    Grant Platform Super Admin Authority
                  </label>
                </div>
                <p className="text-[10px] text-slate-500 pl-5">
                  Super Admins have unrestricted administrative access across all tenant organizations and settings.
                </p>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center gap-1.5"
                >
                  {creating && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{creating ? 'Creating...' : 'Create Account'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: EDIT USER DETAILS */}
      {/* ========================================================================= */}
      {isEditOpen && selectedUser && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-indigo-400" />
                Edit User: {selectedUser.firstName} {selectedUser.lastName}
              </h3>
              <button onClick={() => setIsEditOpen(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">First Name</label>
                  <input
                    type="text"
                    required
                    value={editForm.firstName}
                    onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Last Name</label>
                  <input
                    type="text"
                    required
                    value={editForm.lastName}
                    onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Job Title</label>
                  <input
                    type="text"
                    value={editForm.jobTitle}
                    onChange={(e) => setEditForm({ ...editForm, jobTitle: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Company</label>
                  <input
                    type="text"
                    value={editForm.company}
                    onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Account Status</label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Timezone</label>
                  <input
                    type="text"
                    value={editForm.timezone}
                    onChange={(e) => setEditForm({ ...editForm, timezone: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="editSuperAdmin"
                    checked={editForm.isSuperAdmin}
                    onChange={(e) => setEditForm({ ...editForm, isSuperAdmin: e.target.checked })}
                    className="rounded border-slate-800 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="editSuperAdmin" className="text-slate-200 font-semibold cursor-pointer">
                    Super Admin Authority
                  </label>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updating}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center gap-1.5"
                >
                  {updating && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{updating ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: SET / RESET PASSWORD */}
      {/* ========================================================================= */}
      {isPasswordOpen && selectedUser && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-400" />
                Set / Reset User Password
              </h3>
              <button onClick={() => setIsPasswordOpen(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Target User Info */}
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-1">
              <div className="text-xs font-semibold text-slate-200">
                {selectedUser.firstName} {selectedUser.lastName}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">{selectedUser.email}</div>
            </div>

            <form onSubmit={handlePasswordSubmit} className="space-y-4 text-xs">
              {/* Password Input & Generator */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-slate-400 font-medium">New Password *</label>
                  <button
                    type="button"
                    onClick={generateStrongPassword}
                    className="text-[11px] text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 transition-colors"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Generate Strong Password</span>
                  </button>
                </div>

                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="Enter or generate password..."
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-3 pr-20 py-2 text-slate-200 font-mono outline-none focus:border-amber-500"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {newPassword && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(newPassword);
                          setCopiedPassword(true);
                          setTimeout(() => setCopiedPassword(false), 2000);
                          showSuccess('Password copied to clipboard');
                        }}
                        className="p-1 text-slate-400 hover:text-slate-200"
                        title="Copy to clipboard"
                      >
                        {copiedPassword ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="p-1 text-slate-400 hover:text-slate-200"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Strength Meter */}
                {newPassword && (
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-500">Password Strength:</span>
                      <span className="font-semibold text-slate-300">{strength.label}</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden flex gap-1">
                      <div className={`h-full flex-1 rounded-full ${strength.score >= 1 ? strength.color : 'bg-transparent'}`}></div>
                      <div className={`h-full flex-1 rounded-full ${strength.score >= 2 ? strength.color : 'bg-transparent'}`}></div>
                      <div className={`h-full flex-1 rounded-full ${strength.score >= 3 ? strength.color : 'bg-transparent'}`}></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Revoke Active Sessions */}
              <div className="flex items-center gap-2 p-2.5 bg-slate-950 rounded-lg border border-slate-800">
                <input
                  type="checkbox"
                  id="revokeSessionsCheck"
                  checked={revokeSessions}
                  onChange={(e) => setRevokeSessions(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-900 text-amber-500 focus:ring-amber-500"
                />
                <label htmlFor="revokeSessionsCheck" className="text-slate-300 font-medium cursor-pointer">
                  Revoke all active browser sessions immediately
                </label>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsPasswordOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={settingPassword || !newPassword}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center gap-1.5"
                >
                  {settingPassword && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{settingPassword ? 'Updating...' : 'Set Password'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: DELETE CONFIRMATION */}
      {/* ========================================================================= */}
      {isDeleteOpen && selectedUser && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-rose-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                Delete User Account Permanently
              </h3>
              <button onClick={() => setIsDeleteOpen(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Are you sure you want to permanently delete user account <strong className="text-white">{selectedUser.email}</strong>?
            </p>
            <p className="text-xs text-rose-400/90 bg-rose-950/40 p-2.5 rounded-lg border border-rose-900/50">
              Warning: This action is irreversible. All sessions, workspace memberships, and project bindings will be removed.
            </p>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setIsDeleteOpen(false)}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteSubmit}
                disabled={deleting}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center gap-1.5"
              >
                {deleting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{deleting ? 'Deleting...' : 'Delete Permanently'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
