/**
 * A1 follow-up — the backup drill, including the ENCRYPTED path.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE CI STEP IT REPLACES
 *
 * The CI step this supersedes took a plaintext dump, restored it, and verified
 * it. That is most of the job, but it rehearsed a path production does not
 * use: with BACKUP_ENCRYPTION_KEY set, db-backup.mjs writes a `.dump.enc` and
 * db-restore.mjs has to decrypt and authenticate it first. Those branches were
 * exercised once, by hand. A drill that skips the branch production depends on
 * is a drill that will pass on the day the restore fails.
 *
 * It also checks the things an exit code cannot tell you:
 *   - the dump is a real PGDMP archive, not a plausible-looking file
 *   - the ciphertext is NOT readable as an archive
 *   - the wrong key FAILS, and leaves no plaintext behind
 *   - a single flipped byte is caught by GCM authentication
 *   - a malformed key does not silently produce an unencrypted dump
 *   - the restored row counts match the source on real business tables
 *
 * SAFETY
 *
 * The source is only ever read. The target is a scratch database this script
 * creates and drops, and it refuses any target whose name does not contain
 * "drill" — so it cannot be pointed at something that matters.
 *
 * Usage:
 *   node scripts/backup-drill.mjs --source <url> --admin <url> [--out <dir>]
 *
 * Environment:
 *   PG_DUMP / PG_RESTORE   paths to the client binaries, if not on PATH
 */

import { spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, readdirSync, rmSync, statSync,
  openSync, readSync, writeSync, closeSync, copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { ghCommand } from "./gh-annotate.mjs";

const require_ = createRequire(import.meta.url);
const { Client } = require_("pg");

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const SOURCE = argOf("--source", process.env.DRILL_SOURCE_URL);
const ADMIN = argOf("--admin", process.env.DRILL_ADMIN_URL);
const SCRATCH_DB = argOf("--scratch", "eitekh_backup_drill");
const OUT = argOf("--out", join(tmpdir(), "eitekh-backup-drill"));

function die(msg, code = 2) {
  console.error(`\n[drill] ${msg}\n`);
  process.exit(code);
}

if (!SOURCE) die("--source <url> is required (read-only; the database to back up).");
if (!ADMIN) die("--admin <url> is required (used to CREATE/DROP the scratch database).");

// The restore script has its own production guard; this is the drill's. A
// target that is not obviously a drill database is refused outright.
if (!/drill/i.test(SCRATCH_DB)) {
  die(`Refusing to use "${SCRATCH_DB}" as the restore target: the name must contain "drill".`);
}
const sourceDb = SOURCE.split("/").pop().split("?")[0];
if (sourceDb === SCRATCH_DB) die("The source and the scratch target are the same database.");

const TARGET = ADMIN.replace(/\/[^/?]+(\?|$)/, `/${SCRATCH_DB}$1`);

/**
 * A crash is a failure too, and the one no `check()` can report.
 *
 * The drill does real work between its checks — creating a scratch database,
 * spawning pg_dump — and a throw in any of it kills the process before a
 * single check has run, leaving the CI step failing with nothing attached.
 */
for (const event of ["unhandledRejection", "uncaughtException"]) {
  process.on(event, (err) => {
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    ghCommand("error", "Backup drill", `crashed before finishing (${event}): ${message}`);
    console.error(`\n[drill] ${event}:`, err);
    process.exit(1);
  });
}

// Each failed check emits an annotation; see scripts/gh-annotate.mjs for why
// the job log is not enough.
let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  -- " + detail : ""));
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
    ghCommand("error", "Backup drill", name + (detail ? " -- " + detail : ""));
  }
}

const run = (args, extra) =>
  spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, ...extra },
    maxBuffer: 1 << 26,
  });

/**
 * The lines from a failed run that say what went wrong.
 *
 * The last three lines of output were what these checks used to report, and
 * on a restore that is the verifier's summary — which names the SYMPTOM ("a
 * table is missing") while pg_restore's account of WHY scrolled past long
 * before. pg_restore deliberately keeps going past failures — that is its
 * default, and the verifier is what judges the result — so its errors are
 * mid-stream by design.
 *
 * Capped, because an annotation is a message and not a log, and de-duplicated,
 * because a parallel restore reports the same dependency failure once per
 * worker.
 */
function errorLines(text, max = 8) {
  const seen = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (!/(error|failed|missing|fatal|could not|does not exist)/i.test(t)) continue;
    seen.add(t);
    if (seen.size >= max) break;
  }
  return [...seen].join(" | ");
}

async function admin(sql) {
  const c = new Client({ connectionString: ADMIN });
  await c.connect();
  try { return await c.query(sql); } finally { await c.end(); }
}
async function resetTarget() {
  await admin(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`);
  await admin(`CREATE DATABASE "${SCRATCH_DB}"`);
}
async function scalar(url, sql) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try { return Number((await c.query(sql)).rows[0].n); } finally { await c.end(); }
}
function newest(suffix) {
  const hits = readdirSync(OUT)
    .filter((x) => x.endsWith(suffix))
    .map((x) => ({ x, t: statSync(join(OUT, x)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return hits.length ? join(OUT, hits[0].x) : null;
}
/** First bytes of a file, to tell an archive from ciphertext. */
function magic(file) {
  const fd = openSync(file, "r");
  const b = Buffer.alloc(5);
  readSync(fd, b, 0, 5, 0);
  closeSync(fd);
  return b.toString("latin1");
}

// Throwaway keys, generated per run. Never logged — a drill that prints its
// key teaches the habit of printing keys.
const KEY_A = crypto.randomBytes(32).toString("hex");
const KEY_B = crypto.randomBytes(32).toString("hex");

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const srcLive = await scalar(SOURCE, "SELECT COALESCE(SUM(n_live_tup),0)::bigint n FROM pg_stat_user_tables");
console.log(`[drill] source ${sourceDb}, ~${srcLive.toLocaleString()} live rows`);
console.log(`[drill] scratch target ${SCRATCH_DB}\n`);

/**
 * The client/server pair, recorded before anything is attempted.
 *
 * A dump is produced by one version and read back by another, and on a hosted
 * runner neither is pinned by this repository. When the drill starts failing
 * on a commit that did not touch the database, this is the line that says
 * whether the ground moved.
 */
{
  const clientVersion = spawnSync(process.env.PG_DUMP || "pg_dump", ["--version"], {
    encoding: "utf8",
  });
  const serverVersion = await (async () => {
    const c = new Client({ connectionString: SOURCE });
    await c.connect();
    try {
      return (await c.query("SHOW server_version")).rows[0].server_version;
    } finally {
      await c.end();
    }
  })();
  const env =
    `client ${String(clientVersion.stdout || clientVersion.stderr || "unknown").trim()}` +
    ` | server ${serverVersion}` +
    ` | node ${process.version} on ${process.platform}`;
  console.log(`[drill] ${env}\n`);
  ghCommand("notice", "Backup drill environment", env);
}

// ------------------------------------------------------------- 1. plaintext
console.log("--- 1. PLAINTEXT backup -> restore -> verify");
let r = run(["scripts/db-backup.mjs", "--url", SOURCE, "--out", OUT, "--label", "drillplain"]);
check("pg_dump produced a plaintext dump", r.status === 0,
  r.status === 0 ? "" : String(r.stderr || "").trim().split("\n").pop());

const plain = newest(".dump");
check("the .dump exists and is non-trivial", Boolean(plain) && statSync(plain).size > 100000,
  plain ? `${(statSync(plain).size / 1048576).toFixed(2)} MB` : "no file");
check("it is a real PostgreSQL custom-format archive",
  Boolean(plain) && magic(plain).startsWith("PGDMP"), "magic PGDMP");

await resetTarget();
r = run(["scripts/db-restore.mjs", "--file", plain, "--url", TARGET, "--verify", SOURCE]);
check("plaintext restore completed AND verified against the source", r.status === 0,
  r.status === 0 ? "row counts + PK checksums matched"
    : errorLines(r.stdout + r.stderr));

// ------------------------------------------------------------- 2. encrypted
console.log("\n--- 2. ENCRYPTED backup -> decrypt -> restore -> verify");
r = run(["scripts/db-backup.mjs", "--url", SOURCE, "--out", OUT, "--label", "drillenc"],
  { BACKUP_ENCRYPTION_KEY: KEY_A });
check("encrypted backup succeeded",
  r.status === 0 && /encrypted with AES-256-GCM/.test(r.stdout),
  r.status === 0 ? "" : String(r.stderr || "").trim().split("\n").pop());

const enc = newest(".dump.enc");
const strayPlain = readdirSync(OUT).some((f) => f.includes("drillenc") && f.endsWith(".dump"));
check("a .dump.enc exists and no plaintext was left beside it", Boolean(enc) && !strayPlain,
  enc ? `${(statSync(enc).size / 1048576).toFixed(2)} MB` : "no file");
check("the encrypted file is NOT readable as an archive",
  Boolean(enc) && !magic(enc).startsWith("PGDMP"), "no PGDMP magic in the ciphertext");

await resetTarget();
r = run(["scripts/db-restore.mjs", "--file", enc, "--url", TARGET, "--verify", SOURCE],
  { BACKUP_ENCRYPTION_KEY: KEY_A });
check("encrypted restore completed AND verified",
  r.status === 0 && /decrypted and authenticated/.test(r.stdout),
  r.status === 0 ? "row counts + PK checksums matched"
    : errorLines(r.stdout + r.stderr));
check("the decrypted temporary copy was removed afterwards",
  !readdirSync(OUT).some((f) => f.endsWith(".decrypted")));

// The verifier compares every table, but an independent count on tables a
// human recognises is what makes the result legible in an incident.
const tables = ["User", "Issue", "Comment"];
const counts = [];
let allMatch = true;
for (const t of tables) {
  const sql = `SELECT count(*)::int n FROM "${t}"`;
  const s = await scalar(SOURCE, sql);
  const d = await scalar(TARGET, sql);
  counts.push(`${t} ${d}/${s}`);
  if (s !== d) allMatch = false;
}
check("restored data matches the source on real business tables", allMatch, counts.join(", "));

// ------------------------------------------------------------- 3. wrong key
console.log("\n--- 3. NEGATIVE: the wrong key must fail safely");
await resetTarget();
r = run(["scripts/db-restore.mjs", "--file", enc, "--url", TARGET, "--verify", SOURCE],
  { BACKUP_ENCRYPTION_KEY: KEY_B });
check("restore with the WRONG key is refused",
  r.status !== 0 && /Decryption FAILED/.test(r.stdout + r.stderr), `exit ${r.status}`);
check("no decrypted plaintext was left on disk after the failure",
  !readdirSync(OUT).some((f) => f.endsWith(".decrypted")));
const leaked = await scalar(TARGET, "SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'");
check("nothing was written to the target on a failed decrypt", leaked === 0, `${leaked} tables present`);

// ------------------------------------------------------------- 4. tampering
console.log("\n--- 4. NEGATIVE: tampered ciphertext must fail GCM authentication");
const tampered = enc.replace(/\.enc$/, ".tampered.enc");
copyFileSync(enc, tampered);
const fd = openSync(tampered, "r+");
const one = Buffer.alloc(1);
readSync(fd, one, 0, 1, 4096);
one[0] ^= 0xff;
writeSync(fd, one, 0, 1, 4096);
closeSync(fd);
await resetTarget();
r = run(["scripts/db-restore.mjs", "--file", tampered, "--url", TARGET, "--verify", SOURCE],
  { BACKUP_ENCRYPTION_KEY: KEY_A });
check("a single flipped byte is detected and the restore refused",
  r.status !== 0 && /Decryption FAILED/.test(r.stdout + r.stderr), `exit ${r.status}`);

// --------------------------------------------------------- 5. malformed key
console.log("\n--- 5. NEGATIVE: a malformed key must not silently produce plaintext");
r = run(["scripts/db-backup.mjs", "--url", SOURCE, "--out", OUT, "--label", "drillbadkey"],
  { BACKUP_ENCRYPTION_KEY: "tooshort" });
check("backup refuses a malformed BACKUP_ENCRYPTION_KEY",
  r.status !== 0 && /must be 64 hex/.test(r.stdout + r.stderr), `exit ${r.status}`);
check("and it deleted the dump rather than leaving it unencrypted",
  !readdirSync(OUT).some((f) => f.includes("drillbadkey")));

// ---------------------------------------------------------------- cleanup
await admin(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`);
rmSync(OUT, { recursive: true, force: true });
console.log("\n[drill] scratch database dropped, drill dumps removed");
console.log(`\n[drill] ${pass} passed, ${fail} failed`);
if (fail > 0) {
  ghCommand("error", "Backup drill", `${fail} of ${pass + fail} checks failed. Do not trust the backups.`);
}
process.exit(fail === 0 ? 0 : 1);
