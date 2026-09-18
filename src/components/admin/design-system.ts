/**
 * Super Admin Panel — White Theme design system.
 *
 * The panel was built dark-theme-first: its base surface was `#080c14` and the
 * light path reused dark-mode colour weights (`text-slate-400`,
 * `text-indigo-400`), which wash out badly on white and fail contrast. These
 * tokens define the light theme properly, so every screen can be brought onto
 * one visual language without touching behaviour.
 *
 * Contrast targets (WCAG AA on a white or slate-50 surface):
 *   slate-400  ≈ 2.8:1  — FAILS, never use for text
 *   slate-500  ≈ 4.6:1  — passes for body text
 *   slate-600  ≈ 6.4:1  — preferred for secondary text
 *   slate-900  ≈ 17:1   — primary text
 * Accent text uses the -600/-700 weights for the same reason.
 *
 * Usage: import the token and spread it into className. Tokens are plain
 * strings so they compose with Tailwind and stay tree-shakeable.
 */

/** Joins class strings, dropping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ── Surfaces ────────────────────────────────────────────────────────────────
export const surface = {
  /** The page canvas. Neutral, slightly cool, never pure white. */
  page: "bg-slate-50",
  /** Default content surface — cards, panels, table shells. */
  card: "bg-white border border-slate-200 rounded-xl shadow-sm",
  /** Card that is interactive (clickable/hoverable). */
  cardInteractive:
    "bg-white border border-slate-200 rounded-xl shadow-sm transition-all hover:border-slate-300 hover:shadow-md",
  /** Inset region inside a card — summaries, code blocks, read-only detail. */
  inset: "bg-slate-50 border border-slate-200 rounded-lg",
  /** Sticky top bar. */
  header: "bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm",
  /** Modal / drawer panel. */
  overlayPanel: "bg-white border border-slate-200 rounded-2xl shadow-2xl",
  /** Modal scrim. */
  scrim: "fixed inset-0 bg-slate-900/40 backdrop-blur-sm",
} as const;

// ── Typography ──────────────────────────────────────────────────────────────
export const text = {
  /** Page title. */
  pageTitle: "text-lg font-bold text-slate-900 tracking-tight",
  /** Section / card heading. */
  sectionTitle: "text-sm font-bold text-slate-900",
  /** Body copy. */
  body: "text-sm text-slate-700",
  /** Secondary copy — descriptions, helper text. */
  muted: "text-xs text-slate-600",
  /** Least-prominent copy. Still AA on white; slate-400 is not. */
  subtle: "text-xs text-slate-500",
  /** Small uppercase label above a value or group. */
  label: "text-[11px] font-semibold uppercase tracking-wider text-slate-500",
  /** Large figure in a stat tile. */
  metric: "text-2xl font-bold text-slate-900 tabular-nums tracking-tight",
  /** Monospace identifiers — ids, keys. */
  mono: "font-mono text-xs text-slate-600",
} as const;

// ── Focus ───────────────────────────────────────────────────────────────────
/**
 * One focus treatment for every interactive element. `focus-visible` rather
 * than `focus` so a mouse click does not leave a ring behind, while keyboard
 * navigation stays clearly traceable.
 */
export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

// ── Buttons ─────────────────────────────────────────────────────────────────
const btnBase = cx(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
  "text-xs font-semibold rounded-lg transition-all",
  "disabled:opacity-50 disabled:pointer-events-none cursor-pointer",
  "active:translate-y-px",
  focusRing
);

export const button = {
  /** The single most important action on a screen. */
  primary: cx(btnBase, "px-3.5 py-2 bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"),
  /** Standard action. */
  secondary: cx(
    btnBase,
    "px-3.5 py-2 bg-white text-slate-700 border border-slate-300 shadow-sm hover:bg-slate-50 hover:border-slate-400"
  ),
  /** Low-emphasis action, usually inside a dense row. */
  ghost: cx(btnBase, "px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"),
  /** Destructive action. Reserved — never use for anything reversible. */
  danger: cx(btnBase, "px-3.5 py-2 bg-rose-600 text-white shadow-sm hover:bg-rose-700"),
  /** Destructive but secondary, e.g. "Delete" in a row of many. */
  dangerSubtle: cx(
    btnBase,
    "px-3 py-1.5 text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100"
  ),
  /** Square icon-only control. Always needs an aria-label. */
  icon: cx(
    "inline-flex items-center justify-center p-2 rounded-lg text-slate-500 transition-colors cursor-pointer",
    "hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 disabled:pointer-events-none",
    focusRing
  ),
} as const;

// ── Inputs ──────────────────────────────────────────────────────────────────
export const input = {
  base: cx(
    "w-full text-sm text-slate-900 placeholder:text-slate-400",
    "bg-white border border-slate-300 rounded-lg px-3 py-2 transition-all",
    "hover:border-slate-400",
    "focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none",
    "disabled:bg-slate-50 disabled:text-slate-500"
  ),
  /** Compact variant for dense toolbars. */
  compact: cx(
    "w-full text-xs text-slate-900 placeholder:text-slate-400",
    "bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 transition-all",
    "focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
  ),
  /** Wrapper for an input with a leading icon. */
  withIcon: "relative",
  icon: "absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none",
  iconPadding: "pl-8",
  label: "block text-xs font-semibold text-slate-700 mb-1.5",
  hint: "mt-1 text-[11px] text-slate-500",
  error: "mt-1 text-[11px] font-medium text-rose-600",
} as const;

// ── Badges ──────────────────────────────────────────────────────────────────
const badgeBase =
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap";

export const badge = {
  neutral: cx(badgeBase, "bg-slate-100 text-slate-700 border-slate-200"),
  info: cx(badgeBase, "bg-indigo-50 text-indigo-700 border-indigo-200"),
  success: cx(badgeBase, "bg-emerald-50 text-emerald-700 border-emerald-200"),
  warning: cx(badgeBase, "bg-amber-50 text-amber-700 border-amber-200"),
  danger: cx(badgeBase, "bg-rose-50 text-rose-700 border-rose-200"),
  /** For counts and metadata, not status. */
  count: cx(badgeBase, "bg-slate-100 text-slate-600 border-slate-200 tabular-nums"),
} as const;

/** Maps a status-ish string onto a badge token, so status colour is consistent. */
export function badgeForStatus(status?: string | null): string {
  const s = String(status || "").toUpperCase();
  if (["ACTIVE", "SUCCESS", "HEALTHY", "RESOLVED", "COMPLETED", "SENT", "PASS", "OK"].includes(s)) {
    return badge.success;
  }
  if (["SUSPENDED", "FAILED", "CRITICAL", "ERROR", "BLOCKED", "REJECTED"].includes(s)) {
    return badge.danger;
  }
  if (["PENDING", "WARNING", "DEGRADED", "INVESTIGATING", "PENDING_VERIFY", "QUEUED", "MOCKED"].includes(s)) {
    return badge.warning;
  }
  if (["INACTIVE", "ARCHIVED", "DRAFT", "SKIPPED"].includes(s)) return badge.neutral;
  return badge.info;
}

// ── Alerts ──────────────────────────────────────────────────────────────────
const alertBase = "flex items-start gap-2.5 px-3.5 py-3 rounded-xl border text-xs";

export const alert = {
  info: cx(alertBase, "bg-indigo-50 border-indigo-200 text-indigo-900"),
  success: cx(alertBase, "bg-emerald-50 border-emerald-200 text-emerald-900"),
  warning: cx(alertBase, "bg-amber-50 border-amber-200 text-amber-900"),
  danger: cx(alertBase, "bg-rose-50 border-rose-200 text-rose-900"),
} as const;

// ── Tables ──────────────────────────────────────────────────────────────────
export const table = {
  /** Wrapper providing the border + rounded corners + horizontal scroll. */
  wrapper: "bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden",
  scroll: "overflow-x-auto",
  root: "w-full text-sm border-collapse",
  /** Sticky header so column meaning survives a long scroll. */
  thead: "bg-slate-50 border-b border-slate-200",
  th: "px-3.5 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600 whitespace-nowrap",
  thNumeric: "px-3.5 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600 whitespace-nowrap",
  tbody: "divide-y divide-slate-100",
  tr: "transition-colors hover:bg-slate-50",
  trSelected: "bg-indigo-50/60 hover:bg-indigo-50",
  td: "px-3.5 py-2.5 text-slate-700 align-middle",
  tdNumeric: "px-3.5 py-2.5 text-slate-700 align-middle text-right tabular-nums",
  tdPrimary: "px-3.5 py-2.5 font-semibold text-slate-900 align-middle",
} as const;

// ── Tabs ────────────────────────────────────────────────────────────────────
export const tabs = {
  /** Segmented control on a neutral track. */
  list: "flex items-center gap-1 overflow-x-auto bg-slate-100 border border-slate-200 p-1 rounded-xl scrollbar-none",
  item: cx(
    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap",
    "text-slate-600 hover:text-slate-900 hover:bg-white/70 transition-all cursor-pointer",
    focusRing
  ),
  itemActive: "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200",
} as const;

// ── Stat tile ───────────────────────────────────────────────────────────────
export const statTile = {
  root: cx(surface.card, "p-4"),
  label: text.label,
  value: text.metric,
  delta: "text-[11px] font-semibold",
  deltaUp: "text-emerald-600",
  deltaDown: "text-rose-600",
  deltaFlat: "text-slate-500",
} as const;

// ── Layout ──────────────────────────────────────────────────────────────────
export const layout = {
  /** Consistent max width + responsive gutters for every screen. */
  container: "max-w-7xl mx-auto px-4 sm:px-6",
  /** Vertical rhythm between major blocks. */
  stack: "space-y-5",
  /** Standard responsive grid for stat tiles. */
  statGrid: "grid grid-cols-2 lg:grid-cols-4 gap-3.5",
  /** Two-column content that collapses on tablet. */
  split: "grid grid-cols-1 lg:grid-cols-2 gap-5",
  sectionHeader: "flex flex-wrap items-center justify-between gap-3 mb-3.5",
} as const;

// ── States ──────────────────────────────────────────────────────────────────
export const state = {
  /** Full-surface loading placeholder. */
  loading: "flex flex-col items-center justify-center gap-3 py-16 text-center",
  /** Skeleton block. */
  skeleton: "animate-pulse bg-slate-200 rounded",
  /** Empty state container. */
  empty: "flex flex-col items-center justify-center gap-2 py-14 px-6 text-center",
  emptyIcon: "w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center",
  emptyTitle: "text-sm font-semibold text-slate-800",
  emptyBody: "text-xs text-slate-500 max-w-sm",
} as const;

/** Divider between rows in a list. */
export const divider = "border-t border-slate-200";
