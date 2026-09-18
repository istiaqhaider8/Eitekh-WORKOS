"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { canUseProjectAction } from "@/lib/project-permissions";
import {
  Kanban,
  ListTodo,
  Calendar,
  Layers,
  Clock,
  BarChart3,
  Users,
  PieChart,
  Plus,
  ChevronsLeft,
  ChevronsRight,
  Menu,
  X
} from "lucide-react";

interface AppSidebarProps {
  projects: any[];
  activeProjectId?: string;
  activeView: string;
  onSelectView: (view: string) => void;
  onCreateProjectClick?: () => void;
  currentUser?: any;
  isMobileOpen?: boolean;
  onToggleMobile?: () => void;
  onCloseMobile?: () => void;
}

export function AppSidebar({
  projects,
  activeProjectId,
  activeView,
  onSelectView,
  onCreateProjectClick,
  currentUser,
  isMobileOpen: controlledMobileOpen,
  onToggleMobile,
  onCloseMobile,
}: AppSidebarProps) {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [internalMobileOpen, setInternalMobileOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const isMobileOpen = controlledMobileOpen !== undefined ? controlledMobileOpen : internalMobileOpen;
  const handleCloseMobile = () => {
    if (onCloseMobile) onCloseMobile();
    else setInternalMobileOpen(false);
  };

  useEffect(() => {
    setIsMounted(true);
    const stored = localStorage.getItem("eitekh_sidebar_collapsed");
    if (stored !== null) {
      setIsCollapsed(stored === "true");
    } else if (typeof window !== "undefined" && window.innerWidth >= 768 && window.innerWidth <= 1024) {
      setIsCollapsed(true);
    }
  }, []);

  const toggleCollapse = () => {
    const newValue = !isCollapsed;
    setIsCollapsed(newValue);
    localStorage.setItem("eitekh_sidebar_collapsed", String(newValue));
  };

  const isSuperAdmin = currentUser?.isSuperAdmin;
  const capabilities = currentUser?.capabilities;

  const views = [
    { id: "board", label: "Kanban Board", icon: Kanban, permission: "kanban:view" },
    { id: "list", label: "List View", icon: ListTodo, permission: "list:view" },
    { id: "scrum", label: "Scrum & Backlog", icon: Layers, permission: "backlog:view" },
    { id: "timeline", label: "Timeline (Gantt)", icon: Clock, permission: "timeline:view" },
    { id: "calendar", label: "Calendar", icon: Calendar, permission: "calendar:view" },
    { id: "workload", label: "Team Workload", icon: Users, permission: "workload:view" },
    { id: "charts", label: "Charts & Analytics", icon: PieChart, permission: "analytics:view" },
    { id: "dashboard", label: "Project Reports", icon: BarChart3, permission: "reports:view" },
  ].filter((v) => {
    if (!currentUser || isSuperAdmin || !Array.isArray(capabilities)) return true;
    return capabilities.includes(v.permission);
  });

  if (!isMounted) {
    return <aside className="w-60 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0c1322] flex flex-col justify-between shrink-0 h-[calc(100vh-3.5rem)] select-none hidden md:flex" />;
  }

  return (
    <>
      {/* Fallback Mobile Floating Toggle Overlay only when neither controlled nor toggle provided */}
      {controlledMobileOpen === undefined && !onToggleMobile && (
        <button 
          className="md:hidden fixed bottom-4 right-4 p-3 bg-blue-600 text-white rounded-full shadow-lg z-50 cursor-pointer"
          onClick={() => setInternalMobileOpen(true)}
          aria-label="Open sidebar navigation"
        >
          <Menu className="w-6 h-6" />
        </button>
      )}

      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 md:hidden animate-in fade-in duration-200"
          onClick={handleCloseMobile}
        />
      )}

      {/* Sidebar Container */}
      <aside 
        className={`fixed md:relative top-13 md:top-0 z-50 md:z-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1322] backdrop-blur-md flex flex-col justify-between shrink-0 h-[calc(100vh-3.25rem)] md:h-[calc(100vh-3.5rem)] select-none transition-all duration-300 ease-in-out shadow-xl md:shadow-2xs w-72 max-w-[85vw] ${
          isCollapsed ? "md:w-14" : "md:w-60"
        } ${isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <div className="p-3 overflow-y-auto overflow-x-hidden flex-1 no-scrollbar">
          {/* Collapse Toggle (Desktop only) */}
          <div className="hidden md:flex justify-end mb-4">
            <button
              onClick={toggleCollapse}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isCollapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
            </button>
          </div>

          {/* Close Button (Mobile only) */}
          <div className="md:hidden flex items-center justify-between mb-4 pb-2 border-b border-slate-200 dark:border-slate-800">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">Navigation</span>
            <button
              onClick={handleCloseMobile}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Close navigation"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Projects Section */}
          <div className="mb-6">
            {!isCollapsed && (
              <div className="flex items-center justify-between px-2 mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <span>Projects</span>
                {/* Restricted to Super Admin, Organization Admin, Project Admin
                    and Project Manager. POST /api/projects enforces the same
                    `projects:create` permission, so hiding this only removes the
                    entry point -- it is not the control itself. */}
                {canUseProjectAction(currentUser, "newProject") && (
                  <button
                    onClick={onCreateProjectClick}
                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    title="Create Project"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            <div className="space-y-1">
              {projects.map((p) => {
                const isActive = p.id === activeProjectId;
                return (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    title={p.name}
                    className={`flex items-center gap-2.5 rounded-xl text-xs font-medium transition-all ${
                      isCollapsed ? "justify-center p-2" : "px-3 py-2"
                    } ${
                      isActive
                        ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-500/25 font-semibold"
                        : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 shrink-0 rounded-md flex items-center justify-center font-bold text-[10px] ${
                        isActive ? "bg-white/20 text-white" : "bg-blue-50 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/60"
                      }`}
                    >
                      {p.key}
                    </div>
                    {!isCollapsed && <span className="truncate">{p.name}</span>}
                  </Link>
                );
              })}
            </div>
            
            {isCollapsed && (
              <button
                onClick={onCreateProjectClick}
                className="mt-2 w-full flex justify-center p-2 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title="Create Project"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Project Views */}
          {activeProjectId && (
            <div>
              {!isCollapsed && (
                <div className="px-2 mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <span>Views</span>
                </div>
              )}

              <div className="space-y-1">
                {views.map((v) => {
                  const Icon = v.icon;
                  const isSelected = activeView === v.id;
                  return (
                    <button
                      key={v.id}
                      onClick={() => {
                        onSelectView(v.id);
                        if (typeof window !== "undefined" && window.innerWidth < 768) handleCloseMobile();
                      }}
                      title={isCollapsed ? v.label : undefined}
                      className={`w-full flex items-center gap-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer text-left relative ${
                        isCollapsed ? "justify-center p-2" : "px-3 py-2"
                      } ${
                        isSelected
                          ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 shadow-2xs font-bold border border-blue-200 dark:border-blue-800/80 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:bg-blue-600 before:rounded-r"
                          : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-transparent"
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 transition-colors ${isSelected ? "text-blue-600 dark:text-blue-400" : "text-slate-400"}`} />
                      {!isCollapsed && <span>{v.label}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer info & Hotkeys hint */}
        {!isCollapsed && (
          <div className="p-3 pb-8 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-400 space-y-1 bg-slate-50/80 dark:bg-slate-900/60">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-500 dark:text-slate-400">Shortcuts:</span>
              <span className="font-mono text-[10px] text-slate-600 dark:text-slate-300 font-semibold bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">C (Create), / (Search)</span>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
