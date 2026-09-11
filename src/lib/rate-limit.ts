/**
 * In-memory sliding window rate limiter.
 * Suitable for single-instance or Next.js edge/node runtime.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up stale entries every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetAt <= now) {
        rateLimitStore.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}

export interface RateLimitOptions {
  limit?: number; // Max allowed requests within window
  windowSeconds?: number; // Time window in seconds
}

export function checkRateLimit(
  identifier: string,
  options: RateLimitOptions = {}
): { allowed: boolean; remaining: number; resetInSeconds: number } {
  const limit = options.limit || 10;
  const windowSeconds = options.windowSeconds || 60;
  const now = Date.now();

  const entry = rateLimitStore.get(identifier);

  if (!entry || entry.resetAt <= now) {
    // New or expired window
    rateLimitStore.set(identifier, {
      count: 1,
      resetAt: now + windowSeconds * 1000,
    });
    return { allowed: true, remaining: limit - 1, resetInSeconds: windowSeconds };
  }

  if (entry.count >= limit) {
    const resetInSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: false, remaining: 0, resetInSeconds };
  }

  entry.count += 1;
  const resetInSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  return { allowed: true, remaining: limit - entry.count, resetInSeconds };
}
