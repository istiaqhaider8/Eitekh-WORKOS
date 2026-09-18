/**
 * Tests for announcement audience targeting (src/lib/announcement-targeting.ts).
 *
 * `matchesAudience` decides who reads a broadcast, so the cases that matter
 * most are the ones where it must say NO. Before this module existed the feed
 * returned every active announcement to every signed-in user, so an
 * over-permissive match here is a regression to that behaviour rather than a
 * cosmetic bug.
 */

import {
  matchesAudience,
  isLive,
  announcementStatus,
  dedupeTargets,
  TARGET_KINDS,
  ENUMERATED_TARGET_VALUES,
  type AudienceContext,
} from "../announcement-targeting";

const ctx = (over: Partial<AudienceContext> = {}): AudienceContext => ({
  userId: "user-1",
  userType: "EMPLOYEE",
  orgIds: ["org-1"],
  projectIds: ["proj-1"],
  teamIds: ["team-1"],
  orgRoles: ["MEMBER"],
  projectRoles: ["PROJECT_MEMBER"],
  ...over,
});

const filtered = (targets: Array<[string, string]>, matchMode = "ANY") => ({
  audienceMode: "FILTERED",
  matchMode,
  targets: targets.map(([kind, value]) => ({ kind, value })),
});

describe("matchesAudience — audienceMode ALL", () => {
  it("reaches everyone", () => {
    const a = { audienceMode: "ALL", matchMode: "ANY", targets: [] };
    expect(matchesAudience(a, ctx())).toBe(true);
    expect(matchesAudience(a, ctx({ userType: "CLIENT", orgIds: [], projectIds: [], teamIds: [] }))).toBe(true);
  });

  it("ignores any targets that happen to be attached", () => {
    const a = { audienceMode: "ALL", matchMode: "ANY", targets: [{ kind: "PROJECT", value: "other" }] };
    expect(matchesAudience(a, ctx())).toBe(true);
  });
});

describe("matchesAudience — one kind at a time", () => {
  const cases: Array<[string, string, string, Partial<AudienceContext>]> = [
    ["PROJECT", "proj-1", "proj-9", { projectIds: ["proj-1"] }],
    ["ORG", "org-1", "org-9", { orgIds: ["org-1"] }],
    ["TEAM", "team-1", "team-9", { teamIds: ["team-1"] }],
    ["USER", "user-1", "user-9", { userId: "user-1" }],
    ["USER_TYPE", "EMPLOYEE", "CLIENT", { userType: "EMPLOYEE" }],
    ["ORG_ROLE", "MEMBER", "OWNER", { orgRoles: ["MEMBER"] }],
    ["PROJECT_ROLE", "PROJECT_MEMBER", "VIEWER", { projectRoles: ["PROJECT_MEMBER"] }],
  ];

  it.each(cases)("%s matches the user's own value", (kind, mine, _other, over) => {
    expect(matchesAudience(filtered([[kind, mine]]), ctx(over))).toBe(true);
  });

  it.each(cases)("%s does not match someone else's value", (kind, _mine, other, over) => {
    expect(matchesAudience(filtered([[kind, other]]), ctx(over))).toBe(false);
  });

  it("covers every declared kind", () => {
    // A kind added without a case above would otherwise go untested.
    expect(cases.map((c) => c[0]).sort()).toEqual([...TARGET_KINDS].sort());
  });
});

describe("matchesAudience — several values of one kind are alternatives", () => {
  it("matches when the user is in any listed project", () => {
    expect(matchesAudience(filtered([["PROJECT", "proj-9"], ["PROJECT", "proj-1"]]), ctx())).toBe(true);
  });

  it("does not match when the user is in none of them", () => {
    expect(matchesAudience(filtered([["PROJECT", "proj-8"], ["PROJECT", "proj-9"]]), ctx())).toBe(false);
  });

  it("matches a user who belongs to several projects", () => {
    expect(
      matchesAudience(filtered([["PROJECT", "proj-2"]]), ctx({ projectIds: ["proj-1", "proj-2"] }))
    ).toBe(true);
  });
});

describe("matchesAudience — matchMode ANY across kinds", () => {
  it("matches on one kind even when another does not", () => {
    // "Project X, and separately every Client."
    const a = filtered([["PROJECT", "proj-9"], ["USER_TYPE", "EMPLOYEE"]], "ANY");
    expect(matchesAudience(a, ctx())).toBe(true);
  });

  it("does not match when no kind matches", () => {
    const a = filtered([["PROJECT", "proj-9"], ["USER_TYPE", "CLIENT"]], "ANY");
    expect(matchesAudience(a, ctx())).toBe(false);
  });
});

describe("matchesAudience — matchMode ALL across kinds", () => {
  // The case that motivates ALL: "Clients who are in Project X".
  const clientsInProject = filtered([["PROJECT", "proj-1"], ["USER_TYPE", "CLIENT"]], "ALL");

  it("matches only when every kind matches", () => {
    expect(matchesAudience(clientsInProject, ctx({ userType: "CLIENT", projectIds: ["proj-1"] }))).toBe(true);
  });

  it("rejects the right project but the wrong type", () => {
    expect(matchesAudience(clientsInProject, ctx({ userType: "EMPLOYEE", projectIds: ["proj-1"] }))).toBe(false);
  });

  it("rejects the right type but the wrong project", () => {
    expect(matchesAudience(clientsInProject, ctx({ userType: "CLIENT", projectIds: ["proj-9"] }))).toBe(false);
  });

  it("still ORs within a kind", () => {
    const a = filtered([["PROJECT", "proj-1"], ["PROJECT", "proj-2"], ["USER_TYPE", "CLIENT"]], "ALL");
    expect(matchesAudience(a, ctx({ userType: "CLIENT", projectIds: ["proj-2"] }))).toBe(true);
  });
});

describe("matchesAudience — fails closed", () => {
  it("reaches nobody when FILTERED with no targets", () => {
    // The opposite default would turn a half-filled form into a platform-wide
    // broadcast.
    expect(matchesAudience({ audienceMode: "FILTERED", matchMode: "ANY", targets: [] }, ctx())).toBe(false);
    expect(matchesAudience({ audienceMode: "FILTERED", matchMode: "ALL", targets: [] }, ctx())).toBe(false);
  });

  it("treats an unrecognised kind as matching nobody", () => {
    expect(matchesAudience(filtered([["DEPARTMENT", "sales"]]), ctx())).toBe(false);
  });

  it("does not let an unknown kind widen an ALL-mode audience", () => {
    const a = filtered([["PROJECT", "proj-1"], ["DEPARTMENT", "sales"]], "ALL");
    expect(matchesAudience(a, ctx())).toBe(false);
  });

  it("matches nobody when the user has no memberships", () => {
    const empty = ctx({ orgIds: [], projectIds: [], teamIds: [], orgRoles: [], projectRoles: [] });
    expect(matchesAudience(filtered([["PROJECT", "proj-1"]]), empty)).toBe(false);
    expect(matchesAudience(filtered([["ORG", "org-1"]]), empty)).toBe(false);
    // USER and USER_TYPE still apply — they do not depend on membership.
    expect(matchesAudience(filtered([["USER", "user-1"]]), empty)).toBe(true);
  });
});

describe("isLive — publish and expiry", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const at = (s: string) => new Date(s);

  it("is live inside the window", () => {
    expect(isLive({ isActive: true, startsAt: at("2026-06-01T00:00:00Z"), expiresAt: at("2026-07-01T00:00:00Z") }, now)).toBe(true);
  });

  it("is not live before it starts", () => {
    expect(isLive({ isActive: true, startsAt: at("2026-07-01T00:00:00Z"), expiresAt: null }, now)).toBe(false);
  });

  it("is not live after it expires", () => {
    expect(isLive({ isActive: true, startsAt: at("2026-01-01T00:00:00Z"), expiresAt: at("2026-06-01T00:00:00Z") }, now)).toBe(false);
  });

  it("is not live when unpublished, even inside the window", () => {
    expect(isLive({ isActive: false, startsAt: at("2026-06-01T00:00:00Z"), expiresAt: null }, now)).toBe(false);
  });

  it("never expires when expiresAt is null", () => {
    expect(isLive({ isActive: true, startsAt: at("2026-01-01T00:00:00Z"), expiresAt: null }, now)).toBe(true);
  });

  it("treats the expiry instant as already expired", () => {
    expect(isLive({ isActive: true, startsAt: at("2026-01-01T00:00:00Z"), expiresAt: now }, now)).toBe(false);
  });
});

describe("announcementStatus", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const at = (s: string) => new Date(s);

  it("labels each lifecycle state", () => {
    expect(announcementStatus({ isActive: false, startsAt: at("2026-06-01T00:00:00Z"), expiresAt: null }, now)).toBe("DRAFT");
    expect(announcementStatus({ isActive: true, startsAt: at("2026-07-01T00:00:00Z"), expiresAt: null }, now)).toBe("SCHEDULED");
    expect(announcementStatus({ isActive: true, startsAt: at("2026-06-01T00:00:00Z"), expiresAt: null }, now)).toBe("ACTIVE");
    expect(announcementStatus({ isActive: true, startsAt: at("2026-01-01T00:00:00Z"), expiresAt: at("2026-02-01T00:00:00Z") }, now)).toBe("EXPIRED");
  });

  it("reports an unpublished announcement as DRAFT even once expired", () => {
    expect(announcementStatus({ isActive: false, startsAt: at("2026-01-01T00:00:00Z"), expiresAt: at("2026-02-01T00:00:00Z") }, now)).toBe("DRAFT");
  });
});

describe("dedupeTargets", () => {
  it("collapses repeats and trims", () => {
    expect(
      dedupeTargets([
        { kind: "PROJECT", value: "p1" },
        { kind: "PROJECT", value: " p1 " },
        { kind: "PROJECT", value: "p2" },
      ])
    ).toEqual([
      { kind: "PROJECT", value: "p1" },
      { kind: "PROJECT", value: "p2" },
    ]);
  });

  it("keeps the same value under different kinds", () => {
    expect(dedupeTargets([{ kind: "USER", value: "x" }, { kind: "TEAM", value: "x" }])).toHaveLength(2);
  });

  it("drops empty values", () => {
    expect(dedupeTargets([{ kind: "PROJECT", value: "" }, { kind: "PROJECT", value: "   " }])).toEqual([]);
  });
});

describe("ENUMERATED_TARGET_VALUES", () => {
  it("offers exactly Employee and Client for USER_TYPE", () => {
    expect(ENUMERATED_TARGET_VALUES.USER_TYPE).toEqual(["EMPLOYEE", "CLIENT"]);
  });

  it("covers the project roles a member can hold", () => {
    expect(ENUMERATED_TARGET_VALUES.PROJECT_ROLE).toContain("PROJECT_ADMIN");
    expect(ENUMERATED_TARGET_VALUES.PROJECT_ROLE).toContain("PROJECT_MANAGER");
    expect(ENUMERATED_TARGET_VALUES.PROJECT_ROLE).toContain("VIEWER");
  });
});
