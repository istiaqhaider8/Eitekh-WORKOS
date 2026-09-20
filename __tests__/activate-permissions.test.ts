/**
 * The Activate permission matrix, pinned.
 *
 * WHY A SOURCE-LEVEL TEST AND NOT ONLY THE INTEGRATION SUITE
 *
 * The integration suite proves the matrix by speaking HTTP as a real user in
 * a real project role, which is the stronger proof and is where the behaviour
 * is actually verified. What it cannot do cheaply is notice a key being
 * QUIETLY REMOVED from a role: a permission that disappears turns an allow
 * test into a failure somewhere far away, and a permission that is wrongly
 * ADDED may not be covered by any test at all.
 *
 * So this reads the role definitions and asserts exactly which Activate keys
 * each project role holds — both the ones present and the ones absent. The
 * absent half is the point: `sign_off_gate` must stay off Project Manager.
 */

import { readFileSync } from "node:fs";
import { VIEWER_PERMISSION_KEYS, PBAC_PERMISSION_CATEGORIES } from "@/lib/pbac-engine";

const SOURCE = readFileSync("src/lib/pbac-engine.ts", "utf8");

/** The permission list literal of one system role, by slug. */
function permissionsOf(slug: string): string[] {
  const at = SOURCE.indexOf(`slug: '${slug}'`);
  if (at < 0) throw new Error(`role ${slug} not found`);
  const start = SOURCE.indexOf("permissions: [", at);
  if (start < 0) throw new Error(`permissions for ${slug} not found`);
  const end = SOURCE.indexOf("]", start);
  const block = SOURCE.slice(start, end);
  return [...block.matchAll(/'([a-z_]+:[a-z_]+)'/g)].map((m) => m[1]);
}

const ACTIVATE_KEYS = [
  "activate:view",
  "activate:manage_phases",
  "activate:manage_deliverables",
  "activate:manage_gates",
  "activate:sign_off_gate",
];

function activateKeysOf(slug: string): string[] {
  return permissionsOf(slug).filter((k) => k.startsWith("activate:"));
}

describe("every Activate permission is a real registered key", () => {
  it("matches the PBAC catalogue exactly", () => {
    const registered = PBAC_PERMISSION_CATEGORIES.flatMap((c) => c.permissions.map((p) => p.key))
      .filter((k) => k.startsWith("activate:"))
      .sort();
    // A role granting a key the catalogue does not define would be a silent
    // no-op: nothing would ever match it, and the role would look correct.
    expect(registered).toEqual([...ACTIVATE_KEYS].sort());
  });
});

describe("the project-scoped matrix", () => {
  it("gives Project Admin all five, including sign-off", () => {
    expect(activateKeysOf("project-admin").sort()).toEqual([...ACTIVATE_KEYS].sort());
  });

  it("gives Project Manager four, and NOT sign-off", () => {
    const keys = activateKeysOf("project-manager");
    expect(keys.sort()).toEqual(
      [
        "activate:manage_deliverables",
        "activate:manage_gates",
        "activate:manage_phases",
        "activate:view",
      ].sort()
    );
    /**
     * The load-bearing assertion of this file.
     *
     * A Project Manager runs the methodology and raises gates. If they could
     * also approve one, a single role would carry a gate end to end and the
     * separation of duties would rest entirely on the same-person check —
     * which two people in the same role can satisfy between them without any
     * independent acceptance having happened.
     */
    expect(keys).not.toContain("activate:sign_off_gate");
  });

  it("gives Member read only", () => {
    expect(activateKeysOf("member")).toEqual(["activate:view"]);
  });

  it("gives Viewer read only", () => {
    expect(activateKeysOf("viewer")).toEqual(["activate:view"]);
  });

  it("gives Organization Admin everything, as it already did", () => {
    // org-admin is `[...ALL_PBAC_PERMISSION_KEYS]`, so it is not a literal
    // list and holds sign-off by construction. Asserted so that a future
    // change narrowing it does not silently remove Activate governance.
    expect(permissionsOf("org-admin")).toEqual([]);
    expect(SOURCE).toContain("permissions: [...ALL_PBAC_PERMISSION_KEYS]");
  });
});

describe("the read-only baseline", () => {
  it("includes activate:view, matching the Viewer role", () => {
    // The no-roles fallback and the VIEWER role must agree; a baseline that
    // could see every other view but not the methodology would be an odd gap.
    expect(VIEWER_PERMISSION_KEYS).toContain("activate:view");
  });

  it("includes no Activate write permission", () => {
    const writes = VIEWER_PERMISSION_KEYS.filter(
      (k) => k.startsWith("activate:") && k !== "activate:view"
    );
    expect(writes).toEqual([]);
  });
});

describe("only one role may sign off a gate", () => {
  it("is Project Admin, among the project-scoped roles", () => {
    const holders = ["project-admin", "project-manager", "member", "viewer"].filter((slug) =>
      activateKeysOf(slug).includes("activate:sign_off_gate")
    );
    expect(holders).toEqual(["project-admin"]);
  });
});
