/**
 * Project membership roles — the canonical values and how they map to PBAC.
 *
 * Two naming systems meet here and used to be conflated:
 *   ProjectMember.role  is an uppercase value: PROJECT_ADMIN, MEMBER, VIEWER…
 *   a PBAC role has a slug: project-admin, member, viewer…
 *
 * The members modal built its dropdowns from the PBAC role list and submitted
 * `r.slug`, while the API validates against the uppercase whitelist. Every role
 * change from that UI therefore failed with
 *   400 {"error":"Invalid project role: project-admin"}
 * and the "+ Add" flow failed the same way. The API was right to refuse: the
 * whitelist exists so an org-scoped PBAC role id cannot be smuggled in as a
 * project role. The UI was sending the wrong vocabulary.
 *
 * Both sides now derive from this module so they cannot drift again.
 */

/**
 * The only values ProjectMember.role may take.
 *
 * ADMIN and PROJECT_MEMBER are legacy spellings kept because existing rows use
 * them; new assignments should use PROJECT_ADMIN and MEMBER.
 */
export const PROJECT_ROLE_VALUES = [
  "PROJECT_ADMIN",
  "PROJECT_MANAGER",
  "PROJECT_MEMBER",
  "MEMBER",
  "VIEWER",
  "ADMIN",
] as const;
export type ProjectRoleValue = (typeof PROJECT_ROLE_VALUES)[number];

export const ALLOWED_PROJECT_ROLES: ReadonlySet<string> = new Set(PROJECT_ROLE_VALUES);

/** The roles offered when assigning someone, in descending authority. */
export const ASSIGNABLE_PROJECT_ROLES: ReadonlyArray<{
  value: ProjectRoleValue;
  label: string;
  /** slug of the PBAC role that carries this level's permissions */
  pbacSlug: string;
}> = [
  { value: "PROJECT_ADMIN", label: "Project Admin", pbacSlug: "project-admin" },
  { value: "PROJECT_MANAGER", label: "Project Manager", pbacSlug: "project-manager" },
  { value: "MEMBER", label: "Member", pbacSlug: "member" },
  { value: "VIEWER", label: "Viewer", pbacSlug: "viewer" },
];

export const DEFAULT_PROJECT_ROLE: ProjectRoleValue = "MEMBER";

/** Canonical value for a stored role, folding the legacy spellings. */
export function normaliseProjectRoleValue(role?: string | null): ProjectRoleValue {
  const r = String(role || "").toUpperCase();
  if (r === "ADMIN") return "PROJECT_ADMIN";
  if (r === "MANAGER" || r === "LEAD") return "PROJECT_MANAGER";
  if (r === "PROJECT_MEMBER") return "MEMBER";
  return (PROJECT_ROLE_VALUES as readonly string[]).includes(r)
    ? (r as ProjectRoleValue)
    : DEFAULT_PROJECT_ROLE;
}

/** Maps a PBAC role slug onto the project role value the API accepts. */
export function projectRoleFromPbacSlug(slug?: string | null): ProjectRoleValue | null {
  const s = String(slug || "").toLowerCase();
  const hit = ASSIGNABLE_PROJECT_ROLES.find((r) => r.pbacSlug === s);
  if (hit) return hit.value;
  // Also accept an uppercase value passed straight through.
  const asValue = String(slug || "").toUpperCase();
  return (PROJECT_ROLE_VALUES as readonly string[]).includes(asValue)
    ? (asValue as ProjectRoleValue)
    : null;
}

/** Human label for a stored role value. */
export function projectRoleLabel(role?: string | null): string {
  const v = normaliseProjectRoleValue(role);
  return ASSIGNABLE_PROJECT_ROLES.find((r) => r.value === v)?.label || v;
}

/**
 * Authority level of a project role, on the SAME scale the PBAC engine uses
 * (`ROLE_HIERARCHY` in pbac-engine.ts: viewer 10, member 20, project-manager
 * 30, project-admin 40, org-admin 50, super-admin 60).
 *
 * Added for PROD-6. The engine has `enforceHierarchy`, which refuses to assign
 * a role at or above the actor's own level — but it only runs on the PBAC
 * role-assignment paths. `PATCH /api/projects/[id]/members` writes
 * `ProjectMember.role` directly after checking only the
 * `projects:manage_members` permission, and a PROJECT_MANAGER holds that
 * permission. So a project manager could set someone to PROJECT_ADMIN: a level
 * above their own, by the codebase's own definition.
 *
 * Found by the PROD-6 authorization suite and reproduced live.
 *
 * The levels are duplicated here deliberately rather than imported: pbac-engine
 * is a 2,300-line module that pulls in Prisma and the PBAC store, and importing
 * it into the route layer for two integers would be a heavy and circular
 * dependency. The values are pinned by a test that fails if the two drift.
 */
export const PROJECT_ROLE_AUTHORITY: Record<string, number> = {
  VIEWER: 10,
  MEMBER: 20,
  PROJECT_MEMBER: 20,
  PROJECT_MANAGER: 30,
  PROJECT_ADMIN: 40,
  // Legacy spelling; treated as a project admin.
  ADMIN: 40,
};

export function projectRoleAuthority(role?: string | null): number {
  if (!role) return 0;
  return PROJECT_ROLE_AUTHORITY[role.toUpperCase()] ?? 0;
}

/**
 * May `actorRole` grant `targetRole`?
 *
 * Mirrors `enforceHierarchy`: you may not assign a role at or above your own
 * level. Organization admins, owners and super admins are handled by the
 * caller, which passes their effective level instead of a project role.
 */
export function canGrantProjectRole(actorLevel: number, targetRole: string): boolean {
  return projectRoleAuthority(targetRole) < actorLevel;
}

/** Authority levels for the organization roles, on the same scale. */
export const ORG_ROLE_AUTHORITY: Record<string, number> = {
  OWNER: 60,
  ADMIN: 50,
  MEMBER: 20,
  GUEST: 10,
};
