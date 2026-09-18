import { prisma } from "./prisma";

/**
 * Announcement audience targeting.
 *
 * This module is the single authority on who an announcement reaches. The
 * public feed, the broadcast fan-out and the admin preview all call
 * `matchesAudience` through here, so what an admin is shown as the audience is
 * computed the same way as what a user is actually served.
 *
 * Before this existed, `targetAudience` was a free-text label nothing read:
 * /api/announcements returned every active announcement to every signed-in
 * user. Targeting that is only in the UI is not targeting.
 *
 * Semantics
 *   audienceMode ALL       -> everyone signed in (still subject to the schedule)
 *   audienceMode FILTERED  -> only users matching `targets`
 *
 *   Within one kind, values are alternatives (OR): PROJECT a, PROJECT b means
 *   "in either project". Across kinds, `matchMode` decides:
 *     ANY -> match any kind        ("Project X, plus every Client")
 *     ALL -> match every kind used ("Clients who are in Project X")
 *
 *   FILTERED with no targets reaches NOBODY. An audience nobody matches is the
 *   safe reading of "targeted at nothing"; the alternative would turn an
 *   incomplete form into a platform-wide broadcast.
 */

export const TARGET_KINDS = [
  "ORG",
  "PROJECT",
  "TEAM",
  "USER",
  "USER_TYPE",
  "ORG_ROLE",
  "PROJECT_ROLE",
] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export const AUDIENCE_MODES = ["ALL", "FILTERED"] as const;
export const MATCH_MODES = ["ANY", "ALL"] as const;

/** Kinds whose `value` is a free-form label rather than an id, with the allowed set. */
export const ENUMERATED_TARGET_VALUES: Partial<Record<TargetKind, readonly string[]>> = {
  USER_TYPE: ["EMPLOYEE", "CLIENT"],
  ORG_ROLE: ["OWNER", "ADMIN", "MEMBER", "GUEST"],
  PROJECT_ROLE: ["PROJECT_ADMIN", "PROJECT_MANAGER", "PROJECT_MEMBER", "MEMBER", "VIEWER", "ADMIN"],
};

export interface AnnouncementTargetInput {
  kind: TargetKind | string;
  value: string;
}

/** Everything about a user that any target kind can be matched against. */
export interface AudienceContext {
  userId: string;
  userType: string;
  orgIds: string[];
  projectIds: string[];
  teamIds: string[];
  orgRoles: string[];
  projectRoles: string[];
}

type TargetableAnnouncement = {
  audienceMode: string;
  matchMode: string;
  targets: Array<{ kind: string; value: string }>;
};

/** The set of a user's values that a given target kind is compared against. */
function contextValuesFor(kind: string, ctx: AudienceContext): string[] {
  switch (kind) {
    case "ORG": return ctx.orgIds;
    case "PROJECT": return ctx.projectIds;
    case "TEAM": return ctx.teamIds;
    case "USER": return [ctx.userId];
    case "USER_TYPE": return [ctx.userType];
    case "ORG_ROLE": return ctx.orgRoles;
    case "PROJECT_ROLE": return ctx.projectRoles;
    // An unrecognised kind matches nobody rather than everybody. A kind removed
    // in code but still present in old rows must not widen an audience.
    default: return [];
  }
}

/** Pure audience decision. No I/O, so it is directly testable. */
export function matchesAudience(a: TargetableAnnouncement, ctx: AudienceContext): boolean {
  if (a.audienceMode !== "FILTERED") return true;

  const byKind = new Map<string, string[]>();
  for (const t of a.targets || []) {
    if (!byKind.has(t.kind)) byKind.set(t.kind, []);
    byKind.get(t.kind)!.push(t.value);
  }
  if (byKind.size === 0) return false;

  const kindMatches = (kind: string, values: string[]) => {
    const mine = contextValuesFor(kind, ctx);
    return values.some((v) => mine.includes(v));
  };

  if (a.matchMode === "ALL") {
    for (const [kind, values] of byKind) {
      if (!kindMatches(kind, values)) return false;
    }
    return true;
  }
  for (const [kind, values] of byKind) {
    if (kindMatches(kind, values)) return true;
  }
  return false;
}

/** True when the schedule and publish flag make it visible at `now`. */
export function isLive(
  a: { isActive: boolean; startsAt: Date | string; expiresAt?: Date | string | null },
  now: Date = new Date()
): boolean {
  if (!a.isActive) return false;
  if (new Date(a.startsAt) > now) return false;
  if (a.expiresAt && new Date(a.expiresAt) <= now) return false;
  return true;
}

/** Lifecycle label for the admin list. Derived, never stored, so it cannot go stale. */
export function announcementStatus(
  a: { isActive: boolean; startsAt: Date | string; expiresAt?: Date | string | null },
  now: Date = new Date()
): "DRAFT" | "SCHEDULED" | "ACTIVE" | "EXPIRED" {
  if (!a.isActive) return "DRAFT";
  if (a.expiresAt && new Date(a.expiresAt) <= now) return "EXPIRED";
  if (new Date(a.startsAt) > now) return "SCHEDULED";
  return "ACTIVE";
}

/** Reads everything about one user that targeting can key on. */
export async function buildAudienceContext(userId: string): Promise<AudienceContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      userType: true,
      orgMemberships: { select: { orgId: true, role: true } },
      projectMemberships: { select: { projectId: true, role: true } },
      teamMemberships: { select: { teamId: true } },
    },
  });
  if (!user) return null;

  return {
    userId: user.id,
    userType: user.userType || "EMPLOYEE",
    orgIds: user.orgMemberships.map((m) => m.orgId),
    projectIds: user.projectMemberships.map((m) => m.projectId),
    teamIds: user.teamMemberships.map((m) => m.teamId),
    orgRoles: [...new Set(user.orgMemberships.map((m) => m.role))],
    projectRoles: [...new Set(user.projectMemberships.map((m) => m.role))],
  };
}

/**
 * The announcements one user should see, newest and most severe first.
 *
 * Filtering is applied here rather than in SQL because a match depends on the
 * user's whole membership graph and on matchMode. The candidate set is first
 * narrowed by the schedule in the database, so only live rows are examined.
 */
export async function resolveAnnouncementsForUser(userId: string, take = 10) {
  const ctx = await buildAudienceContext(userId);
  if (!ctx) return [];

  const now = new Date();
  const candidates = await prisma.systemAnnouncement.findMany({
    where: {
      isActive: true,
      startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    include: { targets: { select: { kind: true, value: true } } },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
  });

  return candidates.filter((a) => matchesAudience(a, ctx)).slice(0, take);
}

/**
 * The user ids an announcement should notify.
 *
 * Used by the broadcast fan-out, which previously wrote a notification for
 * every active account regardless of the audience.
 */
export async function resolveRecipientIds(announcementId: string): Promise<string[]> {
  const a = await prisma.systemAnnouncement.findUnique({
    where: { id: announcementId },
    include: { targets: { select: { kind: true, value: true } } },
  });
  if (!a) return [];

  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      userType: true,
      orgMemberships: { select: { orgId: true, role: true } },
      projectMemberships: { select: { projectId: true, role: true } },
      teamMemberships: { select: { teamId: true } },
    },
  });

  return users
    .filter((u) =>
      matchesAudience(a, {
        userId: u.id,
        userType: u.userType || "EMPLOYEE",
        orgIds: u.orgMemberships.map((m) => m.orgId),
        projectIds: u.projectMemberships.map((m) => m.projectId),
        teamIds: u.teamMemberships.map((m) => m.teamId),
        orgRoles: [...new Set(u.orgMemberships.map((m) => m.role))],
        projectRoles: [...new Set(u.projectMemberships.map((m) => m.role))],
      })
    )
    .map((u) => u.id);
}

/**
 * Validates targets against the live database.
 *
 * Ids are checked to exist so a typo cannot be stored as an audience that
 * silently matches nobody, and enumerated kinds are checked against their
 * allowed set. Returns the problems rather than throwing, so the API can report
 * all of them at once.
 */
export async function validateTargets(targets: AnnouncementTargetInput[]): Promise<string[]> {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const t of targets) {
    if (!TARGET_KINDS.includes(t.kind as TargetKind)) {
      errors.push(`Unknown target kind "${t.kind}"`);
      continue;
    }
    const value = String(t.value || "").trim();
    if (!value) {
      errors.push(`Empty value for target kind ${t.kind}`);
      continue;
    }
    const key = `${t.kind}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const allowed = ENUMERATED_TARGET_VALUES[t.kind as TargetKind];
    if (allowed) {
      if (!allowed.includes(value)) {
        errors.push(`${t.kind} must be one of ${allowed.join(", ")} — got "${value}"`);
      }
      continue;
    }

    const exists =
      t.kind === "ORG"
        ? await prisma.organization.count({ where: { id: value } })
        : t.kind === "PROJECT"
          ? await prisma.project.count({ where: { id: value } })
          : t.kind === "TEAM"
            ? await prisma.team.count({ where: { id: value } })
            : t.kind === "USER"
              ? await prisma.user.count({ where: { id: value } })
              : 0;
    if (!exists) errors.push(`${t.kind} "${value}" does not exist`);
  }

  return errors;
}

/** Deduplicates targets, so re-saving the same audience is idempotent. */
export function dedupeTargets(targets: AnnouncementTargetInput[]): AnnouncementTargetInput[] {
  const seen = new Set<string>();
  const out: AnnouncementTargetInput[] = [];
  for (const t of targets) {
    const value = String(t.value || "").trim();
    const key = `${t.kind}:${value}`;
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: t.kind, value });
  }
  return out;
}
