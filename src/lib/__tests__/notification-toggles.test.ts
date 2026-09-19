/**
 * C3 — every notification toggle must control a notification that exists.
 *
 * WHAT WAS WRONG
 *
 * The preferences page offered ten switches. Four of them corresponded to a
 * notification the server really sent. The other six — TEAM_ASSIGNMENT,
 * COMMENT, STATUS_CHANGE, DUE_DATE, SPRINT, ROLE — were never dispatched by
 * anything, so toggling them changed nothing whichever way they were set.
 *
 * That is worse than not offering them. The user believes they configured
 * something; the notification never arrives; the conclusion is that
 * notifications are broken rather than that the control was decorative. It is
 * also invisible to every other kind of test: the page renders, the toggle
 * saves, the value round-trips. Nothing is wrong except that nothing happens.
 *
 * One of the six could not have worked even once implemented: the toggle key
 * was STATUS_CHANGE while the dispatch type was STATUS, and the preference
 * lookup is `prefs[type]`. That mismatch is the kind of thing that gets
 * diagnosed as "notifications are flaky".
 *
 * WHY A SOURCE-READING TEST
 *
 * The relationship being checked spans a route file, the engine and every
 * caller. There is no runtime seam where "is this toggle connected to
 * anything" can be asked, so the check reads the source — the same approach as
 * issue-payload-bounds and sync-bus, and for the same reason: the defect is
 * invisible in a green run and in review.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { readdirSync, statSync } from "fs";

const SRC = join(__dirname, "..", "..");

/** A file with its comments removed, so prose cannot satisfy a code assertion. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const prefsRoute = readFileSync(
  join(SRC, "app", "api", "users", "notification-preferences", "route.ts"),
  "utf8"
);

/** The types the preferences endpoint offers a toggle for. */
function offeredTypes(): string[] {
  const block = prefsRoute.match(/const NOTIFICATION_TYPES = \[([\s\S]*?)\] as const;/);
  if (!block) throw new Error("NOTIFICATION_TYPES not found in the preferences route");
  return [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

/** The types something in the codebase actually dispatches. */
function dispatchedTypes(): Set<string> {
  const found = new Set<string>();
  for (const file of walk(SRC)) {
    if (file.includes("__tests__")) continue;
    const src = readFileSync(file, "utf8");
    if (!/notificationEngine\.dispatch\(/.test(src)) continue;
    // `type: "X"` within a dispatch call. Deliberately simple: a dispatch
    // whose type is computed cannot be verified this way, and there is exactly
    // one of those (the user-initiated POST /api/notifications), handled below.
    for (const m of src.matchAll(/type:\s*"([A-Z_]+)"/g)) found.add(m[1]);
  }
  return found;
}

describe("notification preference toggles", () => {
  const offered = offeredTypes();
  const dispatched = dispatchedTypes();

  it("offers at least one toggle", () => {
    expect(offered.length).toBeGreaterThan(0);
  });

  it.each(offeredTypes())("the %s toggle controls a notification that is actually sent", (type) => {
    // If this fails, either the notification was never built or its dispatch
    // type does not match the toggle key. Both leave the user with a control
    // that does nothing. Remove the toggle, or send the notification — see the
    // comment above NOTIFICATION_TYPES for which four were removed and why.
    expect([...dispatched]).toContain(type);
  });

  it("the default preferences cover exactly the offered types", () => {
    // A type offered but missing from DEFAULT_PREFS falls back to "on" by
    // accident rather than by decision; one present but not offered is dead
    // configuration that outlives the toggle it belonged to.
    const defaults = prefsRoute.match(/const DEFAULT_PREFS[\s\S]*?\n};/);
    expect(defaults).toBeTruthy();
    const keys = [...defaults![0].matchAll(/^\s{2}([A-Z_]+):/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...offered].sort());
  });

  it("no toggle key is a near-miss of a dispatch type", () => {
    // The STATUS_CHANGE / STATUS trap: a key that looks right, is spelled
    // differently, and therefore never matches the `prefs[type]` lookup.
    for (const type of offered) {
      const nearMiss = [...dispatched].find(
        (d) => d !== type && (d.startsWith(type) || type.startsWith(d))
      );
      expect(nearMiss).toBeUndefined();
    }
  });
});

describe("the notifications that were built for these toggles", () => {
  it("a comment notifies the issue's subscribers", () => {
    const src = readFileSync(
      join(SRC, "app", "api", "issues", "[id]", "comments", "route.ts"),
      "utf8"
    );
    expect(src).toMatch(/getIssueSubscribers/);
    expect(src).toMatch(/type: "COMMENT"/);
    // A mentioned user gets a MENTION, not both.
    expect(src).toMatch(/excludeUserIds: notifiedUserIds/);
  });

  it("a status change notifies the issue's subscribers", () => {
    const src = readFileSync(join(SRC, "app", "api", "issues", "[id]", "route.ts"), "utf8");
    expect(src).toMatch(/getIssueSubscribers/);
    expect(src).toMatch(/type: "STATUS"/);
  });

  it("announcements go through the engine, so preferences apply to them", () => {
    // They used to be written straight to the table, which skipped the
    // preference check and published no realtime event.
    //
    // Comments are stripped first: the paragraph in that file explaining what
    // it no longer does mentions the call by name, and matched. A structural
    // test that reads prose as code fails on an accurate comment, which is the
    // fastest way to teach people to stop writing them.
    const src = code(join(SRC, "app", "api", "super-admin", "announcements", "route.ts"));
    expect(src).toMatch(/notificationEngine\.dispatch/);
    expect(src).not.toMatch(/prisma\.notification\.createMany/);
  });

  it("both new notifications are idempotent", () => {
    // A retried request must not produce a second notification for the same
    // comment or the same transition.
    const comments = readFileSync(
      join(SRC, "app", "api", "issues", "[id]", "comments", "route.ts"),
      "utf8"
    );
    const issue = readFileSync(join(SRC, "app", "api", "issues", "[id]", "route.ts"), "utf8");
    expect(comments).toMatch(/idempotencyKey: `comment:/);
    expect(issue).toMatch(/idempotencyKey: `status:/);
  });
});
