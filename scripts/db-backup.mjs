/**
 * A1 — take a database backup.
 *
 * WHAT THIS REPLACES
 *
 * `src/lib/backup.ts` copied the SQLite file at `prisma/dev.db`. After the
 * Postgres migration it was left deliberately failing rather than producing
 * something that looked like a backup and was not one. This is the real thing.
 *
 * WHY pg_dump AND NOT A HAND-ROLLED DUMPER
 *
 * A homegrown exporter is a tempting afternoon's work and a bad idea for data
 * you cannot afford to lose. It has to get sequences, constraints, extensions,
 * partial indexes, generated columns, collations and ownership right, and it
 * will be discovered to have missed one of them during a restore, under
 * pressure. `pg_dump` already handles all of it.
 *
 * The cost is a dependency on the client binaries. Where they are absent this
 * script says so plainly instead of silently doing something lesser.
 *
 * PREFER YOUR PROVIDER'S PITR OVER THIS
 *
 * A scheduled dump loses everything written since the last one. Point-in-time
 * recovery loses seconds. Use this when PITR is unavailable, as a second copy
 * under your own control, or to move data between environments — and say which
 * in the runbook.
 *
 * Usage:
 *   node scripts/db-backup.mjs [--url <postgres-url>] [--out <dir>] [--label <name>]
 *
 * Environment:
 *   DATABASE_URL        source, when --url is not given
 *   BACKUP_DIR          destination, default ./backups
 *   BACKUP_RETAIN       how many to keep locally, default 7
 *   PG_DUMP             path to pg_dump, if not on PATH
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const url = argOf("--url", process.env.DATABASE_URL);
const outDir = resolve(argOf("--out", process.env.BACKUP_DIR || "backups"));
const label = argOf("--label", "scheduled").replace(/[^A-Za-z0-9._-]/g, "-");
const retain = Number(process.env.BACKUP_RETAIN || 7);
const pgDump = process.env.PG_DUMP || "pg_dump";

function die(message, code = 1) {
  console.error(`\n[backup] ${message}\n`);
  process.exit(code);
}

if (!url) die("No database URL. Pass --url or set DATABASE_URL.");
if (!/^postgres(ql)?:\/\//.test(url)) {
  die(`This backs up PostgreSQL. The URL given starts with "${url.split(":")[0]}:".`);
}

// Check for the binary before doing anything else, so the failure is about the
// missing tool rather than a confusing error part-way through.
const probe = spawnSync(pgDump, ["--version"], { encoding: "utf8" });
if (probe.error || probe.status !== 0) {
  die(
    `pg_dump was not found (tried "${pgDump}").\n\n` +
      "Install the PostgreSQL client tools on the host that runs backups:\n" +
      "  Debian/Ubuntu : apt-get install postgresql-client\n" +
      "  Alpine        : apk add postgresql-client\n" +
      "  macOS         : brew install libpq  (then add it to PATH)\n" +
      "  Windows       : install PostgreSQL and add its bin directory to PATH\n\n" +
      "Or set PG_DUMP to its full path.\n\n" +
      "Refusing to improvise a substitute: a hand-rolled export of production data " +
      "is discovered to be incomplete during a restore, which is the worst possible time.",
    3
  );
}
const serverVersion = probe.stdout.trim();

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// Sortable, and unambiguous about which database it came from.
const dbName = url.split("/").pop().split("?")[0];
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const file = join(outDir, `${dbName}_${label}_${stamp}.dump`);

console.log(`[backup] ${probe.stdout.trim()}`);
console.log(`[backup] ${dbName} -> ${file}`);

// -Fc: the custom format. Compressed, and pg_restore can then restore
// selectively and in parallel, which matters when the restore is the thing
// standing between you and being down.
const started = Date.now();
const dump = spawnSync(
  pgDump,
  ["--format=custom", "--no-owner", "--no-privileges", "--file", file, url],
  { stdio: ["ignore", "inherit", "inherit"] }
);

if (dump.status !== 0) {
  // Never leave a partial file that looks like a backup.
  try { if (existsSync(file)) rmSync(file); } catch { /* nothing more to do */ }
  die(`pg_dump exited ${dump.status}. No backup was produced.`, dump.status || 1);
}

const size = statSync(file).size;
const seconds = ((Date.now() - started) / 1000).toFixed(1);

// A zero-byte or implausibly small dump is a failure that exited 0.
if (size < 1024) {
  rmSync(file);
  die(`The dump was only ${size} bytes. Treating that as a failure and deleting it.`);
}

console.log(`[backup] wrote ${(size / 1024 / 1024).toFixed(2)} MB in ${seconds}s`);

// Prune, oldest first. Local retention only — this is not off-host storage,
// and a backup on the same disk as the database is not a backup.
const mine = readdirSync(outDir)
  .filter((f) => f.startsWith(`${dbName}_`) && f.endsWith(".dump"))
  .map((f) => ({ f, t: statSync(join(outDir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);

for (const old of mine.slice(retain)) {
  unlinkSync(join(outDir, old.f));
  console.log(`[backup] pruned ${old.f}`);
}

console.log(
  `\n[backup] done. ${Math.min(mine.length, retain)} backup(s) retained locally.\n` +
    "[backup] REMINDER: copy this off-host. A backup on the same disk as the\n" +
    "[backup] database does not survive the failure you are backing up against.\n" +
    "[backup] Then rehearse a restore — see scripts/db-restore.mjs.\n"
);

console.log(JSON.stringify({ file, bytes: size, seconds: Number(seconds), serverVersion }));
