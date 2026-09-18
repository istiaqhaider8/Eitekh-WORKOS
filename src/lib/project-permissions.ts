/**
 * The permission key behind each project-administration control.
 *
 * These five controls — New Project, Assign, Project Settings, Bulk Upload and
 * Teams — are restricted to Super Admin, Organization Admin, Project Admin and
 * Project Manager. That restriction is expressed as PBAC permissions rather
 * than as a hardcoded list of role names, so there is exactly one authority: a
 * role reaches a control if and only if it holds the key below. The four
 * permitted roles hold all five keys (see the seeded roles in `pbac-engine.ts`);
 * MEMBER and VIEWER hold none of them.
 *
 * Both sides import from here. The reason is the failure mode this replaces:
 * the UI was gating on `projects:edit` while the Teams endpoint accepted any
 * non-VIEWER workspace member, so hiding a button was the only thing stopping
 * the action — and a hidden button is not an access control.
 *
 * Capabilities must be resolved WITH project context
 * (`getUserCapabilities(orgId, userId, { projectRole, projectId })`), otherwise
 * a Project Admin on one project appears to hold the permission on every
 * project in the organization.
 */
export const PROJECT_ADMIN_PERMISSIONS = {
  /** "+" beside PROJECTS in the sidebar. Organization-scoped, not project-scoped. */
  newProject: "projects:create",
  /** "+ Assign" — add, re-role or remove project members. */
  assignMembers: "projects:manage_members",
  /** "Settings" — edit project name, description, status, priority, dates. */
  projectSettings: "projects:edit",
  /** "Bulk Upload" — CSV import of tasks. */
  bulkUploadTasks: "export:import_data",
  /** "Bulk Upload" — CSV import of project members. */
  bulkUploadMembers: "projects:manage_members",
  /** "Teams" — create, edit or delete project teams. */
  manageTeams: "teams:manage",
} as const;

export type ProjectAdminAction = keyof typeof PROJECT_ADMIN_PERMISSIONS;

/**
 * Evaluates a control against a resolved capability list.
 *
 * A super admin passes unconditionally; every other user must hold the key.
 * An absent or non-array capability list denies rather than allows — a failure
 * to resolve permissions must not read as permission granted.
 */
export function canUseProjectAction(
  user: { isSuperAdmin?: boolean | null; capabilities?: unknown } | null | undefined,
  action: ProjectAdminAction
): boolean {
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  if (!Array.isArray(user.capabilities)) return false;
  return (user.capabilities as string[]).includes(PROJECT_ADMIN_PERMISSIONS[action]);
}
