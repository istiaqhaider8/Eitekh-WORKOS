/**
 * PROD-5 — does the isolation suite's own machinery work?
 *
 * "A test suite that cannot fail is not a test suite." These tests check the
 * assertion helpers the tenant-isolation suite is built from, because a
 * vacuous assertion is indistinguishable from a passing one in a green run.
 *
 * This runs in the normal unit suite (no server, no database) so the
 * guarantees are checked on every `npm test`, not only when someone remembers
 * to run the integration suite.
 */

import { expectDenied, expectAllowed, expectBodyExcludes, assertSafeTestDatabase } from "../../../__tests__/integration/harness";

const result = (status: number, text = "") => ({ status, body: null as any, text });

describe("expectDenied only accepts a genuine refusal", () => {
  it.each([401, 403, 404])("accepts %i", (status) => {
    expect(() => expectDenied(result(status), "case")).not.toThrow();
  });

  it("REJECTS 200 — the whole point", () => {
    expect(() => expectDenied(result(200, '{"title":"tenant B secret"}'), "case")).toThrow(/DENIED/);
  });

  it("REJECTS 429", () => {
    // A rate-limited request proves nothing about isolation. Counting it as a
    // pass is how a suite silently stops testing anything.
    expect(() => expectDenied(result(429), "case")).toThrow(/DENIED/);
  });

  it("REJECTS 500", () => {
    // A crash is not an access control. This is also the exact status the
    // suite found authorization denials were being reported with.
    expect(() => expectDenied(result(500), "case")).toThrow(/DENIED/);
  });

  it("REJECTS 302 — a redirect is not a refusal", () => {
    expect(() => expectDenied(result(302), "case")).toThrow(/DENIED/);
  });

  it("names the offending status and body so a failure is diagnosable", () => {
    expect(() => expectDenied(result(200, "leaked payload"), "reading org B"))
      .toThrow(/reading org B.*200.*leaked payload/s);
  });
});

describe("expectAllowed only accepts success", () => {
  it("accepts 200 and 201", () => {
    expect(() => expectAllowed(result(200), "case")).not.toThrow();
    expect(() => expectAllowed(result(201), "case")).not.toThrow();
  });

  it("rejects 403 — otherwise the control cases would pass while everything is broken", () => {
    expect(() => expectAllowed(result(403), "case")).toThrow(/ALLOWED/);
  });

  it("rejects 500", () => {
    expect(() => expectAllowed(result(500), "case")).toThrow(/ALLOWED/);
  });
});

describe("expectBodyExcludes detects a leaked identifier", () => {
  it("throws when the other tenant's value is present", () => {
    expect(() => expectBodyExcludes(result(200, '{"title":"Secret of tenant B"}'), "Secret of tenant B", "case"))
      .toThrow(/another tenant/);
  });

  it("finds it however deeply it is nested", () => {
    const nested = JSON.stringify({ data: { rows: [{ project: { id: "orgB-project-1" } }] } });
    expect(() => expectBodyExcludes(result(200, nested), "orgB-project-1", "case")).toThrow(/another tenant/);
  });

  it("passes when it is genuinely absent", () => {
    expect(() => expectBodyExcludes(result(200, '{"rows":[]}'), "orgB-project-1", "case")).not.toThrow();
  });
});

describe("the suite refuses to run against a non-test database", () => {
  // The suite deletes rows. Pointing it at the development database once would
  // be worse than having no isolation tests at all.
  it("rejects an unset URL", () => {
    expect(() => assertSafeTestDatabase(undefined)).toThrow(/INTEGRATION_DATABASE_URL/);
  });

  it("rejects a database whose name does not contain 'test'", () => {
    expect(() => assertSafeTestDatabase("postgresql://u:p@localhost:5432/eitekh_workos")).toThrow(/Refusing/);
  });

  it("rejects the development database even with query parameters attached", () => {
    expect(() => assertSafeTestDatabase("postgresql://u:p@localhost:5432/eitekh_workos?schema=public"))
      .toThrow(/Refusing/);
  });

  it("accepts a clearly-named test database", () => {
    expect(() => assertSafeTestDatabase("postgresql://u:p@localhost:5432/eitekh_integration_test?schema=public"))
      .not.toThrow();
  });
});
