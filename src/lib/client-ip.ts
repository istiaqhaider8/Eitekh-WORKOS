/**
 * Who sent this request, as far as it can honestly be established.
 *
 * WHAT WENT WRONG
 *
 * The rate limiter derived the client address like this:
 *
 *     req.headers.get("x-forwarded-for")?.split(",")[0]
 *
 * `X-Forwarded-For` is a chain that the CLIENT starts. Each proxy appends what
 * it saw, so the leftmost entry is not the client's address — it is whatever
 * the caller typed. Reading it means the caller chooses their own rate-limit
 * bucket.
 *
 * Demonstrated against the running server, no proxy, unauthenticated:
 *
 *     X-Forwarded-For: 203.0.113.10   ->  remaining 99, 98, 97
 *     X-Forwarded-For: 198.51.100.77  ->  remaining 99, 98, 97
 *
 * A fresh budget per header value. That defeats the per-IP backstop entirely,
 * and the backstop is what stands in front of the unauthenticated routes —
 * which, as the middleware's own comment says, are "where brute force actually
 * happens". Login throttling included.
 *
 * HOW IT IS FIXED
 *
 * Count from the RIGHT, not the left. With `hops` trusted proxies in front of
 * the application, the entry appended by the outermost one is at
 * `length - hops`, and everything to the left of it is caller-supplied noise:
 *
 *     client sends:  X-Forwarded-For: evil
 *     nginx appends: X-Forwarded-For: evil, 203.0.113.10
 *     hops = 1    -> index 2-1 = 1 -> 203.0.113.10   (the real one)
 *
 * Adding ten fake entries just moves the index; the real address is still the
 * one the proxy appended.
 *
 * WHY AN EXPLICIT HOP COUNT AND NOT A GUESS
 *
 * There is no way to infer it from the request. A deployment behind one proxy
 * and a deployment behind a CDN plus a load balancer produce chains that look
 * identical to a caller who pads them. Guessing wrong in the permissive
 * direction restores the bypass silently, so the number is configuration:
 * `TRUSTED_PROXY_HOPS`, checked at boot by src/instrumentation.ts.
 *
 * With no trusted proxy, there is no address that can be believed, and this
 * says so rather than inventing one. Every such request then shares a single
 * bucket — deliberately strict, because the alternative is no limit at all.
 */

/** Returned when no address can be trusted. Callers use it as a bucket key. */
export const UNTRUSTED_CLIENT = "untrusted";

/**
 * Parse `TRUSTED_PROXY_HOPS` into a hop count.
 *
 * `null` means "not configured", which callers treat as untrusted rather than
 * as zero — the distinction matters to the boot guard, which refuses to start
 * a production server that never made the decision.
 */
export function parseTrustedProxyHops(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 10) return null;
  return n;
}

/**
 * The client address from a forwarded chain, or `UNTRUSTED_CLIENT`.
 *
 * `hops` is how many proxies sit between the caller and this process. Zero, or
 * an unconfigured value, means nothing in front is trusted and the header is
 * ignored entirely — including `x-real-ip`, which is exactly as forgeable.
 */
export function clientIpFromForwarded(
  forwardedFor: string | null | undefined,
  hops: number | null
): string {
  if (hops === null || hops === 0) return UNTRUSTED_CLIENT;

  const chain = (forwardedFor ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Shorter than the configured number of hops means the request did not
  // arrive through the proxies it was supposed to. Trusting anything in a
  // chain that short would trust the caller.
  const index = chain.length - hops;
  if (index < 0 || index >= chain.length) return UNTRUSTED_CLIENT;

  const candidate = chain[index];
  return isPlausibleAddress(candidate) ? candidate : UNTRUSTED_CLIENT;
}

/**
 * A loose shape check, not validation.
 *
 * The value is used as a database key and appears in logs, so something
 * arbitrarily long or containing separators must not get through. It does not
 * need to be a routable address — a proxy may legitimately report a private
 * one — only to look like an address rather than like a payload.
 */
function isPlausibleAddress(value: string): boolean {
  if (value.length === 0 || value.length > 45) return false; // 45 = longest IPv6
  return /^[0-9a-fA-F:.\[\]]+$/.test(value);
}
