/**
 * Input sanitization and safety utilities.
 */

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
