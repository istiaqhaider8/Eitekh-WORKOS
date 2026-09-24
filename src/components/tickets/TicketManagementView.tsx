"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Ticket,
  BarChart3,
  ListTodo,
  Plus,
  RefreshCw,
  Layers,
} from "lucide-react";
import { TicketList } from "./TicketList";
import { TicketDashboard } from "./TicketDashboard";
import { ClientTicketCreateModal } from "./ClientTicketCreateModal";
import { TicketDetailModal } from "./TicketDetailModal";

interface TicketManagementViewProps {
  projectId: string;
  currentUser: any;
  projectMembers?: any[];
  onNavigateToIssue?: (issueId: string) => void;
}

export function TicketManagementView({
  projectId,
  currentUser,
  projectMembers = [],
  onNavigateToIssue,
}: TicketManagementViewProps) {
  const isClient = currentUser?.userType === "CLIENT";
  const userRole = currentUser?.role || "VIEWER";
  const canSeeDashboard = !isClient || currentUser?.capabilities?.includes("tickets:dashboard");
  const canCreateTicket = true; // All authenticated clients and staff can raise tickets

  // Active Sub-view: "tickets" list or "dashboard"
  const [activeSubView, setActiveSubView] = useState<"tickets" | "dashboard">(
    canSeeDashboard ? "dashboard" : "tickets"
  );

  // Tickets List State
  const [tickets, setTickets] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("ALL");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [selectedPriority, setSelectedPriority] = useState("ALL");

  // Modal Controls
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // Fetch Tickets List
  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "20");
      if (selectedStatus !== "ALL") params.set("status", selectedStatus);
      if (selectedCategory !== "ALL") params.set("category", selectedCategory);
      if (selectedPriority !== "ALL") params.set("priority", selectedPriority);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());

      const res = await fetch(`/api/projects/${projectId}/tickets?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setTickets(data.tickets || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.error("Error fetching tickets:", err);
    } finally {
      setLoading(false);
    }
  }, [projectId, page, selectedStatus, selectedCategory, selectedPriority, searchQuery]);

  useEffect(() => {
    let ignore = false;
    const params = new URLSearchParams({
      page: String(page),
      limit: "15",
    });
    if (selectedStatus !== "ALL") params.set("status", selectedStatus);
    if (selectedCategory !== "ALL") params.set("category", selectedCategory);
    if (selectedPriority !== "ALL") params.set("priority", selectedPriority);
    if (searchQuery.trim()) params.set("search", searchQuery.trim());

    fetch(`/api/projects/${projectId}/tickets?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!ignore) {
          if (data.tickets) {
            setTickets(data.tickets || []);
            setTotal(data.total || 0);
            setTotalPages(data.totalPages || 1);
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          console.error("Error fetching tickets:", err);
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [projectId, page, selectedStatus, selectedCategory, selectedPriority, searchQuery]);

  const handleTicketCreated = (newTicket: any) => {
    fetchTickets();
    setSelectedTicketId(newTicket.id);
  };

  const handleTicketUpdated = (updatedTicket: any) => {
    fetchTickets();
  };

  const handleStatusFilterFromDashboard = (status: string) => {
    setSelectedStatus(status);
    setActiveSubView("tickets");
  };

  return (
    <div className="flex-1 flex flex-col p-6 space-y-6 overflow-y-auto max-w-7xl mx-auto w-full">
      {/* Top Bar / Navigation Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
              🎫
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                Ticket Management Desk
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isClient
                  ? "Track your submitted tickets, submit questions, and monitor resolutions."
                  : "Review, manage, approve, and convert client requests into project tasks."}
              </p>
            </div>
          </div>
        </div>

        {/* View Switcher & Action */}
        <div className="flex items-center gap-3">
          {canSeeDashboard && (
            <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200/80 dark:border-slate-700/60 text-xs">
              <button
                onClick={() => setActiveSubView("dashboard")}
                className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  activeSubView === "dashboard"
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Dashboard</span>
              </button>
              <button
                onClick={() => setActiveSubView("tickets")}
                className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  activeSubView === "tickets"
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <ListTodo className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>All Tickets</span>
              </button>
            </div>
          )}

          {canCreateTicket && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Raise Ticket</span>
            </button>
          )}
        </div>
      </div>

      {/* Main View Display */}
      {activeSubView === "dashboard" && canSeeDashboard ? (
        <TicketDashboard
          projectId={projectId}
          onSelectStatusFilter={handleStatusFilterFromDashboard}
          onSelectTicket={(tId) => setSelectedTicketId(tId)}
        />
      ) : (
        <TicketList
          tickets={tickets}
          total={total}
          page={page}
          totalPages={totalPages}
          loading={loading}
          searchQuery={searchQuery}
          selectedStatus={selectedStatus}
          selectedCategory={selectedCategory}
          selectedPriority={selectedPriority}
          onSearchChange={(q) => {
            setSearchQuery(q);
            setPage(1);
          }}
          onStatusChange={(s) => {
            setSelectedStatus(s);
            setPage(1);
          }}
          onCategoryChange={(c) => {
            setSelectedCategory(c);
            setPage(1);
          }}
          onPriorityChange={(p) => {
            setSelectedPriority(p);
            setPage(1);
          }}
          onPageChange={setPage}
          onSelectTicket={(tId) => setSelectedTicketId(tId)}
          onOpenCreateModal={() => setIsCreateModalOpen(true)}
          canCreateTicket={canCreateTicket}
        />
      )}

      {/* Modals */}
      <ClientTicketCreateModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        projectId={projectId}
        onTicketCreated={handleTicketCreated}
      />

      <TicketDetailModal
        ticketId={selectedTicketId}
        projectId={projectId}
        currentUser={currentUser}
        projectMembers={projectMembers}
        isOpen={!!selectedTicketId}
        onClose={() => setSelectedTicketId(null)}
        onTicketUpdated={handleTicketUpdated}
        onNavigateToIssue={onNavigateToIssue}
      />
    </div>
  );
}
