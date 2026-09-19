/**
 * PROD-6 — the project-role authority levels must match the PBAC engine's.
 *
 * `PROJECT_ROLE_AUTHORITY` in project-roles.ts duplicates the numbers from
 * `ROLE_HIERARCHY` in pbac-engine.ts, deliberately: importing a 2,300-line
 * module that pulls in Prisma and the PBAC store, into the route layer, for
 * two integers would be a heavy and circular dependency.
 *
 * Duplication is only acceptable if drift is impossible, so this reads the
 * engine's source and compares. If someone changes one table and not the
 * other, a route would enforce a hierarchy the engine disagrees with — and
 * disagreeing authorities are how escalation bugs are born.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { PROJECT_ROLE_AUTHORITY, projectRoleAuthority, canGrantProjectRole } from "../project-roles";

function engineHierarchy(): Record<string, number> {
  const src = readFileSync(join(__dirname, "..", "pbac-engine.ts"), "utf8");
  const block = src.match(/const ROLE_HIERARCHY: Record<string, number> = \{([\s\S]*?)\};/);
  if (!block) throw new Error("ROLE_HIERARCHY not found in pbac-engine.ts");
  const out: Record<string, number> = {};
  for (const m of block[1].matchAll(/'([a-z-]+)':\s*(\d+)/g)) out[m[1]] = Number(m[2]);
  return out;
}

describe("project role authority mirrors the PBAC hierarchy", () => {
  const engine = engineHierarchy();

  it("reads the engine's table", () => {
    expect(Object.keys(engine).length).toBeGreaterThanOrEqual(6);
  });

  it.each([
    ["VIEWER", "viewer"],
    ["MEMBER", "member"],
    ["PROJECT_MANAGER", "project-manager"],
    ["PROJECT_ADMIN", "project-admin"],
  ])("%s matches the engine's %s level", (projectRole, slug) => {
    expect(PROJECT_ROLE_AUTHORITY[projectRole]).toBe(engine[slug]);
  });

  it("orders project admin strictly above project manager", () => {
    // The specific relationship the escalation fix depends on.
    expect(projectRoleAuthority("PROJECT_ADMIN")).toBeGreaterThan(
      projectRoleAuthority("PROJECT_MANAGER")
    );
  });

  it("treats an unknown role as no authority at all", () => {
    // Fail closed: an unrecognised role must not outrank anything.
    expect(projectRoleAuthority("SOMETHING_ELSE")).toBe(0);
    expect(projectRoleAuthority(null)).toBe(0);
    expect(projectRoleAuthority(undefined)).toBe(0);
  });
});

describe("canGrantProjectRole refuses at-or-above the actor's level", () => {
  const manager = projectRoleAuthority("PROJECT_MANAGER");
  const admin = projectRoleAuthority("PROJECT_ADMIN");

  it("a manager cannot grant project admin — the bug PROD-6 found", () => {
    expect(canGrantProjectRole(manager, "PROJECT_ADMIN")).toBe(false);
  });

  it("a manager cannot grant its own level either", () => {
    // At-or-above, not merely above: two peers promoting each other is the
    // same escalation with an extra step.
    expect(canGrantProjectRole(manager, "PROJECT_MANAGER")).toBe(false);
  });

  it("a manager can grant member and viewer", () => {
    expect(canGrantProjectRole(manager, "MEMBER")).toBe(true);
    expect(canGrantProjectRole(manager, "VIEWER")).toBe(true);
  });

  it("a project admin can grant manager but not another admin", () => {
    expect(canGrantProjectRole(admin, "PROJECT_MANAGER")).toBe(true);
    expect(canGrantProjectRole(admin, "PROJECT_ADMIN")).toBe(false);
  });

  it("an org admin outranks every project role", () => {
    const orgAdmin = 50;
    for (const r of ["VIEWER", "MEMBER", "PROJECT_MANAGER", "PROJECT_ADMIN"]) {
      expect(canGrantProjectRole(orgAdmin, r)).toBe(true);
    }
  });

  it("someone with no role can grant nothing", () => {
    for (const r of ["VIEWER", "MEMBER", "PROJECT_MANAGER", "PROJECT_ADMIN"]) {
      expect(canGrantProjectRole(0, r)).toBe(false);
    }
  });
});
