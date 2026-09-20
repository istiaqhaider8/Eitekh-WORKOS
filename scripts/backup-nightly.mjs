/**
 * A1 / Phase 5 — the nightly job: take a backup, then get it off the host.
 *
 * WHY A WRAPPER RATHER THAN TWO SCHEDULER ENTRIES
 *
 * The two steps have to be joined by the FILENAME, and `db-backup.mjs` writes
 * a timestamped one. A scheduler entry cannot know it in advance. Writing
 * `ExecStartPost=... --file /var/backups/latest.dump.enc` looks reasonable and
 * refers to a file that does not exist, which is the kind of mistake that
 * reports success every night until someone needs the copy.
 *
 * Splitting them into two independent timers has a worse failure mode: the
 * offsite copy can fail silently for a month while the backup keeps reporting
 * success, and "we have local backups and no offsite copy" is precisely the
 * state where the next incident is unrecoverable.
 *
 * So: one job, one exit code. A failure in either half fails the whole thing,
 * which is what the operator needs to be told.
 *
 * Usage:
 *   node scripts/backup-nightly.mjs [--label nightly] [--prune 14]
 *   node scripts/backup-nightly.mjs --no-offsite     # local only, deliberately
 *
 * Environment: everything db-backup.mjs and backup-offsite.mjs read. In
 * particular DATABASE_URL, BACKUP_ENCRYPTION_KEY and the BACKUP_S3_* set.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

function fail(message) {
  console.error(`\n[nightly] ${message}\n`);
  process.exitCode = 1;
}

/**
 * Warn — loudly — about the configuration that produces a readable backup.
 *
 * Not a refusal: an operator whose destination encrypts at rest may have made
 * this choice deliberately, and refusing to back up at all over it would turn
 * a weaker backup into no backup. But it must not be quiet, because the
 * consequence lands on every tenant at once.
 */
if (!process.env.BACKUP_ENCRYPTION_KEY) {
  console.warn(
    "[nightly] WARNING: BACKUP_ENCRYPTION_KEY is not set. The dump will contain every\n" +
      "[nightly] tenant's data in the clear, on this host and everywhere it is copied.",
  );
}

// ---------------------------------------------------------------- 1. dump
console.log("[nightly] taking the backup...");
const backup = spawnSync(
  process.execPath,
  [join(HERE, "db-backup.mjs"), "--label", argOf("--label", "nightly")],
  { encoding: "utf8" },
);

// Streamed through rather than swallowed: when this runs under systemd or
// cron, this output IS the incident report.
if (backup.stdout) process.stdout.write(backup.stdout);
if (backup.stderr) process.stderr.write(backup.stderr);

if (backup.status !== 0) {
  fail(`db-backup.mjs exited ${backup.status}. Nothing was shipped.`);
} else {
  /**
   * The filename comes from db-backup.mjs's last line of JSON.
   *
   * Parsing a script's stdout is not lovely, but the alternative — a "latest"
   * symlink — is a second piece of state that can be stale, and a stale
   * pointer means shipping yesterday's dump while reporting success. The JSON
   * line is the contract; `db-backup.mjs` prints it as its final action.
   */
  const lines = backup.stdout.trim().split(/\r?\n/);
  let produced = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      produced = JSON.parse(line);
      break;
    } catch {
      // Not the JSON line after all; keep looking backwards.
    }
  }

  if (!produced?.file) {
    fail(
      "db-backup.mjs succeeded but did not report which file it wrote, so there is\n" +
        "nothing to ship. This is a bug in the contract between the two scripts.",
    );
  } else if (!existsSync(produced.file)) {
    fail(`db-backup.mjs reported ${produced.file}, which does not exist.`);
  } else if (argv.includes("--no-offsite")) {
    console.log(
      `\n[nightly] --no-offsite: ${produced.file} stays on this host.\n` +
        "[nightly] A backup on the same disk as the database does not survive the\n" +
        "[nightly] failure it exists for.\n",
    );
  } else {
    // ------------------------------------------------------------ 2. ship
    const shipArgs = [join(HERE, "backup-offsite.mjs"), "--file", produced.file];
    const prune = argOf("--prune", null);
    if (prune) shipArgs.push("--prune", prune);

    console.log("\n[nightly] copying it off the host...");
    const ship = spawnSync(process.execPath, shipArgs, { encoding: "utf8" });
    if (ship.stdout) process.stdout.write(ship.stdout);
    if (ship.stderr) process.stderr.write(ship.stderr);

    if (ship.status !== 0) {
      fail(
        `The backup was taken but the offsite copy FAILED (exit ${ship.status}).\n` +
          `It exists only at ${produced.file}, on the same host as the database.`,
      );
    } else {
      console.log("[nightly] done: backed up and copied off-host.");
    }
  }
}

// process.exitCode is set by fail(); never process.exit(), which races the
// closing sockets of the S3 client and trips a libuv assertion on Windows.
