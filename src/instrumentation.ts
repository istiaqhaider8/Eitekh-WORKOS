/**
 * Next.js startup hook. `register()` runs once when the server boots.
 *
 * Purpose: validate production configuration at STARTUP rather than at first
 * use. Several config faults were previously only detectable when a user
 * tripped over them:
 *   - FIELD_ENCRYPTION_KEY missing threw from encryption.ts on the first
 *     encrypt/decrypt, so the app booted "healthy" and failed later.
 *   - SMTP unconfigured silently dropped every email (password resets, OTP,
 *     invitations) while reporting success.
 *   - BASE_URL unset made every email link point at localhost:3000.
 * A process that cannot do its job should refuse to start, not fail per-request.
 */

import { assertProductionRateLimitStore } from "./lib/rate-limit-store";
import { telemetryStartupWarnings } from "./lib/telemetry";

const HEX_64 = /^[0-9a-f]{64}$/i;

// The all-zeros key is the CI fallback in .github/workflows/ci.yml. It must
// never be usable in production.
const CI_PLACEHOLDER_KEY = "0".repeat(64);

function validateProductionConfig(): string[] {
  const errors: string[] = [];
  const warnings: string[] = [];

  const jwt = process.env.JWT_SECRET || "";
  if (!jwt) {
    errors.push("JWT_SECRET is not set.");
  } else if (jwt.length < 32) {
    errors.push(`JWT_SECRET is too short (${jwt.length} chars); use at least 32.`);
  } else if (jwt.includes("dev-only") || jwt.includes("change-in-production") || jwt.includes("ci-test")) {
    errors.push("JWT_SECRET still contains a development/CI placeholder value.");
  }

  const fek = process.env.FIELD_ENCRYPTION_KEY || "";
  if (!fek) {
    errors.push("FIELD_ENCRYPTION_KEY is not set. Generate with: openssl rand -hex 32");
  } else if (!HEX_64.test(fek)) {
    errors.push("FIELD_ENCRYPTION_KEY must be a 64-character hex string.");
  } else if (fek.toLowerCase() === CI_PLACEHOLDER_KEY) {
    errors.push("FIELD_ENCRYPTION_KEY is the all-zeros CI placeholder; it is not a real key.");
  }

  if (!process.env.DATABASE_URL) {
    errors.push("DATABASE_URL is not set.");
  } else if (process.env.DATABASE_URL.startsWith("file:")) {
    // An error now, not a warning. Before PROD-1 a file: URL worked and was
    // merely unwise; the Prisma provider is postgresql, so it cannot work at
    // all and the app would fail on its first query instead of at boot.
    errors.push(
      "DATABASE_URL points at a SQLite file, but the Prisma provider is postgresql. " +
        "Set a postgresql:// URL. SQLite support was removed in PROD-1: it has a single " +
        "writer and is file-local, so it cannot back more than one instance."
    );
  } else if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL)) {
    warnings.push(
      `DATABASE_URL does not look like a PostgreSQL URL (${process.env.DATABASE_URL.split(":")[0]}:...). ` +
        "The Prisma provider is postgresql."
    );
  }

  // Email: silently dropping mail is worse than refusing to boot, because the
  // flows it breaks (reset, OTP, invitation) are exactly the ones a locked-out
  // user cannot work around.
  const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_PASS);
  if (!smtpConfigured) {
    errors.push(
      "SMTP is not configured (SMTP_HOST and SMTP_PASS required). Without it, password " +
        "resets, OTP codes and invitations cannot be delivered."
    );
  }

  const baseUrl = process.env.BASE_URL || process.env.NEXTAUTH_URL;

  /**
   * Running a PRODUCTION build locally is a legitimate thing to do — to
   * reproduce a bug, to load-test, to check a boot guard. But the two checks
   * below reject localhost (email links unusable) and reserved placeholder
   * domains (cannot resolve), which between them leave no honest value for a
   * local run.
   *
   * Rather than weaken the checks, this is an explicit opt-out. It has to be
   * set deliberately, it says what it costs, and it can be grepped for in a
   * deployment that should never have it.
   */
  const allowLocalBaseUrl = process.env.ALLOW_LOCAL_BASE_URL === "1";
  if (allowLocalBaseUrl) {
    warnings.push(
      "ALLOW_LOCAL_BASE_URL=1: BASE_URL is not being validated. Every link in outgoing " +
        "email will be unreachable for its recipient. This must never be set in a real deployment."
    );
  }

  if (!baseUrl) {
    errors.push("BASE_URL is not set; links in outgoing email would point at localhost.");
  } else if (allowLocalBaseUrl) {
    // Explicitly opted out above.
  } else if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
    errors.push(`BASE_URL points at a local address (${baseUrl}); email links would be unusable.`);
  } else if (/\.(invalid|test|example|localdomain)(\/|$)/i.test(baseUrl)) {
    // A reserved-TLD placeholder. The guard above only catches localhost, so a
    // value like https://something.invalid passes as "production-looking" and
    // every link in outgoing mail then points at a domain that cannot resolve.
    //
    // This is not hypothetical: exactly such a placeholder was added to run the
    // production build locally, because the localhost check rejects the honest
    // answer. It is an error rather than a warning because the failure is
    // invisible until a locked-out user cannot use their reset link.
    errors.push(
      `BASE_URL (${baseUrl}) uses a reserved placeholder domain that cannot resolve. ` +
        "Password-reset, invitation and OTP links would all be dead. Set your real public URL."
    );
  }

  const publicUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (publicUrl && baseUrl && publicUrl.replace(/\/$/, "") !== baseUrl.replace(/\/$/, "")) {
    warnings.push(`NEXT_PUBLIC_APP_URL (${publicUrl}) does not match BASE_URL (${baseUrl}).`);
  }

  // PROD-2. A per-process rate-limit store in production is the defect PROD-2
  // exists to remove: it silently grants N x the configured limit once there is
  // more than one instance. Refuse rather than scale into it.
  errors.push(...assertProductionRateLimitStore());

  // PROD-7. Not an error: an operator running without a sink has made a
  // choice, and refusing to boot over observability would turn a monitoring
  // gap into an outage. Loud, because the failure mode is learning about
  // incidents from customers.
  warnings.push(...telemetryStartupWarnings());

  for (const w of warnings) {
    console.warn(`[config] WARNING: ${w}`);
  }

  return errors;
}

export async function register() {
  // Only the Node.js runtime needs this; the edge runtime has no env access to
  // most of these and runs per-request.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.NODE_ENV !== "production") {
    // Outside production, report the same checks as warnings so the gaps are
    // visible during development without blocking local work.
    const errors = validateProductionConfig();
    if (errors.length) {
      console.warn(
        `[config] ${errors.length} setting(s) would FAIL a production boot:\n` +
          errors.map((e) => `  - ${e}`).join("\n")
      );
    }
    return;
  }

  const errors = validateProductionConfig();
  if (errors.length) {
    const message =
      `Refusing to start: ${errors.length} invalid production configuration setting(s):\n` +
      errors.map((e) => `  - ${e}`).join("\n");
    console.error(`[config] ${message}`);
    throw new Error(message);
  }

  console.log("[config] Production configuration validated.");
}

/**
 * PROD-7 — Next.js calls this for every unhandled server error, including ones
 * thrown inside React Server Components and route handlers that never reach a
 * try/catch.
 *
 * Without it, error tracking would only ever see what code remembered to log,
 * which is exactly the errors nobody anticipated — the ones worth tracking.
 */
export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string; headers?: Record<string, string> },
  context: { routerKind?: string; routePath?: string; routeType?: string }
) {
  const { logger } = await import("./lib/logger");
  logger.error(
    "UNHANDLED_SERVER_ERROR",
    `Unhandled error in ${request?.method ?? "?"} ${request?.path ?? context?.routePath ?? "?"}`,
    err,
    {
      routeType: context?.routeType,
      routerKind: context?.routerKind,
      routePath: context?.routePath,
    }
  );
}
