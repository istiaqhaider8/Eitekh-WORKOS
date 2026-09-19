/**
 * C1 — the webhook signature.
 *
 * WHAT WAS WRONG
 *
 * Delivery sent the shared secret in a header on every request:
 *
 *     "X-Webhook-Secret": decryptField(webhook.secret)
 *
 * The secret travelled to the receiver each time, so it was exposed to every
 * intermediary, every proxy that logs headers and every receiver's own logs —
 * and a receiver comparing it learns only that the sender had the secret, not
 * that this payload, at this time, came from us. A captured request replayed
 * forever.
 *
 * These tests pin the properties that make the replacement worth having. Most
 * of them are about what a signature must REFUSE, because a MAC that accepts
 * everything passes any test that only checks the happy path.
 */

import crypto from "crypto";
import {
  signWebhookPayload,
  verifyWebhookSignature,
  signedPayload,
  SIGNATURE_TOLERANCE_SECONDS,
} from "../webhook-signature";

const SECRET = "whsec_" + "a".repeat(32);
const OTHER_SECRET = "whsec_" + "b".repeat(32);
const BODY = JSON.stringify({ event: "issue.updated", data: { id: "abc", title: "hello" } });
const NOW = 1_780_000_000;

describe("webhook payload signing", () => {
  it("produces a v1-prefixed hex digest", () => {
    const sig = signWebhookPayload(SECRET, NOW, BODY);
    expect(sig).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  it("is a real HMAC-SHA256 over timestamp.body", () => {
    // Computed independently here, the way an integrator would from the docs.
    // If this drifts, every receiver's verification breaks at once.
    const expected =
      "v1=" +
      crypto.createHmac("sha256", SECRET).update(`${NOW}.${BODY}`, "utf8").digest("hex");
    expect(signWebhookPayload(SECRET, NOW, BODY)).toBe(expected);
  });

  it("is deterministic for the same inputs", () => {
    expect(signWebhookPayload(SECRET, NOW, BODY)).toBe(signWebhookPayload(SECRET, NOW, BODY));
  });

  it("changes when the body changes", () => {
    const a = signWebhookPayload(SECRET, NOW, BODY);
    const b = signWebhookPayload(SECRET, NOW, BODY.replace("hello", "hellp"));
    expect(a).not.toBe(b);
  });

  it("changes when the timestamp changes", () => {
    // This is what makes the replay window enforceable rather than advisory:
    // an attacker cannot move the timestamp forward and keep the signature.
    expect(signWebhookPayload(SECRET, NOW, BODY)).not.toBe(signWebhookPayload(SECRET, NOW + 1, BODY));
  });

  it("changes when the secret changes", () => {
    expect(signWebhookPayload(SECRET, NOW, BODY)).not.toBe(signWebhookPayload(OTHER_SECRET, NOW, BODY));
  });

  it("delimits the timestamp from the body", () => {
    // Without a separator, ("12", "3body") and ("123", "body") would sign the
    // same bytes, so a receiver could be handed a different timestamp than the
    // one that was actually signed.
    expect(signedPayload(12, "3body")).not.toBe(signedPayload(123, "body"));
  });
});

describe("verification accepts what it should", () => {
  it("accepts a signature it just produced", () => {
    const sig = signWebhookPayload(SECRET, NOW, BODY);
    expect(verifyWebhookSignature(SECRET, sig, String(NOW), BODY, NOW)).toEqual({ ok: true });
  });

  it("accepts a request at the edge of the tolerance window", () => {
    const ts = NOW - SIGNATURE_TOLERANCE_SECONDS;
    const sig = signWebhookPayload(SECRET, ts, BODY);
    expect(verifyWebhookSignature(SECRET, sig, String(ts), BODY, NOW).ok).toBe(true);
  });
});

describe("verification refuses what it must", () => {
  const sig = () => signWebhookPayload(SECRET, NOW, BODY);

  it("refuses a missing signature", () => {
    const r = verifyWebhookSignature(SECRET, null, String(NOW), BODY, NOW);
    expect(r).toEqual({ ok: false, reason: "missing signature header" });
  });

  it("refuses a missing timestamp", () => {
    const r = verifyWebhookSignature(SECRET, sig(), null, BODY, NOW);
    expect(r).toEqual({ ok: false, reason: "missing timestamp header" });
  });

  it("refuses a non-numeric timestamp", () => {
    const r = verifyWebhookSignature(SECRET, sig(), "not-a-number", BODY, NOW);
    expect(r.ok).toBe(false);
  });

  it("refuses a REPLAYED request outside the window", () => {
    // The point of the whole scheme. A captured request stops working.
    const old = NOW - SIGNATURE_TOLERANCE_SECONDS - 1;
    const r = verifyWebhookSignature(SECRET, signWebhookPayload(SECRET, old, BODY), String(old), BODY, NOW);
    expect(r).toEqual({ ok: false, reason: "timestamp outside the tolerance window" });
  });

  it("refuses a timestamp from the future", () => {
    // Both directions. A far-future timestamp is as much a sign of tampering
    // as a stale one, and accepting it would give an attacker an arbitrarily
    // long replay window.
    const future = NOW + SIGNATURE_TOLERANCE_SECONDS + 1;
    const r = verifyWebhookSignature(SECRET, signWebhookPayload(SECRET, future, BODY), String(future), BODY, NOW);
    expect(r).toEqual({ ok: false, reason: "timestamp outside the tolerance window" });
  });

  it("refuses a body that was altered in transit", () => {
    const tampered = BODY.replace("hello", "HELLO");
    const r = verifyWebhookSignature(SECRET, sig(), String(NOW), tampered, NOW);
    expect(r).toEqual({ ok: false, reason: "signature mismatch" });
  });

  it("refuses a signature made with a different secret", () => {
    const forged = signWebhookPayload(OTHER_SECRET, NOW, BODY);
    const r = verifyWebhookSignature(SECRET, forged, String(NOW), BODY, NOW);
    expect(r).toEqual({ ok: false, reason: "signature mismatch" });
  });

  it("refuses a timestamp that does not match the one signed", () => {
    // Signed at NOW, presented as NOW+1 — inside the tolerance window, so only
    // the signature can catch it. This is the case a scheme that signs the body
    // alone would let through.
    const r = verifyWebhookSignature(SECRET, sig(), String(NOW + 1), BODY, NOW);
    expect(r).toEqual({ ok: false, reason: "signature mismatch" });
  });

  it("refuses a truncated signature rather than matching a prefix", () => {
    const short = sig().slice(0, 20);
    const r = verifyWebhookSignature(SECRET, short, String(NOW), BODY, NOW);
    expect(r).toEqual({ ok: false, reason: "signature mismatch" });
  });

  it("refuses an empty signature", () => {
    const r = verifyWebhookSignature(SECRET, "", String(NOW), BODY, NOW);
    expect(r.ok).toBe(false);
  });

  it("does not throw on a signature of a different length", () => {
    // timingSafeEqual throws on mismatched lengths, so the length check has to
    // come first. Getting that wrong turns a forged signature into a 500,
    // which is both a worse response and a signal to whoever is probing.
    expect(() => verifyWebhookSignature(SECRET, "v1=deadbeef", String(NOW), BODY, NOW)).not.toThrow();
  });
});

describe("the secret is never transmitted", () => {
  it("does not appear in the signature", () => {
    const sig = signWebhookPayload(SECRET, NOW, BODY);
    expect(sig).not.toContain(SECRET);
    expect(sig).not.toContain("whsec");
  });

  it("the delivery path sends a signature header and no secret header", () => {
    // A structural guard. The defect was a HEADER NAME, so the thing worth
    // pinning is which headers the delivery code sets — a behavioural test
    // would need a live receiver to inspect them.
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "..", "webhook-delivery.ts"),
      "utf8"
    );
    expect(src).toMatch(/SIGNATURE_HEADER/);
    expect(src).not.toMatch(/X-Webhook-Secret/);
    // The secret is read (to sign with) but must only ever reach the HMAC.
    expect(src).toMatch(/signWebhookPayload\(secret,/);
  });
});
