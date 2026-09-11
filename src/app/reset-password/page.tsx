"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Lock, ArrowLeft, CheckCircle2, AlertCircle, Eye, EyeOff, Check, X } from "lucide-react";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live password validation checklist
  const hasMinLength = newPassword.length >= 8;
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasLower = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  const isStrong = hasMinLength && hasUpper && hasLower && hasNumber && hasSpecial;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("Missing or invalid password reset token. Please request a new link.");
      return;
    }

    if (!isStrong) {
      setError("Please ensure your new password satisfies all strength requirements below.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to reset password");
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  if (!token && !success) {
    return (
      <div className="text-center py-4 space-y-4">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 mb-1">
          <AlertCircle className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Invalid Reset Link</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          This password reset link is missing a valid security token or has already expired. Please request a new link.
        </p>
        <div className="pt-2">
          <Link
            href="/forgot-password"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
          >
            Request New Reset Link
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="text-center py-4 space-y-4">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 mb-1">
          <CheckCircle2 className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Password Updated!</h3>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          Your password has been securely reset and all existing active sessions have been revoked. You can now sign in with your new credentials.
        </p>
        <div className="pt-3">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm shadow-blue-500/20 transition-all"
          >
            Sign In to Workspace →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-lg flex items-center gap-2.5 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div>
        <label
          htmlFor="newPassword"
          className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
        >
          New Password
        </label>
        <div className="relative">
          <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            id="newPassword"
            type={showPassword ? "text" : "password"}
            required
            aria-required="true"
            placeholder="••••••••"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full text-xs pl-9 pr-10 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {/* Dynamic Password Requirements Checklist */}
        {newPassword.length > 0 && (
          <div className="mt-2.5 p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-300 dark:border-slate-700/60 space-y-1.5 text-[11px]">
            <p className="font-semibold text-slate-600 dark:text-slate-400">Password requirements:</p>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              <div className={`flex items-center gap-1.5 ${hasMinLength ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}>
                {hasMinLength ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                <span>8+ characters</span>
              </div>
              <div className={`flex items-center gap-1.5 ${hasUpper ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}>
                {hasUpper ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                <span>Uppercase letter</span>
              </div>
              <div className={`flex items-center gap-1.5 ${hasLower ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}>
                {hasLower ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                <span>Lowercase letter</span>
              </div>
              <div className={`flex items-center gap-1.5 ${hasNumber ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}>
                {hasNumber ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                <span>At least 1 number</span>
              </div>
              <div className={`flex items-center gap-1.5 col-span-2 ${hasSpecial ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}>
                {hasSpecial ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                <span>Special character (!@#$%^&*)</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div>
        <label
          htmlFor="confirmPassword"
          className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
        >
          Confirm New Password
        </label>
        <div className="relative">
          <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            id="confirmPassword"
            type={showPassword ? "text" : "password"}
            required
            aria-required="true"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full text-xs pl-9 pr-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
          />
        </div>
        {confirmPassword.length > 0 && (
          <p className={`text-[11px] mt-1 flex items-center gap-1 ${passwordsMatch ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}`}>
            {passwordsMatch ? (
              <>
                <Check className="w-3 h-3" />
                <span>Passwords match</span>
              </>
            ) : (
              <>
                <X className="w-3 h-3" />
                <span>Passwords do not match</span>
              </>
            )}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={loading || (newPassword.length > 0 && (!isStrong || !passwordsMatch))}
        className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg shadow-sm shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
      >
        <span>{loading ? "Resetting password..." : "Set New Password"}</span>
      </button>

      <div className="pt-2 text-center border-t border-slate-300 dark:border-slate-800">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Cancel and return to sign in
        </Link>
      </div>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Top Back Navigation */}
        <div className="flex items-center justify-between">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer px-2.5 py-1.5 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Login</span>
          </Link>
        </div>

        {/* Brand and Header */}
        <div className="text-center space-y-2">
          <img src="/leaf-logo.png" alt="Eitekh WorkOS" className="w-14 h-14 mx-auto object-contain drop-shadow-md" />
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Create new password
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Choose a strong password to secure your Eitekh WorkOS account
          </p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-300 dark:border-slate-800 shadow-xl space-y-6">
          <Suspense fallback={<div className="text-center text-slate-400 text-xs py-8">Loading reset form...</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

