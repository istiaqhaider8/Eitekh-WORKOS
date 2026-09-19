"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { User, Shield, Building, ArrowLeft, ShieldCheck, RefreshCw } from "lucide-react";
import { Breadcrumb } from "@/components/common/Breadcrumb";
import { AppHeader } from "@/components/layout/AppHeader";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentOrg, setCurrentOrg] = useState<any>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setCurrentUser(data.user);
          if (data.user.organizations?.length > 0) {
            setCurrentOrg(data.user.organizations[0]);
          }
        }
      });
  }, []);

  const isOrgAdmin = currentUser?.isSuperAdmin || currentOrg?.role === "OWNER" || currentOrg?.role === "ADMIN";

  const navItems = [
    { href: "/settings/profile", label: "Profile", icon: User, adminOnly: false },
    { href: "/settings/security", label: "Security", icon: Shield, adminOnly: false },
    { href: "/settings/system-cache", label: "System Refresh & Cache", icon: RefreshCw, adminOnly: false },
    ...(isOrgAdmin
      ? [
          { href: "/settings/organization", label: "Organization", icon: Building, adminOnly: true },
          { href: "/settings/roles", label: "Roles & Permissions", icon: ShieldCheck, adminOnly: true },
        ]
      : []),
  ];

  const currentNav = navItems.find((item) => pathname.startsWith(item.href));

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <AppHeader
        currentUser={currentUser}
        currentOrg={currentOrg}
        breadcrumbs={[
          { label: "Settings" },
          { label: currentNav?.label || "General" },
        ]}
      />

      <div className="flex-1 flex flex-col md:flex-row max-w-7xl mx-auto w-full overflow-hidden">
        {/* Settings Navigation */}
        <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-slate-300 dark:border-slate-800 p-4 sm:p-6 flex flex-col shrink-0">
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
            className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all mb-4 md:mb-6 cursor-pointer shadow-2xs w-fit"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Dashboard</span>
          </button>

          <h2 className="hidden md:block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4 px-3">
            Settings
          </h2>

          <nav className="flex md:flex-col gap-1.5 overflow-x-auto pb-1 md:pb-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors shrink-0 ${
                    isActive
                      ? "bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
