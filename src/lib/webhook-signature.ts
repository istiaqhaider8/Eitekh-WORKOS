/**
 * C1 — signing webhook payloads.
 *
 * WHAT WAS WRONG
 *
 * Delivery sent the shared secret itself, in a header:
 *
 *     "X-Webhook-Secret": decryptField(webhook.secret)
 *
 * That is worse than sending nothing. The secret travelled on every single
 * delivery, so it was exposed to every intermediary, every reverse proxy that
 * logs request headers, and every receiver's own application log — and a
 * receiver comparing it proves only that whoever sent the request had the
 * secret, not that WE sent this particular payload at this particular time.
 * A captured request could be replayed forever.
 *
 * WHAT IT DOES NOW
 *
 * HMAC-SHA256 over `${timestamp}.${body}`, with the secret as the key, and the
 * secret never leaves the server. The timestamp is inside the signed material,
 * so changing it invalidates the signature — which is what makes a replay
 * window enforceable rather than advisory.
 *
 * The scheme is deliberately the one receivers already know from Stripe and
 * GitHub: a `v1=` prefixed hex digest, verified in constant time against a
 * recomputation. Inventing a format here would mean every integrator writes
 * novel verification code, and novel verification code is where `==` gets used
 * on a MAC.
 */

import crypto from "crypto";

/** How old a signed request may be before a receiver should reject it. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export const SIGNATURE_HEADER = "X-Eitekh-Signature";
export const TIMESTAMP_HEADER = "X-Eitekh-Timestamp";
export const EVENT_HEADER = "X-Eitekh-Event";
export const DELIVERY_HEADER = "X-Eitekh-Delivery";

/**
 * The exact bytes the signature covers.
 *
 * Timestamp and body joined by a period. The separator matters: signing
 * `timestamp + body` with no delimiter would let `("12", "3body")` and
 * `("123", "body")` produce the same input, so a receiver could be fed a
 * different timestamp than the one that was signed.
 */
export function signedPayload(timestamp: number, body: string): string {
  return `${timestamp}.${body}`;
}

/** `v1=<hex>` for the given body and secret. */
export function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  const mac = crypto
    .createHmac("sha256", secret)
    .update(signedPayload(timestamp, body), "utf8")
    .digest("hex");
  return `v1=${mac}`;
}

/**
 * Verify a signature the way a receiver should.
 *
 * Exported because it is the reference implementation the documentation points
 * integrators at, and because the tests verify OUR signing against it rather
 * than against a second copy of the same expression — a test that recomputes
 * the HMAC inline proves only that crypto is deterministic.
 */
export function verifyWebhookSignature(
  secret: string,
  header: string | null | undefined,
  timestampHeader: string | null | undefined,
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): { ok: true } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: "missing signature header" };
  if (!timestampHeader) return { ok: false, reason: "missing timestamp header" };

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "timestamp is not a number" };

  // Replay protection. Both directions: a far-future timestamp is as much a
  // sign of tampering as a stale one.
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp outside the tolerance window" };
  }

  const expected = signWebhookPayload(secret, timestamp, body);

  // Constant time. A length-sensitive or short-circuiting comparison on a MAC
  // leaks it a byte at a time to anyone who can measure the response.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "signature mismatch" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };

  return { ok: true };
}
