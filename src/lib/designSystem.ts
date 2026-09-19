import {
  CheckSquare,
  AlertCircle,
  Bookmark,
  Zap,
} from "lucide-react";

export const ISSUE_TYPES = [
  {
    value: "TASK",
    label: "Task",
    icon: CheckSquare,
    badgeClass: "text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/60 border-sky-200 dark:border-sky-800/80",
    color: "#0284c7",
  },
  {
    value: "BUG",
    label: "Bug",
    icon: AlertCircle,
    badgeClass: "text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800/80",
    color: "#f43f5e",
  },
  {
    value: "STORY",
    label: "Story",
    icon: Bookmark,
    badgeClass: "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800/80",
    color: "#10b981",
  },
  {
    value: "EPIC",
    label: "Epic",
    icon: Zap,
    badgeClass: "text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 border-purple-200 dark:border-purple-800/80",
    color: "#a855f7",
  },
];

export const DEFAULT_PRIORITIES = [
  { value: "CRITICAL", name: "Critical", color: "#f43f5e", dotClass: "bg-rose-500", bgClass: "bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900" },
  { value: "HIGH", name: "High", color: "#f59e0b", dotClass: "bg-amber-500", bgClass: "bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900" },
  { value: "MEDIUM", name: "Medium", color: "#3b82f6", dotClass: "bg-blue-500", bgClass: "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900" },
  { value: "LOW", name: "Low", color: "#10b981", dotClass: "bg-emerald-500", bgClass: "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900" },
];

export function getIssueTypeInfo(type: string) {
  return ISSUE_TYPES.find((t) => t.value === type) || ISSUE_TYPES[0];
}

export function getPriorityStyle(priority: string, customPriorities: any[] = []) {
  const list = customPriorities.length > 0 ? customPriorities : DEFAULT_PRIORITIES;
  const found = list.find(
    (p) => p.value?.toUpperCase() === priority?.toUpperCase() || p.name?.toUpperCase() === priority?.toUpperCase()
  );
  if (found) {
    return {
      name: found.name || priority,
      color: found.color || "#3b82f6",
      dotClass: found.dotClass || "bg-blue-500",
      bgClass: found.bgClass || "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900",
    };
  }
  return {
    name: priority || "Medium",
    color: "#3b82f6",
    dotClass: "bg-blue-500",
    bgClass: "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900",
  };
}

/**
 * Checks if an issue has reached a "DONE" or resolved status
 */
export function isIssueDone(issue: any, statuses?: any[]): boolean {
  if (!issue) return false;
  const statusObj = issue.status || (statuses && issue.statusId ? statuses.find((s: any) => s.id === issue.statusId) : null);
  if (!statusObj) {
    if (issue.statusId && typeof issue.statusId === "string" && issue.statusId.toLowerCase().includes("done")) {
      return true;
    }
    return false;
  }
  const category = (statusObj.category || "").toUpperCase();
  if (category === "DONE" || category === "COMPLETED" || category === "RESOLVED") return true;
  const name = (statusObj.name || "").toLowerCase();
  return name.includes("done") || name.includes("closed") || name.includes("resolved") || name.includes("completed");
}

/**
 * Returns Jira-standard styling for issue keys:
 * When completed/done, renders with strikethrough (line-through decoration-blue-600)
 */
export function getIssueKeyClass(isDone: boolean, extraClasses = ""): string {
  if (isDone) {
    return `font-mono font-bold line-through text-blue-600/75 dark:text-blue-400/75 decoration-blue-600 dark:decoration-blue-400 decoration-2 ${extraClasses}`.trim();
  }
  return `font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline ${extraClasses}`.trim();
}


// ---------------------------------------------------------------------------
// D3 — readable text from a tenant-chosen colour.
//
// Custom priorities and statuses let a tenant pick any hex colour, and several
// views then used it BOTH as the badge text and, at 8% alpha, as the badge
// background:
//
//     backgroundColor: prioInfo.color + "15",
//     color: prioInfo.color,
//
// A colour on a near-white tint of itself has very little contrast. axe
// measured 3.35:1 on the project board with the default blue (#3b82f6 on
// #eff5fe) — and that is the BEST case, because it is our own palette. A
// tenant who picks a pale yellow gets a badge nobody can read, and no amount
// of care in our own design tokens prevents it, because the colour is data.
//
// So the text colour is derived rather than used raw: keep the hue the tenant
// chose, and move its lightness until it clears the threshold against the
// background it will actually sit on.

/** Relative luminance, per WCAG 2.1. */
function relativeLuminance(r: number, g: number, b: number): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 1;
  const la = relativeLuminance(...ca);
  const lb = relativeLuminance(...cb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A version of `color` that reaches `minRatio` against `background`.
 *
 * Walks toward black on a light background and toward white on a dark one, in
 * small steps, and stops at the first shade that passes. Returns the original
 * when it already passes, and the best it managed when even black or white
 * cannot reach the target — which only happens on a mid-grey background, where
 * nothing would.
 *
 * `minRatio` defaults to 4.5, the AA threshold for normal text. Badge text in
 * this app is 10–11px, so it is normal text by every definition.
 */
export function readableTextColor(color: string, background: string, minRatio = 4.5): string {
  const c = parseHex(color);
  const bg = parseHex(background);
  if (!c || !bg) return color;

  if (contrastRatio(color, background) >= minRatio) return color;

  // Darken against a light background, lighten against a dark one.
  const bgIsLight = relativeLuminance(...bg) > 0.5;
  const target: [number, number, number] = bgIsLight ? [0, 0, 0] : [255, 255, 255];

  let best = color;
  let bestRatio = contrastRatio(color, background);

  for (let step = 0.05; step <= 1.0001; step += 0.05) {
    const blended = toHex(
      c[0] + (target[0] - c[0]) * step,
      c[1] + (target[1] - c[1]) * step,
      c[2] + (target[2] - c[2]) * step
    );
    const ratio = contrastRatio(blended, background);
    if (ratio > bestRatio) {
      best = blended;
      bestRatio = ratio;
    }
    if (ratio >= minRatio) return blended;
  }

  return best;
}

/**
 * The inline style for a badge tinted with a tenant-chosen colour.
 *
 * `surface` is what the tint sits on — the card background — because an 8%
 * alpha over white and the same alpha over slate-900 are very different
 * colours, and the text has to be readable on whichever one it lands on.
 */
export function customBadgeStyle(
  color: string,
  surface: "light" | "dark" = "light"
): { backgroundColor: string; borderColor: string; color: string } {
  const c = parseHex(color);
  const surfaceHex = surface === "dark" ? "#0f172a" : "#ffffff";
  const s = parseHex(surfaceHex)!;

  // The tint, flattened: 8% of the colour over the surface. Computed rather
  // than left as an alpha so the contrast check has a real background to
  // measure against.
  const alpha = surface === "dark" ? 0.18 : 0.08;
  const blendedBg = c
    ? toHex(
        c[0] * alpha + s[0] * (1 - alpha),
        c[1] * alpha + s[1] * (1 - alpha),
        c[2] * alpha + s[2] * (1 - alpha)
      )
    : surfaceHex;

  return {
    backgroundColor: blendedBg,
    // Borders are non-text: 3:1 is the requirement, and the raw colour at 40%
    // is fine for that.
    borderColor: color + "66",
    color: readableTextColor(color, blendedBg),
  };
}
