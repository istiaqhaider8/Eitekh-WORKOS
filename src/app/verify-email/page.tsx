"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, AlertCircle, Loader2, ArrowRight, ArrowLeft } from "lucide-react";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("No verification token found in URL");
      setLoading(false);
      return;
    }

    const verify = async () => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to verify email");
        }

        setSuccess(true);
      } catch (err: any) {
        setError(err.message || "Verification failed");
      } finally {
        setLoading(false);
      }
    };

    verify();
  }, [token]);

  if (loading) {
    return (
      <div className="text-center py-8 space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto" />
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Verifying your email...</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">Please wait while we confirm your email address.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-6 space-y-4">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-rose-500/10 text-rose-500 dark:text-rose-400 mb-2">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Verification Failed</h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-sm mx-auto">{error}</p>
        <div className="pt-4">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-sm font-semibold transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Login</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center py-6 space-y-4">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-2">
        <CheckCircle2 className="w-6 h-6" />
      </div>
      <h3 className="text-lg font-bold text-slate-900 dark:text-white">Email Verified!</h3>
      <p className="text-sm text-slate-600 dark:text-slate-400 max-w-sm mx-auto">
        Your email has been successfully confirmed. You can now access your Eitekh WorkOS workspace.
      </p>
      <div className="pt-4">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-lg shadow-blue-500/20"
        >
          <span>Continue to Login</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
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

        <div className="text-center space-y-2">
          <img src="/leaf-logo.png" alt="Eitekh WorkOS" className="w-14 h-14 mx-auto object-contain drop-shadow-md" />
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Account Verification
          </h1>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-2xl p-6 md:p-8 shadow-xl">
          <Suspense fallback={<div className="text-center text-slate-400 text-sm py-8">Loading verification...</div>}>
            <VerifyEmailContent />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
