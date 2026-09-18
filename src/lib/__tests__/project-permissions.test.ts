/**
 * Tests for the gate behind New Project, Assign, Project Settings, Bulk Upload
 * and Teams (src/lib/project-permissions.ts).
 *
 * The capability sets below are the real seeded PBAC permissions for each role
 * (see `defaultRoles` in pbac-engine.ts), reduced to the keys these five
 * controls depend on. The "New Project" control in particular cannot be checked
 * from server-rendered HTML — AppSidebar renders a placeholder until it mounts —
 * so this is where that gate is pinned.
 */

import { canUseProjectAction, PROJECT_ADMIN_PERMISSIONS } from "../project-permissions";

const ALL_FIVE = [
  "projects:create",
  "projects:edit",
  "projects:manage_members",
  "teams:manage",
  "export:import_data",
];

const ROLES = {
  superAdmin: { isSuperAdmin: true, capabilities: [] as string[] },
  orgAdmin: { isSuperAdmin: false, capabilities: ALL_FIVE },
  projectAdmin: { isSuperAdmin: false, capabilities: ALL_FIVE },
  projectManager: { isSuperAdmin: false, capabilities: ALL_FIVE },
  // MEMBER and VIEWER hold none of the five. These are their real seeded keys.
  member: {
    isSuperAdmin: false,
    capabilities: [
      "projects:view", "issues:view", "issues:create", "issues:edit",
      "issues:transition", "issues:assign", "issues:comment", "teams:view",
      "export:csv",
    ],
  },
  viewer: {
    isSuperAdmin: false,
    capabilities: ["projects:view", "issues:view", "teams:view"],
  },
};

const ACTIONS = Object.keys(PROJECT_ADMIN_PERMISSIONS) as Array<
  keyof typeof PROJECT_ADMIN_PERMISSIONS
>;

describe("canUseProjectAction — roles that may use the controls", () => {
  it.each([["superAdmin"], ["orgAdmin"], ["projectAdmin"], ["projectManager"]])(
    "%s can use all five controls",
    (key) => {
      const user = ROLES[key as keyof typeof ROLES];
      for (const action of ACTIONS) {
        expect(canUseProjectAction(user, action)).toBe(true);
      }
    }
  );

  it("grants a super admin regardless of the capability list", () => {
    // A super admin is allowed even when capabilities failed to resolve.
    expect(canUseProjectAction({ isSuperAdmin: true }, "newProject")).toBe(true);
    expect(canUseProjectAction({ isSuperAdmin: true, capabilities: [] }, "manageTeams")).toBe(true);
  });
});

describe("canUseProjectAction — roles that may not", () => {
  it.each([["member"], ["viewer"]])("%s is denied all five controls", (key) => {
    const user = ROLES[key as keyof typeof ROLES];
    for (const action of ACTIONS) {
      expect(canUseProjectAction(user, action)).toBe(false);
    }
  });

  it("denies a member holding only adjacent-looking permissions", () => {
    // teams:view is not teams:manage; issues:assign is not projects:manage_members.
    const user = { isSuperAdmin: false, capabilities: ["teams:view", "issues:assign", "projects:view"] };
    expect(canUseProjectAction(user, "manageTeams")).toBe(false);
    expect(canUseProjectAction(user, "assignMembers")).toBe(false);
    expect(canUseProjectAction(user, "projectSettings")).toBe(false);
  });
});

describe("canUseProjectAction — fails closed", () => {
  it("denies when there is no user", () => {
    expect(canUseProjectAction(null, "newProject")).toBe(false);
    expect(canUseProjectAction(undefined, "manageTeams")).toBe(false);
  });

  it("denies when capabilities could not be resolved", () => {
    // The previous implementation fell back to a project-role guess here, so an
    // unresolved permission list granted project-admin rights.
    expect(canUseProjectAction({ isSuperAdmin: false }, "projectSettings")).toBe(false);
    expect(canUseProjectAction({ isSuperAdmin: false, capabilities: null }, "projectSettings")).toBe(false);
    expect(canUseProjectAction({ isSuperAdmin: false, capabilities: "projects:edit" }, "projectSettings")).toBe(false);
    expect(canUseProjectAction({ isSuperAdmin: false, capabilities: {} }, "projectSettings")).toBe(false);
  });

  it("denies on an empty capability list", () => {
    expect(canUseProjectAction({ isSuperAdmin: false, capabilities: [] }, "bulkUploadTasks")).toBe(false);
  });
});

describe("PROJECT_ADMIN_PERMISSIONS mapping", () => {
  it("maps each control to the permission its endpoint enforces", () => {
    expect(PROJECT_ADMIN_PERMISSIONS).toEqual({
      newProject: "projects:create",
      assignMembers: "projects:manage_members",
      projectSettings: "projects:edit",
      bulkUploadTasks: "export:import_data",
      bulkUploadMembers: "projects:manage_members",
      manageTeams: "teams:manage",
    });
  });

  it("covers every control the UI gates", () => {
    // A control added to the UI without a key here would render ungated.
    expect(ACTIONS.sort()).toEqual(
      [
        "assignMembers",
        "bulkUploadMembers",
        "bulkUploadTasks",
        "manageTeams",
        "newProject",
        "projectSettings",
      ].sort()
    );
  });
});
