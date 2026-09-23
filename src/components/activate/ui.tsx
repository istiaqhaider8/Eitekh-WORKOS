import React from "react";
import { CheckCircle2, Clock, AlertTriangle, XCircle, ShieldCheck, ChevronRight } from "lucide-react";

/**
 * Enhanced styling and component primitives for SAP Activate UI.
 * Provides high-contrast, executive-ready, and theme-adaptive components.
 */

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-blue-50/80 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200/80 dark:border-blue-900/60",
  success: "bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-900/60",
  warning: "bg-amber-50/80 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200/80 dark:border-amber-900/60",
  danger: "bg-rose-50/80 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200/80 dark:border-rose-900/60",
  accent: "bg-accent/80 text-accent-foreground border-accent-foreground/20",
};

/* -------------------------------------------------------------------------
 * Panel & PanelHeader
 * ---------------------------------------------------------------------- */

export function Panel({
  children,
  className = "",
  padded = true,
  as: Tag = "section",
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
  as?: "section" | "div" | "aside";
}) {
  return (
    <Tag
      className={`bg-card/90 backdrop-blur-xs border border-border/80 rounded-2xl shadow-xs transition-shadow hover:shadow-sm ${
        padded ? "p-4 sm:p-5" : ""
      } ${className}`}
    >
      {children}
    </Tag>
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  id,
  badge,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  id?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 pb-1 border-b border-border/40 mb-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 id={id} className="text-sm font-bold text-foreground tracking-tight">
            {title}
          </h3>
          {badge}
        </div>
        {description && (
          <p className="text-[11px] text-muted-foreground mt-0.5 max-w-prose leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Btn — Buttons with micro-interactions
 * ---------------------------------------------------------------------- */

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "outline";

const BTN_VARIANT: Record<BtnVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs border border-primary/20",
  secondary: "bg-card text-foreground border border-border hover:bg-muted/70 shadow-2xs",
  outline: "bg-transparent text-foreground border border-border hover:bg-muted/50",
  ghost: "bg-transparent text-muted-foreground border border-transparent hover:bg-muted hover:text-foreground",
  danger: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-300 dark:border-rose-900 hover:bg-rose-500/20",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs border border-transparent",
};

export const Btn = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "xs" }
>(function Btn({ variant = "secondary", size = "sm", className = "", ...props }, ref) {
  const sizing =
    size === "md" ? "px-3.5 py-2 text-xs" : size === "xs" ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-[11px]";
  return (
    <button
      ref={ref}
      {...props}
      className={
        `${sizing} font-medium rounded-lg transition-all duration-150 inline-flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-[0.98] ` +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background " +
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 " +
        `${BTN_VARIANT[variant]} ${className}`
      }
    />
  );
});

/* -------------------------------------------------------------------------
 * Pill & Badges
 * ---------------------------------------------------------------------- */

export function Pill({
  children,
  tone = "neutral",
  className = "",
  size = "sm",
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
  size?: "sm" | "md";
}) {
  const padding = size === "md" ? "px-2.5 py-1 text-[11px]" : "px-2 py-0.5 text-[10px]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold uppercase tracking-wider ${padding} ${TONE_SOFT[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function GateBadge({ status }: { status: string }) {
  switch (status) {
    case "APPROVED":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3 text-emerald-500" aria-hidden="true" />
          APPROVED
        </span>
      );
    case "RAISED":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 animate-pulse">
          <Clock className="w-3 h-3 text-amber-500" aria-hidden="true" />
          PENDING SIGN-OFF
        </span>
      );
    case "REJECTED":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30">
          <XCircle className="w-3 h-3 text-rose-500" aria-hidden="true" />
          REJECTED
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide bg-muted text-muted-foreground border border-border">
          <ShieldCheck className="w-3 h-3 opacity-60" aria-hidden="true" />
          OPEN
        </span>
      );
  }
}

export function PhaseStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "COMPLETED":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3" />
          COMPLETED
        </span>
      );
    case "IN_PROGRESS":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-500/10 border border-blue-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
          ACTIVE
        </span>
      );
    case "SKIPPED":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-muted-foreground bg-muted border border-border">
          SKIPPED
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-muted-foreground bg-muted border border-border">
          NOT STARTED
        </span>
      );
  }
}

/* -------------------------------------------------------------------------
 * Note & Callouts
 * ---------------------------------------------------------------------- */

export function Note({
  children,
  tone = "neutral",
  role,
  className = "",
}: {
  children: React.ReactNode;
  tone?: Tone;
  role?: string;
  className?: string;
}) {
  return (
    <div
      role={role}
      className={`text-[11px] rounded-xl border px-3 py-2 leading-relaxed flex items-start gap-2 ${TONE_SOFT[tone]} ${className}`}
    >
      <div className="flex-1">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Stat Cards
 * ---------------------------------------------------------------------- */

export function Stat({
  label,
  value,
  tone,
  sublabel,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: "danger" | "warning" | "success" | "info";
  sublabel?: React.ReactNode;
}) {
  const valueTone =
    tone === "danger"
      ? "text-rose-600 dark:text-rose-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "success"
          ? "text-emerald-600 dark:text-emerald-400"
          : tone === "info"
            ? "text-blue-600 dark:text-blue-400"
            : "text-foreground";
  return (
    <div className="rounded-xl border border-border/80 bg-muted/30 hover:bg-muted/50 transition-colors px-3.5 py-2.5">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
        {label}
      </dt>
      <dd className={`text-base font-extrabold tabular-nums tracking-tight mt-0.5 ${valueTone}`}>
        {value}
      </dd>
      {sublabel && <p className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Meter / Progress Bars
 * ---------------------------------------------------------------------- */

export function Meter({
  value,
  total,
  showLabel = false,
  height = "h-1.5",
}: {
  value: number;
  total: number;
  showLabel?: boolean;
  height?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const done = total > 0 && value >= total;
  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex justify-between items-center text-[10px] font-medium text-muted-foreground mb-1">
          <span>{pct}% complete</span>
          <span>{value}/{total}</span>
        </div>
      )}
      <div aria-hidden="true" className={`${height} w-full rounded-full bg-muted/80 overflow-hidden`}>
        <div
          className={`h-full rounded-full transition-all duration-400 ease-out ${
            done ? "bg-emerald-500" : pct > 60 ? "bg-blue-600 dark:bg-blue-500" : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * EmptyState
 * ---------------------------------------------------------------------- */

export function EmptyState({
  title,
  children,
  action,
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-10 px-4 rounded-xl border border-dashed border-border/80 bg-muted/10">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      {children && (
        <p className="text-[11px] text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
          {children}
        </p>
      )}
      {action && <div className="mt-3.5 flex justify-center">{action}</div>}
    </div>
  );
}

export const fieldClass =
  "w-full text-xs rounded-lg border border-input bg-card text-foreground px-2.5 py-1.5 " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:border-transparent transition-colors shadow-2xs";

export function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground/90 mb-1"
    >
      {children}
    </label>
  );
}
