import React from "react";

/**
 * The shared look of the Activate screens.
 *
 * WHY THIS EXISTS
 *
 * The four Activate components had grown their own visual vocabulary: four
 * corner radii, six near-identical button styles, five font sizes between
 * 9px and 14px, and — the part that actually mattered — not one of the
 * application's theme tokens. Everywhere else in this codebase a panel is
 * `bg-card border-border`; here it was `bg-white dark:bg-slate-900
 * border-slate-200 dark:border-slate-800`, spelled out 14 times. Two
 * consequences, both visible: Activate did not follow the product's theme,
 * and its "primary" button was slate-900 in one place and blue-600 in
 * another while the product's primary is indigo.
 *
 * So the styling moves here, expressed in tokens, and the screens describe
 * what a thing IS rather than what colour it should be. Nothing in this file
 * knows anything about phases, gates or decisions — it holds no state, makes
 * no requests and takes no decisions. Behaviour stays in the screens.
 *
 * THE SCALE
 *
 * Two text sizes carry almost everything: `text-xs` for content and
 * `text-[11px]` for meta. Headings are `text-sm`. The 9px and 10px text is
 * gone — it was unreadable at arm's length and the information it carried
 * was not less important than the rest.
 */

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

/**
 * Tones, as full class strings rather than interpolations.
 *
 * Tailwind scans source text for complete class names, so a constructed
 * `bg-${tone}-50` is not in the stylesheet at all and renders unstyled. It
 * has to be spelled out to exist.
 */
const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900",
  success:
    "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900",
  warning:
    "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900",
  danger:
    "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900",
  accent: "bg-accent text-accent-foreground border-transparent",
};

/* -------------------------------------------------------------------------
 * Panel — the one card shape
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
      className={`bg-card border border-border rounded-2xl shadow-sm ${
        padded ? "p-4 sm:p-5" : ""
      } ${className}`}
    >
      {children}
    </Tag>
  );
}

/**
 * A panel's heading row: what this is, what it is for, and its actions.
 *
 * `actions` wraps below the title on a narrow screen rather than squeezing
 * the heading into two characters per line.
 */
export function PanelHeader({
  title,
  description,
  actions,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h3 id={id} className="text-sm font-bold text-foreground">
          {title}
        </h3>
        {description && (
          <p className="text-[11px] text-muted-foreground mt-0.5 max-w-prose">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Btn — one button, five intents
 * ---------------------------------------------------------------------- */

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success";

const BTN_VARIANT: Record<BtnVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90 border border-transparent",
  secondary: "bg-card text-foreground border border-border hover:bg-muted",
  ghost: "bg-transparent text-muted-foreground border border-transparent hover:bg-muted hover:text-foreground",
  danger:
    "bg-transparent text-rose-600 dark:text-rose-400 border border-rose-300 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/40",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 border border-transparent",
};

export const Btn = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" }
>(function Btn({ variant = "secondary", size = "sm", className = "", ...props }, ref) {
  const sizing = size === "md" ? "px-4 py-2 text-xs" : "px-3 py-1.5 text-[11px]";
  return (
    <button
      ref={ref}
      {...props}
      className={
        `${sizing} font-semibold rounded-lg transition-colors whitespace-nowrap ` +
        // A focus ring that is visible on both themes. Several of these
        // controls were reachable by keyboard with no visible focus at all.
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background " +
        "disabled:opacity-40 disabled:cursor-not-allowed " +
        `${BTN_VARIANT[variant]} ${className}`
      }
    />
  );
});

/* -------------------------------------------------------------------------
 * Pill — a small piece of state
 * ---------------------------------------------------------------------- */

export function Pill({
  children,
  tone = "neutral",
  className = "",
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${TONE_SOFT[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** A tinted note — the amber caution, the red refusal, the quiet aside. */
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
    <p
      role={role}
      className={`text-[11px] rounded-lg border px-2.5 py-1.5 ${TONE_SOFT[tone]} ${className}`}
    >
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------
 * Stat — one number and what it counts
 * ---------------------------------------------------------------------- */

export function Stat({
  label,
  value,
  tone,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: "danger" | "warning";
}) {
  const valueTone =
    tone === "danger"
      ? "text-rose-600 dark:text-rose-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-muted/40 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={`text-sm font-bold tabular-nums ${valueTone}`}>{value}</dd>
    </div>
  );
}

/**
 * A progress bar for "4 of 25".
 *
 * `aria-hidden`, deliberately: every place this is used already states the
 * same thing in words next to it, and a screen reader announcing a
 * percentage as well would say it twice.
 */
export function Meter({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const done = total > 0 && value >= total;
  return (
    <div aria-hidden="true" className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-300 ${
          done ? "bg-emerald-500" : "bg-primary"
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * EmptyState — say what is missing and what to do
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
    <div className="text-center py-8 px-4">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      {children && (
        <p className="text-[11px] text-muted-foreground mt-1 max-w-sm mx-auto">{children}</p>
      )}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

/** The shared shape of a text input or select on these screens. */
export const fieldClass =
  "w-full text-xs rounded-lg border border-input bg-card text-foreground px-2.5 py-1.5 " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:border-transparent";

/** A small caps label above a field or group. */
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
      className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1"
    >
      {children}
    </label>
  );
}
