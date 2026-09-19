import { NextResponse } from "next/server";
import { logger } from "./logger";

/**
 * Mapping thrown errors to HTTP status codes.
 *
 * WHY THIS FILE GREW TEETH (PROD-5)
 *
 * It already existed, with an `ApiError` class and a handler — and **zero**
 * callers. Meanwhile 51 route handlers derived their status by matching on
 * error message text, inconsistently and per-handler. The tenant-isolation
 * suite found the consequence: a cross-organization request was correctly
 * refused with "Forbidden: Cross-organization project access denied" and then
 * reported as **HTTP 500**, because the GET handler mapped only "Unauthorized"
 * to 401 and everything else to 500 — while the PATCH handler in the same file
 * mapped "Forbidden" to 403.
 *
 * Nothing leaked. But a security control that reports itself as a server error
 * is a real defect:
 *
 *   - A client cannot tell "you may not do this" from "the server broke", so
 *     retry logic retries a permanent denial forever.
 *   - Every cross-tenant probe looks like a crash. Once error tracking exists
 *     (PROD-7) it would page on authorization working correctly, and real
 *     faults would drown in the noise.
 *   - 500 is the one status a monitoring system is entitled to treat as "our
 *     fault". Spending it on "not your data" is how alert fatigue starts.
 *
 * WHAT TO PREFER
 *
 * Throw `ApiError` with an explicit status. The string mapping below is a
 * compatibility layer for the guards and routes that still throw bare
 * `Error`s: it is strictly better than each route inventing its own matching,
 * and it is not a pattern to extend.
 */

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Unauthorized: Please sign in") {
    super(401, message, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Forbidden") {
    super(403, message, "FORBIDDEN");
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Not found") {
    super(404, message, "NOT_FOUND");
  }
}

/**
 * Derive a status from a legacy error message.
 *
 * Returns null when the message says nothing recognisable, so the caller can
 * apply its own fallback rather than having 500 forced on it — several routes
 * legitimately treat an unrecognised failure as a 400 business-rule error, and
 * turning those into 500s would trade one wrong status for another.
 *
 * Ordering matters: "Unauthorized" is checked before "Forbidden" because some
 * messages contain both words.
 */
export function statusFromMessage(message: string): number | null {
  if (!message) return null;
  const m = message.toLowerCase();

  if (m.includes("unauthorized") || m.includes("please sign in")) return 401;
  if (m.includes("forbidden") || m.includes("access denied") || m.includes("permission")) return 403;
  if (m.includes("not found") || m.includes("does not exist")) return 404;
  if (m.includes("already exists") || m.includes("duplicate")) return 409;
  return null;
}

/** True when the error is a deliberate refusal rather than a fault. */
export function isExpectedClientError(status: number): boolean {
  return status >= 400 && status < 500;
}

/**
 * Turn a thrown value into a response.
 *
 * `fallbackStatus` is what an unrecognised error becomes. It is a parameter
 * rather than a constant so that migrating a route cannot silently change the
 * status it used to return for business-rule failures.
 *
 * Only genuine faults (5xx) are logged as errors. Logging a 403 at error level
 * is what makes authorization noise indistinguishable from breakage.
 */
export function handleApiError(
  error: unknown,
  context?: string,
  fallbackStatus = 500,
): NextResponse {
  const logContext = context || "API";

  if (error instanceof ApiError) {
    if (!isExpectedClientError(error.statusCode)) {
      logger.error("API_ERROR", `[${logContext}] ${error.message}`, error);
    }
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode },
    );
  }

  const message = error instanceof Error ? error.message : "";
  const mapped = statusFromMessage(message);
  const status = mapped ?? fallbackStatus;

  if (isExpectedClientError(status)) {
    // A refusal, not a fault. Recorded at a level that does not page anyone,
    // but still recorded — a spike in cross-tenant refusals is worth seeing.
    logger.warn("API_REFUSED", `[${logContext}] ${message}`, { status });
    return NextResponse.json({ error: message || "Request refused" }, { status });
  }

  logger.error("API_ERROR", `[${logContext}] ${message || "Unknown error"}`, error);

  // An unrecognised 5xx must not echo internals back to the caller. A message
  // that was deliberately chosen (4xx above) is safe to return; one that
  // arrived from a database driver or a stack unwind is not.
  return NextResponse.json({ error: "Internal server error" }, { status });
}
