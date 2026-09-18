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
