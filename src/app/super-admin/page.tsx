"use client";

import dynamic from "next/dynamic";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Shield,
  Building2,
  Users,
  Activity,
  ToggleLeft,
  ToggleRight,
  Megaphone,
  History,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Ban,
  RefreshCw,
  LogOut,
  Mail,
  Send,
  Eye,
  Sparkles,
  Check,
  Copy,
  X,
  BarChart3,
  PieChart,
  ArrowRight,
  UserPlus,
  KeyRound,
  Plus,
  Radio,
  Wifi,
  Search,
  Server,
  Layers,
  Clock,
  ShieldAlert,
  Zap,
  FolderGit2,
  Calendar,
  Lock,
  Unlock,
  Settings,
  Sliders,
  FileText,
  Edit2,
  Trash2,
} from "lucide-react";
import { AnalyticsChartsView } from "@/components/views/AnalyticsChartsView";
import { GlobalAlertBanner } from "@/components/admin/GlobalAlertBanner";

/**
 * D2 — the tab views are loaded on demand.
 *
 * All of them were static imports, so 7,171 lines across thirteen files
 * shipped on first load for a page that renders one tab at a time. Measured
 * before this change, /super-admin pulled 1,503 kB of client JavaScript —
 * the heaviest route in the app once /projects/[id] was split.
 *
 * Each is already rendered behind `activeTab === "..."`, so the component
 * was never mounted until its tab was selected; it was only downloaded.
 * That is what makes this a safe change rather than a restructuring.
 *
 * GlobalAlertBanner stays static: it renders unconditionally at the top of
 * the page, so deferring it would add a round trip before the first paint
 * and buy nothing.
 */
const adminTabLoading = () => (
  <div className="flex items-center justify-center py-24 text-sm text-slate-500 dark:text-slate-500">
    Loading…
  </div>
);
const SystemSyncMonitorView = dynamic(
  () => import("@/components/admin/SystemSyncMonitorView").then((m) => m.SystemSyncMonitorView),
  { loading: adminTabLoading, ssr: false }
);
const PlatformHealthView = dynamic(
  () => import("@/components/admin/PlatformHealthView").then((m) => m.PlatformHealthView),
  { loading: adminTabLoading, ssr: false }
);
const AccessGovernanceView = dynamic(
  () => import("@/components/admin/AccessGovernanceView").then((m) => m.AccessGovernanceView),
  { loading: adminTabLoading, ssr: false }
);
const SecurityCenterView = dynamic(
  () => import("@/components/admin/SecurityCenterView").then((m) => m.SecurityCenterView),
  { loading: adminTabLoading, ssr: false }
);
const SecurityThreatOperationsView = dynamic(
  () => import("@/components/admin/SecurityThreatOperationsView").then((m) => m.SecurityThreatOperationsView),
  { loading: adminTabLoading, ssr: false }
);
const PlatformReportsHubView = dynamic(
  () => import("@/components/admin/PlatformReportsHubView").then((m) => m.PlatformReportsHubView),
  { loading: adminTabLoading, ssr: false }
);
const JobAutomationMonitorView = dynamic(
  () => import("@/components/admin/JobAutomationMonitorView").then((m) => m.JobAutomationMonitorView),
  { loading: adminTabLoading, ssr: false }
);
const AuditComplianceView = dynamic(
  () => import("@/components/admin/AuditComplianceView").then((m) => m.AuditComplianceView),
  { loading: adminTabLoading, ssr: false }
);
const PlatformUserDirectoryView = dynamic(
  () => import("@/components/admin/PlatformUserDirectoryView").then((m) => m.PlatformUserDirectoryView),
  { loading: adminTabLoading, ssr: false }
);
const SystemRefreshCacheView = dynamic(
  () => import("@/components/admin/SystemRefreshCacheView").then((m) => m.SystemRefreshCacheView),
  { loading: adminTabLoading, ssr: false }
);
const PlatformWorkspacesProjectsView = dynamic(
  () => import("@/components/admin/PlatformWorkspacesProjectsView").then((m) => m.PlatformWorkspacesProjectsView),
  { loading: adminTabLoading, ssr: false }
);
const PlatformAnnouncementsView = dynamic(
  () => import("@/components/admin/PlatformAnnouncementsView").then((m) => m.PlatformAnnouncementsView),
  { loading: adminTabLoading, ssr: false }
);

import { ThemeToggle } from "@/components/common/ThemeToggle";
import { showSuccess, showError } from "@/lib/toast";

export default function SuperAdminCommandCenterPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<
    | "overview"
    | "security-threats"
    | "reports"
    | "analytics"
    | "orgs"
    | "workspaces-projects"
    | "users"
    | "pbac"
    | "cache"
    | "security"
    | "features"
    | "announcements"
    | "audit"
    | "jobs"
    | "emails"
    | "sync"
    | "health"
  >("overview");

  const [stats, setStats] = useState<any>(null);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [flags, setFlags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  const [analyticsData, setAnalyticsData] = useState<{
    issues: any[];
    statuses: any[];
    users: any[];
    orgs: any[];
    sprints: any[];
    projects: any[];
  }>({ issues: [], statuses: [], users: [], orgs: [], sprints: [], projects: [] });

  // Email Config State
  const [emailConfig, setEmailConfig] = useState<any>({
    senderEmail: "cocofbd@gmail.com",
    senderName: "Eitekh WorkOS",
    isEnabled: true,
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    smtpUser: "cocofbd@gmail.com",
    smtpPass: "",
    isSecure: false,
  });
  // The email config is only rendered by the "emails" tab, so it is fetched
  // when that tab is first opened rather than on mount.
  const [emailLoaded, setEmailLoaded] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  // Modals & Forms
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  const [addUserForm, setAddUserForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    jobTitle: "",
    orgId: "",
    role: "MEMBER",
    isSuperAdmin: false,
    password: "",
  });

  const [showAddOrgModal, setShowAddOrgModal] = useState(false);
  const [addingOrg, setAddingOrg] = useState(false);
  const [addOrgForm, setAddOrgForm] = useState({
    name: "",
    slug: "",
    domain: "",
  });

  const [showEditOrgModal, setShowEditOrgModal] = useState(false);
  const [showDeleteOrgModal, setShowDeleteOrgModal] = useState(false);
  const [activeOrg, setActiveOrg] = useState<any>(null);
  const [editOrgForm, setEditOrgForm] = useState({
    name: "",
    slug: "",
    domain: "",
    timezone: "UTC",
    language: "en",
    status: "ACTIVE",
  });
  const [savingOrg, setSavingOrg] = useState(false);

  // Feature Flag modals
  const [showCreateFlagModal, setShowCreateFlagModal] = useState(false);
  const [showEditFlagModal, setShowEditFlagModal] = useState(false);
  const [showDeleteFlagModal, setShowDeleteFlagModal] = useState(false);
  const [activeFlag, setActiveFlag] = useState<any>(null);
  const [flagForm, setFlagForm] = useState({
    key: "",
    description: "",
    isGlobalEnabled: true,
  });
  const [savingFlag, setSavingFlag] = useState(false);

  // Fetched the first time the "emails" tab is opened. Keeping it off the mount
  // path means the panel does not pay for a response no visible tab is using.
  const loadEmailSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/super-admin/email-settings");
      if (res.ok) {
        const eData = await res.json();
        if (eData.config) setEmailConfig(eData.config);
      }
    } catch (e) {
      console.error("Failed to load email settings", e);
    } finally {
      setEmailLoaded(true);
    }
  }, []);

  const loadAllData = useCallback(async () => {
    try {
      // Only what the panel renders before a tab is chosen. The email config is
      // loaded by the "emails" tab on demand, and the email-templates request
      // that used to run here was dropped: it was the largest response of the
      // seven (~35KB) and its result was stored in state that nothing read.
      const [statsRes, orgsRes, usersRes, flagsRes, analyticsRes] = await Promise.all([
        fetch("/api/super-admin/stats"),
        fetch("/api/super-admin/orgs"),
        fetch("/api/super-admin/users"),
        fetch("/api/super-admin/features"),
        fetch("/api/super-admin/analytics"),
      ]);

      if (statsRes.status === 403) {
        showError("Access Denied: Super Admin role required");
        router.push("/");
        return;
      }

      if (statsRes.ok) setStats(await statsRes.json());
      if (orgsRes.ok) setOrgs((await orgsRes.json()).organizations || []);
      if (usersRes.ok) setUsers((await usersRes.json()).users || []);
      if (flagsRes.ok) setFlags((await flagsRes.json()).flags || []);
      if (analyticsRes && analyticsRes.ok) {
        setAnalyticsData(await analyticsRes.json());
      }

    } catch (e: any) {
      console.error(e);
      showError("Error loading command center telemetry");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get("tab");
      if (
        tabParam &&
        [
          "overview",
          "security-threats",
          "reports",
          "analytics",
          "orgs",
          "workspaces-projects",
          "users",
          "pbac",
          "cache",
          "security",
          "features",
          "announcements",
          "audit",
          "jobs",
          "emails",
          "sync",
          "health",
        ].includes(tabParam)
      ) {
        setActiveTab(tabParam as any);
      }
    }
    loadAllData();
    const interval = setInterval(loadAllData, 15000);
    return () => clearInterval(interval);
  }, [loadAllData]);

  useEffect(() => {
    if (activeTab === "emails" && !emailLoaded) loadEmailSettings();
  }, [activeTab, emailLoaded, loadEmailSettings]);

  // Global search handler
  const handleGlobalSearch = async (query: string) => {
    setGlobalSearch(query);
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/super-admin/search?q=${encodeURIComponent(query.trim())}`);
      if (res.ok) {
        setSearchResults(await res.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSearchLoading(false);
    }
  };

  // Toggle Feature Flag
  const handleToggleFlag = async (key: string, currentVal: boolean) => {
    try {
      const res = await fetch("/api/super-admin/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, isGlobalEnabled: !currentVal }),
      });
      if (res.ok) {
        showSuccess(`Feature flag ${key} updated`);
        loadAllData();
      } else {
        showError("Failed to toggle feature flag");
      }
    } catch (e: any) {
      showError(e.message || "Error updating flag");
    }
  };

  // Toggle Org Status
  const handleToggleOrgStatus = async (orgId: string, currentStatus: string) => {
    const newStatus = currentStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    try {
      const res = await fetch("/api/super-admin/orgs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, status: newStatus }),
      });
      if (res.ok) {
        showSuccess(`Organization set to ${newStatus}`);
        loadAllData();
      } else {
        showError("Failed to update organization status");
      }
    } catch (e: any) {
      showError(e.message || "Error updating organization");
    }
  };

  // Toggle User Status
  const handleToggleUserStatus = async (userId: string, currentStatus: string) => {
    const newStatus = currentStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    try {
      const res = await fetch("/api/super-admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, status: newStatus }),
      });
      if (res.ok) {
        showSuccess(`User account set to ${newStatus}`);
        loadAllData();
      } else {
        showError("Failed to update user status");
      }
    } catch (e: any) {
      showError(e.message || "Error updating user");
    }
  };

  // Handle Add User
  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingUser(true);
    try {
      const res = await fetch("/api/super-admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addUserForm),
      });
      if (res.ok) {
        showSuccess(`User ${addUserForm.email} created successfully`);
        setShowAddUserModal(false);
        setAddUserForm({
          email: "",
          firstName: "",
          lastName: "",
          jobTitle: "",
          orgId: "",
          role: "MEMBER",
          isSuperAdmin: false,
          password: "",
        });
        loadAllData();
      } else {
        const json = await res.json();
        showError(json.error || "Failed to create user");
      }
    } catch (e: any) {
      showError(e.message || "Error creating user");
    } finally {
      setAddingUser(false);
    }
  };

  // Handle Add Org
  const handleAddOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingOrg(true);
    try {
      const res = await fetch("/api/super-admin/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addOrgForm),
      });
      if (res.ok) {
        showSuccess(`Organization ${addOrgForm.name} created successfully`);
        setShowAddOrgModal(false);
        setAddOrgForm({ name: "", slug: "", domain: "" });
        loadAllData();
      } else {
        const json = await res.json();
        showError(json.error || "Failed to create organization");
      }
    } catch (e: any) {
      showError(e.message || "Error creating organization");
    } finally {
      setAddingOrg(false);
    }
  };

  // Handle Edit Org
  const handleEditOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg) return;
    setSavingOrg(true);
    try {
      const res = await fetch("/api/super-admin/orgs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: activeOrg.id,
          ...editOrgForm,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || `Organization ${editOrgForm.name} updated successfully`);
        setShowEditOrgModal(false);
        setActiveOrg(null);
        loadAllData();
      } else {
        showError(data.error || "Failed to update organization");
      }
    } catch (e: any) {
      showError(e.message || "Error updating organization");
    } finally {
      setSavingOrg(false);
    }
  };

  // Handle Delete Org
  const handleDeleteOrg = async () => {
    if (!activeOrg) return;
    setSavingOrg(true);
    try {
      const res = await fetch(`/api/super-admin/orgs?orgId=${activeOrg.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || "Organization deleted successfully");
        setShowDeleteOrgModal(false);
        setActiveOrg(null);
        loadAllData();
      } else {
        showError(data.error || "Failed to delete organization");
      }
    } catch (e: any) {
      showError(e.message || "Error deleting organization");
    } finally {
      setSavingOrg(false);
    }
  };

  // Handle Create Feature Flag
  const handleCreateFlag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flagForm.key.trim()) return;
    setSavingFlag(true);
    try {
      const res = await fetch("/api/super-admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(flagForm),
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || `Feature flag ${flagForm.key} created`);
        setShowCreateFlagModal(false);
        setFlagForm({ key: "", description: "", isGlobalEnabled: true });
        loadAllData();
      } else {
        showError(data.error || "Failed to create feature flag");
      }
    } catch (e: any) {
      showError(e.message || "Error creating flag");
    } finally {
      setSavingFlag(false);
    }
  };

  // Handle Edit Feature Flag
  const handleEditFlag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeFlag) return;
    setSavingFlag(true);
    try {
      const res = await fetch("/api/super-admin/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: activeFlag.key,
          description: flagForm.description,
          isGlobalEnabled: flagForm.isGlobalEnabled,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || `Feature flag ${activeFlag.key} updated`);
        setShowEditFlagModal(false);
        setActiveFlag(null);
        loadAllData();
      } else {
        showError(data.error || "Failed to update feature flag");
      }
    } catch (e: any) {
      showError(e.message || "Error updating flag");
    } finally {
      setSavingFlag(false);
    }
  };

  // Handle Delete Feature Flag
  const handleDeleteFlag = async () => {
    if (!activeFlag) return;
    setSavingFlag(true);
    try {
      const res = await fetch(`/api/super-admin/features?key=${encodeURIComponent(activeFlag.key)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || "Feature flag deleted successfully");
        setShowDeleteFlagModal(false);
        setActiveFlag(null);
        loadAllData();
      } else {
        showError(data.error || "Failed to delete feature flag");
      }
    } catch (e: any) {
      showError(e.message || "Error deleting feature flag");
    } finally {
      setSavingFlag(false);
    }
  };

  if (loading && !stats) {
    return (
      // The background was hardcoded to #080c14 (near-black) while the text
      // stayed slate-700/900, so in the white theme this screen rendered dark
      // text on a dark slab — effectively invisible while the panel loaded.
      <div
        className="sa-panel min-h-screen bg-slate-50 dark:bg-[#080c14] text-slate-900 dark:text-slate-100 flex items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <div className="text-center space-y-3">
          <RefreshCw className="w-10 h-10 animate-spin mx-auto text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">Initializing Eitekh Platform Command Center…</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">Loading governance, security telemetry, threat queues, and sync engines</p>
        </div>
      </div>
    );
  }

  const kpis = stats?.kpis || { totalOrgs: 0, activeOrgs: 0, totalUsers: 0, activeUsers: 0, totalWorkspaces: 0, totalProjects: 0, totalIssues: 0, openIssues: 0, activeSprints: 0, securityAlerts: 0, syncErrors: 0, suspendedOrgs: 0 };
  const actionRequired = stats?.actionRequired || [];

  return (
    <div className="sa-panel min-h-screen bg-slate-50 dark:bg-[#080c14] text-slate-900 dark:text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white pb-16 transition-colors duration-200">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-[#0e1626]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800/80 px-4 sm:px-6 py-3 shadow-sm dark:shadow-none transition-colors duration-200">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") {
                  const lastProjectId = localStorage.getItem("eitekh_last_project_id");
                  if (lastProjectId) {
                    router.push(`/projects/${lastProjectId}`);
                    return;
                  }
                  if (window.history.length > 1 && document.referrer && document.referrer.includes(window.location.host)) {
                    router.back();
                    return;
                  }
                }
                router.push("/");
              }}
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
              title="Return to Workspace / Previous Page"
            >
              <ArrowLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span>Back</span>
            </button>
            <div>
              <div className="flex items-center gap-2.5">
                <img src="/leaf-logo.png" alt="Eitekh" className="w-6 h-6 object-contain shrink-0 drop-shadow-sm" />
                <h1 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-none">
                  Eitekh Platform Command Center
                </h1>
                <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 rounded text-[10px] font-bold uppercase tracking-wider leading-none shadow-sm dark:border-indigo-800">
                  ROOT
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                Centralized governance, continuous security, real-time sync operations, and intelligence.
              </p>
            </div>
          </div>

          {/* Search & Actions */}
          <div className="flex items-center gap-3">
            <div className="relative w-full sm:w-72">
              <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus-within:border-indigo-500 transition-colors">
                <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="Global platform search..."
                  value={globalSearch}
                  onChange={(e) => handleGlobalSearch(e.target.value)}
                  className="bg-transparent border-none outline-none w-full text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                />
                {searchLoading && <RefreshCw className="w-3 h-3 animate-spin text-indigo-500 dark:text-indigo-400" />}
              </div>

              {/* Search dropdown results */}
              {searchResults && (
                <div className="absolute top-full mt-1 left-0 right-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-3 z-50 max-h-96 overflow-y-auto space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Search Results</span>
                    <button onClick={() => setSearchResults(null)} className="text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {searchResults.organizations?.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Organizations</span>
                      {searchResults.organizations.map((o: any) => (
                        <div
                          key={o.id}
                          onClick={() => {
                            setActiveTab("orgs");
                            setSearchResults(null);
                          }}
                          className="cursor-pointer p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-xs text-slate-800 dark:text-slate-200 flex items-center justify-between transition-colors"
                        >
                          <span className="font-semibold">{o.name}</span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">/{o.slug}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {searchResults.users?.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Users</span>
                      {searchResults.users.map((u: any) => (
                        <div
                          key={u.id}
                          onClick={() => {
                            setActiveTab("users");
                            setSearchResults(null);
                          }}
                          className="cursor-pointer p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-xs text-slate-800 dark:text-slate-200 flex items-center justify-between transition-colors"
                        >
                          <span className="font-semibold">{u.firstName} {u.lastName}</span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{u.email}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {searchResults.projects?.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">Projects</span>
                      {searchResults.projects.map((p: any) => (
                        <div
                          key={p.id}
                          onClick={() => {
                            setActiveTab("pbac");
                            setSearchResults(null);
                          }}
                          className="cursor-pointer p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-xs text-slate-800 dark:text-slate-200 flex items-center justify-between transition-colors"
                        >
                          <span className="font-semibold">{p.name}</span>
                          <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono">[{p.key}]</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <ThemeToggle />

            <button
              onClick={() => {
                setActiveTab("cache");
                if (typeof window !== "undefined") {
                  window.history.replaceState(null, "", "?tab=cache");
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-50 dark:bg-cyan-950/50 hover:bg-cyan-100 dark:hover:bg-cyan-900/60 text-cyan-700 dark:text-cyan-300 border border-cyan-200 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer dark:border-cyan-800"
              title="System Refresh & Cache Management"
            >
              <RefreshCw className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
              <span className="hidden md:inline">System Refresh & Cache</span>
            </button>

            <button
              onClick={() => {
                setRefreshing(true);
                loadAllData().then(() => showSuccess("Platform telemetry synchronized"));
              }}
              className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
              title="Synchronize Platform Data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-indigo-600 dark:text-indigo-400" : ""}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6 w-full flex-1">
        {/* Top 12 Clickable Executive KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {[
            { label: "Total Orgs", value: kpis.totalOrgs, sub: `${kpis.activeOrgs} active`, tab: "orgs", color: "text-blue-600 dark:text-blue-400", bg: "from-blue-500/5 to-transparent" },
            { label: "Total Users", value: kpis.totalUsers, sub: `${kpis.activeUsers} active`, tab: "users", color: "text-emerald-600 dark:text-emerald-400", bg: "from-emerald-500/5 to-transparent" },
            { label: "Workspaces", value: kpis.totalWorkspaces, sub: "multi-tenant", tab: "workspaces-projects", color: "text-indigo-600 dark:text-indigo-400", bg: "from-indigo-500/5 to-transparent" },
            { label: "Projects", value: kpis.totalProjects, sub: "PBAC isolated", tab: "workspaces-projects", color: "text-purple-600 dark:text-purple-400", bg: "from-purple-500/5 to-transparent" },
            { label: "Total Issues", value: kpis.totalIssues, sub: `${kpis.openIssues} open`, tab: "analytics", color: "text-amber-600 dark:text-amber-400", bg: "from-amber-500/5 to-transparent" },
            { label: "Active Sprints", value: kpis.activeSprints, sub: "in progress", tab: "analytics", color: "text-sky-600 dark:text-sky-400", bg: "from-sky-500/5 to-transparent" },
            { label: "Active Threats", value: kpis.securityAlerts || 0, sub: "threat queue", tab: "security-threats", color: kpis.securityAlerts > 0 ? "text-rose-600 dark:text-rose-400 font-bold" : "text-slate-700 dark:text-slate-300", bg: "from-rose-500/5 to-transparent" },
            { label: "System Cache", value: "Active", sub: "Safe Refresh Hub", tab: "cache", color: "text-cyan-600 dark:text-cyan-400 font-bold", bg: "from-cyan-500/5 to-transparent" },
            { label: "Sync Errors", value: kpis.syncErrors || 0, sub: "0 dropped", tab: "sync", color: "text-emerald-600 dark:text-emerald-400", bg: "from-emerald-500/5 to-transparent" },
            { label: "Reports Hub", value: "15 Types", sub: "RFC CSV/PDF", tab: "reports", color: "text-indigo-600 dark:text-indigo-400", bg: "from-indigo-500/5 to-transparent" },
            { label: "Suspended Orgs", value: kpis.suspendedOrgs, sub: "isolated", tab: "orgs", color: kpis.suspendedOrgs > 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-500 dark:text-slate-400", bg: "from-rose-500/5 to-transparent" },
            { label: "Subsystems", value: "16/16", sub: "Operational", tab: "health", color: "text-emerald-600 dark:text-emerald-400", bg: "from-emerald-500/5 to-transparent" },
          ].map((item, idx) => (
            <div
              key={idx}
              onClick={() => {
                setActiveTab(item.tab as any);
                if (typeof window !== "undefined") {
                  window.history.replaceState(null, "", `?tab=${item.tab}`);
                }
              }}
              className={`cursor-pointer bg-white dark:bg-slate-900/90 bg-gradient-to-br ${item.bg} hover:border-indigo-200 dark:hover:border-indigo-500/50 border border-slate-200 dark:border-slate-800 p-3 rounded-xl transition-all duration-200 space-y-1 shadow-sm dark:shadow-sm hover:scale-[1.02]`}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">{item.label}</span>
              <div className={`text-lg font-bold ${item.color}`}>{item.value}</div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{item.sub}</p>
            </div>
          ))}
        </div>

        {/* Action Required Banner */}
        <GlobalAlertBanner alerts={actionRequired} onNavigateTab={(t) => setActiveTab(t as any)} />

        {/* Navigation Tabs Bar */}
        <div
          role="tablist"
          aria-label="Super admin sections"
          className="flex items-center gap-1.5 overflow-x-auto bg-slate-100 dark:bg-slate-900/80 p-1.5 rounded-xl border border-slate-200 dark:border-slate-800 scrollbar-none"
        >
          {[
            { id: "overview", label: "Command Overview", icon: Activity },
            { id: "cache", label: "System Refresh & Cache", icon: RefreshCw, badge: "Safe" },
            { id: "audit", label: "Audit Logs", icon: History },
            { id: "pbac", label: "Access Governance / PBAC", icon: KeyRound },
            { id: "security-threats", label: "Security & Threat Ops", icon: ShieldAlert },
            { id: "sync", label: "Real-Time Sync Monitor", icon: Radio },
            { id: "reports", label: "Reports Center (15)", icon: FileText },
            { id: "health", label: "System Health (16)", icon: Server },
            { id: "security", label: "Sessions & Threat Map", icon: Lock },
            { id: "jobs", label: "Job & Automation Monitor", icon: Clock },
            { id: "orgs", label: `Organizations (${orgs.length})`, icon: Building2 },
            { id: "workspaces-projects", label: "Workspaces & Projects", icon: FolderGit2 },
            { id: "users", label: `User Directory (${users.length})`, icon: Users },
            { id: "features", label: `Feature Flags (${flags.length})`, icon: Sliders },
            { id: "announcements", label: "Announcements", icon: Megaphone },
            { id: "emails", label: "Email & Notifications", icon: Mail },
            { id: "analytics", label: "Analytics & Charts", icon: BarChart3 },
          ].map((tab: any) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const isCache = tab.id === "cache";
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id as any);
                  if (typeof window !== "undefined") {
                    window.history.replaceState(null, "", `?tab=${tab.id}`);
                  }
                }}
                role="tab"
                aria-selected={isActive}
                // focus-visible (not focus) so keyboard users get a clear ring
                // while a mouse click does not leave one behind.
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-150 shrink-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-100 dark:focus-visible:ring-offset-slate-900 ${
                  isActive
                    ? isCache
                      ? "bg-cyan-700 text-white shadow-sm font-bold"
                      : "bg-indigo-600 text-white shadow-sm font-bold"
                    : isCache
                    ? "text-cyan-800 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-500/30 hover:bg-cyan-100 dark:hover:bg-cyan-900/60"
                    : "text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-800/80"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-white" : isCache ? "text-cyan-600 dark:text-cyan-400" : "text-slate-500 dark:text-slate-400"}`} />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-cyan-50 text-cyan-700 dark:text-cyan-300 border border-cyan-200 uppercase dark:bg-cyan-950/40 dark:border-cyan-800">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content Views */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Quick Actions Row */}
            <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 shadow-sm dark:shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <Zap className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                Super Admin Operational Quick Actions
              </h3>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={() => {
                    setActiveTab("cache");
                    if (typeof window !== "undefined") {
                      window.history.replaceState(null, "", "?tab=cache");
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-cyan-50 dark:bg-cyan-950/60 hover:bg-cyan-100 dark:hover:bg-cyan-900/80 text-cyan-800 dark:text-cyan-300 rounded-lg text-xs font-bold border border-cyan-200 shadow-sm transition-all cursor-pointer dark:border-cyan-800"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                  <span>System Refresh & Cache</span>
                </button>
                <button
                  onClick={() => setShowAddOrgModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Organization</span>
                </button>
                <button
                  onClick={() => setShowAddUserModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                  <span>Create User Account</span>
                </button>
                <button
                  onClick={() => setActiveTab("security-threats")}
                  className="flex items-center gap-1.5 px-3 py-2 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-800 dark:text-rose-300 rounded-lg text-xs font-semibold border border-rose-200 transition-all cursor-pointer dark:border-rose-800"
                >
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                  <span>Threat Ops Queue</span>
                </button>
                <button
                  onClick={() => setActiveTab("reports")}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-800 dark:text-indigo-300 rounded-lg text-xs font-semibold border border-indigo-200 transition-all cursor-pointer dark:border-indigo-800"
                >
                  <FileText className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>Enterprise Reports Hub</span>
                </button>
                <button
                  onClick={() => setActiveTab("sync")}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 rounded-lg text-xs font-semibold border border-emerald-200 transition-all cursor-pointer dark:border-emerald-800"
                >
                  <Radio className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Sync Telemetry</span>
                </button>
                <button
                  onClick={() => setActiveTab("health")}
                  className="flex items-center gap-1.5 px-3 py-2 bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 dark:hover:bg-purple-900/60 text-purple-800 dark:text-purple-300 rounded-lg text-xs font-semibold border border-purple-200 transition-all cursor-pointer dark:border-purple-800"
                >
                  <Server className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  <span>Run Subsystem Probes</span>
                </button>
              </div>
            </div>

            {/* Health Snapshot & Live Stream Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Health Snapshot */}
              <div className="lg:col-span-1 bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4 shadow-sm dark:shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <Server className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                    Subsystems Health Snapshot
                  </h3>
                  <button onClick={() => setActiveTab("health")} className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
                    View All (16) →
                  </button>
                </div>

                <div className="space-y-2.5">
                  {(stats?.systemHealth || []).map((h: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between bg-slate-50 dark:bg-slate-950/80 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800/80 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{h.service}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/20 border border-emerald-200 px-1.5 py-0.5 rounded dark:border-emerald-800">
                          {h.status}
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono block">{h.latencyMs} ms</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Live Platform Activity Feed */}
              <div className="lg:col-span-2 bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4 shadow-sm dark:shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <History className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                    Live Platform Activity & Audit Stream
                  </h3>
                  <button onClick={() => setActiveTab("audit")} className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
                    Audit Ledger →
                  </button>
                </div>

                <div className="space-y-2 max-h-[380px] overflow-y-auto">
                  {(stats?.auditLogs || []).length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 font-medium">No recent activity logged</div>
                  ) : (
                    (stats?.auditLogs || []).map((log: any) => (
                      <div key={log.id} className="p-3 bg-slate-50 dark:bg-slate-950/80 rounded-xl border border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-3 text-xs hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 font-bold rounded text-[10px] dark:border-indigo-800">
                              {log.action}
                            </span>
                            <span className="text-slate-800 dark:text-slate-200 font-semibold">{log.targetResource}</span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">Actor: {log.actorId.slice(0, 12)}...</p>
                        </div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "security-threats" && <SecurityThreatOperationsView />}
        {activeTab === "reports" && <PlatformReportsHubView />}
        {activeTab === "sync" && <SystemSyncMonitorView />}
        {activeTab === "health" && <PlatformHealthView />}
        {activeTab === "pbac" && <AccessGovernanceView />}
        {activeTab === "cache" && <SystemRefreshCacheView />}
        {activeTab === "security" && <SecurityCenterView />}
        {activeTab === "audit" && <AuditComplianceView />}
        {activeTab === "jobs" && <JobAutomationMonitorView />}

        {activeTab === "analytics" && (
          <AnalyticsChartsView
            issues={analyticsData.issues}
            statuses={analyticsData.statuses}
            members={analyticsData.users}
            projects={analyticsData.projects || []}
            sprints={analyticsData.sprints}
            projectId={analyticsData.projects?.[0]?.id || 'default'}
            projectName={analyticsData.projects?.[0]?.name || 'Platform Overview'}
          />
        )}

        {activeTab === "orgs" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between bg-white dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  Organization & Tenant Management
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Manage organization boundaries, enforce tenant suspensions, and inspect workspace hierarchies.
                </p>
              </div>
              <button
                onClick={() => setShowAddOrgModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Organization</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {orgs.map((o) => {
                const isSuspended = o.status === "SUSPENDED";
                const totalProjects = o.workspaces?.reduce((acc: number, w: any) => acc + (w.projects?.length || w._count?.projects || 0), 0) || 0;
                return (
                  <div
                    key={o.id}
                    className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{o.name}</h3>
                          <span className="text-[11px] text-slate-600 dark:text-slate-400 font-mono">slug: {o.slug}</span>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            isSuspended ? "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300" : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                          }`}
                        >
                          {o.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">Domain: {o.domain || "Not configured"}</p>

                      {/* Workspaces & Projects Hierarchy Breakdown */}
                      {o.workspaces && o.workspaces.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/60 space-y-1.5 text-[11px]">
                          <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider block">Workspaces & Projects Hierarchy</span>
                          {o.workspaces.map((w: any) => (
                            <div key={w.id} className="bg-slate-50 dark:bg-slate-950 p-2 rounded-lg border border-slate-200/80 dark:border-slate-800/80 space-y-1">
                              <div className="flex items-center justify-between font-semibold text-slate-800 dark:text-slate-200">
                                <span className="flex items-center gap-1">
                                  <Layers className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                                  {w.name}
                                </span>
                                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">({w.projects?.length || w._count?.projects || 0} projects)</span>
                              </div>
                              {w.projects && w.projects.length > 0 && (
                                <div className="pl-3 border-l-2 border-indigo-200 space-y-0.5 mt-1 dark:border-indigo-800">
                                  {w.projects.map((p: any) => (
                                    <div key={p.id} className="flex items-center justify-between text-[10px] text-slate-600 dark:text-slate-400">
                                      <span className="flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300">
                                        <FolderGit2 className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
                                        {p.name} <span className="text-purple-500 font-mono">[{p.key}]</span>
                                      </span>
                                      <span className="text-[9px] px-1 py-0.2 bg-slate-200 dark:bg-slate-800 rounded font-semibold uppercase">{p.status || "ACTIVE"}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                        {o._count?.members ?? o.members?.length ?? 0} members | {o._count?.workspaces ?? o.workspaces?.length ?? 0} workspaces | {totalProjects} projects
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            setActiveTab("workspaces-projects");
                            if (typeof window !== "undefined") {
                              window.history.replaceState(null, "", "?tab=workspaces-projects");
                            }
                          }}
                          className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                          title="Manage Workspaces & Projects for this Organization"
                        >
                          <FolderGit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setActiveOrg(o);
                            setEditOrgForm({
                              name: o.name,
                              slug: o.slug,
                              domain: o.domain || "",
                              timezone: o.timezone || "UTC",
                              language: o.language || "en",
                              status: o.status || "ACTIVE",
                            });
                            setShowEditOrgModal(true);
                          }}
                          className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-indigo-800 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                          title="Edit Organization"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setActiveOrg(o);
                            setShowDeleteOrgModal(true);
                          }}
                          className="p-1.5 text-slate-600 dark:text-slate-400 hover:text-rose-600 hover:bg-rose-100 rounded transition-colors cursor-pointer dark:hover:bg-rose-900/50"
                          title="Delete Organization"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleToggleOrgStatus(o.id, o.status)}
                          className={`px-2 py-1 rounded text-[11px] font-semibold border transition-colors cursor-pointer ${
                            isSuspended
                              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
                              : "bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/50"
                          } dark:text-emerald-400 dark:border-emerald-800 dark:text-rose-400 dark:border-rose-800`}
                        >
                          {isSuspended ? "Reactivate" : "Suspend"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "workspaces-projects" && (
          <PlatformWorkspacesProjectsView orgs={orgs} onRefreshParent={loadAllData} />
        )}

        {activeTab === "users" && (
          <PlatformUserDirectoryView
            users={users}
            orgs={orgs}
            onRefresh={loadAllData}
          />
        )}

        {activeTab === "features" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between bg-white dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  Platform Feature Flags & Capabilities Engine
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Instantly create, configure, toggle, or delete modules and experimental capabilities globally.
                </p>
              </div>
              <button
                onClick={() => {
                  setFlagForm({ key: "", description: "", isGlobalEnabled: true });
                  setShowCreateFlagModal(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Feature Flag</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {flags.map((flag) => (
                <div
                  key={flag.id}
                  className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-slate-100">{flag.key}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          flag.isGlobalEnabled ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        {flag.isGlobalEnabled ? "ENABLED" : "DISABLED"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">{flag.description || "Platform operational module flag"}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setActiveFlag(flag);
                        setFlagForm({
                          key: flag.key,
                          description: flag.description || "",
                          isGlobalEnabled: flag.isGlobalEnabled,
                        });
                        setShowEditFlagModal(true);
                      }}
                      className="p-2 text-slate-600 dark:text-slate-400 hover:text-indigo-800 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 transition-colors cursor-pointer"
                      title="Edit Feature Flag"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setActiveFlag(flag);
                        setShowDeleteFlagModal(true);
                      }}
                      className="p-2 text-slate-600 dark:text-slate-400 hover:text-rose-600 hover:bg-rose-100 rounded-lg border border-slate-200 dark:border-slate-800 transition-colors cursor-pointer dark:hover:bg-rose-900/50"
                      title="Delete Feature Flag"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleToggleFlag(flag.key, flag.isGlobalEnabled)}
                      className={`p-2 rounded-lg transition-colors border cursor-pointer ${
                        flag.isGlobalEnabled
                          ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-500"
                          : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700"
                      }`}
                      title={flag.isGlobalEnabled ? "Disable Flag" : "Enable Flag"}
                    >
                      {flag.isGlobalEnabled ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "announcements" && (
          <PlatformAnnouncementsView />
        )}

        {activeTab === "emails" && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Mail className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                Email Infrastructure & Notification Templates
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Configure SMTP parameters, customize transaction templates, and test delivery pipes.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* SMTP Config */}
              <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">SMTP Server Configuration</h3>
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-slate-600 dark:text-slate-400 block mb-1">Sender Email</label>
                    <input
                      type="text"
                      value={emailConfig.senderEmail}
                      onChange={(e) => setEmailConfig({ ...emailConfig, senderEmail: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-600 dark:text-slate-400 block mb-1">SMTP Host</label>
                      <input
                        type="text"
                        value={emailConfig.smtpHost || ""}
                        onChange={(e) => setEmailConfig({ ...emailConfig, smtpHost: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-slate-600 dark:text-slate-400 block mb-1">SMTP Port</label>
                      <input
                        type="number"
                        value={emailConfig.smtpPort || 587}
                        onChange={(e) => setEmailConfig({ ...emailConfig, smtpPort: parseInt(e.target.value, 10) })}
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                      />
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      setConfigSaving(true);
                      try {
                        const res = await fetch("/api/super-admin/email-settings", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(emailConfig),
                        });
                        if (res.ok) showSuccess("SMTP settings updated");
                      } catch (e: any) {
                        showError(e.message || "Failed to save");
                      } finally {
                        setConfigSaving(false);
                      }
                    }}
                    disabled={configSaving}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-xs"
                  >
                    {configSaving ? "Saving..." : "Save SMTP Config"}
                  </button>
                </div>
              </div>

              {/* Test Send */}
              <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">Test Email Dispatch</h3>
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-slate-600 dark:text-slate-400 block mb-1">Destination Address</label>
                    <input
                      type="email"
                      placeholder="recipient@example.com"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                    />
                  </div>
                  <button
                    onClick={async () => {
                      if (!testEmail.trim()) return;
                      setTestSending(true);
                      try {
                        const res = await fetch("/api/super-admin/email-settings/test", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ to: testEmail.trim() }),
                        });
                        const json = await res.json();
                        if (res.ok) showSuccess(json.message || "Test email sent");
                        else showError(json.error || "Failed to send");
                      } catch (e: any) {
                        showError(e.message || "Error sending test email");
                      } finally {
                        setTestSending(false);
                      }
                    }}
                    disabled={testSending || !testEmail.trim()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-xs disabled:opacity-50"
                  >
                    {testSending ? "Sending..." : "Dispatch Test Email"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modal: Create User */}
      {showAddUserModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Create New User Account
              </h3>
              <button onClick={() => setShowAddUserModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddUser} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">First Name *</label>
                  <input
                    type="text"
                    required
                    value={addUserForm.firstName}
                    onChange={(e) => setAddUserForm({ ...addUserForm, firstName: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Last Name *</label>
                  <input
                    type="text"
                    required
                    value={addUserForm.lastName}
                    onChange={(e) => setAddUserForm({ ...addUserForm, lastName: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  value={addUserForm.email}
                  onChange={(e) => setAddUserForm({ ...addUserForm, email: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Password *</label>
                <input
                  type="password"
                  required
                  value={addUserForm.password}
                  onChange={(e) => setAddUserForm({ ...addUserForm, password: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Organization</label>
                <select
                  value={addUserForm.orgId}
                  onChange={(e) => setAddUserForm({ ...addUserForm, orgId: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                >
                  <option value="">No Organization (Standalone)</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="isSuperAdmin"
                  checked={addUserForm.isSuperAdmin}
                  onChange={(e) => setAddUserForm({ ...addUserForm, isSuperAdmin: e.target.checked })}
                  className="rounded border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
                <label htmlFor="isSuperAdmin" className="text-slate-700 dark:text-slate-300 font-medium">
                  Grant Super Admin Authority
                </label>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingUser}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {addingUser ? "Creating..." : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create Org */}
      {showAddOrgModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Create New Organization Tenant
              </h3>
              <button onClick={() => setShowAddOrgModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddOrg} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Organization Name *</label>
                <input
                  type="text"
                  required
                  placeholder="Acme Corp"
                  value={addOrgForm.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
                    setAddOrgForm({ ...addOrgForm, name, slug });
                  }}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Organization Slug *</label>
                <input
                  type="text"
                  required
                  value={addOrgForm.slug}
                  onChange={(e) => setAddOrgForm({ ...addOrgForm, slug: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none font-mono"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Domain (Optional)</label>
                <input
                  type="text"
                  placeholder="acme.com"
                  value={addOrgForm.domain}
                  onChange={(e) => setAddOrgForm({ ...addOrgForm, domain: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddOrgModal(false)}
                  className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingOrg}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {addingOrg ? "Creating..." : "Create Tenant"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Org */}
      {showEditOrgModal && activeOrg && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Edit Organization: {activeOrg.name}
              </h3>
              <button onClick={() => setShowEditOrgModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditOrg} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Organization Name *</label>
                <input
                  type="text"
                  required
                  value={editOrgForm.name}
                  onChange={(e) => setEditOrgForm({ ...editOrgForm, name: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Slug *</label>
                <input
                  type="text"
                  required
                  value={editOrgForm.slug}
                  onChange={(e) => setEditOrgForm({ ...editOrgForm, slug: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none font-mono"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Domain</label>
                <input
                  type="text"
                  value={editOrgForm.domain}
                  onChange={(e) => setEditOrgForm({ ...editOrgForm, domain: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Timezone</label>
                  <input
                    type="text"
                    value={editOrgForm.timezone}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, timezone: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">Status</label>
                  <select
                    value={editOrgForm.status}
                    onChange={(e) => setEditOrgForm({ ...editOrgForm, status: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditOrgModal(false)}
                  className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingOrg}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {savingOrg ? "Saving..." : "Save Organization"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Org Confirmation */}
      {showDeleteOrgModal && activeOrg && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 border border-rose-200 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl dark:border-rose-800">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-50 text-rose-600 rounded-lg dark:bg-rose-950/40 dark:text-rose-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Permanently Delete Organization</h3>
                <p className="text-xs text-rose-600 font-semibold dark:text-rose-400">Critical Cascading Deletion</p>
              </div>
            </div>

            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              Are you sure you want to permanently delete{" "}
              <strong className="text-white font-mono">{activeOrg.name}</strong> ({activeOrg.slug})?
              This will irreversibly delete all workspaces, projects, issues, sprints, and memberships belonging to this tenant.
            </p>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteOrgModal(false)}
                className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteOrg}
                disabled={savingOrg}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs disabled:opacity-50"
              >
                {savingOrg ? "Deleting..." : "Permanently Delete Organization"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Feature Flag */}
      {showCreateFlagModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Create New Feature Flag
              </h3>
              <button onClick={() => setShowCreateFlagModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateFlag} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Flag Key * (e.g. AI_ASSISTANT)</label>
                <input
                  type="text"
                  required
                  placeholder="NEW_CAPABILITY"
                  value={flagForm.key}
                  onChange={(e) => setFlagForm({ ...flagForm, key: e.target.value.toUpperCase() })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none font-mono uppercase"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="What does this feature flag control?"
                  value={flagForm.description}
                  onChange={(e) => setFlagForm({ ...flagForm, description: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="flagGlobalEnabled"
                  checked={flagForm.isGlobalEnabled}
                  onChange={(e) => setFlagForm({ ...flagForm, isGlobalEnabled: e.target.checked })}
                  className="rounded border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-indigo-600 dark:text-indigo-400"
                />
                <label htmlFor="flagGlobalEnabled" className="text-slate-700 dark:text-slate-300">
                  Enable globally upon creation
                </label>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateFlagModal(false)}
                  className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingFlag}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {savingFlag ? "Creating..." : "Create Flag"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Feature Flag */}
      {showEditFlagModal && activeFlag && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Edit Feature Flag: {activeFlag.key}
              </h3>
              <button onClick={() => setShowEditFlagModal(false)} className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditFlag} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">Description</label>
                <textarea
                  rows={2}
                  value={flagForm.description}
                  onChange={(e) => setFlagForm({ ...flagForm, description: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-800 dark:text-slate-200 outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="editFlagGlobalEnabled"
                  checked={flagForm.isGlobalEnabled}
                  onChange={(e) => setFlagForm({ ...flagForm, isGlobalEnabled: e.target.checked })}
                  className="rounded border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-indigo-600 dark:text-indigo-400"
                />
                <label htmlFor="editFlagGlobalEnabled" className="text-slate-700 dark:text-slate-300">
                  Global Enabled
                </label>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditFlagModal(false)}
                  className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingFlag}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  {savingFlag ? "Saving..." : "Save Flag"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Feature Flag Confirmation */}
      {showDeleteFlagModal && activeFlag && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 border border-rose-200 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl dark:border-rose-800">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-rose-50 text-rose-600 rounded-lg dark:bg-rose-950/40 dark:text-rose-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Delete Feature Flag</h3>
                <p className="text-xs text-rose-600 font-semibold dark:text-rose-400">Confirm Flag Removal</p>
              </div>
            </div>

            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              Are you sure you want to delete feature flag{" "}
              <strong className="text-white font-mono">{activeFlag.key}</strong>? This will remove global control of this feature.
            </p>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteFlagModal(false)}
                className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteFlag}
                disabled={savingFlag}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs disabled:opacity-50"
              >
                {savingFlag ? "Deleting..." : "Permanently Delete Flag"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}