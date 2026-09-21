/**
 * The entry point a scheduler calls. Everything it needs, resolved here.
 *
 * WHY A WRAPPER AND NOT A SCHEDULER ENTRY THAT CALLS backup-nightly DIRECTLY
 *
 * A scheduled task runs with none of a developer shell's environment: no
 * DATABASE_URL, no working directory worth relying on, and on this host no
 * pg_dump on PATH. A task defined with those baked into its command line is a
 * task that silently stops matching reality the first time any of them moves,
 * and the way you find out is that the backup you needed was never taken.
 *
 * So the scheduler entry is one line — run this file — and everything that
 * can change lives here, in the repository, under review.
 *
 * WHY IT WRITES ITS OWN LOG
 *
 * A scheduled task's output goes nowhere by default. Task Scheduler records
 * that the process exited non-zero; it does not record why. When the backup
 * fails, the reason is the only thing anybody wants, so each run appends a
 * timestamped block to backup.log and the log is pruned by age, not by size.
 *
 * Usage:
 *   node scripts/backup-scheduled.mjs            # what the scheduler runs
 *   node scripts/backup-scheduled.mjs --dry-run  # print the resolved config
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Read .env directly rather than expecting the scheduler to have loaded it.
 *
 * Only fills what is not already set, so a real deployment's environment
 * always wins over a file that happens to be sitting in the checkout.
 */
function loadEnvFile() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnvFile();

/**
 * Backups do NOT go in the repository.
 *
 * `/backups/` is the script default and it is gitignored, but a working tree
 * is something people delete, move and re-clone, and a backup that lives
 * inside the thing it protects has a habit of leaving with it. They go beside
 * the database's own durable directory instead.
 *
 * This is still the same physical disk as the database. That is a real
 * limitation and not one this script can fix: see backup-offsite.mjs, and the
 * warning db-backup.mjs prints at the end of every run.
 */
const BACKUP_HOME = process.env.BACKUP_DIR || join(homedir(), ".eitekh", "backups");
mkdirSync(BACKUP_HOME, { recursive: true });

/**
 * pg_dump is not on PATH on this host — the embedded Postgres package ships
 * the server only. The client tools were unpacked next to the data directory,
 * and this looks there before giving up, so the scheduled task does not carry
 * an absolute path that nobody will remember to update.
 */
const BUNDLED_BIN = join(homedir(), ".eitekh", "pgsql", "bin");
if (!process.env.PG_DUMP && existsSync(join(BUNDLED_BIN, "pg_dump.exe"))) {
  process.env.PG_DUMP = join(BUNDLED_BIN, "pg_dump.exe");
}
if (!process.env.PG_RESTORE && existsSync(join(BUNDLED_BIN, "pg_restore.exe"))) {
  process.env.PG_RESTORE = join(BUNDLED_BIN, "pg_restore.exe");
}

process.env.BACKUP_DIR = BACKUP_HOME;
process.env.BACKUP_RETAIN = process.env.BACKUP_RETAIN || "7";

const LOG = join(BACKUP_HOME, "backup.log");
const LOG_RETAIN_DAYS = Number(process.env.BACKUP_LOG_RETAIN_DAYS || 90);

function log(text) {
  process.stdout.write(text);
  try {
    appendFileSync(LOG, text);
  } catch {
    /* a failed log write must not fail the backup */
  }
}

/**
 * Offsite shipping is attempted only when a destination is configured.
 *
 * backup-nightly.mjs treats a failed upload as a failed night, which is
 * right: "we have local backups and no offsite copy" is exactly the state
 * where the next incident is unrecoverable. But with no bucket configured at
 * all there is nothing to ship to, and failing every night over it would
 * train whoever reads these logs to ignore them.
 */
const hasOffsite = Boolean(process.env.BACKUP_S3_BUCKET);

const args = [join(HERE, "backup-nightly.mjs"), "--label", "scheduled"];
if (!hasOffsite) args.push("--no-offsite");

const stamp = new Date().toISOString();
log(`\n${"=".repeat(72)}\n[scheduled] ${stamp}\n`);
log(`[scheduled] database  : ${(process.env.DATABASE_URL || "(unset)").replace(/:\/\/[^@]*@/, "://***@")}\n`);
log(`[scheduled] backup dir: ${BACKUP_HOME}\n`);
log(`[scheduled] pg_dump   : ${process.env.PG_DUMP || "(expecting it on PATH)"}\n`);
log(`[scheduled] offsite   : ${hasOffsite ? process.env.BACKUP_S3_BUCKET : "not configured — local only"}\n`);
log(`[scheduled] encrypted : ${process.env.BACKUP_ENCRYPTION_KEY ? "yes" : "NO — see BACKUP_ENCRYPTION_KEY"}\n`);

if (DRY_RUN) {
  log("[scheduled] --dry-run: nothing was taken.\n");
  process.exit(0);
}

const run = spawnSync(process.execPath, args, { encoding: "utf8", cwd: ROOT });
if (run.stdout) log(run.stdout);
if (run.stderr) log(run.stderr);

const code = run.status ?? 1;
log(`[scheduled] finished with exit code ${code} at ${new Date().toISOString()}\n`);

// Prune the log by age. A backup log is read after an incident, months later,
// and truncating it by size throws away exactly the history that answers
// "when did this last work?".
try {
  if (existsSync(LOG)) {
    const ageDays = (Date.now() - statSync(LOG).mtimeMs) / 86_400_000;
    if (ageDays > LOG_RETAIN_DAYS) unlinkSync(LOG);
  }
} catch {
  /* nothing more to do */
}

process.exit(code);
