"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Building, Globe, Clock, Users, UserPlus } from "lucide-react";
import { Skeleton } from "@/components/common/Skeleton";

export default function OrganizationSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [org, setOrg] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [role, setRole] = useState("MEMBER");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteSuccessMsg, setInviteSuccessMsg] = useState<string | null>(null);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    role: "MEMBER",
  });

  const [formData, setFormData] = useState({
    name: "",
    domain: "",
    timezone: "UTC",
    dateFormat: "YYYY-MM-DD",
    workingHoursStart: "09:00",
    workingHoursEnd: "17:00",
  });

  const [workingDays, setWorkingDays] = useState<number[]>([]);

  const fetchOrgData = async (orgId: string) => {
    try {
      const res = await fetch(`/api/orgs/${orgId}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(Array.isArray(data) ? data : (data.members || []));
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then(async (data) => {
        if (data.user && data.user.organizations?.length > 0) {
          const currentOrg = data.user.organizations[0];
          setOrg(currentOrg);
          setRole(currentOrg.role || (data.user.isSuperAdmin ? "OWNER" : "MEMBER"));

          setFormData({
            name: currentOrg.name || "",
            domain: currentOrg.domain || "",
            timezone: currentOrg.timezone || "UTC",
            dateFormat: currentOrg.dateFormat || "YYYY-MM-DD",
            workingHoursStart: currentOrg.workingHours?.split("-")[0] || "09:00",
            workingHoursEnd: currentOrg.workingHours?.split("-")[1] || "17:00",
          });

          setWorkingDays(
            currentOrg.workingDays
              ? currentOrg.workingDays.split(",").map(Number)
              : [1, 2, 3, 4, 5]
          );

          fetchOrgData(currentOrg.id);
        } else if (data.user?.isSuperAdmin) {
          try {
            const orgsRes = await fetch("/api/super-admin/orgs");
            if (orgsRes.ok) {
              const orgsData = await orgsRes.json();
              const orgs = orgsData.organizations || orgsData;
              if (Array.isArray(orgs) && orgs.length > 0) {
                const firstOrg = orgs[0];
                setOrg(firstOrg);
                setRole("OWNER");
                setFormData({
                  name: firstOrg.name || "",
                  domain: firstOrg.domain || "",
                  timezone: firstOrg.timezone || "UTC",
                  dateFormat: firstOrg.dateFormat || "YYYY-MM-DD",
                  workingHoursStart: firstOrg.workingHours?.split("-")[0] || "09:00",
                  workingHoursEnd: firstOrg.workingHours?.split("-")[1] || "17:00",
                });
                setWorkingDays(
                  firstOrg.workingDays
                    ? firstOrg.workingDays.split(",").map(Number)
                    : [1, 2, 3, 4, 5]
                );
                fetchOrgData(firstOrg.id);
              }
            }
          } catch (e) {
            console.error("Failed to fetch orgs for super admin:", e);
          }
        }
        setLoading(false);
      });
  }, []);

  const isAdmin = role === "OWNER" || role === "ADMIN";

  const handleDayToggle = (day: number) => {
    setWorkingDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    setSaving(true);
    setMessage({ type: "", text: "" });

    try {
      const res = await fetch(`/api/orgs/${org.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          domain: formData.domain,
          timezone: formData.timezone,
          dateFormat: formData.dateFormat,
          workingDays: workingDays.join(","),
          workingHours: `${formData.workingHoursStart}-${formData.workingHoursEnd}`,
        }),
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Organization settings updated." });
        router.refresh();
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to update settings." });
      }
    } catch (error) {
      setMessage({ type: "error", text: "An unexpected error occurred." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <Skeleton className="h-7 w-48" />
        <div className="space-y-4 p-6 border border-slate-200 dark:border-slate-800 rounded-xl">
          <Skeleton className="h-5 w-32 mb-4" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
          ))}
        </div>
        <div className="space-y-3 p-6 border border-slate-200 dark:border-slate-800 rounded-xl">
          <Skeleton className="h-5 w-32 mb-4" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="w-8 h-8 rounded-full" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!org) {
    return <div className="p-8">No organization found.</div>;
  }

  const daysOfWeek = [
    { id: 1, label: "Mon" },
    { id: 2, label: "Tue" },
    { id: 3, label: "Wed" },
    { id: 4, label: "Thu" },
    { id: 5, label: "Fri" },
    { id: 6, label: "Sat" },
    { id: 7, label: "Sun" },
  ];

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Organization Settings</h1>
        <p className="text-sm text-slate-500">Manage your organization's details, work schedule, and members.</p>
      </div>

      {!isAdmin && (
        <div className="p-4 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-lg text-sm">
          You must be an Owner or Admin to edit these settings.
        </div>
      )}

      {message.text && (
        <div className={`p-4 rounded-lg text-sm ${message.type === "success" ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* General Details */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-300 dark:border-slate-800 shadow-sm space-y-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 border-b border-slate-300 dark:border-slate-800 pb-4">
            <Building className="w-5 h-5 text-slate-400" />
            General Details
          </h2>
          
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" htmlFor="page-name">Organization Name</label>
              <input id="page-name"
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                disabled={!isAdmin}
                required
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" htmlFor="page-domain">Allowed Domain</label>
              <input id="page-domain"
                type="text"
                name="domain"
                value={formData.domain}
                onChange={handleChange}
                disabled={!isAdmin}
                placeholder="e.g. yourcompany.com"
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        {/* Work Schedule */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-300 dark:border-slate-800 shadow-sm space-y-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 border-b border-slate-300 dark:border-slate-800 pb-4">
            <Clock className="w-5 h-5 text-slate-400" />
            Work Schedule & Localization
          </h2>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" htmlFor="page-timezone">Timezone</label>
              <select id="page-timezone"
                name="timezone"
                value={formData.timezone}
                onChange={handleChange}
                disabled={!isAdmin}
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
              >
                <option value="UTC">UTC</option>
                <option value="America/New_York">Eastern Time (ET)</option>
                <option value="America/Chicago">Central Time (CT)</option>
                <option value="America/Los_Angeles">Pacific Time (PT)</option>
                <option value="Europe/London">London (GMT)</option>
                <option value="Asia/Tokyo">Tokyo (JST)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" htmlFor="page-dateFormat">Date Format</label>
              <select id="page-dateFormat"
                name="dateFormat"
                value={formData.dateFormat}
                onChange={handleChange}
                disabled={!isAdmin}
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
              >
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Working Days</label>
            <div className="flex flex-wrap gap-3">
              {daysOfWeek.map((day) => (
                <label key={day.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={workingDays.includes(day.id)}
                    onChange={() => handleDayToggle(day.id)}
                    disabled={!isAdmin}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  {day.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" htmlFor="page-workingHoursStart">Start Time</label>
              <input id="page-workingHoursStart"
                type="time"
                name="workingHoursStart"
                value={formData.workingHoursStart}
                onChange={handleChange}
                disabled={!isAdmin}
                className="p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent outline-none disabled:opacity-50"
              />
            </div>
            <div className="pb-3 text-slate-500">to</div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1" htmlFor="page-workingHoursEnd">End Time</label>
              <input id="page-workingHoursEnd"
                type="time"
                name="workingHoursEnd"
                value={formData.workingHoursEnd}
                onChange={handleChange}
                disabled={!isAdmin}
                className="p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent outline-none disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
          </div>
        )}
      </form>

      {/* Members Section */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-300 dark:border-slate-800 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-slate-300 dark:border-slate-800 pb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="w-5 h-5 text-slate-400" />
            Members ({members.length})
          </h2>
          {isAdmin && (
            <button
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              Invite Member
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-300 dark:border-slate-800">
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase">User</th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Role</th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase">Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member: any) => (
                <tr key={member.id} className="border-b border-slate-300 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-3 px-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 flex items-center justify-center font-bold text-xs uppercase">
                      {member.user?.firstName?.[0] || "U"}
                    </div>
                    <div>
                      <div className="font-medium text-sm text-slate-900 dark:text-white">
                        {member.user?.firstName} {member.user?.lastName}
                      </div>
                      <div className="text-xs text-slate-500">{member.user?.email}</div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-sm">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      member.role === "OWNER" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" :
                      member.role === "ADMIN" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    }`}>
                      {member.role}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-500">
                    {new Date(member.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="font-bold text-lg text-slate-900 dark:text-white">Invite Team Member</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Invite a new or existing user to join {org?.name}. An invitation email will be dispatched from cocofbd@gmail.com.
            </p>

            {inviteSuccessMsg ? (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-300">
                {inviteSuccessMsg}
              </div>
            ) : null}

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setInviting(true);
                setInviteSuccessMsg(null);
                try {
                  const res = await fetch(`/api/orgs/${org.id}/members`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(inviteForm),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    alert(data.error || "Failed to invite member");
                    return;
                  }
                  setInviteSuccessMsg(data.message || `Member ${inviteForm.email} added successfully!`);
                  fetchOrgData(org.id);
                  setInviteForm({ email: "", firstName: "", lastName: "", role: "MEMBER" });
                  setTimeout(() => {
                    setShowInviteModal(false);
                    setInviteSuccessMsg(null);
                  }, 1500);
                } catch (err: any) {
                  alert(err.message);
                } finally {
                  setInviting(false);
                }
              }}
              className="space-y-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1" htmlFor="page-first-name">First Name</label>
                  <input id="page-first-name"
                    type="text"
                    value={inviteForm.firstName}
                    onChange={(e) => setInviteForm({ ...inviteForm, firstName: e.target.value })}
                    placeholder="e.g. John"
                    className="w-full p-2.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1" htmlFor="page-last-name">Last Name</label>
                  <input id="page-last-name"
                    type="text"
                    value={inviteForm.lastName}
                    onChange={(e) => setInviteForm({ ...inviteForm, lastName: e.target.value })}
                    placeholder="e.g. Doe"
                    className="w-full p-2.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1" htmlFor="page-email-address">Email Address *</label>
                <input id="page-email-address"
                  type="email"
                  required
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  placeholder="colleague@example.com"
                  className="w-full p-2.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1" htmlFor="page-organization-role">Organization Role</label>
                <select id="page-organization-role"
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                  className="w-full p-2.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 outline-none focus:border-blue-500"
                >
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                  <option value="PROJECT_MANAGER">Project Manager</option>
                  <option value="QA_ENGINEER">QA Engineer</option>
                  <option value="VIEWER">Viewer</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-300 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {inviting ? "Sending..." : "Send Invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
