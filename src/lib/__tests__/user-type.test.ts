/**
 * Tests for the User.userType field — the Employee/Client classification.
 *
 * The allowed pair is defined once in validation.ts and enforced in three
 * places: this schema, the three request schemas that accept the field, and a
 * CHECK constraint on the column (migration 0005_user_type). These tests pin
 * the first, and that the pair is exactly two values — a third option added
 * here without updating the migration would pass the API and then be refused by
 * the database.
 */

import {
  USER_TYPES,
  DEFAULT_USER_TYPE,
  userTypeSchema,
  userTypeLabel,
  superAdminUserCreateSchema,
  superAdminUserUpdateSchema,
  projectMemberSchema,
} from "../validation";

describe("USER_TYPES", () => {
  it("is exactly Employee and Client", () => {
    expect([...USER_TYPES]).toEqual(["EMPLOYEE", "CLIENT"]);
  });

  it("defaults to EMPLOYEE", () => {
    // Every account that existed before the column was added is an employee,
    // and the column default in the migration matches this.
    expect(DEFAULT_USER_TYPE).toBe("EMPLOYEE");
    expect(USER_TYPES).toContain(DEFAULT_USER_TYPE);
  });

  it("must stay in step with the database CHECK constraint", () => {
    // If this fails, migration 0005_user_type needs a follow-up migration
    // widening its CHECK before the new value can ever be stored.
    expect(USER_TYPES).toHaveLength(2);
  });
});

describe("userTypeSchema", () => {
  it("accepts both options", () => {
    expect(userTypeSchema.safeParse("EMPLOYEE").success).toBe(true);
    expect(userTypeSchema.safeParse("CLIENT").success).toBe(true);
  });

  it.each([["CONTRACTOR"], ["employee"], ["Client"], [""], ["ADMIN"], ["VENDOR"]])(
    "rejects %p",
    (value) => {
      expect(userTypeSchema.safeParse(value).success).toBe(false);
    }
  );

  it("rejects non-strings", () => {
    expect(userTypeSchema.safeParse(null).success).toBe(false);
    expect(userTypeSchema.safeParse(undefined).success).toBe(false);
    expect(userTypeSchema.safeParse(1).success).toBe(false);
    expect(userTypeSchema.safeParse(["EMPLOYEE"]).success).toBe(false);
  });
});

describe("userTypeLabel", () => {
  it("renders the two options", () => {
    expect(userTypeLabel("EMPLOYEE")).toBe("Employee");
    expect(userTypeLabel("CLIENT")).toBe("Client");
  });

  it("falls back to Employee for a missing value", () => {
    // Guards rows written before the column existed and any partial payload.
    expect(userTypeLabel(undefined)).toBe("Employee");
    expect(userTypeLabel(null)).toBe("Employee");
    expect(userTypeLabel("")).toBe("Employee");
  });
});

describe("request schemas accepting userType", () => {
  const cases: Array<[string, { safeParse: (v: unknown) => { success: boolean } }, object]> = [
    ["superAdminUserCreateSchema", superAdminUserCreateSchema, { email: "a@b.com" }],
    ["superAdminUserUpdateSchema", superAdminUserUpdateSchema, { userId: "cmu2wp2u40002xrx22y60uydr" }],
    ["projectMemberSchema", projectMemberSchema, {}],
  ];

  it.each(cases)("%s accepts a valid type", (_name, schema, base) => {
    expect(schema.safeParse({ ...base, userType: "CLIENT" }).success).toBe(true);
  });

  it.each(cases)("%s rejects an invalid type", (_name, schema, base) => {
    expect(schema.safeParse({ ...base, userType: "CONTRACTOR" }).success).toBe(false);
  });

  it.each(cases)("%s treats the field as optional", (_name, schema, base) => {
    // Omitting it must not break existing callers; the column default applies.
    expect(schema.safeParse({ ...base }).success).toBe(true);
  });
});
