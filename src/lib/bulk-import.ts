/**
 * Shared contract for bulk import.
 *
 * The template generator, the validator and the importer all read these
 * constants, so a column can never be offered in a template that the importer
 * does not understand.
 */

export const TASK_IMPORT_HEADERS = [
  "title",
  "description",
  "type",
  "priority",
  "status",
  "assignee",
  "sprint",
  "epic",
  "points",
  "startdate",
  "duedate",
] as const;

export const MEMBER_IMPORT_HEADERS = ["email", "role"] as const;

/**
 * Project roles a bulk upload may assign.
 *
 * Mirrors the whitelist in the single-member route, which exists to stop an
 * injected org-scoped PBAC role id (e.g. "role_<orgId>_org-admin") being
 * accepted as a project role. Bulk upload must not be a way around it.
 */
export const ALLOWED_PROJECT_ROLES = new Set([
  "PROJECT_ADMIN",
  "PROJECT_MANAGER",
  "PROJECT_MEMBER",
  "MEMBER",
  "VIEWER",
  "ADMIN",
]);

export const ALLOWED_ISSUE_TYPES = new Set(["TASK", "BUG", "STORY", "EPIC", "SUBTASK"]);
export const ALLOWED_PRIORITIES = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

/** Hard ceiling on rows per upload, so one request cannot exhaust the process. */
export const MAX_IMPORT_ROWS = 2000;

export type RowOutcome = "created" | "skipped" | "failed";

export interface RowResult {
  /** 1-based row number as the user sees it in their spreadsheet. */
  row: number;
  outcome: RowOutcome;
  /** Identifying value for the row (task title, or member email). */
  subject: string;
  /** Why it was skipped or failed. Empty for created rows. */
  reason?: string;
  /** Set for created rows so the caller can link to the result. */
  createdId?: string;
  createdKey?: string;
}

export interface ImportSummary {
  mode: "validate" | "import";
  total: number;
  created: number;
  skipped: number;
  failed: number;
  results: RowResult[];
}

/** Parses a YYYY-MM-DD (or any Date-parseable) cell. */
export function parseDateCell(value: string): { ok: true; date: Date | null } | { ok: false; error: string } {
  if (!value) return { ok: true, date: null };
  // Require an unambiguous date so "01/02/2026" cannot silently mean either
  // 1 February or 2 January depending on the server locale.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, error: `date must be YYYY-MM-DD, got "${value}"` };
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (isNaN(d.getTime())) return { ok: false, error: `"${value}" is not a real date` };
  return { ok: true, date: d };
}

/** Parses a non-negative integer cell. */
export function parseIntCell(value: string, field: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (!value) return { ok: true, value: null };
  if (!/^\d+$/.test(value)) return { ok: false, error: `${field} must be a whole number, got "${value}"` };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return { ok: false, error: `${field} is out of range` };
  return { ok: true, value: n };
}

export function summarise(mode: "validate" | "import", results: RowResult[]): ImportSummary {
  return {
    mode,
    total: results.length,
    created: results.filter((r) => r.outcome === "created").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    results,
  };
}
