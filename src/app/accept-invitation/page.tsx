"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Lock, User, Eye, EyeOff, Check, X, CheckCircle2, AlertCircle, Loader2, ArrowRight } from "lucide-react";

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [inviteData, setInviteData] = useState<{
    email: string;
    organizationName: string;
    role: string;
  } | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const hasMinLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const isStrong = hasMinLength && hasUpper && hasLower && hasNumber && hasSpecial;
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  useEffect(() => {
    if (!token) {
      setError("Missing invitation token.");
      setLoading(false);
      return;
    }

    const validate = async () => {
      try {
        const res = await fetch(`/api/auth/invitation?token=${token}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Invalid invitation");
        setInviteData(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    validate();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isStrong) { setError("Please meet all password requirements."); return; }
    if (!passwordsMatch) { setError("Passwords do not match."); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, firstName, lastName, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to accept invitation");
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8 space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto" />
        <p className="text-sm text-slate-500 dark:text-slate-400">Validating invitation...</p>
      </div>
    );
  }

  if (error && !inviteData) {
    return (
      <div className="text-center py-6 space-y-4">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400">
          <AlertCircle className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Invalid Invitation</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">{error}</p>
        <Link href="/login" className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold">
          Go to Login
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="text-center py-6 space-y-4">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Account Activated!</h3>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          You&apos;ve joined <strong>{inviteData?.organizationName}</strong>. Sign in to get started.
        </p>
        <Link href="/login" className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm">
          Sign In <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 rounded-lg text-xs text-blue-700 dark:text-blue-300 text-center">
        You&apos;re joining <strong>{inviteData?.organizationName}</strong> as <strong>{inviteData?.role}</strong>
      </div>

      <div className="text-xs text-slate-500 dark:text-slate-400 text-center">
        Email: <strong className="text-slate-700 dark:text-slate-300">{inviteData?.email}</strong>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-lg text-xs text-red-600">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="firstName" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">First Name</label>
          <input id="firstName" type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane"
            className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label htmlFor="lastName" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Last Name</label>
          <input id="lastName" type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe"
            className="w-full text-xs px-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div>
        <label htmlFor="password" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Create Password</label>
        <div className="relative">
          <Lock className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-3" />
          <input id="password" type={showPassword ? "text" : "password"} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
            className="w-full text-xs pl-9 pr-10 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {password.length > 0 && (
          <div className="mt-2 p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-300 dark:border-slate-700/60 space-y-1 text-[11px]">
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              {[
                { ok: hasMinLength, label: "8+ characters" },
                { ok: hasUpper, label: "Uppercase letter" },
                { ok: hasLower, label: "Lowercase letter" },
                { ok: hasNumber, label: "At least 1 number" },
              ].map(({ ok, label }) => (
                <div key={label} className={`flex items-center gap-1.5 ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"}`}>
                  {ok ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                  <span>{label}</span>
                </div>
              ))}
              <div className={`flex items-center gap-1.5 col-span-2 ${hasSpecial ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"}`}>
                {hasSpecial ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                <span>Special character</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Confirm Password</label>
        <div className="relative">
          <Lock className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-3" />
          <input id="confirmPassword" type={showPassword ? "text" : "password"} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat password"
            className="w-full text-xs pl-9 pr-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
        </div>
        {confirmPassword.length > 0 && (
          <p className={`text-[11px] mt-1 flex items-center gap-1 ${passwordsMatch ? "text-emerald-600" : "text-rose-500"}`}>
            {passwordsMatch ? <><Check className="w-3 h-3" /><span>Passwords match</span></> : <><X className="w-3 h-3" /><span>Passwords do not match</span></>}
          </p>
        )}
      </div>

      <button type="submit" disabled={submitting || !isStrong || !passwordsMatch}
        className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg shadow-sm shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50">
        <span>{submitting ? "Setting up account..." : "Accept Invitation & Create Account"}</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </form>
  );
}

export default function AcceptInvitationPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <img src="/leaf-logo.png" alt="Eitekh WorkOS" className="w-14 h-14 mx-auto object-contain drop-shadow-md" />
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Accept Invitation
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Set up your Eitekh WorkOS account
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-300 dark:border-slate-800 shadow-xl">
          <Suspense fallback={<div className="text-center text-slate-500 dark:text-slate-400 text-xs py-8">Loading...</div>}>
            <AcceptInvitationContent />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
