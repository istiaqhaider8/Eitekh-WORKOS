/**
 * Integration tests for core validation schemas (src/lib/validation.ts).
 * These are pure schema tests — no I/O required.
 */

import { loginSchema, registerSchema, parseBody, paginationSchema } from "../validation";

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
