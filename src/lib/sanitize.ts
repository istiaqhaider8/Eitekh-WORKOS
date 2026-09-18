/**
 * Input sanitization and safety utilities.
 */

const SAFE_URL_PROTOCOLS = new Set(["https:", "http:", "data:"]);

/**
 * Prevents javascript: and other dangerous URL protocol injection.
 * Returns '#' for any URL that doesn't start with a safe protocol.
 */
export function sanitizeUrl(url: string | null | undefined): string {
  if (!url || typeof url !== "string") return "#";
  const trimmed = url.trim();
  if (!trimmed) return "#";
  try {
    // data: URLs don't parse as URL objects cleanly — check prefix directly
    if (trimmed.toLowerCase().startsWith("data:")) {
      // Only allow safe MIME types in data: URLs
      const mimeMatch = trimmed.match(/^data:([^;,]+)/i);
      if (!mimeMatch) return "#";
      const mime = mimeMatch[1].toLowerCase();
      // Allow image types and common document types; block text/html, text/javascript, etc.
      const safeMimes = ["image/", "application/pdf", "application/octet-stream"];
      if (!safeMimes.some((prefix) => mime.startsWith(prefix))) return "#";
      return trimmed;
    }
    const parsed = new URL(trimmed);
    if (!SAFE_URL_PROTOCOLS.has(parsed.protocol)) return "#";
    return trimmed;
  } catch {
    // Relative URLs (starting with / or .) are safe
    if (trimmed.startsWith("/") || trimmed.startsWith(".")) return trimmed;
    return "#";
  }
}

/**
 * Escapes common HTML control characters to prevent XSS.
 */
export function escapeHtml(unsafe: string): string {
  if (!unsafe || typeof unsafe !== "string") return "";
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Strips all HTML tags from a string.
 */
export function stripHtml(html: string): string {
  if (!html || typeof html !== "string") return "";
  return html.replace(/<[^>]*>?/gm, "").trim();
}

/**
 * Truncates text safely to a specified length with an ellipsis.
 */
export function truncate(text: string, maxLength: number = 100): string {
  if (!text || text.length <= maxLength) return text || "";
  return text.slice(0, maxLength).trim() + "…";
}

/**
 * Normalizes email address.
 */
export function normalizeEmail(email: string): string {
  if (!email || typeof email !== "string") return "";
  return email.toLowerCase().trim();
}

/**
 * Neutralises spreadsheet formula injection (CWE-1236) for a CSV field.
 *
 * Excel and Google Sheets evaluate a cell beginning with `=`, `+`, `-`, `@`,
 * tab or CR as a formula — even when the field is quoted, because the quotes
 * are consumed by the CSV parser. So a user-supplied issue title of
 * `=HYPERLINK("http://attacker","Click")` becomes a live formula in whoever
 * opens the export. Quoting alone does not prevent this; the value has to stop
 * looking like a formula.
 *
 * Prefixing with a single quote is the conventional fix: spreadsheets treat it
 * as "this cell is text" and do not display it.
 */
export function csvSafeCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  const needsGuard = /^[=+\-@\t\r]/.test(s);
  const guarded = needsGuard ? `'${s}` : s;
  // Standard CSV escaping: double any embedded quote.
  return guarded.replace(/"/g, '""');
}
