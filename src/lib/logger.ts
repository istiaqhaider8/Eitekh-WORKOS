// src/lib/logger.ts
// Production-grade sanitized structured logging utility for Eitekh WorkOS

import { sanitizeLogData } from "./log-sanitize";
import { capture } from "./telemetry";

export { sanitizeLogData };

type LogLevel = "INFO" | "WARN" | "ERROR" | "SECURITY" | "AUDIT";

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

  /**
   * Ship to the telemetry sink as well as the console (PROD-7).
   *
   * Wrapped, because logging must never be able to throw into the code that
   * called it: a logger that can fail a request is worse than a quiet one.
   * (The shared sanitizer lives in ./log-sanitize so that this module and
   * telemetry.ts do not import each other.)
   */
  private ship(
    severity: "info" | "warning" | "error" | "security" | "audit",
    action: string,
    message: string,
    meta?: Record<string, any>,
    error?: unknown
  ) {
    try {
      capture({
        severity,
        action,
        message,
        meta,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : undefined,
      });
    } catch {
      // A telemetry failure must not become an application failure.
    }
  }

  info(action: string, message: string, meta?: Record<string, any>) {
    console.log(this.formatLog("INFO", action, message, meta));
    this.ship("info", action, message, meta);
  }

  warn(action: string, message: string, meta?: Record<string, any>) {
    console.warn(this.formatLog("WARN", action, message, meta));
    this.ship("warning", action, message, meta);
  }

  error(action: string, message: string, error?: any, meta?: Record<string, any>) {
    const errorDetails = error instanceof Error
      ? { message: error.message, stack: process.env.NODE_ENV === "development" ? error.stack : undefined }
      : error;
    console.error(this.formatLog("ERROR", action, message, { ...meta, error: errorDetails }));
    // The full stack is shipped even in production: the reason to redact it
    // from the console is that stdout is shared, whereas the point of an error
    // tracker is a readable trace. It is scrubbed before it leaves.
    this.ship("error", action, message, meta, error);
  }

  security(action: string, message: string, meta?: Record<string, any>) {
    console.warn(this.formatLog("SECURITY", action, `🔒 ${message}`, meta));
    // SECURITY and AUDIT stay queryable outside the host: they are the audit
    // trail the PBAC-5 / ADMIN-3 work depends on.
    this.ship("security", action, message, meta);
  }

  audit(action: string, userId: string, projectId: string | undefined, message: string, meta?: Record<string, any>) {
    console.log(this.formatLog("AUDIT", action, message, { userId, projectId, ...meta }));
    this.ship("audit", action, message, { userId, projectId, ...meta });
  }
}

export const logger = new Logger();
