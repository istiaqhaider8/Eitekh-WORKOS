#!/usr/bin/env node
/**
 * B4 — fail the build when a tenant-scoped API route has no isolation test.
 *
 * WHY THIS IS A BUILD STEP AND NOT A REVIEW HABIT
 *
 * There are 127 route files. The isolation suite reached two route families
 * first, and BOTH contained a real vulnerability — the team-members email leak
 * and the project-manager privilege escalation. That is not a coincidence
 * worth betting the remaining families against, and the gap did not come from
 * carelessness: it came from a route being added months after the tests, with
 * nothing to notice.
 *
 * So the ratchet matters more than the sweep. A sweep is out of date the next
 * time someone adds a route; this makes adding one a decision.
 *
 * WHAT "COVERED" MEANS HERE, PRECISELY
 *
 * That the integration suite ISSUES A REQUEST to the route. It does NOT mean
 * the assertion is correct, or that every method and every parameter is
 * exercised. A checker cannot know that. What it can do is make the absence of
 * any test at all impossible to ship silently, which is the failure this is
 * aimed at.
 *
 * Read the exemption list as the interesting part. Every entry is a claim that
 * a route needs no tenant isolation, and each one is an argument someone can
 * lose.
 *
 * Run:  node scripts/check-isolation-coverage.mjs
 * Exit: 0 clean, 1 uncovered routes found.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const API_ROOT = "src/app/api";
const TEST_DIR = "__tests__/integration";

/**
 * Routes that legitimately need no tenant-isolation test, each with a reason.
 *
 * Keep this list short and argued. "It's probably fine" is not a reason; the
 * two vulnerabilities found so far were both in routes that looked fine.
 */
const EXEMPT = new Map([
  // --- not tenant-scoped at all -------------------------------------------
  ["health", "liveness probe; returns no tenant data"],
  ["docs", "serves repository documentation, identical for every caller"],
  ["docs/download", "same as docs"],
  ["telemetry/client", "write-only error sink; accepts reports, returns nothing"],
  ["internal/alerts/check", "cron endpoint behind ALERT_CHECK_SECRET, not a session"],

  // --- authentication: pre-tenant by definition ----------------------------
  ["auth/login", "establishes a session; there is no tenant yet"],
  ["auth/logout", "ends the caller's own session"],
  ["auth/register", "creates a user; pre-tenant"],
  ["auth/forgot-password", "unauthenticated by design; rate-limited"],
  ["auth/reset-password", "token-scoped, not session-scoped"],
  ["auth/verify-email", "token-scoped"],
  ["auth/verify-otp", "token-scoped"],
  ["auth/resend-otp", "token-scoped"],
  ["auth/invitation", "token-scoped; the token IS the authorization"],
  ["auth/me", "returns the caller's own identity and nothing else"],
  ["auth/profile", "the caller's own profile"],
  ["auth/change-password", "the caller's own password"],
  ["auth/mfa", "the caller's own MFA settings"],
  ["auth/sessions", "the caller's own sessions"],

  // --- scoped to the caller, with no id parameter to tamper with -----------
  ["users/my-tasks", "filtered to the caller; no id parameter"],
  ["users/notification-preferences", "the caller's own preferences"],
  ["notifications", "filtered to the caller; cross-tenant denial covered live and by the notification probe"],
  ["announcements", "announcements targeted at the caller; audience logic covered by unit tests"],
]);

/**
 * Routes that DO need an isolation test and do not have one yet.
 *
 * Deliberately a separate list from EXEMPT, because it means the opposite
 * thing. EXEMPT says "no test is needed"; this says "a test is needed and has
 * not been written". Collapsing the two would turn honest debt into a claim of
 * coverage, which is the failure this whole script exists to prevent.
 *
 * These do not fail the build — the ratchet is aimed at NEW routes, and
 * failing on a pre-existing backlog would mean the first person to add a route
 * has to clear someone else's debt. They are printed on every run so the
 * number is in front of whoever is looking.
 *
 * Each needs a fixture the two-tenant fixture does not build yet.
 */
const KNOWN_GAPS = new Map([
  ["jobs/:id", "needs a Job row per tenant in the fixture"],
  ["pbac/roles/:id", "needs a PbacRole per tenant; the fixture provisions none"],
  ["pbac/roles/:id/users", "same as pbac/roles/:id"],
  ["recurring-tasks/:id", "needs a RecurringTask per tenant"],
  ["recurring-tasks/trigger", "cron-shaped; decide first whether it should be session-authenticated at all"],
  ["users/delegations/:id", "needs a TaskDelegation per tenant"],
  ["users/leave/:id", "needs a LeaveRequest per tenant"],
]);

/** Route families covered by the super-admin denial sweep in authz.test.ts. */
const SUPER_ADMIN_SWEEP = "super-admin/";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry === "route.ts") out.push(p);
  }
  return out;
}

/** `src/app/api/projects/[id]/export/route.ts` -> `projects/:id/export` */
function routeName(file) {
  return file
    .replace(/\\/g, "/")
    .replace(`${API_ROOT}/`, "")
    .replace("/route.ts", "")
    .replace(/\[[^\]]+\]/g, ":id");
}

// ---------------------------------------------------------------------------
// What the integration suite touches.
// ---------------------------------------------------------------------------
const testFiles = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => join(TEST_DIR, f));

const testSource = testFiles.map((f) => readFileSync(f, "utf8")).join("\n");

/**
 * Every `/api/...` path the tests mention, normalised.
 *
 * A `${...}` interpolation becomes `:id`. That is right for ids and wrong for
 * the loops that interpolate a SEGMENT NAME — `/api/projects/${id}/${p}` where
 * p runs over ["issues", "members", "analytics", ...]. Those are handled below
 * by treating a trailing `:id` as a wildcard, and only when the loop's segment
 * names appear as plain string literals in the same suite.
 */
const mentioned = new Set();
// `/api/...` ANYWHERE inside a string, not only at its start. Requiring the
// quote immediately before it missed every absolute URL — the SSE test builds
// `${BASE_URL}/api/sync/events?...` — and reported covered routes as gaps,
// which is the failure mode that gets a checker switched off.
for (const m of testSource.matchAll(/\/api\/[^"'`\s)]+/g)) {
  const path = m[0]
    .replace(/\$\{[^}]*\}/g, ":id")
    .split("?")[0]
    .replace(/\/+$/, "");
  mentioned.add(path);
}

/**
 * Bare string literals, for expanding the segment-name loops.
 *
 * Slashes are allowed because the loops contain multi-segment tails —
 * `["export", "reports/download", "import/template", ...]` — and excluding
 * them reported two covered routes as gaps.
 */
const literals = new Set();
for (const m of testSource.matchAll(/["'`]([a-z0-9][a-z0-9/-]{1,40})["'`]/gi)) {
  literals.add(m[1]);
}

function isCovered(name) {
  if (mentioned.has(`/api/${name}`)) return true;

  /**
   * A loop over sub-route names, e.g.
   *
   *   for (const p of ["export", "reports/download"])
   *     api(user, `/api/projects/${id}/${p}`)
   *
   * which reaches this script as the path `/api/projects/:id/:id` plus the
   * tails as plain literals. Every split point is tried, because the tail may
   * be more than one segment.
   */
  const segments = name.split("/");
  for (let i = 1; i < segments.length; i++) {
    const prefix = segments.slice(0, i);
    const tail = segments.slice(i).join("/");
    if (mentioned.has(`/api/${[...prefix, ":id"].join("/")}`) && literals.has(tail)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
const files = walk(API_ROOT);
const uncovered = [];
const staleGaps = [];
let covered = 0;
let exempt = 0;
let knownGap = 0;

for (const file of files) {
  const name = routeName(file);

  if (EXEMPT.has(name)) { exempt++; continue; }
  if (name.startsWith(SUPER_ADMIN_SWEEP)) {
    // authz.test.ts sweeps this directory and has its own guard asserting the
    // sweep list is complete, so a new super-admin route fails THERE.
    exempt++;
    continue;
  }

  if (isCovered(name)) {
    covered++;
    // A gap that is now covered should leave the list, or the list becomes a
    // record of what used to be true.
    if (KNOWN_GAPS.has(name)) staleGaps.push(name);
    continue;
  }

  if (KNOWN_GAPS.has(name)) { knownGap++; continue; }
  uncovered.push(name);
}

console.log(
  `isolation coverage: ${files.length} routes — ${covered} exercised by the ` +
  `integration suite, ${exempt} exempt, ${knownGap} known gaps, ` +
  `${uncovered.length} unaccounted for`
);

if (knownGap > 0) {
  console.log("\nKnown gaps — these need an isolation test and do not have one:");
  for (const [name, reason] of KNOWN_GAPS) {
    if (!staleGaps.includes(name)) console.log(`  ${name.padEnd(30)} ${reason}`);
  }
}

if (staleGaps.length) {
  console.error("\nThese are listed as KNOWN_GAPS but ARE now covered. Remove them:\n");
  for (const s of staleGaps) console.error(`  ${s}`);
  console.error("\nA stale gap list is worse than none: it understates coverage and\n" +
    "trains people to ignore the output.\n");
  process.exit(1);
}

if (uncovered.length) {
  console.error("\nThese tenant-scoped routes have no isolation test:\n");
  for (const u of uncovered) console.error(`  src/app/api/${u}/route.ts`);
  console.error(
    "\nAdd a denial test to __tests__/integration/ — at minimum, that a user of\n" +
    "org A is refused org B's resource, and that the response body does not\n" +
    "contain org B's data.\n\n" +
    "Two things to get right, both of which have produced tests that asserted\n" +
    "nothing here before:\n" +
    "  - use a method the route actually implements; a 405 never reaches the guard\n" +
    "  - send a VALID body; a 400 from the schema never reaches it either\n\n" +
    "The two route families the suite reached first BOTH held a real\n" +
    "vulnerability, so an untested family is not a neutral gap.\n\n" +
    "If a route genuinely needs no isolation test, add it to EXEMPT WITH THE\n" +
    "REASON. If it needs one you are not writing now, add it to KNOWN_GAPS —\n" +
    "deliberately, not silently.\n"
  );
  process.exit(1);
}
