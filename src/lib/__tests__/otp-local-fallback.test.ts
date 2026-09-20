/**
 * The one-time code, when it cannot be delivered.
 *
 * WHY THIS BEHAVIOUR EXISTS
 *
 * Two mechanisms make OTP flows impossible to complete without a mail server,
 * and they stack:
 *
 *   - with no SMTP configured, `sendEmail` returns MOCKED, and
 *     `createAndSendOtp` treated anything other than SENT as a failure — so
 *     registration and password reset returned 500 while a perfectly valid
 *     code sat in the database;
 *   - with EMAIL_DISABLED set, nothing is dispatched AND no EmailLog row is
 *     written, so the code exists only as a one-way hash. Nobody can recover
 *     it, including the operator running the server.
 *
 * The second was introduced by the kill switch built to stop this application
 * emailing real people from a development machine. It made the first worse:
 * the flows were not merely awkward locally, they were unusable.
 *
 * So on a LOCAL run the code is printed to the server's own stdout and the
 * call reports success, because the code really is available. Reporting
 * failure while a valid code sits in the database is the lie that stopped the
 * caller dead.
 *
 * WHAT THE TESTS ARE ACTUALLY GUARDING
 *
 * The guard, not the convenience. A one-time code in a log is a credential in
 * a log: it defeats the point of out-of-band delivery, and log shipping would
 * spread it further. The tests that matter here are the ones asserting the
 * code is NOT printed and NOT treated as delivered on a real production
 * server — if that regressed, this feature would become a vulnerability.
 */

const otpCreate = jest.fn();
const otpUpdateMany = jest.fn();
const sendEmail = jest.fn();

jest.mock("../prisma", () => ({
  prisma: {
    otpCode: {
      create: (...a: any[]) => otpCreate(...a),
      updateMany: (...a: any[]) => otpUpdateMany(...a),
    },
  },
}));
jest.mock("../email", () => ({
  sendEmail: (...a: any[]) => sendEmail(...a),
}));

const EMAIL = "someone@example.test";

describe("createAndSendOtp when delivery does not happen", () => {
  let createAndSendOtp: any;
  let warn: jest.SpyInstance;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    otpUpdateMany.mockResolvedValue({ count: 0 });
    otpCreate.mockImplementation(({ data }: any) => Promise.resolve({ id: "otp1", ...data }));
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    createAndSendOtp = require("../otp").createAndSendOtp;
  });

  afterEach(() => {
    warn.mockRestore();
    process.env = { ...originalEnv };
  });

  /** The six digits the run actually generated, read off the create() call. */
  const printedLines = () => warn.mock.calls.map((c) => String(c[0])).join("\n");

  describe("on a local run", () => {
    beforeEach(() => {
      (process.env as any).NODE_ENV = "development";
      delete process.env.ALLOW_LOCAL_BASE_URL;
    });

    it("reports success when the send was MOCKED, because the code exists", async () => {
      // Without this, `next dev` returns 500 on registration while a valid
      // OtpCode row has just been written. The code is there; saying
      // otherwise stops the caller for no reason.
      sendEmail.mockResolvedValue({ status: "MOCKED", success: true });
      const r = await createAndSendOtp(EMAIL, "REGISTRATION");
      expect(r.success).toBe(true);
      expect(otpCreate).toHaveBeenCalledTimes(1);
    });

    it("reports success when the send was BLOCKED by the kill switch", async () => {
      sendEmail.mockResolvedValue({ status: "BLOCKED", reason: "EMAIL_DISABLED" });
      const r = await createAndSendOtp(EMAIL, "PASSWORD_RESET");
      expect(r.success).toBe(true);
    });

    it("prints the six digits that were actually stored", async () => {
      /**
       * The printed code must be the one whose HASH went into the row — not a
       * second generated value, which would be worse than printing nothing
       * because it would look like the feature worked.
       */
      sendEmail.mockResolvedValue({ status: "BLOCKED" });
      await createAndSendOtp(EMAIL, "PASSWORD_RESET");

      const out = printedLines();
      const match = out.match(/\b(\d{6})\b/);
      expect(match).not.toBeNull();

      const printed = match![1];
      const crypto = require("node:crypto");
      const expectedHash = crypto.createHash("sha256").update(printed).digest("hex");
      expect(otpCreate.mock.calls[0][0].data.codeHash).toBe(expectedHash);
    });

    it("names the recipient and the purpose, so the line is usable", async () => {
      sendEmail.mockResolvedValue({ status: "BLOCKED" });
      await createAndSendOtp(EMAIL, "PASSWORD_RESET");
      const out = printedLines();
      expect(out).toContain(EMAIL);
      expect(out).toContain("PASSWORD_RESET");
      // Says why it is happening, so nobody mistakes it for a leak.
      expect(out).toMatch(/local run/i);
    });

    it("prints nothing when the mail actually went out", async () => {
      // The fallback is for undelivered codes only. Printing on a successful
      // send would put a live credential in the log for no reason at all.
      sendEmail.mockResolvedValue({ status: "SENT", messageId: "abc" });
      const r = await createAndSendOtp(EMAIL, "REGISTRATION");
      expect(r.success).toBe(true);
      expect(printedLines()).not.toMatch(/\b\d{6}\b/);
    });
  });

  describe("on a production run — the guard", () => {
    beforeEach(() => {
      (process.env as any).NODE_ENV = "production";
      delete process.env.ALLOW_LOCAL_BASE_URL;
    });

    it("does NOT print the code", async () => {
      /**
       * THE TEST THAT MATTERS.
       *
       * If this regressed, every password reset and registration code would
       * be written to production stdout and shipped wherever logs go. That
       * turns a local convenience into a credential disclosure.
       */
      sendEmail.mockResolvedValue({ status: "FAILED", error: "smtp down" });
      await createAndSendOtp(EMAIL, "PASSWORD_RESET");
      expect(printedLines()).not.toMatch(/\b\d{6}\b/);
    });

    it("reports FAILURE, so the caller tells the user to retry", async () => {
      // In production an undelivered code is a real failure: the user cannot
      // see it. Claiming success would leave them staring at a code entry
      // screen for a code that will never arrive.
      sendEmail.mockResolvedValue({ status: "FAILED", error: "smtp down" });
      const r = await createAndSendOtp(EMAIL, "PASSWORD_RESET");
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/verification email/i);
    });

    it("still reports success when the mail was genuinely sent", async () => {
      sendEmail.mockResolvedValue({ status: "SENT", messageId: "abc" });
      const r = await createAndSendOtp(EMAIL, "REGISTRATION");
      expect(r.success).toBe(true);
    });
  });

  describe("ALLOW_LOCAL_BASE_URL is what marks a production BUILD as local", () => {
    it("enables the fallback when set, even with NODE_ENV=production", async () => {
      /**
       * Running a production build locally is normal here — to reproduce a
       * bug, to load-test, to check a boot guard — and such a run sets
       * ALLOW_LOCAL_BASE_URL=1, which instrumentation.ts describes as
       * something that "must never be set in a real deployment". That makes it
       * a deliberate, greppable signal that this is not production, which is
       * exactly what a credential guard needs.
       */
      (process.env as any).NODE_ENV = "production";
      process.env.ALLOW_LOCAL_BASE_URL = "1";
      sendEmail.mockResolvedValue({ status: "BLOCKED" });

      const r = await createAndSendOtp(EMAIL, "PASSWORD_RESET");
      expect(r.success).toBe(true);
      expect(printedLines()).toMatch(/\b\d{6}\b/);
    });

    it("does not enable it for any other value", async () => {
      // Only "1". A truthy-ish value like "0" or "false" must not open the
      // guard, because the failure direction here is disclosure.
      for (const value of ["0", "false", "no", "", "yes", "true"]) {
        jest.resetModules();
        jest.clearAllMocks();
        warn.mockClear();
        (process.env as any).NODE_ENV = "production";
        process.env.ALLOW_LOCAL_BASE_URL = value;
        otpUpdateMany.mockResolvedValue({ count: 0 });
        otpCreate.mockImplementation(({ data }: any) => Promise.resolve({ id: "o", ...data }));
        sendEmail.mockResolvedValue({ status: "BLOCKED" });

        const fresh = require("../otp").createAndSendOtp;
        const r = await fresh(EMAIL, "PASSWORD_RESET");
        expect(r.success).toBe(false);
        expect(printedLines()).not.toMatch(/\b\d{6}\b/);
      }
    });
  });

  it("invalidates earlier unused codes either way", async () => {
    // Each request supersedes the last, which is why only the newest code
    // ever works — worth pinning, because it surprised a real user.
    (process.env as any).NODE_ENV = "development";
    sendEmail.mockResolvedValue({ status: "BLOCKED" });
    await createAndSendOtp(EMAIL, "PASSWORD_RESET");
    expect(otpUpdateMany).toHaveBeenCalledTimes(1);
    const call = otpUpdateMany.mock.calls[0][0];
    expect(call.where.usedAt).toBeNull();
    expect(call.data.usedAt).toBeInstanceOf(Date);
  });
});
