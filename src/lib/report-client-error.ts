/**
 * PROD-7 — the browser side of error reporting.
 *
 * Kept deliberately tiny and dependency-free: this code runs in the error
 * path, so anything it needs is something that might already be broken. It
 * uses `sendBeacon` where available, because a page that is navigating away or
 * crashing is exactly when a normal `fetch` gets cancelled — and those are the
 * reports worth having.
 */

const ENDPOINT = "/api/telemetry/client";

export type ClientErrorSource = "boundary" | "window" | "unhandledrejection";

export interface ClientErrorReport {
  message: string;
  stack?: string;
  source?: ClientErrorSource;
  digest?: string;
}

/**
 * Report a browser error. Never throws, and never returns a rejected promise:
 * a failure to report must not itself surface as an error in the page.
 */
export function reportClientError(report: ClientErrorReport): void {
  if (typeof window === "undefined") return;

  try {
    const payload = JSON.stringify({
      message: String(report.message ?? "Unknown client error").slice(0, 1_000),
      stack: report.stack ? String(report.stack).slice(0, 8_000) : undefined,
      // The full URL including its query string is sent deliberately — it is
      // often the only clue to what the user was doing — and is scrubbed on
      // the server, where tokens in query strings are stripped.
      url: window.location?.href?.slice(0, 500),
      source: report.source ?? "boundary",
      digest: report.digest,
      userAgent: navigator?.userAgent?.slice(0, 500),
    });

    // sendBeacon survives unload; fetch does not.
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }

    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {
      /* reporting is best effort */
    });
  } catch {
    /* never let the reporter become the error */
  }
}

let installed = false;

/**
 * Catch errors that no React boundary sees: a throw from outside the render
 * tree, and a promise rejection nobody handled. Those are a large share of
 * real browser failures, and an error boundary alone misses all of them.
 *
 * Idempotent, because React strict mode mounts effects twice in development
 * and double-reporting would misrepresent the rate the alerts threshold on.
 */
export function installGlobalErrorReporting(): () => void {
  if (typeof window === "undefined" || installed) return () => {};
  installed = true;

  const onError = (event: ErrorEvent) => {
    reportClientError({
      message: event.message || "Uncaught error",
      stack: event.error?.stack,
      source: "window",
    });
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    reportClientError({
      message:
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "Unhandled promise rejection",
      stack: reason instanceof Error ? reason.stack : undefined,
      source: "unhandledrejection",
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    installed = false;
  };
}
