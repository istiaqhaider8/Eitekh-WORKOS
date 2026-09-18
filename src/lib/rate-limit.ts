/**
 * Rate limiting, backed by a store that every instance shares (PROD-2).
 *
 * This module used to hold a `new Map()` in module scope. See
 * `rate-limit-store.ts` for why that is not a rate limit once there is more
 * than one process, and why the replacement is Postgres rather than Redis.
 *
 * The public names are unchanged — `checkRateLimit`, `resetRateLimit`,
 * `RateLimitOptions` — but both functions are now async, because a shared
 * store is necessarily a network round-trip. The eleven call sites in
 * `src/app/api/auth/*` were updated to `await`; there is no synchronous
 * shim, because a shim would be a fast path that silently answers from the
 * wrong data.
 */

import { getRateLimitStore, maybeSweepRateLimits } from "./rate-limit-store";
import { logger } from "./logger";

export interface RateLimitOptions {
  limit?: number; // Max allowed requests within the window
  windowSeconds?: number; // Time window in seconds
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
}

function secondsUntil(resetAt: Date): number {
  return Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
}

/**
 * Record a request against `identifier` and say whether it is permitted.
 *
 * FAILURE BEHAVIOUR: if the store is unreachable this DENIES.
 *
 * Failing closed is the right default here for a reason specific to this
 * deployment: the store is the application's own Postgres. If it is down,
 * every route that touches the database is already failing, so denying costs
 * nothing that was working anyway. Failing open, by contrast, would reopen the
 * brute-force window on login and password reset at exactly the moment
 * operators are distracted by a database incident — and an attacker who can
 * cause a little database trouble could then buy themselves an unlimited
 * credential-stuffing window.
 *
 * (This differs from the usual Redis advice, where failing open is defensible
 * because Redis being down does not mean the app is down. It is not the
 * situation here.)
 */
export async function checkRateLimit(
  identifier: string,
  options: RateLimitOptions = {}
): Promise<RateLimitResult> {
  const limit = options.limit || 10;
  const windowSeconds = options.windowSeconds || 60;

  try {
    const { count, resetAt } = await getRateLimitStore().hit(identifier, windowSeconds);
    maybeSweepRateLimits();

    const resetInSeconds = secondsUntil(resetAt);
    if (count > limit) {
      return { allowed: false, remaining: 0, resetInSeconds };
    }
    return { allowed: true, remaining: Math.max(0, limit - count), resetInSeconds };
  } catch (error) {
    logger.error(
      "RATE_LIMIT_STORE_UNAVAILABLE",
      "Denying the request: the shared rate-limit store could not be reached, and " +
        "failing open would remove a brute-force control.",
      error,
      { identifier: identifier.split(":")[0] }
    );
    return { allowed: false, remaining: 0, resetInSeconds: windowSeconds };
  }
}

/**
 * Clear a key's window.
 *
 * Used after a successful login to discharge the per-account failure counter,
 * so that a legitimate user who signs in repeatedly is never locked out by the
 * brute-force ceiling — only consecutive failures count against it.
 *
 * A failure here is swallowed rather than surfaced: the caller has already
 * authenticated successfully, and refusing a valid login because a counter
 * could not be cleared would turn a cleanup problem into an outage. The window
 * lapses on its own.
 */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    await getRateLimitStore().reset(key);
  } catch (error) {
    logger.warn("RATE_LIMIT_RESET_FAILED", "Could not clear a rate-limit window; it will lapse on its own.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
