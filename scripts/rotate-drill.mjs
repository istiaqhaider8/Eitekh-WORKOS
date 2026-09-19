/**
 * A5 follow-up — rehearse a FIELD_ENCRYPTION_KEY rotation, automatically.
 *
 * WHY THIS EXISTS
 *
 * rotate-encryption-key.mjs has a good self-test, but the self-test only
 * proves the script agrees with ITSELF: it encrypts a probe with its own code
 * and decrypts it with its own code. The failure it cannot see is drift from
 * `src/lib/encryption.ts` — the envelope the application actually writes. An
 * earlier draft of the rotation script detected encrypted values by counting
 * colons and would have skipped every row while reporting a clean rotation.
 *
 * So this drill seeds rows using the APPLICATION's encryption module, rotates
 * them with the script, and reads them back with the APPLICATION's module
 * again. If the two ever diverge, this fails.
 *
 * It also checks the branches that matter more than the happy path:
 *   - a dry run writes nothing
 *   - a legacy plaintext value is skipped, not mangled
 *   - hashed recoveryCodes are left alone
 *   - the OLD key can no longer read the rotated rows
 *   - a WRONG old key fails and writes nothing
 *   - identical / malformed keys are refused
 *   - a second rotation still works
 *
 * SAFETY
 *
 * Runs only against a scratch database it creates and drops, whose name must
 * contain "drill". Keys are generated per run and never printed.
 *
 * Usage:
 *   node scripts/rotate-drill.mjs --admin <url> [--scratch <dbname>]
 */

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { ghError, ghNotice } from "./gh-annotate.mjs";

const require_ = createRequire(import.meta.url);
const { Client } = require_("pg");
const { PrismaClient } = require_("@prisma/client");

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const ADMIN = argOf("--admin", process.env.DRILL_ADMIN_URL);
const SCRATCH_DB = argOf("--scratch", "eitekh_rotate_drill");

function die(msg, code = 2) {
  console.error(`\n[rotate-drill] ${msg}\n`);
  process.exit(code);
}

if (!ADMIN) die("--admin <url> is required (used to CREATE/DROP the scratch database).");
if (!/drill/i.test(SCRATCH_DB)) {
  die(`Refusing to use "${SCRATCH_DB}": the scratch database name must contain "drill". ` +
    "This drill inserts and rewrites rows.");
}

const URL_ = ADMIN.replace(/\/[^/?]+(\?|$)/, `/${SCRATCH_DB}$1`);

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  -- " + detail : ""));
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
    // See scripts/gh-annotate.mjs: the job log is admin-only on a public
    // repository, so a failure that speaks only to the log speaks to nobody.
    ghError("Key rotation drill", name + (detail ? " -- " + detail : ""));
  }
}

/**
 * A crash is a failure too, and it is the one the annotations would miss.
 *
 * Every `check()` reports itself, but this script does real work between the
 * checks — creating a scratch database, running migrations, spawning the
 * rotation tool — and a throw in any of that kills the process before a single
 * check has run. The CI step then fails with nothing attached at all, which is
 * the exact silence these annotations exist to end.
 */
for (const event of ["unhandledRejection", "uncaughtException"]) {
  process.on(event, (err) => {
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    ghError("Key rotation drill", `crashed before finishing (${event}): ${message}`);
    console.error(`\n[rotate-drill] ${event}:`, err);
    process.exit(1);
  });
}

/**
 * The environment, recorded up front.
 *
 * This drill compares the rotation tool against the application's own
 * encryption module, and both run on whatever node the runner ships. When it
 * starts failing on a commit that touched neither, this is the line that says
 * whether the ground moved.
 */
ghNotice("Key rotation drill environment", `node ${process.version} on ${process.platform}`);

async function admin(sql) {
  const c = new Client({ connectionString: ADMIN });
  await c.connect();
  try { return await c.query(sql); } finally { await c.end(); }
}

const KEY1 = crypto.randomBytes(32).toString("hex"); // what the rows start with
const KEY2 = crypto.randomBytes(32).toString("hex"); // what they are rotated to
const KEY3 = crypto.randomBytes(32).toString("hex"); // a key nothing was written with

const SECRET_A = "whsec_" + crypto.randomBytes(12).toString("hex");
const SECRET_B = "whsec_" + crypto.randomBytes(12).toString("hex");
const MFA = "JBSWY3DPEHPK3PXP";
const LEGACY_PLAINTEXT = "legacy-plaintext-secret";
const HASHED_RECOVERY = JSON.stringify(["$2a$10$fakehashone", "$2a$10$fakehashtwo"]);

/**
 * The application's own encryption module. getKey() reads
 * FIELD_ENCRYPTION_KEY on every call, so flipping the environment variable
 * between calls is enough — there is no module-level key to invalidate.
 */
const appEnc = await import(pathToFileURL(join(REPO, "src", "lib", "encryption.ts")).href);
function appEncrypt(keyHex, plaintext) {
  process.env.FIELD_ENCRYPTION_KEY = keyHex;
  return appEnc.encryptField(plaintext);
}
function appDecrypt(keyHex, envelope) {
  process.env.FIELD_ENCRYPTION_KEY = keyHex;
  return appEnc.decryptField(envelope);
}

const runRotate = (oldKey, newKey, extraArgs) =>
  spawnSync(process.execPath, [join(REPO, "scripts", "rotate-encryption-key.mjs"), ...(extraArgs || [])], {
    cwd: REPO,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: URL_,
      OLD_FIELD_ENCRYPTION_KEY: oldKey,
      FIELD_ENCRYPTION_KEY: newKey,
    },
  });

// ---------------------------------------------------------- 1. scratch db
console.log("--- 1. scratch database + schema");
await admin(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`);
await admin(`CREATE DATABASE "${SCRATCH_DB}"`);
const mig = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  cwd: REPO, encoding: "utf8", shell: true,
  env: { ...process.env, DATABASE_URL: URL_ },
});
check("migrations applied to the scratch database", mig.status === 0,
  mig.status === 0 ? "" : String(mig.stdout + mig.stderr).trim().split("\n").slice(-2).join(" | "));

const prisma = new PrismaClient({ datasources: { db: { url: URL_ } } });

// ---------------------------------------------------------- 2. seed
console.log("\n--- 2. seed rows encrypted with the OLD key, using the APPLICATION's code");
const org = await prisma.organization.create({ data: { name: "rotate drill", slug: "rotate-drill" } });

const encA = appEncrypt(KEY1, SECRET_A);
const encB = appEncrypt(KEY1, SECRET_B);
const encMfa = appEncrypt(KEY1, MFA);

check("the application produced an enc:v1: envelope",
  encA.startsWith("enc:v1:") && encA.slice(7).split(":").length === 3,
  "prefix + iv:tag:ciphertext");

const wh1 = await prisma.webhook.create({
  data: { orgId: org.id, targetUrl: "https://example.test/a", secret: encA, events: "issue.created" },
});
const wh2 = await prisma.webhook.create({
  data: { orgId: org.id, targetUrl: "https://example.test/b", secret: encB, events: "issue.updated" },
});
// A row written before field encryption existed. It must be SKIPPED — a
// rotation that re-encrypts an unverifiable value risks double-encrypting it.
const wh3 = await prisma.webhook.create({
  data: { orgId: org.id, targetUrl: "https://example.test/c", secret: LEGACY_PLAINTEXT, events: "issue.deleted" },
});
const user = await prisma.user.create({
  data: {
    email: "rotate-drill@local.test", passwordHash: "x", firstName: "Rot", lastName: "Drill",
    mfaEnabled: true, mfaSecret: encMfa, recoveryCodes: HASHED_RECOVERY,
  },
});
console.log("seeded: 2 encrypted webhook secrets, 1 legacy plaintext, 1 encrypted mfaSecret, hashed recoveryCodes");

// ---------------------------------------------------------- 3. dry run
console.log("\n--- 3. DRY RUN must change nothing");
let r = runRotate(KEY1, KEY2, ["--dry-run"]);
check("dry run succeeded and counted the 3 encrypted rows",
  r.status === 0 && /would rotate: 3/.test(r.stdout), `exit ${r.status}`);
check("dry run reported the legacy plaintext row as skipped",
  /skipped \(unrecognised format\): 1/.test(r.stdout));
check("dry run wrote nothing to the database",
  (await prisma.webhook.findUnique({ where: { id: wh1.id } })).secret === encA);

// ---------------------------------------------------------- 4. real run
console.log("\n--- 4. REAL rotation");
r = runRotate(KEY1, KEY2);
check("rotation exited cleanly", r.status === 0, `exit ${r.status}`);
check("rotation reported 3 rows rewritten", /rotated: 3/.test(r.stdout));

const rot1 = await prisma.webhook.findUnique({ where: { id: wh1.id } });
const rot2 = await prisma.webhook.findUnique({ where: { id: wh2.id } });
const rot3 = await prisma.webhook.findUnique({ where: { id: wh3.id } });
const rotU = await prisma.user.findUnique({ where: { id: user.id } });

check("the stored ciphertext actually changed", rot1.secret !== encA && rot2.secret !== encB);
check("the envelope format is still enc:v1:",
  rot1.secret.startsWith("enc:v1:") && rot1.secret.slice(7).split(":").length === 3);
check("the legacy plaintext row was left exactly as it was", rot3.secret === LEGACY_PLAINTEXT);
check("hashed recoveryCodes were not touched", rotU.recoveryCodes === HASHED_RECOVERY);

// ------------------------------------------- 5. the application can read it
console.log("\n--- 5. the APPLICATION must read the rotated rows with the NEW key");
check("webhook secret A decrypts to the original plaintext", appDecrypt(KEY2, rot1.secret) === SECRET_A);
check("webhook secret B decrypts to the original plaintext", appDecrypt(KEY2, rot2.secret) === SECRET_B);
check("mfaSecret decrypts to the original plaintext", appDecrypt(KEY2, rotU.mfaSecret) === MFA);

let oldStillWorks = false;
try { oldStillWorks = appDecrypt(KEY1, rot1.secret) === SECRET_A; } catch { oldStillWorks = false; }
check("the OLD key can no longer read the rotated rows", !oldStillWorks, "that is the point of a rotation");

// ---------------------------------------------------------- 6. negatives
console.log("\n--- 6. NEGATIVE cases");
const before = (await prisma.webhook.findUnique({ where: { id: wh1.id } })).secret;
r = runRotate(KEY3, KEY2);
check("a wrong OLD key is reported as a failure, not a success",
  r.status !== 0 && /could not decrypt with the OLD key/.test(r.stdout + r.stderr), `exit ${r.status}`);
check("nothing was rewritten when the old key was wrong",
  (await prisma.webhook.findUnique({ where: { id: wh1.id } })).secret === before);

r = runRotate(KEY2, KEY2);
check("identical old and new keys are refused",
  r.status !== 0 && /identical/.test(r.stdout + r.stderr), `exit ${r.status}`);

r = runRotate("nothex", KEY2);
check("a malformed old key is refused",
  r.status !== 0 && /64 hex/.test(r.stdout + r.stderr), `exit ${r.status}`);

r = runRotate(KEY2, KEY3);
check("a second consecutive rotation also succeeds",
  r.status === 0 && /rotated: 3/.test(r.stdout), `exit ${r.status}`);
check("after two rotations the application still reads the original plaintext",
  appDecrypt(KEY3, (await prisma.webhook.findUnique({ where: { id: wh1.id } })).secret) === SECRET_A);

// ---------------------------------------------------------------- cleanup
await prisma.$disconnect();
await admin(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`);
console.log("\n[rotate-drill] scratch database dropped");
console.log(`\n[rotate-drill] ${pass} passed, ${fail} failed`);
if (fail > 0) {
  ghError("Key rotation drill", `${fail} of ${pass + fail} checks failed. Do not attempt a real rotation.`);
}
process.exit(fail === 0 ? 0 : 1);
