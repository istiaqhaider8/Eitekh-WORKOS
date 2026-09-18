#!/usr/bin/env node
/**
 * Fails when a mutating API route reads a request body without a Zod schema.
 *
 * Eight routes did. Three of them were unauthenticated, and one of those --
 * auth/invite -- took `role` straight from the body with no check on the
 * inviter's own role, while auth/invitation creates the OrganizationMember with
 * `role: invitation.role`. An organization MEMBER could therefore mint an OWNER
 * invitation, and a value like "GOD_MODE" was stored verbatim. That is what an
 * unvalidated body costs, so it is worth a build step rather than a convention.
 *
 * A route counts as validated if it uses parseBody, parseJsonBody or safeParse.
 * A route that never reads a body needs nothing, so it is not flagged.
 *
 * Run: node scripts/check-route-validation.mjs
 * Exit: 0 clean, 1 violations found.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const API_ROOT = "src/app/api";
const MUTATING = /export\s+async\s+function\s+(POST|PATCH|PUT)\b/;
const VALIDATED = /parseBody|parseJsonBody|safeParse/;
/** Reading the body at all is what creates the exposure. */
const READS_BODY = /await\s+(req|request|_req)\s*\.\s*(json|formData|text)\s*\(/;

/**
 * Routes allowed to read a body without a schema, each with a reason.
 * Keep this empty if you can; every entry is an exception to argue about.
 */
const ALLOWED = new Map([
  // Reads only `label`, behind an explicit `typeof body.label === "string"`
  // guard, and is super-admin only. Listed rather than rewritten because the
  // guard already does what a schema would for a single optional string.
  ["super-admin/backups", "single optional string behind a typeof guard, super-admin only"],
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry === "route.ts") out.push(p);
  }
  return out;
}

const files = walk(API_ROOT);
const violations = [];
let mutating = 0;
let validated = 0;
let noBody = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!MUTATING.test(src)) continue;
  mutating++;

  const name = file.replace(/\\/g, "/").replace(`${API_ROOT}/`, "").replace("/route.ts", "");

  if (VALIDATED.test(src)) { validated++; continue; }
  if (!READS_BODY.test(src)) { noBody++; continue; }
  if (ALLOWED.has(name)) { validated++; continue; }

  violations.push(name);
}

console.log(
  `route validation: ${mutating} mutating routes — ${validated} validated, ` +
  `${noBody} read no body, ${violations.length} unvalidated`
);

if (violations.length) {
  console.error("\nThese mutating routes read a request body with no Zod schema:\n");
  for (const v of violations) console.error(`  src/app/api/${v}/route.ts`);
  console.error(
    "\nAdd a schema in src/lib/validation.ts and parse with parseJsonBody:\n" +
    "  const parsed = await parseJsonBody(req, mySchema);\n" +
    "  if (!parsed.success) return parsed.error;\n" +
    "  const { ... } = parsed.data;\n\n" +
    "If a route genuinely needs no schema, add it to ALLOWED in this script\n" +
    "with the reason — deliberately, not silently.\n"
  );
  process.exit(1);
}
