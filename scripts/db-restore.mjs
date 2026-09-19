/**
 * A1 — restore a backup, and refuse to do it carelessly.
 *
 * The restore is the half nobody rehearses, and the half that decides whether
 * the backups were worth taking. This script is built to be run in anger by
 * someone who is stressed:
 *
 *   - It refuses a target that looks like production unless told twice.
 *   - It refuses to restore into a database that already has rows, unless
 *     --force is given, because an accidental restore over live data turns an
 *     incident into a catastrophe.
 *   - It tells you to run the verifier afterwards, and exits non-zero if you
 *     ask it to verify and the verification fails.
 *
 * Usage:
 *   node scripts/db-restore.mjs --file <dump> --url <target-url> [--force] [--verify <source-url>]
 *
 * Environment:
 *   PG_RESTORE   path to pg_restore, if not on PATH
 *   BACKUP_ENCRYPTION_KEY  required when the file ends in .enc
 */

import { spawnSync } from "node:child_process";
import { existsSync, statSync, createReadStream, createWriteStream, rmSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import crypto from "node:crypto";
import { libpqUrlFor } from "./pg-url.mjs";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { Client } = require_("pg");

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const file = argOf("--file");
// pg_restore connects through libpq, which refuses Prisma's query parameters.
// See scripts/pg-url.mjs — the restore half of the same problem.
const url = libpqUrlFor("restore", argOf("--url", process.env.DATABASE_URL) || "");
const force = argv.includes("--force");
const verifyAgainst = argOf("--verify");
const pgRestore = process.env.PG_RESTORE || "pg_restore";

function die(message, code = 1) {
  console.error(`\n[restore] ${message}\n`);
  process.exit(code);
}

if (!file) die("No --file given.");
if (!existsSync(file)) die(`No such dump: ${file}`);
if (!url) die("No target database URL. Pass --url or set DATABASE_URL.");

const dbName = url.split("/").pop().split("?")[0];

// A restore into the wrong database is the mistake this guard exists for, and
// it is made by tired people at 3am.
const looksProduction = /prod|live/i.test(dbName) && !/test|scratch|drill|staging/i.test(dbName);
if (looksProduction && !force) {
  die(
    `The target database is called "${dbName}", which looks like production.\n` +
      "Re-run with --force if that is genuinely what you mean.",
    2
  );
}

const probe = spawnSync(pgRestore, ["--version"], { encoding: "utf8" });
if (probe.error || probe.status !== 0) {
  die(
    `pg_restore was not found (tried "${pgRestore}"). Install the PostgreSQL client tools; ` +
      "see the notes in scripts/db-backup.mjs.",
    3
  );
}

// Refuse to overwrite a database that already holds data.
const client = new Client({ connectionString: url });
await client.connect();
const { rows } = await client.query(
  `SELECT COALESCE(SUM(n_live_tup), 0)::bigint AS n FROM pg_stat_user_tables`
);
const existingRows = Number(rows[0].n);
await client.end();

if (existingRows > 0 && !force) {
  die(
    `"${dbName}" already contains roughly ${existingRows.toLocaleString()} rows.\n` +
      "Restoring over live data would destroy it. Re-run with --force if that is the intent,\n" +
      "or restore into a scratch database first and compare.",
    2
  );
}

// Decrypt first when the dump is encrypted. pg_restore cannot read an
// encrypted file, and the failure it gives is unhelpful — so this is handled
// here rather than left to the operator to notice.
let dumpPath = file;
let tempPlaintext = null;
if (file.endsWith(".enc")) {
  const keyHex = process.env.BACKUP_ENCRYPTION_KEY;
  if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) {
    die("This dump is encrypted. Set BACKUP_ENCRYPTION_KEY (64 hex characters) to restore it.", 2);
  }
  const header = Buffer.alloc(28);
  const { open } = await import("node:fs/promises");
  const h = await open(file, "r");
  await h.read(header, 0, 28, 0);
  await h.close();

  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), header.subarray(0, 12));
  decipher.setAuthTag(header.subarray(12, 28));
  tempPlaintext = file.replace(/\.enc$/, ".decrypted");
  try {
    await pipeline(createReadStream(file, { start: 28 }), decipher, createWriteStream(tempPlaintext));
  } catch {
    // GCM authentication failed: wrong key, or the file was altered in
    // transit. Either way it must not be fed to pg_restore.
    try { if (existsSync(tempPlaintext)) rmSync(tempPlaintext); } catch {}
    die("Decryption FAILED — wrong key, or the dump was corrupted or tampered with.", 1);
  }
  dumpPath = tempPlaintext;
  console.log("[restore] decrypted and authenticated");
}

const sizeMb = (statSync(dumpPath).size / 1024 / 1024).toFixed(2);
console.log(`[restore] ${probe.stdout.trim()}`);
console.log(`[restore] ${file} (${sizeMb} MB) -> ${dbName}`);

const started = Date.now();
const result = spawnSync(
  pgRestore,
  [
    "--dbname", url,
    "--no-owner",
    "--no-privileges",
    /**
     * Keep going past benign ownership/extension noise, then judge the result
     * by the verifier rather than by the exit code alone.
     *
     * That is pg_restore's DEFAULT — `-e, --exit-on-error` means "exit on
     * error, default is to continue" — so the right way to ask for it is to
     * pass nothing. This used to pass `--exit-on-error=0`, which was wrong
     * twice over:
     *
     *   - the option takes no argument, so glibc's getopt_long rejects the
     *     `=0` outright and pg_restore exits before restoring anything. On
     *     Windows it is accepted, which is why the drill passed locally and
     *     failed on the Linux runner with every table missing.
     *   - had it been accepted, the flag's presence would have turned
     *     exit-on-error ON, the opposite of the comment's intent.
     */
    "--jobs", "4",
    dumpPath,
  ],
  { stdio: ["ignore", "inherit", "inherit"] }
);

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n[restore] pg_restore exited ${result.status} after ${seconds}s`);

// This is the number the runbook asks for: how long a restore actually takes.
console.log(`[restore] RECORD THIS: restore of ${sizeMb} MB took ${seconds}s`);

const cleanupPlaintext = () => {
  // Never leave a decrypted dump lying around; that is the whole point of
  // encrypting it.
  if (tempPlaintext && existsSync(tempPlaintext)) {
    try { rmSync(tempPlaintext); console.log("[restore] removed the decrypted copy"); } catch {}
  }
};
process.on("exit", cleanupPlaintext);

if (!verifyAgainst) {
  console.log(
    "\n[restore] NOT VERIFIED. pg_restore finishing is not proof the data is there.\n" +
      "[restore] Run:\n" +
      `[restore]   node scripts/db-verify-restore.mjs <source-url> ${url}\n`
  );
  process.exit(result.status === 0 ? 0 : 1);
}

console.log("\n[restore] verifying against the source...");
const verify = spawnSync(
  process.execPath,
  ["scripts/db-verify-restore.mjs", verifyAgainst, url],
  { stdio: ["ignore", "inherit", "inherit"] }
);

if (verify.status !== 0) {
  die("VERIFICATION FAILED. Do not rely on this backup.", 1);
}
console.log("\n[restore] restore completed and verified.");
