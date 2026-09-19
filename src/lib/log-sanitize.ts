/**
 * Log sanitization — key-based redaction, shared by the logger and telemetry.
 *
 * Extracted from logger.ts for PROD-7. telemetry.ts needs it, and logger.ts
 * needs telemetry.ts; leaving it where it was made those two modules import
 * each other. A shared leaf module is the fix, rather than a lazy require that
 * hides the cycle.
 */

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "jwttoken",
  "secret",
  "mfasecret",
  "recoverycodes",
  "cookie",
  "authorization",
  "creditcard",
  "cvv",
]);

/**
 * Deeply sanitizes an object or value, replacing sensitive keys/values with '[REDACTED]'
 */
export function sanitizeLogData(data: any): any {
  if (data === null || data === undefined) return data;
  if (typeof data === "string") {
    // Redact Bearer tokens or cookie string patterns
    return data.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
  }
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase().replace(/[-_]/g, "");
    if (SENSITIVE_KEYS.has(lowerKey)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object") {
      sanitized[key] = sanitizeLogData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

