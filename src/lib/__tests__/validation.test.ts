/**
 * Integration tests for core validation schemas (src/lib/validation.ts).
 * These are pure schema tests — no I/O required.
 */

import { loginSchema, registerSchema, parseBody, paginationSchema, pbacRoleCreateSchema, otpVerifySchema } from "../validation";

describe("loginSchema", () => {
  it("accepts valid credentials", () => {
    const result = loginSchema.safeParse({ email: "user@example.com", password: "secret" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("user@example.com");
  });

  it("normalises email to lowercase", () => {
    const result = loginSchema.safeParse({ email: "USER@EXAMPLE.COM", password: "secret" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("user@example.com");
  });

  it("rejects missing password", () => {
    const result = loginSchema.safeParse({ email: "user@example.com" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email format", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "secret" });
    expect(result.success).toBe(false);
  });
});

describe("registerSchema", () => {
  const valid = {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    password: "Password1!",
  };

  it("accepts a valid registration payload", () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a weak password (no uppercase)", () => {
    const r = registerSchema.safeParse({ ...valid, password: "password1!" });
    expect(r.success).toBe(false);
  });

  it("rejects a weak password (no special char)", () => {
    const r = registerSchema.safeParse({ ...valid, password: "Password1" });
    expect(r.success).toBe(false);
  });

  it("rejects missing firstName", () => {
    const { firstName, ...rest } = valid;
    expect(registerSchema.safeParse(rest).success).toBe(false);
  });
});

describe("paginationSchema", () => {
  it("coerces string numbers and applies defaults", () => {
    const r = paginationSchema.safeParse({ page: "2", limit: "50" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(2);
      expect(r.data.limit).toBe(50);
    }
  });

  it("defaults page=1 and limit=20 when absent", () => {
    const r = paginationSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.limit).toBe(20);
    }
  });

  it("caps limit at 100", () => {
    const r = paginationSchema.safeParse({ limit: "200" });
    expect(r.success).toBe(false);
  });
});

describe("parseBody", () => {
  it("returns success:true with parsed data for a valid payload", () => {
    const result = parseBody(loginSchema, { email: "a@b.com", password: "pw" });
    expect(result.success).toBe(true);
  });

  it("returns success:false with a NextResponse for invalid payload", () => {
    const result = parseBody(loginSchema, { email: "bad" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });
});

describe("pbacRoleCreateSchema", () => {
  // Creating a permission role was returning 400 for every role not tied to a
  // project. The editor sends an explicit null for projectId, and the field was
  // `.optional()` but not nullable.
  it("accepts an explicit null projectId, as the role editor sends", () => {
    const result = pbacRoleCreateSchema.safeParse({
      name: "QA Reviewer",
      scope: "ORG",
      projectId: null,
      projectName: null,
      permissions: ["projects:view"],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.projectId).toBeNull();
  });

  it("still accepts an omitted projectId and a real one", () => {
    expect(pbacRoleCreateSchema.safeParse({ name: "R", permissions: [] }).success).toBe(true);
    expect(
      pbacRoleCreateSchema.safeParse({ name: "R", projectId: "cmu2wp2v6000mxrx2hur23je3", permissions: [] }).success
    ).toBe(true);
  });

  // A custom role id is `role_<orgId>_<slug>_<timestamp>` — 64 characters. The
  // 50-character cuid bound let system roles (46) through but rejected every
  // custom role, so a role could be created and then never edited.
  it("accepts a full-length custom role id for edits", () => {
    const customId = "role_cmu2wp2ug0004xrx2vd989zrp_zz-qa-reviewer-25n7_1789736000503";
    expect(customId.length).toBeGreaterThan(50);
    const result = pbacRoleCreateSchema.safeParse({ id: customId, name: "R", permissions: [] });
    expect(result.success).toBe(true);
  });

  it("accepts a system role id too", () => {
    const systemId = "role_cmu2wp2ug0004xrx2vd989zrp_project-manager";
    expect(pbacRoleCreateSchema.safeParse({ id: systemId, name: "R", permissions: [] }).success).toBe(true);
  });

  it("requires a name", () => {
    expect(pbacRoleCreateSchema.safeParse({ name: "", permissions: [] }).success).toBe(false);
    expect(pbacRoleCreateSchema.safeParse({ permissions: [] }).success).toBe(false);
  });

  it("defaults permissions to an empty list", () => {
    const result = pbacRoleCreateSchema.safeParse({ name: "R" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.permissions).toEqual([]);
  });

  it("rejects an invalid scope", () => {
    expect(pbacRoleCreateSchema.safeParse({ name: "R", scope: "GALAXY", permissions: [] }).success).toBe(false);
  });
});

/**
 * The OTP code field.
 *
 * WHAT THIS IS GUARDING
 *
 * The pattern was `/^d{6}$/` — a bare `d` instead of `\d`, so it matched the
 * literal string "dddddd" and nothing else. Every one-time code the
 * application had ever issued was rejected by this schema before `verifyOtp`
 * was reached, which meant registration and password reset could not be
 * completed by anybody, ever.
 *
 * It was invisible from every angle that normally catches things. The code was
 * generated correctly, hashed correctly, stored correctly, emailed correctly
 * and compared correctly; the OTP logic had no defect at all. The request
 * never got that far. And the message shown to the user — "Code must be 6
 * digits" — described a rule the input already satisfied, so the error blamed
 * the person typing.
 *
 * The first test below is the one that matters: a real code must PASS. A test
 * that only checks rejections would have passed against the broken pattern,
 * because the broken pattern rejected everything.
 */
describe("otpVerifySchema — the code field", () => {
  const valid = { email: "user@example.com", code: "281799", purpose: "PASSWORD_RESET" as const };

  it("accepts a real six-digit code", () => {
    const result = otpVerifySchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts a code with leading zeros", () => {
    // generateOtp() pads to six characters, so "000123" is a code it can
    // legitimately produce. A regex written as a number range would drop it.
    expect(otpVerifySchema.safeParse({ ...valid, code: "000123" }).success).toBe(true);
  });

  it("accepts every digit", () => {
    expect(otpVerifySchema.safeParse({ ...valid, code: "012345" }).success).toBe(true);
    expect(otpVerifySchema.safeParse({ ...valid, code: "6789" + "01" }).success).toBe(true);
  });

  it('rejects the literal string the broken pattern used to accept', () => {
    // `/^d{6}$/` matched exactly this and nothing else.
    expect(otpVerifySchema.safeParse({ ...valid, code: "dddddd" }).success).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(otpVerifySchema.safeParse({ ...valid, code: "12345" }).success).toBe(false);
    expect(otpVerifySchema.safeParse({ ...valid, code: "1234567" }).success).toBe(false);
    expect(otpVerifySchema.safeParse({ ...valid, code: "" }).success).toBe(false);
  });

  it("rejects non-digits, including a huge string", () => {
    expect(otpVerifySchema.safeParse({ ...valid, code: "12a456" }).success).toBe(false);
    expect(otpVerifySchema.safeParse({ ...valid, code: " 12345" }).success).toBe(false);
    // The length bound exists so an attacker cannot feed something enormous
    // into the hash comparison.
    expect(otpVerifySchema.safeParse({ ...valid, code: "1".repeat(100_000) }).success).toBe(false);
  });

  it("states a rule the input can actually satisfy", () => {
    /**
     * The error text is part of the contract.
     *
     * While the pattern was broken this message was actively misleading: it
     * told the user their six-digit code was not six digits, which sends
     * people to re-read the email rather than report a bug.
     */
    const rejected = otpVerifySchema.safeParse({ ...valid, code: "12345" });
    expect(rejected.success).toBe(false);
    if (!rejected.success) {
      const message = rejected.error.issues[0].message;
      expect(message).toBe("Code must be 6 digits");
      // And the thing it describes must be accepted.
      expect(otpVerifySchema.safeParse({ ...valid, code: "123456" }).success).toBe(true);
    }
  });
});
