/**
 * PROD-7 — scrubbing, and the guarantees around it.
 *
 * The acceptance criterion is "PII/secret scrubbing verified with a deliberate
 * test error containing a fake token". These tests are that, plus the
 * properties that make the scrubber trustworthy: it must run before anything
 * leaves the process, it must reach values nested anywhere, and a failure in
 * the sink must never reach the caller.
 *
 * Every secret below is fabricated for this file.
 */

import {
  scrub,
  scrubString,
  capture,
  counters,
  __setTelemetryTransportForTests,
  type TelemetryEvent,
  type TelemetryTransport,
} from "../telemetry";

class RecordingTransport implements TelemetryTransport {
  readonly name = "recording";
  readonly sent: TelemetryEvent[] = [];
  async send(event: TelemetryEvent): Promise<void> {
    this.sent.push(event);
  }
}

class ExplodingTransport implements TelemetryTransport {
  readonly name = "exploding";
  async send(): Promise<void> {
    throw new Error("sink unreachable");
  }
}

afterEach(() => {
  __setTelemetryTransportForTests(undefined);
});

describe("secrets never leave the process", () => {
  it.each([
    [
      "a database URL with an inline password",
      "connect failed: postgresql://app_user:sup3rs3cr3t@db.internal:5432/eitekh",
      "sup3rs3cr3t",
    ],
    [
      "a JWT",
      "rejected token eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJhYmMifQ.c2lnbmF0dXJlX2hlcmU",
      "c2lnbmF0dXJlX2hlcmU",
    ],
    ["a bearer header", "Authorization: Bearer abc123.def456-ghi789", "abc123.def456-ghi789"],
    ["a provider secret key", "stripe said sk_live_51ABCdefGHIjklMNO", "sk_live_51ABCdefGHIjklMNO"],
    ["a GitHub token", "ghp_0123456789abcdefghijABCDEFGHIJ0123", "ghp_0123456789abcdefghijABCDEFGHIJ0123"],
    [
      "a 64-hex field-encryption key",
      "FIELD_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ],
    [
      "the session cookie",
      "Cookie: eitekh_session_token=eyJhbGciOi.payload.signature; other=1",
      "eyJhbGciOi.payload.signature",
    ],
  ])("scrubs %s", (_label, input, secret) => {
    const out = scrubString(input);
    expect(out).not.toContain(secret);
    expect(out).toContain("REDACTED");
  });

  it("scrubs email addresses — tenant PII in a third-party tracker is its own problem", () => {
    const out = scrubString("failed for customer alice.smith+tag@acme-corp.example");
    expect(out).not.toContain("alice.smith+tag@acme-corp.example");
    expect(out).toContain("[REDACTED_EMAIL]");
  });

  it("leaves ordinary text alone", () => {
    // A scrubber that eats everything is useless for debugging.
    const msg = "Issue IT-42 transitioned from TODO to IN_PROGRESS in project alpha";
    expect(scrubString(msg)).toBe(msg);
  });
});

describe("scrub reaches values wherever they are", () => {
  it("redacts by key as well as by value", () => {
    const out = scrub({ password: "hunter2", note: "fine" }) as Record<string, unknown>;
    expect(out.password).toBe("[REDACTED]");
    expect(out.note).toBe("fine");
  });

  it("reaches deeply nested strings", () => {
    const out = scrub({
      a: { b: { c: [{ d: "token is ghp_0123456789abcdefghijABCDEFGHIJ0123" }] } },
    }) as any;
    expect(JSON.stringify(out)).not.toContain("ghp_0123456789");
  });

  it("reaches into an error stack", () => {
    const out = scrub({
      error: {
        message: "connect ECONNREFUSED postgresql://u:p4ssw0rd@host/db",
        stack: "at connect (postgresql://u:p4ssw0rd@host/db)",
      },
    }) as any;
    expect(JSON.stringify(out)).not.toContain("p4ssw0rd");
  });

  it("does not choke on null, undefined or numbers", () => {
    expect(scrub(null)).toBeNull();
    expect(scrub(undefined)).toBeUndefined();
    expect(scrub(42)).toBe(42);
  });
});

describe("capture", () => {
  it("scrubs a deliberate error containing a fake token before sending", () => {
    // The acceptance criterion, exercised end to end through the public entry
    // point rather than through the scrubber directly.
    const t = new RecordingTransport();
    __setTelemetryTransportForTests(t);
    process.env.TELEMETRY_ENDPOINT = "http://telemetry.invalid/ingest";

    const err = new Error(
      "Upload failed for bob@customer.example using Bearer sk_live_ABCDEFGH12345678"
    );
    capture({
      severity: "error",
      action: "DELIBERATE_TEST_ERROR",
      message: err.message,
      meta: { authorization: "Bearer sk_live_ABCDEFGH12345678", userEmail: "bob@customer.example" },
      error: { name: err.name, message: err.message, stack: err.stack },
    });

    expect(t.sent).toHaveLength(1);
    const wire = JSON.stringify(t.sent[0]);
    expect(wire).not.toContain("sk_live_ABCDEFGH12345678");
    expect(wire).not.toContain("bob@customer.example");
    expect(wire).toContain("DELIBERATE_TEST_ERROR");

    delete process.env.TELEMETRY_ENDPOINT;
  });

  it("stamps environment and timestamp so events are attributable", () => {
    const t = new RecordingTransport();
    __setTelemetryTransportForTests(t);
    process.env.TELEMETRY_ENDPOINT = "http://telemetry.invalid/ingest";

    capture({ severity: "info", action: "PING", message: "hello" });

    expect(t.sent[0].environment).toBeTruthy();
    expect(Date.parse(t.sent[0].timestamp)).not.toBeNaN();
    delete process.env.TELEMETRY_ENDPOINT;
  });

  it("never throws when the sink fails", () => {
    // Telemetry that can fail a request is worse than no telemetry.
    __setTelemetryTransportForTests(new ExplodingTransport());
    process.env.TELEMETRY_ENDPOINT = "http://telemetry.invalid/ingest";
    expect(() => capture({ severity: "error", action: "X", message: "y" })).not.toThrow();
    delete process.env.TELEMETRY_ENDPOINT;
  });

  it("counts events even when no sink is configured", () => {
    // The counters back the alerting rules, so they must not depend on a
    // transport being present.
    __setTelemetryTransportForTests(null);
    const before = counters.snapshot()["events.error"] ?? 0;
    capture({ severity: "error", action: "COUNTED", message: "z" });
    expect(counters.snapshot()["events.error"]).toBe(before + 1);
  });
});
