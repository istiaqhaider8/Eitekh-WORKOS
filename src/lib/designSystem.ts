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

