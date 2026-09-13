// src/lib/logger.ts
// Production-grade sanitized structured logging utility for Eitekh WorkOS

type LogLevel = "INFO" | "WARN" | "ERROR" | "SECURITY" | "AUDIT";

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

class Logger {
  private formatLog(
    level: LogLevel,
    action: string,
    message: string,
    meta?: Record<string, any>
  ): string {
    const timestamp = new Date().toISOString();
    const cleanMeta = meta ? sanitizeLogData(meta) : undefined;
    const metaStr = cleanMeta ? ` | meta: ${JSON.stringify(cleanMeta)}` : "";
    return `[${timestamp}] [${level}] [${action}] ${message}${metaStr}`;
  }

  info(action: string, message: string, meta?: Record<string, any>) {
    console.log(this.formatLog("INFO", action, message, meta));
  }

  warn(action: string, message: string, meta?: Record<string, any>) {
    console.warn(this.formatLog("WARN", action, message, meta));
  }

  error(action: string, message: string, error?: any, meta?: Record<string, any>) {
    const errorDetails = error instanceof Error
      ? { message: error.message, stack: process.env.NODE_ENV === "development" ? error.stack : undefined }
      : error;
    console.error(this.formatLog("ERROR", action, message, { ...meta, error: errorDetails }));
  }

  security(action: string, message: string, meta?: Record<string, any>) {
    console.warn(this.formatLog("SECURITY", action, `🔒 ${message}`, meta));
  }

  audit(action: string, userId: string, projectId: string | undefined, message: string, meta?: Record<string, any>) {
    console.log(this.formatLog("AUDIT", action, message, { userId, projectId, ...meta }));
  }
}

export const logger = new Logger();
