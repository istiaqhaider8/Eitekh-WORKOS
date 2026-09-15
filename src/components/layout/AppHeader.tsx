"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  Search,
  Plus,
  Shield,
  LogOut,
  User,
  Settings,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Check,
  ArrowLeft,
  RefreshCw,
  Menu,
} from "lucide-react";

import { Breadcrumb } from "@/components/common/Breadcrumb";
import { ThemeToggle } from "@/components/common/ThemeToggle";

interface AppHeaderProps {
  currentUser: any;
  currentOrg?: any;
  workspaces?: any[];
  breadcrumbs?: { label: string; href?: string }[];
  canCreateIssue?: boolean;
  onCreateIssueClick?: () => void;
  onOpenCommandPalette?: () => void;
  onBack?: () => void;
  onToggleMobileSidebar?: () => void;
}

export function AppHeader({
  currentUser,
  currentOrg,
  workspaces,
  breadcrumbs,
  canCreateIssue,
  onCreateIssueClick,
  onOpenCommandPalette,
  onBack,
  onToggleMobileSidebar,
}: AppHeaderProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationTab, setNotificationTab] = useState<"all" | "unread" | "mentions" | "assignments" | "system">("all");
  const [notificationSearch, setNotificationSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showUserMenu, setShowUserMenu] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (notificationsRef.current && !notificationsRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!showNotifications) setSelectedIds(new Set());
  }, [showNotifications]);

  useEffect(() => {
    setSelectedIds(new Set());
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 10000);
    return () => clearInterval(interval);
  }, [notificationTab, notificationSearch]);

  const fetchNotifications = async () => {
    try {
      const params = new URLSearchParams();
      if (notificationTab !== "all") params.set("filter", notificationTab);
      if (notificationSearch.trim()) params.set("search", notificationSearch.trim());
      params.set("limit", "30");

      const res = await fetch(`/api/notifications?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const markAllAsRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (e) {
      console.error(e);
    }
  };

  const markAsRead = async (id: string) => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (e) {
      console.error(e);
    }
  };

  const clearAllNotifications = async () => {
    try {
      await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearAll: true }),
      });
      setNotifications([]);
      setUnreadCount(0);
    } catch (e) {
      console.error(e);
    }
  };

  const deleteNotification = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setUnreadCount((prev) => {
        const item = notifications.find((n) => n.id === id);
        return item && !item.isRead ? Math.max(0, prev - 1) : prev;
      });
    } catch (err) {
      console.error(err);
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allSelected = notifications.length > 0 && notifications.every((n) => selectedIds.has(n.id));
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(notifications.map((n) => n.id)));
  };

  const markSelectedAsRead = async () => {
    const ids = Array.from(selectedIds);
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const unreadSelected = notifications.filter((n) => ids.includes(n.id) && !n.isRead).length;
      setNotifications((prev) => prev.map((n) => ids.includes(n.id) ? { ...n, isRead: true } : n));
      setUnreadCount((prev) => Math.max(0, prev - unreadSelected));
      setSelectedIds(new Set());
    } catch (err) {
      console.error(err);
    }
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedIds);
    try {
      await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const unreadSelected = notifications.filter((n) => ids.includes(n.id) && !n.isRead).length;
      setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)));
      setUnreadCount((prev) => Math.max(0, prev - unreadSelected));
      setSelectedIds(new Set());
    } catch (err) {
      console.error(err);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "MENTION":
        return <span className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 font-bold text-xs">@</span>;
      case "ASSIGNMENT":
      case "TEAM_ASSIGNMENT":
        return <span className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-bold text-xs">👤</span>;
      case "COMMENT":
      case "REPLY":
        return <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 font-bold text-xs">💬</span>;
      case "STATUS":
      case "PRIORITY":
        return <span className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 font-bold text-xs">🔄</span>;
      case "DUE_DATE":
      case "OVERDUE":
        return <span className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 font-bold text-xs">⏰</span>;
      case "SPRINT":
        return <span className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold text-xs">🏃</span>;
      default:
        return <span className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold text-xs">⚡</span>;
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(dateStr).toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (e) {
      console.error("Logout error:", e);
    }
    window.location.href = "/login";
  };

  const handleDefaultBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (typeof window !== "undefined") {
      const lastProjectId = localStorage.getItem("eitekh_last_project_id");
      if (window.location.pathname.startsWith("/settings") || window.location.pathname.startsWith("/super-admin")) {
        if (lastProjectId) {
          router.push(`/projects/${lastProjectId}`);
          return;
        }
      }
      if (window.history.length > 1 && document.referrer && document.referrer.includes(window.location.host)) {
        router.back();
        return;
      }
    }
    router.push("/");
  };

  return (
    <header className="h-13 md:h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1322] backdrop-blur-md flex items-center justify-between px-2.5 sm:px-4 md:px-5 sticky top-0 z-30 transition-colors shadow-2xs">
      {/* Left: Hamburger & Brand & Context */}
      <div className="flex items-center gap-2 sm:gap-3 md:gap-4 shrink-0">
        {onToggleMobileSidebar && (
          <button
            type="button"
            onClick={onToggleMobileSidebar}
            aria-label="Toggle navigation menu"
            className="md:hidden p-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        <Link
          href="/"
          className="flex items-center gap-2 md:gap-2.5 py-1 px-1.5 -ml-1 rounded-xl font-bold text-sm sm:text-base md:text-lg tracking-tight text-slate-900 dark:text-white hover:bg-slate-100/80 dark:hover:bg-slate-900/80 transition-all group shrink-0"
        >
          <img
            src="/leaf-logo.png"
            alt="Eitekh"
            className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 object-contain group-hover:scale-105 transition-transform shrink-0 drop-shadow-xs"
          />
          <span className="font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5 leading-none">
            <span>Eitekh</span>
            <span className="hidden xs:inline-block text-[9px] sm:text-[10px] font-bold tracking-wider uppercase text-blue-600 dark:text-blue-400 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/70 dark:to-indigo-950/50 px-1.5 sm:px-2 py-0.5 rounded-full border border-blue-300 dark:border-blue-800/60 shadow-2xs">
              WorkOS
            </span>
          </span>
        </Link>

        {breadcrumbs ? (
          <div className="hidden sm:flex items-center gap-1.5 border-l border-slate-300 dark:border-slate-800 pl-2.5 md:pl-4">
            <Breadcrumb items={breadcrumbs} />
          </div>
        ) : currentOrg && (
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 border-l border-slate-300 dark:border-slate-800 pl-2.5 md:pl-4">
            <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[100px] md:max-w-[160px]">{currentOrg.name}</span>
            <span className="text-slate-400 dark:text-slate-600">/</span>
            <span className="text-slate-700 dark:text-slate-400 truncate max-w-[80px] md:max-w-[120px]">{workspaces?.[0]?.name || "Main"}</span>
          </div>
        )}
      </div>

      {/* Center: Global Search & Hotkey Trigger */}
      <div className="flex-1 max-w-md mx-1.5 sm:mx-3 md:mx-4">
        <button
          onClick={onOpenCommandPalette}
          aria-label="Search"
          className="w-full flex items-center justify-between px-2.5 sm:px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 bg-slate-100 hover:bg-slate-200/70 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-800 hover:border-blue-500 dark:hover:border-indigo-400 rounded-xl transition-all duration-150 cursor-pointer shadow-2xs group"
        >
          <div className="flex items-center gap-1.5 sm:gap-2 truncate">
            <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500 transition-colors shrink-0" />
            <span className="hidden md:inline group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors font-medium truncate">Search issues, projects, or commands...</span>
            <span className="md:hidden text-[11px] text-slate-400 truncate">Search...</span>
          </div>
          <kbd className="hidden lg:inline px-1.5 py-0.5 text-[10px] font-mono font-medium text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-md shadow-2xs shrink-0">
            Ctrl + K
          </kbd>
        </button>
      </div>

      {/* Right: Actions, Notifications, Profile */}
      <div className="flex items-center gap-1.5 md:gap-2.5">
        {(canCreateIssue !== false && (currentUser?.isSuperAdmin || !Array.isArray(currentUser?.capabilities) || currentUser.capabilities.includes("issues:create"))) && (
          <button
            onClick={onCreateIssueClick}
            aria-label="Create issue"
            className="btn-primary flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-xl cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Create</span>
            <kbd className="hidden sm:inline px-1 py-0.2 text-[9px] bg-white/20 rounded font-mono">C</kbd>
          </button>
        )}

        <ThemeToggle />

        {/* Notifications Bell */}
        <div className="relative" ref={notificationsRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            aria-label="Notifications"
            className="p-1.5 md:p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/80 rounded-xl transition-colors relative cursor-pointer"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-600 dark:bg-blue-500 rounded-full ring-2 ring-white dark:ring-slate-900 animate-pulse" />
            )}
          </button>

          {showNotifications && (
            <div className="fixed sm:absolute inset-x-3 sm:inset-x-auto sm:right-0 top-14 sm:top-auto sm:mt-2 w-auto sm:w-96 max-w-sm sm:max-w-md bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl shadow-2xl p-3.5 z-50 animate-in fade-in zoom-in-95 duration-100 flex flex-col max-h-[calc(100vh-5rem)] sm:max-h-[32rem]">
              <div className="flex items-center justify-between pb-2 border-b border-slate-300 dark:border-slate-800">
                <span className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                  Notifications
                  {unreadCount > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 font-bold text-[10px]">
                      {unreadCount}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  {selectedIds.size > 0 ? (
                    <>
                      <button
                        onClick={markSelectedAsRead}
                        className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        <Check className="w-3 h-3" />
                        <span>Mark read ({selectedIds.size})</span>
                      </button>
                      <button
                        onClick={deleteSelected}
                        className="text-[11px] text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                      >
                        Delete ({selectedIds.size})
                      </button>
                    </>
                  ) : (
                    <>
                      {unreadCount > 0 && (
                        <button
                          onClick={markAllAsRead}
                          className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                        >
                          <Check className="w-3 h-3" />
                          <span>Mark all read</span>
                        </button>
                      )}
                      {notifications.length > 0 && (
                        <button
                          onClick={clearAllNotifications}
                          className="text-[11px] text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                        >
                          Clear all
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Notification Filter Tabs */}
              <div className="flex items-center gap-1 pt-2 pb-1 overflow-x-auto no-scrollbar">
                {[
                  { id: "all", label: "All" },
                  { id: "unread", label: "Unread" },
                  { id: "mentions", label: "Mentions" },
                  { id: "assignments", label: "Assigned" },
                  { id: "system", label: "System" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setNotificationTab(tab.id as any)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors shrink-0 cursor-pointer ${
                      notificationTab === tab.id
                        ? "bg-blue-50 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400"
                        : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* In-Popover Search */}
              <div className="pt-1.5 pb-2">
                <input
                  type="text"
                  placeholder="Filter notifications..."
                  value={notificationSearch}
                  onChange={(e) => setNotificationSearch(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700/80 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-800 dark:text-slate-100 placeholder-slate-400"
                />
              </div>

              {/* Select-all row */}
              {notifications.length > 0 && (
                <div className="flex items-center gap-2 px-1 pb-1.5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 text-blue-600 cursor-pointer accent-blue-600"
                    aria-label="Select all notifications"
                  />
                  <span className="text-[11px] text-slate-400 select-none">
                    {selectedIds.size > 0 ? `${selectedIds.size} of ${notifications.length} selected` : "Select all"}
                  </span>
                </div>
              )}

              {/* Notification Items List */}
              <div className="overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 max-h-72">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    {notificationSearch ? "No matching notifications found" : "No notifications in this filter"}
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => {
                        if (selectedIds.size > 0) { toggleSelect(n.id, { stopPropagation: () => {} } as React.MouseEvent); return; }
                        if (!n.isRead) markAsRead(n.id);
                        if (n.linkUrl) router.push(n.linkUrl);
                      }}
                      className={`py-2.5 px-2 flex items-start justify-between gap-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-xl transition-colors cursor-pointer group ${
                        selectedIds.has(n.id) ? "bg-blue-50 dark:bg-blue-950/30" : !n.isRead ? "bg-blue-50/40 dark:bg-blue-950/20" : ""
                      }`}
                    >
                      <div className="flex items-start gap-2.5 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(n.id)}
                          onClick={(e) => toggleSelect(n.id, e)}
                          onChange={() => {}}
                          className="mt-1 w-3.5 h-3.5 shrink-0 rounded border-slate-300 dark:border-slate-600 text-blue-600 cursor-pointer accent-blue-600"
                          aria-label="Select notification"
                        />
                        <div className="shrink-0 mt-0.5">
                          {getNotificationIcon(n.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                              {n.title}
                            </p>
                            <span className="text-[10px] text-slate-400 shrink-0">
                              {formatTimeAgo(n.createdAt)}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5 leading-relaxed">
                            {n.message}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!n.isRead && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
                        )}
                        <button
                          onClick={(e) => deleteNotification(n.id, e)}
                          aria-label="Delete notification"
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-400 hover:text-red-500 transition-opacity cursor-pointer"
                          title="Dismiss"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Super Admin Switcher */}
        {currentUser?.isSuperAdmin && (
          <div className="flex items-center gap-1.5">
            <Link
              href="/super-admin"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/80 rounded-xl hover:bg-amber-100/80 transition-colors shadow-2xs"
            >
              <Shield className="w-3.5 h-3.5 text-amber-600" />
              <span className="hidden sm:inline">Super Admin</span>
            </Link>
            <Link
              href="/super-admin?tab=cache"
              className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-cyan-700 bg-cyan-50 dark:bg-cyan-950/50 dark:text-cyan-300 border border-cyan-200/80 dark:border-cyan-800/80 rounded-xl hover:bg-cyan-100/80 transition-colors shadow-2xs"
              title="System Refresh & Cache Management"
            >
              <RefreshCw className="w-3.5 h-3.5 text-cyan-500" />
              <span>Refresh & Cache</span>
            </Link>
          </div>
        )}

        {/* User Avatar Menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            aria-label="User menu"
            className="flex items-center gap-1.5 p-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-2xs">
              {currentUser?.firstName?.[0] || "U"}
            </div>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {showUserMenu && (
            <div className="absolute right-0 mt-2 w-60 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl shadow-2xl p-2.5 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-2.5 border-b border-slate-300 dark:border-slate-800">
                <p className="text-xs font-bold text-slate-900 dark:text-white">{currentUser?.fullName || currentUser?.firstName}</p>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">{currentUser?.email}</p>
                <span className="inline-block mt-1.5 px-2 py-0.5 text-[9px] font-bold rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 uppercase border border-blue-200/60 dark:border-blue-800/60">
                  {currentUser?.jobTitle || "Member"}
                </span>
              </div>
              <div className="py-1.5 space-y-0.5">
                <Link
                  href="/settings/profile"
                  onClick={() => setShowUserMenu(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-colors"
                >
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  <span>Profile, Leaves & Delegation</span>
                </Link>
                <Link
                  href="/settings/security"
                  onClick={() => setShowUserMenu(false)}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-colors"
                >
                  <Settings className="w-3.5 h-3.5 text-slate-400" />
                  <span>Security & Sessions</span>
                </Link>
                {currentUser?.isSuperAdmin && (
                  <Link
                    href="/super-admin?tab=cache"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-cyan-600 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-950/40 rounded-xl transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-cyan-500" />
                    <span>System Refresh & Cache</span>
                  </Link>
                )}
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
