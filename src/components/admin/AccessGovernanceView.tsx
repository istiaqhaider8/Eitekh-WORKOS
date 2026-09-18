'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield,
  Building2,
  Users,
  KeyRound,
  FileSpreadsheet,
  Eye,
  History,
  Sparkles,
  RefreshCw,
  LayoutDashboard,
  Radio,
  Zap,
  FolderGit2,
} from 'lucide-react';
import { showSuccess, showError } from '@/lib/toast';
import { OverviewTab } from './access-governance/OverviewTab';
import { UsersTab } from './access-governance/UsersTab';
import { RolesTab } from './access-governance/RolesTab';
import { AccessMatrixTab } from './access-governance/AccessMatrixTab';
import { InspectorTab } from './access-governance/InspectorTab';
import { AuditTab } from './access-governance/AuditTab';
import { SystemRefreshCacheView } from './SystemRefreshCacheView';

interface AccessGovernanceViewProps {
  initialOrgId?: string;
  showHeader?: boolean;
}

export function AccessGovernanceView({ initialOrgId, showHeader = true }: AccessGovernanceViewProps = {}) {
  // Navigation Tabs: Overview, Users, Permission Roles, Access Matrix, Inspector, Audit
  const [activeTab, setActiveTab] = useState<
    'overview' | 'users' | 'roles' | 'matrix' | 'inspector' | 'audit' | 'cache'
  >('overview');

  // Selected User for Inspector Tab navigation
  const [inspectorUserId, setInspectorUserId] = useState<string>('');

  // Multi-Tenant Org Context
  const [orgs, setOrgs] = useState<any[]>([]);
  // Starts EMPTY on purpose. This used to default to the literal string
  // 'default-org', which is not a real tenant: the view would immediately fetch
  // that phantom org's roles and render them, then replace them once loadOrgs()
  // resolved the real org. That is what made the roles list show 7 entries and
  // then 6 a moment later, with user counts changing as the role ids changed.
  // Every fetch below is guarded on a truthy selectedOrgId, so an empty value
  // simply means "do not query until we know which tenant we are looking at".
  const [selectedOrgId, setSelectedOrgId] = useState<string>(initialOrgId || '');

  // Project-wise Scoping State
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('ALL');

  // Core Data State
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [allKeys, setAllKeys] = useState<string[]>([]);
  const [highRiskKeys, setHighRiskKeys] = useState<string[]>([]);
  const [totalGovernedUsers, setTotalGovernedUsers] = useState(0);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  // Real-Time Sync State
  const [autoSync, setAutoSync] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<string>('Just now');
  const [syncCount, setSyncCount] = useState(0);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  // 1. Fetch available organizations (with fallback to /api/auth/me for tenant admins)
  const loadOrgs = async () => {
    try {
      const res = await fetch('/api/super-admin/orgs');
      if (res.ok) {
        const json = await res.json();
        const orgList = json.organizations || json.orgs || [];
        setOrgs(orgList);
        if (orgList.length > 0 && !selectedOrgId) {
          setSelectedOrgId(initialOrgId || orgList[0].id);
        }
        return;
      }
    } catch (e) {
      // Ignore and fallback
    }

    try {
      const meRes = await fetch('/api/auth/me');
      if (meRes.ok) {
        const meJson = await meRes.json();
        const userOrgs = meJson.user?.organizations || [];
        setOrgs(userOrgs);
        if (userOrgs.length > 0 && !selectedOrgId) {
          setSelectedOrgId(initialOrgId || userOrgs[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching orgs for PBAC', err);
    }
  };

  useEffect(() => {
    loadOrgs();
  }, []);

  // 1.1 Fetch available projects for selected organization
  const loadProjects = useCallback(async () => {
    if (!selectedOrgId) return;
    try {
      const res = await fetch(`/api/pbac/projects?orgId=${selectedOrgId}`);
      if (res.ok) {
        const json = await res.json();
        setProjects(json.projects || []);
      }
    } catch (e) {
      console.error('Error loading projects for PBAC', e);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    loadProjects();
  }, [selectedOrgId, loadProjects]);

  // 2. Fetch PBAC Data when active org or active project changes or real-time sync fires
  const loadPbacData = useCallback(async (silent = false) => {
    if (!selectedOrgId) return;
    if (!silent) setLoading(true);
    try {
      const projectParam = selectedProjectId && selectedProjectId !== 'ALL' ? `&projectId=${selectedProjectId}` : '';
      const [rolesRes, usersRes, auditRes] = await Promise.all([
        fetch(`/api/pbac/roles?orgId=${selectedOrgId}${projectParam}`),
        fetch(`/api/pbac/users?orgId=${selectedOrgId}${projectParam}&limit=1`),
        fetch(`/api/pbac/audit?orgId=${selectedOrgId}&limit=10`),
      ]);

      if (rolesRes.ok) {
        const json = await rolesRes.json();
        setRoles(json.roles || []);
        setCategories(json.categories || []);
        setAllKeys(json.allKeys || []);
        setHighRiskKeys(json.highRiskKeys || []);
      }

      if (usersRes.ok) {
        const json = await usersRes.json();
        setTotalGovernedUsers(json.totalRecords || 0);
      }

      if (auditRes.ok) {
        const json = await auditRes.json();
        setAuditLogs(json.logs || []);
      }

      setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setSyncCount((prev) => prev + 1);
    } catch (e: any) {
      if (!silent) showError(e.message || 'Failed to load PBAC governance data');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedOrgId, selectedProjectId]);

  useEffect(() => {
    if (selectedOrgId) {
      loadPbacData(false);
    }
  }, [selectedOrgId, selectedProjectId, loadPbacData]);

  // 3. Real-Time Cross-Tab / Background Channel Synchronization
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Create BroadcastChannel for multi-tab sync
    try {
      const channel = new BroadcastChannel('eitekh_pbac_realtime_sync');
      broadcastChannelRef.current = channel;
      channel.onmessage = (event) => {
        if (event.data?.type === 'PBAC_MUTATION') {
          loadPbacData(true);
        }
      };
    } catch (e) {
      console.warn('BroadcastChannel not supported', e);
    }

    // Window CustomEvent listener
    const handleLocalMutation = () => {
      loadPbacData(true);
    };
    window.addEventListener('pbac:updated', handleLocalMutation);

    return () => {
      window.removeEventListener('pbac:updated', handleLocalMutation);
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
      }
    };
  }, [loadPbacData]);

  // 4. Real-Time Auto-Polling (Interval Sync)
  useEffect(() => {
    if (!autoSync || !selectedOrgId) return;

    const interval = setInterval(() => {
      // Only sync if document is visible
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadPbacData(true);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [autoSync, selectedOrgId, loadPbacData]);

  // Trigger Refresh & Broadcast to all tabs
  const handleFullRefresh = () => {
    loadPbacData(false);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pbac:updated'));
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.postMessage({ type: 'PBAC_MUTATION', orgId: selectedOrgId });
      }
    }
    showSuccess('PBAC permission roles and access matrix synchronized');
  };

  // Jump to Inspector
  const handleInspectUser = (userId: string) => {
    setInspectorUserId(userId);
    setActiveTab('inspector');
  };

  const navTabs = [
    { id: 'overview', label: '1. Overview', icon: LayoutDashboard, badge: null },
    { id: 'users', label: '2. Users', icon: Users, badge: totalGovernedUsers > 0 ? String(totalGovernedUsers) : null },
    { id: 'roles', label: '3. Permission Roles', icon: KeyRound, badge: roles.length > 0 ? String(roles.length) : null },
    { id: 'matrix', label: '4. Access Matrix', icon: FileSpreadsheet, badge: null },
    { id: 'inspector', label: '5. Effective Access Inspector', icon: Eye, badge: null },
    { id: 'audit', label: '6. Audit Ledger', icon: History, badge: null },
    { id: 'cache', label: '7. System Refresh & Cache', icon: RefreshCw, badge: 'Safe' },
  ];

  return (
    // sa-panel also applied here because this view is rendered standalone under
    // /settings/roles, outside the super-admin shell, and must get the same
    // focus, table and reduced-motion treatment.
    <div className="sa-panel space-y-6">
      {/* Top Banner & Multi-Tenant Org Selector */}
      <div className="bg-white dark:bg-slate-900/80 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm dark:shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              Eitekh WorkOS — Access Governance & PBAC
            </h2>
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-800/80 rounded-full text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              <span>LIVE SYNCED</span>
            </div>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Deterministic Authorization: <span className="font-semibold text-slate-800 dark:text-slate-200">EXISTING USER</span> ➔{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">PERMISSION ROLE</span> ➔{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">PERMISSIONS (18 MODULES)</span> ➔{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">PROJECT MEMBERSHIP</span> ➔{' '}
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">EFFECTIVE ACCESS</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Real-time Status Badge */}
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-[11px]">
            <Radio className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 animate-pulse" />
            <span className="text-slate-500 dark:text-slate-400">Synced:</span>
            <span className="text-slate-800 dark:text-slate-200 font-mono font-medium">{lastSyncTime}</span>
            <button
              onClick={() => setAutoSync(!autoSync)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-all ${
                autoSync
                  ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700/50'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
              title={autoSync ? 'Auto-sync active (click to pause)' : 'Auto-sync paused (click to resume)'}
            >
              {autoSync ? 'Auto' : 'Paused'}
            </button>
          </div>

          {/* Org Selector */}
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
            <Building2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="text-slate-500 dark:text-slate-400 font-medium">Tenant Org:</span>
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="bg-transparent text-slate-900 dark:text-slate-200 font-semibold outline-none cursor-pointer"
            >
              {orgs.length === 0 ? (
                // Placeholder only — it must carry no value, or selecting it
                // would query a tenant that does not exist.
                <option value="" disabled className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200">
                  Loading organizations…
                </option>
              ) : (
                orgs.map((o) => (
                  <option key={o.id} value={o.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200">
                    {o.name}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Project Selecting Option (Project-wise Permission Scoping) */}
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
            <FolderGit2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-slate-500 dark:text-slate-400 font-medium">Project:</span>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="bg-transparent text-slate-900 dark:text-slate-200 font-semibold outline-none cursor-pointer max-w-[220px] truncate"
            >
              <option value="ALL" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 font-medium">
                🌐 All Projects (Global Scope)
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200 font-medium">
                  🎯 {p.name} ({p.key})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleFullRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-600 dark:text-indigo-400' : ''}`} />
            <span>Sync Now</span>
          </button>
        </div>
      </div>

      {/* 6-Tab Streamlined Navigation */}
      <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-slate-900/60 p-1 rounded-xl border border-slate-300/80 dark:border-slate-800 overflow-x-auto">
        {navTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/60 dark:hover:bg-slate-800/60'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                    // text-indigo-100 on bg-indigo-700, not a dark weight: this
                    // badge sits on a saturated fill, so the label must be pale
                    // in BOTH themes. (A blanket "pale accent text -> -700"
                    // rewrite briefly made this indigo-on-indigo, i.e. invisible.)
                    isActive ? 'bg-indigo-700 text-indigo-100' : 'bg-slate-300 dark:bg-slate-800 text-slate-700 dark:text-slate-400'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active Tab Contents with Real-Time Event Hydration */}
      {activeTab === 'overview' && (
        <OverviewTab
          roles={roles}
          totalUsers={totalGovernedUsers}
          auditLogs={auditLogs}
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          onNavigateTab={(tab: string) => setActiveTab(tab as any)}
          onCreateRole={() => setActiveTab('roles')}
        />
      )}

      {activeTab === 'users' && (
        <UsersTab
          orgId={selectedOrgId}
          roles={roles}
          projects={projects}
          selectedProjectId={selectedProjectId}
          onInspectUser={handleInspectUser}
          onRefresh={handleFullRefresh}
        />
      )}

      {activeTab === 'roles' && (
        <RolesTab
          orgId={selectedOrgId}
          roles={roles}
          categories={categories}
          allKeys={allKeys}
          highRiskKeys={highRiskKeys}
          projects={projects}
          selectedProjectId={selectedProjectId}
          onRefresh={handleFullRefresh}
        />
      )}

      {activeTab === 'matrix' && (
        <AccessMatrixTab
          orgId={selectedOrgId}
          roles={roles}
          projects={projects}
          selectedProjectId={selectedProjectId}
          onInspectUser={handleInspectUser}
        />
      )}

      {activeTab === 'inspector' && (
        <InspectorTab
          orgId={selectedOrgId}
          selectedUserId={inspectorUserId}
          projects={projects}
          selectedProjectId={selectedProjectId}
        />
      )}

      {activeTab === 'audit' && (
        <AuditTab
          orgId={selectedOrgId}
        />
      )}

      {activeTab === 'cache' && (
        <SystemRefreshCacheView
          orgId={selectedOrgId}
          projectId={selectedProjectId}
        />
      )}
    </div>
  );
}
