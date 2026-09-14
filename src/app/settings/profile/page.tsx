"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { formatLeaveRange } from "@/lib/leave-engine";

interface LeaveRecord {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  leaveType: string;
  status?: string;
  note?: string | null;
}

interface DelegationRecord {
  id: string;
  issueId: string;
  originalAssigneeId: string;
  delegateUserId: string;
  startDate: string;
  endDate: string;
  status: string;
  reason?: string | null;
  originalAssignee?: { id: string; firstName: string; lastName: string; email: string };
  delegateUser?: { id: string; firstName: string; lastName: string; email: string };
  issue?: { id: string; issueKey: string; title: string; projectId: string };
  history?: any[];
}

export default function ProfileSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    jobTitle: "",
    company: "",
    timezone: "UTC",
    language: "en",
  });
  
  const [initials, setInitials] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [orgId, setOrgId] = useState("");

  // Leave & Delegation State
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [delegations, setDelegations] = useState<DelegationRecord[]>([]);
  const [orgMembers, setOrgMembers] = useState<any[]>([]);
  const [myTasks, setMyTasks] = useState<any[]>([]);
  const [leavesLoading, setLeavesLoading] = useState(true);

  // Leave Modal State
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const [leaveSuccess, setLeaveSuccess] = useState("");

  const [leaveForm, setLeaveForm] = useState({
    startDate: "",
    endDate: "",
    leaveType: "Annual Leave",
    note: "",
    delegateWork: false,
    delegateUserId: "",
    delegationScope: "ALL_ELIGIBLE", // ALL_ELIGIBLE vs SELECTED_TASKS
    selectedTaskIds: [] as string[],
  });

  const fetchProfile = async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      if (data.user) {
        setFormData({
          firstName: data.user.firstName || "",
          lastName: data.user.lastName || "",
          jobTitle: data.user.jobTitle || "",
          company: data.user.company || "",
          timezone: data.user.timezone || "UTC",
          language: data.user.language || "en",
        });
        setInitials((data.user.firstName?.[0] || "") + (data.user.lastName?.[0] || ""));
        setCurrentUserId(data.user.id);
        const fetchedOrgId = data.user.organizations?.[0]?.id || data.user.organizations?.[0]?.organization?.id;
        if (fetchedOrgId) {
          setOrgId(fetchedOrgId);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchLeaves = async () => {
    setLeavesLoading(true);
    try {
      const res = await fetch("/api/users/leave");
      if (res.ok) {
        const data = await res.json();
        setLeaves(data.leaves || []);
      }
    } catch (e) {
      console.error("Failed to fetch leaves", e);
    } finally {
      setLeavesLoading(false);
    }
  };

  const fetchDelegations = async () => {
    try {
      const res = await fetch("/api/users/delegations?status=ALL");
      if (res.ok) {
        const data = await res.json();
        setDelegations(data.delegations || []);
      }
    } catch (e) {
      console.error("Failed to fetch delegations", e);
    }
  };

  const fetchOrgMembers = async () => {
    try {
      const res = await fetch("/api/users/leave"); // or org members endpoint
      if (res.ok) {
        const data = await res.json();
        // Extract unique users from leaves or fetch org members
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchProfile();
    fetchLeaves();
    fetchDelegations();
  }, []);

  useEffect(() => {
    if (!orgId) return;
    // Strictly fetch PBAC-verified organization members for the user's active tenant
    fetch(`/api/orgs/${orgId}/members`)
      .then((r) => {
        if (!r.ok) throw new Error("PBAC Access Denied");
        return r.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          setOrgMembers(data);
        }
      })
      .catch((err) => {
        console.error("PBAC Org Members Fetch Error:", err);
        setOrgMembers([]);
      });
  }, [orgId, showLeaveModal]);

  // Fetch my active assigned tasks when modal opens
  useEffect(() => {
    if (showLeaveModal && currentUserId) {
      fetch(`/api/users/my-tasks`)
        .then((r) => r.json())
        .then((data) => {
          setMyTasks(data.tasks || []);
        })
        .catch((err) => {
          console.error("Failed to fetch my tasks:", err);
          setMyTasks([]);
        });
    }
  }, [showLeaveModal, currentUserId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage({ type: "", text: "" });

    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Profile updated successfully." });
        setInitials(formData.firstName[0] + (formData.lastName?.[0] || ""));
        router.refresh();
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to update profile." });
      }
    } catch (error) {
      setMessage({ type: "error", text: "An unexpected error occurred." });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLeaveSubmitting(true);
    setLeaveError("");
    setLeaveSuccess("");

    if (!leaveForm.startDate || !leaveForm.endDate) {
      setLeaveError("Please select both start date and end date");
      setLeaveSubmitting(false);
      return;
    }

    if (new Date(leaveForm.startDate) > new Date(leaveForm.endDate)) {
      setLeaveError("Start date cannot be after end date");
      setLeaveSubmitting(false);
      return;
    }

    if (leaveForm.delegateWork && !leaveForm.delegateUserId) {
      setLeaveError("Please select a team member to delegate work to.");
      setLeaveSubmitting(false);
      return;
    }

    try {
      // 1. Create Leave Record
      const leaveRes = await fetch("/api/users/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: leaveForm.startDate,
          endDate: leaveForm.endDate,
          leaveType: leaveForm.leaveType,
          note: leaveForm.note,
        }),
      });

      const leaveData = await leaveRes.json();
      if (!leaveRes.ok) {
        setLeaveError(leaveData.error || "Failed to submit leave application.");
        setLeaveSubmitting(false);
        return;
      }

      // 2. If Delegate Work is checked, create Task Delegation
      if (leaveForm.delegateWork && leaveForm.delegateUserId) {
        const delRes = await fetch("/api/users/delegations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leaveId: leaveData.leave?.id,
            delegateUserId: leaveForm.delegateUserId,
            scope: leaveForm.delegationScope,
            issueIds: leaveForm.selectedTaskIds,
            startDate: leaveForm.startDate,
            endDate: leaveForm.endDate,
            reason: leaveForm.note || "Annual Leave Delegation",
          }),
        });

        const delData = await delRes.json();
        if (!delRes.ok) {
          setLeaveError(`Leave saved, but delegation failed: ${delData.error}`);
          fetchLeaves();
          fetchDelegations();
          setLeaveSubmitting(false);
          return;
        }
      }

      setLeaveSuccess("Leave application & work delegation submitted successfully.");
      setLeaveForm({
        startDate: "",
        endDate: "",
        leaveType: "Annual Leave",
        note: "",
        delegateWork: false,
        delegateUserId: "",
        delegationScope: "ALL_ELIGIBLE",
        selectedTaskIds: [],
      });
      setShowLeaveModal(false);
      fetchLeaves();
      fetchDelegations();
    } catch (err) {
      setLeaveError("An unexpected error occurred while saving leave.");
    } finally {
      setLeaveSubmitting(false);
    }
  };

  const handleCancelLeave = async (leaveId: string) => {
    if (!confirm("Are you sure you want to cancel this leave record? Any associated delegations will also be cancelled.")) return;

    try {
      const res = await fetch(`/api/users/leave/${leaveId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setLeaveSuccess("Leave record cancelled.");
        fetchLeaves();
        fetchDelegations();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to cancel leave");
      }
    } catch (err) {
      alert("Error cancelling leave");
    }
  };

  const handleEndDelegation = async (delegationId: string) => {
    if (!confirm("Are you sure you want to end this delegation and return the task to the original assignee?")) return;

    try {
      const res = await fetch(`/api/users/delegations/${delegationId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setLeaveSuccess("Delegation ended and task returned to original assignee.");
        fetchDelegations();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to end delegation");
      }
    } catch (err) {
      alert("Error ending delegation");
    }
  };

  const toggleTaskSelection = (taskId: string) => {
    setLeaveForm((prev) => {
      const exists = prev.selectedTaskIds.includes(taskId);
      return {
        ...prev,
        selectedTaskIds: exists
          ? prev.selectedTaskIds.filter((id) => id !== taskId)
          : [...prev.selectedTaskIds, taskId],
      };
    });
  };

  const now = new Date();
  const myLeaves = leaves.filter((l) => l.userId === currentUserId);
  const upcomingLeaves = myLeaves.filter(
    (l) => l.status !== "CANCELLED" && new Date(l.endDate) >= new Date(now.setHours(0, 0, 0, 0))
  );
  const historyLeaves = myLeaves.filter(
    (l) => l.status === "CANCELLED" || new Date(l.endDate) < new Date(now.setHours(0, 0, 0, 0))
  );

  const delegationsByMe = delegations.filter((d) => d.originalAssigneeId === currentUserId);
  const delegationsToMe = delegations.filter((d) => d.delegateUserId === currentUserId);

  if (loading) {
    return <div className="p-8">Loading profile...</div>;
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Profile, Leave & Task Delegation</h1>
        <p className="text-sm text-slate-500">Manage your personal details, leave schedule, and temporary task delegations across Eitekh WorkOS.</p>
      </div>

      {message.text && (
        <div className={`p-4 rounded-lg text-sm ${message.type === "success" ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
          {message.text}
        </div>
      )}

      {/* Profile Picture Card */}
      <div className="flex items-center gap-6 p-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 shadow-sm">
        <div className="w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-300 font-bold text-2xl tracking-widest uppercase">
          {initials || "U"}
        </div>
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white mb-1">Profile Picture</h3>
          <p className="text-sm text-slate-500 mb-3">Avatar uploads are coming soon. Using initials for now.</p>
        </div>
      </div>

      {/* Personal Info Form */}
      <form onSubmit={handleSubmit} className="space-y-6 bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-300 dark:border-slate-800 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-3">Personal Details</h2>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">First Name</label>
            <input
              type="text"
              name="firstName"
              value={formData.firstName}
              onChange={handleChange}
              required
              className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Last Name</label>
            <input
              type="text"
              name="lastName"
              value={formData.lastName}
              onChange={handleChange}
              required
              className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Job Title</label>
            <input
              type="text"
              name="jobTitle"
              value={formData.jobTitle}
              onChange={handleChange}
              className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Company</label>
            <input
              type="text"
              name="company"
              value={formData.company}
              onChange={handleChange}
              className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Timezone</label>
            <select
              name="timezone"
              value={formData.timezone}
              onChange={handleChange}
              className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="UTC">UTC (Universal Coordinated Time)</option>
              <option value="America/New_York">Eastern Time (ET)</option>
              <option value="America/Chicago">Central Time (CT)</option>
              <option value="America/Denver">Mountain Time (MT)</option>
              <option value="America/Los_Angeles">Pacific Time (PT)</option>
              <option value="Europe/London">London (GMT/BST)</option>
              <option value="Europe/Paris">Paris (CET/CEST)</option>
              <option value="Asia/Tokyo">Tokyo (JST)</option>
              <option value="Asia/Kolkata">India (IST)</option>
              <option value="Australia/Sydney">Sydney (AEST/AEDT)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Language</label>
            <select
              name="language"
              value={formData.language}
              onChange={handleChange}
              className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="ja">Japanese</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-slate-300 dark:border-slate-800">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>

      {/* Leave & Availability Management Section */}
      <div className="space-y-6 bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-300 dark:border-slate-800 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">My Leave & Availability</h2>
            <p className="text-xs text-slate-500 mt-0.5">When you schedule leave, team members will see non-blocking availability warnings and optional task delegations.</p>
          </div>
          <button
            onClick={() => {
              setLeaveError("");
              setLeaveSuccess("");
              setShowLeaveModal(true);
            }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
          >
            <span>+</span> Apply for Leave & Delegate Work
          </button>
        </div>

        {leaveSuccess && (
          <div className="p-3 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-lg text-sm font-medium">
            {leaveSuccess}
          </div>
        )}

        {/* Upcoming Leave */}
        <div>
          <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Upcoming & Current Leave</h3>
          {leavesLoading ? (
            <div className="text-sm text-slate-500 py-4">Loading leave records...</div>
          ) : upcomingLeaves.length === 0 ? (
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-sm text-slate-500 text-center border border-dashed border-slate-200 dark:border-slate-700">
              No upcoming leave scheduled. You are currently Available.
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingLeaves.map((l) => (
                <div key={l.id} className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
                      <span className="font-semibold text-slate-900 dark:text-white text-sm">
                        {formatLeaveRange(l.startDate, l.endDate)}
                      </span>
                      <span className="px-2 py-0.5 text-xs rounded-md bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200 font-medium">
                        {l.leaveType}
                      </span>
                    </div>
                    {l.note && <p className="text-xs text-slate-600 dark:text-slate-400 pl-4">{l.note}</p>}
                  </div>
                  <button
                    onClick={() => handleCancelLeave(l.id)}
                    className="px-3 py-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md transition-colors border border-red-200 dark:border-red-900/50"
                  >
                    Cancel Leave
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Leave History (Past & Cancelled Leave Records) */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">Leave History ({historyLeaves.length})</h3>
          {historyLeaves.length === 0 ? (
            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg text-xs text-slate-400 text-center border border-slate-200 dark:border-slate-800">
              No past or cancelled leave records.
            </div>
          ) : (
            <div className="space-y-2">
              {historyLeaves.map((l) => (
                <div key={l.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between text-xs">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {formatLeaveRange(l.startDate, l.endDate)}
                      </span>
                      <span className="px-2 py-0.5 text-[10px] rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium">
                        {l.leaveType}
                      </span>
                      {l.status === 'CANCELLED' ? (
                        <span className="px-2 py-0.5 text-[10px] rounded bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 uppercase font-bold border border-red-200 dark:border-red-900/50">
                          CANCELLED
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] rounded bg-slate-100 dark:bg-slate-800 text-slate-500 uppercase font-bold">
                          COMPLETED
                        </span>
                      )}
                    </div>
                    {l.note && <p className="text-[11px] text-slate-500">{l.note}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Task Delegations Section */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Task Delegations</h2>
          
          <div className="grid grid-cols-2 gap-4">
            {/* Delegated By Me */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700/60 pb-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Delegated By Me ({delegationsByMe.length})</span>
              </div>
              {delegationsByMe.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-2">No active or past task delegations created.</p>
              ) : (
                <div className="space-y-2">
                  {delegationsByMe.map((d) => (
                    <div key={d.id} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs flex items-center justify-between">
                      <div className="space-y-0.5 max-w-[70%]">
                        <div className="font-semibold text-slate-900 dark:text-white truncate">
                          {d.issue?.issueKey}: {d.issue?.title}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Delegated to: <strong>{d.delegateUser?.firstName} {d.delegateUser?.lastName}</strong>
                        </div>
                        <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium">
                          {formatLeaveRange(d.startDate, d.endDate)} · <span className={`uppercase font-bold ${d.status === 'ACTIVE' ? 'text-green-600' : 'text-slate-400'}`}>{d.status}</span>
                        </div>
                      </div>
                      {d.status === 'ACTIVE' && (
                        <button
                          onClick={() => handleEndDelegation(d.id)}
                          className="px-2 py-1 text-[11px] text-amber-600 hover:text-amber-700 border border-amber-200 dark:border-amber-800 rounded hover:bg-amber-50 dark:hover:bg-amber-950/30 font-medium"
                        >
                          End Early
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Delegated To Me */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700/60 pb-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Delegated To Me ({delegationsToMe.length})</span>
              </div>
              {delegationsToMe.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-2">No tasks currently delegated to you.</p>
              ) : (
                <div className="space-y-2">
                  {delegationsToMe.map((d) => (
                    <div key={d.id} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-900 dark:text-white truncate">
                          {d.issue?.issueKey}: {d.issue?.title}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Original Assignee: <strong>{d.originalAssignee?.firstName} {d.originalAssignee?.lastName}</strong>
                        </div>
                        <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium">
                          Period: {formatLeaveRange(d.startDate, d.endDate)} · <span className={`uppercase font-bold ${d.status === 'ACTIVE' ? 'text-green-600' : 'text-slate-400'}`}>{d.status}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Apply for Leave & Delegate Work Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 shadow-xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Apply for Leave & Delegate Work</h3>
              <button
                onClick={() => setShowLeaveModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-semibold"
              >
                ×
              </button>
            </div>

            {leaveError && (
              <div className="p-3 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-lg text-xs font-medium">
                {leaveError}
              </div>
            )}

            <form onSubmit={handleCreateLeave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Start Date *</label>
                  <input
                    type="date"
                    required
                    value={leaveForm.startDate}
                    onChange={(e) => setLeaveForm((prev) => ({ ...prev, startDate: e.target.value }))}
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">End Date *</label>
                  <input
                    type="date"
                    required
                    value={leaveForm.endDate}
                    onChange={(e) => setLeaveForm((prev) => ({ ...prev, endDate: e.target.value }))}
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Leave Type</label>
                <select
                  value={leaveForm.leaveType}
                  onChange={(e) => setLeaveForm((prev) => ({ ...prev, leaveType: e.target.value }))}
                  className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="Annual Leave">Annual Leave</option>
                  <option value="Sick Leave">Sick Leave</option>
                  <option value="Personal">Personal Leave</option>
                  <option value="Parental">Parental Leave</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Reason / Note (Optional)</label>
                <textarea
                  rows={2}
                  value={leaveForm.note}
                  onChange={(e) => setLeaveForm((prev) => ({ ...prev, note: e.target.value }))}
                  placeholder="e.g. Vacation, Family event..."
                  className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                />
              </div>

              {/* Delegate Work Section */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="delegateWork"
                    checked={leaveForm.delegateWork}
                    onChange={(e) => setLeaveForm((prev) => ({ ...prev, delegateWork: e.target.checked }))}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700"
                  />
                  <label htmlFor="delegateWork" className="text-xs font-bold text-slate-900 dark:text-white cursor-pointer select-none">
                    ☑ Delegate my active work during leave
                  </label>
                </div>

                {leaveForm.delegateWork && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3 animate-in fade-in duration-150">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Delegate to (Team Member) *</label>
                      <select
                        value={leaveForm.delegateUserId}
                        onChange={(e) => setLeaveForm((prev) => ({ ...prev, delegateUserId: e.target.value }))}
                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                      >
                        <option value="">Select a team member...</option>
                        {orgMembers.map((m: any) => {
                          const u = m.user || m;
                          if (u.id === currentUserId) return null;
                          return (
                            <option key={u.id} value={u.id}>
                              {u.firstName} {u.lastName} ({u.email})
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowLeaveModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={leaveSubmitting}
                  className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {leaveSubmitting ? "Submitting..." : "Confirm & Save Leave"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
