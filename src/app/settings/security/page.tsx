"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Shield, Smartphone, Key, Monitor, Trash2, CheckCircle2, Loader2, AlertCircle } from "lucide-react";

interface Session {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  os: string | null;
  browser: string | null;
  location: string | null;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export default function SecuritySettingsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [mfaLoading, setMfaLoading] = useState(false);
  
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    fetchSessions();
    // Assuming we don't have an endpoint just for user's MFA status on this page mount right now.
    // If the user was passed in via props or context, we could set mfaEnabled initially.
  }, []);

  const fetchSessions = async () => {
    setLoadingSessions(true);
    try {
      const res = await fetch("/api/auth/sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (error) {
      console.error("Failed to fetch sessions", error);
    } finally {
      setLoadingSessions(false);
    }
  };

  const checkPasswordStrength = (password: string) => {
    if (!password) return { text: "", color: "bg-transparent", score: 0 };
    
    let score = 0;
    if (password.length >= 8) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[a-z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score += 1;

    if (score < 3) return { text: "Weak", color: "bg-red-500", width: "w-1/3", score };
    if (score < 5) return { text: "Medium", color: "bg-yellow-500", width: "w-2/3", score };
    return { text: "Strong", color: "bg-emerald-500", width: "w-full", score };
  };

  const strength = checkPasswordStrength(newPassword);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordStatus(null);
    
    if (newPassword !== confirmPassword) {
      setPasswordStatus({ type: "error", message: "New password and confirm password do not match." });
      return;
    }

    if (strength.score < 5) {
      setPasswordStatus({ type: "error", message: "Password is not strong enough. Please include uppercase, lowercase, numbers, and special characters." });
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setPasswordStatus({ type: "success", message: "Password updated successfully." });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setPasswordStatus({ type: "error", message: data.error || "Failed to update password." });
      }
    } catch (error) {
      setPasswordStatus({ type: "error", message: "An unexpected error occurred." });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleToggleMFA = async () => {
    setMfaLoading(true);
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !mfaEnabled }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setMfaEnabled(data.mfaEnabled);
        if (data.mfaEnabled && data.recoveryCodes) {
          setRecoveryCodes(data.recoveryCodes);
        } else {
          setRecoveryCodes([]);
        }
      }
    } catch (error) {
      console.error("Failed to toggle MFA", error);
    } finally {
      setMfaLoading(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      const res = await fetch("/api/auth/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (res.ok) {
        setSessions(sessions.filter((s) => s.id !== sessionId));
      }
    } catch (error) {
      console.error("Failed to revoke session", error);
    }
  };

  const handleRevokeAll = async () => {
    try {
      const res = await fetch("/api/auth/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revokeAll: true }),
      });
      if (res.ok) {
        setSessions(sessions.filter((s) => s.isCurrent));
      }
    } catch (error) {
      console.error("Failed to revoke all sessions", error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-slate-500"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold">Account Security & Sessions</h1>
            <p className="text-xs text-slate-500">Manage your active devices, password, and two-factor authentication</p>
          </div>
        </div>

        {/* Change Password Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-bold">Change Password</h2>
          </div>

          {passwordStatus && (
            <div className={`p-3 rounded-lg text-xs font-semibold flex items-center gap-2 border ${
              passwordStatus.type === "success" 
                ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800"
                : "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800"
            }`}>
              {passwordStatus.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {passwordStatus.message}
            </div>
          )}

          <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Current Password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">New Password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none mb-2"
              />
              {newPassword && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full ${strength.width} ${strength.color} transition-all duration-300`}></div>
                  </div>
                  <p className={`text-[10px] font-medium ${
                    strength.text === "Weak" ? "text-red-500" :
                    strength.text === "Medium" ? "text-yellow-500" : "text-emerald-500"
                  }`}>
                    Strength: {strength.text}
                  </p>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Confirm New Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full text-xs p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={passwordLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {passwordLoading && <Loader2 className="w-3 h-3 animate-spin" />}
              Update Password
            </button>
          </form>
        </div>

        {/* Two-Factor Authentication Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-600" />
              <div>
                <h2 className="text-sm font-bold">Two-Factor Authentication (MFA)</h2>
                <p className="text-xs text-slate-500">Secure your account using an authenticator app (TOTP)</p>
              </div>
            </div>

            <button
              onClick={handleToggleMFA}
              disabled={mfaLoading}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 disabled:opacity-50 ${
                mfaEnabled ? "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100" : "bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
            >
              {mfaLoading && <Loader2 className="w-3 h-3 animate-spin" />}
              {mfaEnabled ? "Disable MFA" : "Enable MFA"}
            </button>
          </div>

          {mfaEnabled && recoveryCodes.length > 0 && (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg border border-emerald-200 dark:border-emerald-800 text-xs space-y-3">
              <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-bold">
                <CheckCircle2 className="w-4 h-4" />
                <span>Authenticator App Active</span>
              </div>
              <div>
                <p className="text-slate-600 dark:text-slate-300 font-medium mb-2">Emergency Backup Codes:</p>
                <p className="text-slate-500 text-[11px] mb-3">Save these codes in a secure place. They can be used to recover your account if you lose access to your authenticator app.</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {recoveryCodes.map((code, idx) => (
                    <code key={idx} className="font-mono bg-white dark:bg-slate-900 px-2 py-1 border border-emerald-100 dark:border-emerald-900 rounded text-center">
                      {code}
                    </code>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Active Sessions Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-blue-600" />
              <div>
                <h2 className="text-sm font-bold">Active Sessions</h2>
                <p className="text-xs text-slate-500">Devices currently logged into your account</p>
              </div>
            </div>
            {sessions.length > 1 && (
              <button
                onClick={handleRevokeAll}
                className="text-xs text-red-600 hover:underline font-semibold"
              >
                Log out of all other sessions
              </button>
            )}
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {loadingSessions ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
              </div>
            ) : sessions.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-500">No active sessions found.</div>
            ) : (
              sessions.map((s) => (
                <div key={s.id} className="py-3 flex items-center justify-between text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {s.browser || "Unknown Browser"} on {s.os || s.userAgent || "Unknown Device"}
                      </span>
                      {s.isCurrent && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 font-semibold">
                          Current Session
                        </span>
                      )}
                    </div>
                    <p className="text-slate-400 text-[11px] mt-0.5">
                      {s.ipAddress || "Unknown IP"} · {s.location || "Unknown Location"} · Active {formatDate(s.lastActiveAt)}
                    </p>
                  </div>
                  {!s.isCurrent && (
                    <button
                      onClick={() => handleRevokeSession(s.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg transition-colors"
                      title="Revoke session"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
