'use client';

import React from 'react';
import {
  Shield,
  Users,
  KeyRound,
  CheckCircle2,
  Lock,
  ArrowRight,
  Sparkles,
  Building2,
  FolderGit2,
  History,
  AlertTriangle,
  FileSpreadsheet,
  Plus,
  Search,
} from 'lucide-react';

interface OverviewTabProps {
  roles: any[];
  totalUsers: number;
  auditLogs: any[];
  projects?: any[];
  selectedProjectId?: string;
  onSelectProject?: (projectId: string) => void;
  onNavigateTab: (tab: string) => void;
  onCreateRole: () => void;
}

export function OverviewTab({
  roles,
  totalUsers,
  auditLogs,
  projects = [],
  selectedProjectId = 'ALL',
  onSelectProject,
  onNavigateTab,
  onCreateRole,
}: OverviewTabProps) {
  const activeRoles = roles.filter((r) => r.status === 'ACTIVE');
  const totalAssignments = roles.reduce((acc, r) => acc + (r.assignedUserCount || 0), 0);
  const highRiskRoles = roles.filter((r) => (r.permissions || []).some((p: string) => p.includes('delete') || p.includes('manage')));

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div
          onClick={() => onNavigateTab('roles')}
          className="cursor-pointer bg-white dark:bg-slate-900/80 hover:bg-slate-50 dark:hover:bg-slate-850 border border-slate-200 dark:border-slate-800 hover:border-indigo-200 p-4 rounded-xl transition-all space-y-1 shadow-sm dark:shadow-sm"
        >
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
            Permission Roles
          </span>
          <div className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            {roles.length}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-600 dark:text-slate-400">
            {activeRoles.length} Active / {roles.length - activeRoles.length} Inactive
          </p>
        </div>

        <div
          onClick={() => onNavigateTab('users')}
          className="cursor-pointer bg-white dark:bg-slate-900/80 hover:bg-slate-50 dark:hover:bg-slate-850 border border-slate-200 dark:border-slate-800 hover:border-indigo-200 p-4 rounded-xl transition-all space-y-1 shadow-sm dark:shadow-sm"
        >
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
            Governed Users
          </span>
          <div className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            {totalUsers}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-600 dark:text-slate-400">Existing accounts in tenant</p>
        </div>

        <div
          onClick={() => onNavigateTab('users')}
          className="cursor-pointer bg-white dark:bg-slate-900/80 hover:bg-slate-50 dark:hover:bg-slate-850 border border-slate-200 dark:border-slate-800 hover:border-indigo-200 p-4 rounded-xl transition-all space-y-1 shadow-sm dark:shadow-sm"
        >
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
            Role Grants
          </span>
          <div className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            {totalAssignments}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-600 dark:text-slate-400">Active user-role mappings</p>
        </div>

        <div
          onClick={() => onNavigateTab('roles')}
          className="cursor-pointer bg-white dark:bg-slate-900/80 hover:bg-slate-50 dark:hover:bg-slate-850 border border-slate-200 dark:border-slate-800 hover:border-indigo-200 p-4 rounded-xl transition-all space-y-1 shadow-sm dark:shadow-sm"
        >
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
            High-Risk Roles
          </span>
          <div className="text-xl font-bold text-amber-600 dark:text-amber-400 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            {highRiskRoles.length}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-600 dark:text-slate-400">Contains delete or admin privileges</p>
        </div>

        <div
          onClick={() => onNavigateTab('audit')}
          className="cursor-pointer bg-white dark:bg-slate-900/80 hover:bg-slate-50 dark:hover:bg-slate-850 border border-slate-200 dark:border-slate-800 hover:border-indigo-200 p-4 rounded-xl transition-all space-y-1 col-span-2 sm:col-span-1 shadow-sm dark:shadow-sm"
        >
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
            Audit Ledger
          </span>
          <div className="text-xl font-bold text-purple-600 dark:text-purple-400 flex items-center gap-2">
            <History className="w-5 h-5" />
            {auditLogs.length}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-600 dark:text-slate-400">Tracked governance events</p>
        </div>
      </div>

      {/* Core Authorization Model Blueprint */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-sm dark:shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              Unified Permission Role Authorization Flow
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Simple, powerful, and secure access governance: <span className="font-semibold text-slate-900 dark:text-slate-800 dark:text-slate-200">Role = What</span> and <span className="font-semibold text-slate-900 dark:text-slate-800 dark:text-slate-200">Membership = Where</span>.
            </p>
          </div>

          <button
            onClick={onCreateRole}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Permission Role</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-2">
          <div className="bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5">
            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block">
              1. Existing User
            </span>
            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" /> User Directory
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
              Real accounts already in the system. No new users created on assignment.
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5">
            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block">
              2. Permission Role
            </span>
            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" /> What User Can Do
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
              Assigned directly to users. Users can have multiple roles with unioned permissions.
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5">
            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block">
              3. Permissions
            </span>
            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" /> 18 Canonical Modules
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
              Fine-grained capabilities covering issues, sprints, backlogs, views, settings, and exports.
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5">
            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block">
              4. Resource Boundary
            </span>
            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <FolderGit2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" /> Where User Can Do It
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
              Project and workspace membership determines active scope. Strictly isolated.
            </p>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-emerald-300 dark:border-emerald-500/20 space-y-1.5">
            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
              5. Effective Access
            </span>
            <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Access Granted
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
              Calculated effective access with full "Why Does User Have Access?" provenance trace.
            </p>
          </div>
        </div>
      </div>

      {/* Quick Action Shortcuts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div
          onClick={() => onNavigateTab('roles')}
          className="cursor-pointer p-4 bg-white dark:bg-slate-900/60 hover:bg-slate-50 dark:hover:bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-200 rounded-xl transition-all flex items-center justify-between shadow-sm dark:shadow-none"
        >
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">Manage Permission Roles</h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-600 dark:text-slate-400">Configure 18 permission categories & assign users</p>
          </div>
          <ArrowRight className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        </div>

        <div
          onClick={() => onNavigateTab('users')}
          className="cursor-pointer p-4 bg-white dark:bg-slate-900/60 hover:bg-slate-50 dark:hover:bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-200 rounded-xl transition-all flex items-center justify-between shadow-sm dark:shadow-none"
        >
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">Bulk User Role Assignment</h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-600 dark:text-slate-400">Multi-select existing users with pre-flight simulation</p>
          </div>
          <ArrowRight className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        </div>

        <div
          onClick={() => onNavigateTab('inspector')}
          className="cursor-pointer p-4 bg-white dark:bg-slate-900/60 hover:bg-slate-50 dark:hover:bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-200 rounded-xl transition-all flex items-center justify-between shadow-sm dark:shadow-none"
        >
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">Effective Access Inspector</h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-600 dark:text-slate-400">Inspect user access with "Why?" provenance traces</p>
          </div>
          <ArrowRight className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        </div>
      </div>
    </div>
  );
}
