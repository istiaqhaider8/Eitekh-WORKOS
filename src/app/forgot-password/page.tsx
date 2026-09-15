"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, ArrowLeft, ArrowRight, ShieldCheck, RotateCw, Lock, Eye, EyeOff, Check, X, CheckCircle2, AlertCircle } from "lucide-react";

type Step = "email" | "otp" | "new-password" | "success";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OTP state
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Password state
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const hasMinLength = newPassword.length >= 8;
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasLower = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
  const isStrong = hasMinLength && hasUpper && hasLower && hasNumber && hasSpecial;
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  useEffect(() => {
    if (resendCooldown > 0) {
      const t = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [resendCooldown]);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send code");
      setStep("otp");
      setResendCooldown(60);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newDigits = [...otpDigits];
    newDigits[index] = value.slice(-1);
    setOtpDigits(newDigits);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) inputRefs.current[index - 1]?.focus();
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const newDigits = [...otpDigits];
    for (let i = 0; i < pasted.length; i++) newDigits[i] = pasted[i];
    setOtpDigits(newDigits);
    inputRefs.current[Math.min(pasted.length, 5)]?.focus();
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const code = otpDigits.join("");
    if (code.length !== 6) { setError("Please enter all 6 digits."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, purpose: "PASSWORD_RESET" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      setResetToken(data.resetToken);
      setStep("new-password");
    } catch (err: any) {
      setError(err.message);
      setOtpDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return;
    setError(null);
    try {
      const res = await fetch("/api/auth/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose: "PASSWORD_RESET" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resend");
      setResendCooldown(60);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isStrong) { setError("Please ensure your new password satisfies all strength requirements."); return; }
    if (!passwordsMatch) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset password");
      setStep("success");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderStepIndicator = () => {
    const steps = [
      { key: "email", label: "Email" },
      { key: "otp", label: "Verify" },
      { key: "new-password", label: "New Password" },
    ];
    const currentIdx = steps.findIndex((s) => s.key === step);

    return (
      <div className="flex items-center justify-center gap-1 mb-4">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
              i <= currentIdx ? "bg-blue-600 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-500"
            }`}>
              {i < currentIdx ? <Check className="w-3 h-3" /> : i + 1}
            </div>
            {i < steps.length - 1 && (
              <div className={`w-8 h-0.5 ${i < currentIdx ? "bg-blue-600" : "bg-slate-200 dark:bg-slate-700"}`} />
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <img src="/leaf-logo.png" alt="Eitekh WorkOS" className="w-14 h-14 mx-auto object-contain drop-shadow-md" />
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            {step === "success" ? "Password Updated!" : "Reset your password"}
          </h1>
          {step !== "success" && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {step === "email" && "Enter your email and we'll send a verification code"}
              {step === "otp" && `Enter the 6-digit code sent to ${email}`}
              {step === "new-password" && "Choose a strong new password"}
            </p>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-300 dark:border-slate-800 shadow-xl space-y-5">
          {step !== "success" && renderStepIndicator()}

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-lg flex items-center gap-2.5 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === "email" && (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Work Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com"
                    className="w-full text-xs pl-9 pr-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all" />
                </div>
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg shadow-sm shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50">
                <span>{loading ? "Sending code..." : "Send Verification Code"}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>
          )}

          {step === "otp" && (
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              <div className="flex items-center justify-center gap-1">
                <ShieldCheck className="w-5 h-5 text-blue-500" />
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Enter Code</span>
              </div>
              <div className="flex justify-center gap-2" onPaste={handleOtpPaste}>
                {otpDigits.map((digit, i) => (
                  <input key={i} ref={(el) => { inputRefs.current[i] = el; }} type="text" inputMode="numeric" maxLength={1} value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)} onKeyDown={(e) => handleOtpKeyDown(i, e)} autoFocus={i === 0}
                    className="w-11 h-13 text-center text-lg font-bold rounded-lg border-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 transition-all" />
                ))}
              </div>
              <button type="submit" disabled={loading || otpDigits.join("").length !== 6}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg shadow-sm shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50">
                <span>{loading ? "Verifying..." : "Verify Code"}</span>
              </button>
              <div className="text-center">
                <button type="button" onClick={handleResendOtp} disabled={resendCooldown > 0}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:text-slate-400 disabled:no-underline disabled:cursor-default">
                  <RotateCw className="w-3 h-3" />
                  <span>{resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}</span>
                </button>
              </div>
            </form>
          )}

          {step === "new-password" && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label htmlFor="newPassword" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">New Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input id="newPassword" type={showPassword ? "text" : "password"} required placeholder="At least 8 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full text-xs pl-9 pr-10 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {newPassword.length > 0 && (
                  <div className="mt-2.5 p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-300 dark:border-slate-700/60 space-y-1 text-[11px]">
                    <p className="font-semibold text-slate-600 dark:text-slate-400">Password requirements:</p>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                      {[
                        { ok: hasMinLength, label: "8+ characters" },
                        { ok: hasUpper, label: "Uppercase letter" },
                        { ok: hasLower, label: "Lowercase letter" },
                        { ok: hasNumber, label: "At least 1 number" },
                      ].map(({ ok, label }) => (
                        <div key={label} className={`flex items-center gap-1.5 ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}>
                          {ok ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                          <span>{label}</span>
                        </div>
                      ))}
                      <div className={`flex items-center gap-1.5 col-span-2 ${hasSpecial ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}>
                        {hasSpecial ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                        <span>Special character (!@#$%^&*)</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="confirmPassword" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Confirm New Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input id="confirmPassword" type={showPassword ? "text" : "password"} required placeholder="Repeat password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full text-xs pl-9 pr-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all" />
                </div>
                {confirmPassword.length > 0 && (
                  <p className={`text-[11px] mt-1 flex items-center gap-1 ${passwordsMatch ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}`}>
                    {passwordsMatch ? <><Check className="w-3 h-3" /><span>Passwords match</span></> : <><X className="w-3 h-3" /><span>Passwords do not match</span></>}
                  </p>
                )}
              </div>
              <button type="submit" disabled={loading || !isStrong || !passwordsMatch}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg shadow-sm shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50">
                <span>{loading ? "Resetting..." : "Set New Password"}</span>
              </button>
            </form>
          )}

          {step === "success" && (
            <div className="text-center py-2 space-y-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Your password has been reset and all active sessions have been revoked. You can now sign in.
              </p>
              <Link href="/login" className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm">
                Sign In to Workspace <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}

          {step !== "success" && (
            <div className="text-center pt-2 border-t border-slate-300 dark:border-slate-800">
              <Link href="/login" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                <ArrowLeft className="w-3 h-3" /> Remember your password? Sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
