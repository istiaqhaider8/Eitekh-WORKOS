/**
 * A1 / Phase 5 — prove point-in-time recovery actually works.
 *
 * WHY THIS EXISTS
 *
 * DEPLOYMENT.md has recommended PITR over scheduled dumps since A1, on the
 * grounds that a nightly dump means a bad afternoon costs a day of everyone's
 * work. That recommendation was never exercised. Recommending a recovery
 * mechanism nobody in this project has ever performed is the same category of
 * claim as an alert rule that had never fired: it reads as covered, and the
 * first time anyone finds out is during an incident.
 *
 * So this performs one, end to end, and measures it.
 *
 * WHAT IT PROVES
 *
 *   1. WAL archiving works — segments land in the archive, not just on disk.
 *   2. A base backup taken from a RUNNING server is restorable. This is the
 *      part people assume and should not: it is only valid because WAL replay
 *      repairs the torn pages the copy inevitably contains.
 *   3. Recovery lands at a CHOSEN POINT IN TIME: data written before the
 *      target is present, data written after it is gone. That is the whole
 *      difference between PITR and a dump, and it is the only check here that
 *      a restore-from-dump drill cannot also make.
 *   4. How long it takes. That number is the RTO, and it is the one people
 *      guess at and get badly wrong.
 *
 * WHAT IT DOES NOT PROVE
 *
 * This runs against its OWN throwaway cluster on its own port. It does not
 * touch the application's database and it is not a statement about any
 * production deployment. On a managed Postgres (RDS, Cloud SQL, Neon,
 * Supabase) PITR is a provider feature with its own retention window and its
 * own restore path, and the numbers below will not be theirs. What transfers
 * is the procedure and the confidence that the mechanism is understood.
 *
 * WHY NOT pg_basebackup
 *
 * It is not on this machine. The embedded PostgreSQL distribution this project
 * uses for local verification ships only initdb, pg_ctl and postgres — no
 * pg_dump, no pg_restore, no pg_basebackup. So the base backup here is taken
 * through the low-level API (pg_backup_start / copy / pg_backup_stop), which
 * needs nothing but a SQL connection and a file copy. That is also a useful
 * thing to have written down: it is the fallback when the client binaries are
 * missing on the host that has to recover.
 *
 * Usage:
 *   node scripts/pitr-drill.mjs [--rows 5000] [--keep]
 *
 *   --rows N   rows in each of the two batches; raise it to measure RTO at a
 *              volume closer to yours. Default 5000.
 *   --keep     leave the clusters on disk afterwards for inspection.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ROWS = Number(argOf("--rows", 5000));
const KEEP = argv.includes("--keep");

const BIN = resolve("node_modules/@embedded-postgres/windows-x64/native/bin");
const INITDB = join(BIN, "initdb.exe");
const PG_CTL = join(BIN, "pg_ctl.exe");

/**
 * Its own directories and its own ports.
 *
 * The application's verification database is on 54329 and must not be
 * disturbed: a drill that can damage the data it is meant to protect is not a
 * drill. Nothing below ever opens a connection to it.
 */
const ROOT = resolve(
  process.env.PITR_ROOT ||
    join(process.env.TEMP || process.env.TMP || ".", "eitekh-pitr-drill"),
);
const PRIMARY = join(ROOT, "primary");
const ARCHIVE = join(ROOT, "archive");
const RESTORED = join(ROOT, "restored");
const PRIMARY_PORT = 54330;
const RESTORE_PORT = 54331;

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS " : "FAIL "} ${label}${detail ? `  -- ${detail}` : ""}`);
  ok ? (passed += 1) : (failed += 1);
  return ok;
}
const say = (m) => console.log(`[pitr-drill] ${m}`);

function run(exe, args, opts = {}) {
  const r = spawnSync(exe, args, { encoding: "utf8", ...opts });
  if (r.error) throw new Error(`${exe} failed to start: ${r.error.message}`);
  return r;
}

function mustRun(exe, args, what) {
  const r = run(exe, args);
  if (r.status !== 0) {
    throw new Error(
      `${what} failed (exit ${r.status})\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`,
    );
  }
  return r;
}

async function connect(port, database = "postgres") {
  const client = new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database,
    // initdb ran with trust auth: this cluster is throwaway, listens only on
    // loopback, and holds nothing but the drill's own synthetic rows. A
    // password here would be a hardcoded credential for no gain.
    password: undefined,
  });
  await client.connect();
  return client;
}

/**
 * Wait for a condition instead of sleeping a guessed interval.
 *
 * Every timing-sensitive step below (server up, archive populated, recovery
 * complete) polls. A fixed sleep either wastes time or fails on a slow run,
 * and the second failure mode is the one that gets a working drill deleted.
 */
async function waitFor(label, fn, timeoutMs = 60_000) {
  const start = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await fn();
    } catch {
      ok = false;
    }
    if (ok) return Date.now() - start;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${label}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Entries that must NOT be copied into a base backup.
 *
 * pg_wal is the important one and the easy one to get wrong. The whole point
 * of PITR is that WAL comes from the ARCHIVE during recovery; copying the
 * live pg_wal in would mix a half-written set of segments into the restored
 * cluster. The rest are per-run scratch state that the server rebuilds, and
 * postmaster.pid would make a restored cluster believe another postmaster
 * owns its directory.
 */
const BACKUP_EXCLUDE = new Set([
  "pg_wal",
  "postmaster.pid",
  "postmaster.opts",
  "pg_replslot",
  "pg_dynshmem",
  "pg_notify",
  "pg_serial",
  "pg_snapshots",
  "pg_stat_tmp",
  "pg_subtrans",
  "current_logfiles",
  "log",
]);

function copyDataDir(from, to) {
  mkdirSync(to, { recursive: true });
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(from)) {
    if (BACKUP_EXCLUDE.has(entry)) continue;
    const src = join(from, entry);
    const dst = join(to, entry);
    const st = statSync(src);
    if (st.isDirectory()) {
      cpSync(src, dst, { recursive: true });
      const walk = (d) => {
        for (const e of readdirSync(d)) {
          const p = join(d, e);
          const s = statSync(p);
          if (s.isDirectory()) walk(p);
          else {
            files += 1;
            bytes += s.size;
          }
        }
      };
      walk(dst);
    } else {
      cpSync(src, dst);
      files += 1;
      bytes += st.size;
    }
  }
  // Recovery needs the directory to exist even though its contents come from
  // the archive.
  mkdirSync(join(to, "pg_wal", "archive_status"), { recursive: true });
  return { files, bytes };
}

async function main() {
  if (!existsSync(INITDB)) {
    console.error(
      `[pitr-drill] PostgreSQL binaries not found at ${BIN}.\n` +
        "Run: npm install --no-save embedded-postgres",
    );
    process.exitCode = 1;
    return;
  }

  say(`root: ${ROOT}`);
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ARCHIVE, { recursive: true });

  // ------------------------------------------------------------------ 1
  say("initialising a throwaway primary...");
  mustRun(INITDB, ["-D", PRIMARY, "-U", "postgres", "--auth=trust", "--encoding=UTF8"], "initdb");

  /**
   * The archiving configuration, which is the entire subject of this drill.
   *
   * archive_command is the line that decides whether PITR exists. `copy` is
   * used because this is Windows and cmd.exe runs the command; on Linux it is
   * `test ! -f /archive/%f && cp %p /archive/%f` — and the `test !` half
   * matters, because an archive_command that silently overwrites an existing
   * segment can destroy the archive it is writing to.
   *
   * archive_timeout bounds the RPO. Without it a low-traffic database can sit
   * on a partially filled 16MB segment for hours, and everything in it is lost
   * in a total-loss scenario. 10s here is for the drill; 60s is a reasonable
   * production value, and the cost is one mostly-empty segment per minute.
   */
  const archiveForConf = ARCHIVE.replace(/\//g, "\\");
  appendFileSync(
    join(PRIMARY, "postgresql.conf"),
    [
      "",
      "# --- added by scripts/pitr-drill.mjs ---",
      `port = ${PRIMARY_PORT}`,
      "listen_addresses = '127.0.0.1'",
      "wal_level = replica",
      "archive_mode = on",
      `archive_command = 'copy "%p" "${archiveForConf}\\\\%f"'`,
      "archive_timeout = 10",
      "",
    ].join("\n"),
    "utf8",
  );

  say("starting the primary...");
  mustRun(PG_CTL, ["-D", PRIMARY, "-l", join(ROOT, "primary.log"), "-w", "start"], "pg_ctl start");

  let client = await connect(PRIMARY_PORT);

  await client.query(`
    CREATE TABLE drill (
      id     bigserial PRIMARY KEY,
      batch  text NOT NULL,
      note   text NOT NULL
    )
  `);

  // ------------------------------------------------------------------ 2
  /**
   * The base backup, taken from a running server.
   *
   * pg_backup_start and pg_backup_stop must run in the SAME session — the
   * backup state is session-scoped, and if the connection drops in between,
   * Postgres cancels the backup. That is why `client` is held open across the
   * file copy rather than reconnecting.
   *
   * The copy is deliberately taken while the server is up and accepting
   * writes, because that is the only interesting case. It is guaranteed to
   * contain torn pages; the backup_label written at the end tells recovery
   * where to start replaying, and full-page images in the WAL repair them.
   */
  say("taking a base backup from the RUNNING server...");
  await client.query("SELECT pg_backup_start('eitekh-pitr-drill', true)");
  const copied = copyDataDir(PRIMARY, RESTORED);
  const stop = await client.query("SELECT * FROM pg_backup_stop(true)");
  const labelfile = stop.rows[0].labelfile;
  writeFileSync(join(RESTORED, "backup_label"), labelfile, "utf8");

  check(
    "a base backup can be taken from a running server",
    copied.files > 0 && typeof labelfile === "string" && labelfile.includes("START WAL LOCATION"),
    `${copied.files} files, ${(copied.bytes / 1024 / 1024).toFixed(1)}MB`,
  );

  const archivedAfterBackup = readdirSync(ARCHIVE).length;
  check(
    "WAL segments are reaching the archive, not just local disk",
    archivedAfterBackup > 0,
    `${archivedAfterBackup} segment(s) in the archive`,
  );

  // ------------------------------------------------------------------ 3
  /**
   * Two batches with a recovery target between them.
   *
   * Batch A stands for everything written before the incident and MUST
   * survive. Batch B stands for what was written after — a bad migration, a
   * mistaken DELETE, a compromised account — and MUST NOT. A restore that
   * brings back both is a restore that reinstates the problem.
   */
  say(`writing batch A (${ROWS} rows)...`);
  await client.query(
    `INSERT INTO drill (batch, note) SELECT 'A', 'before the incident #' || g FROM generate_series(1, $1) g`,
    [ROWS],
  );

  // A gap either side of the target, so the recovery point is unambiguous
  // rather than resting on sub-second ordering.
  await new Promise((r) => setTimeout(r, 1500));
  const targetRow = await client.query("SELECT now() AS t");
  const TARGET = targetRow.rows[0].t.toISOString();
  say(`recovery target: ${TARGET}`);
  await new Promise((r) => setTimeout(r, 1500));

  say(`writing batch B (${ROWS} rows) — this is what recovery must DISCARD...`);
  await client.query(
    `INSERT INTO drill (batch, note) SELECT 'B', 'after the incident #' || g FROM generate_series(1, $1) g`,
    [ROWS],
  );

  const before = await client.query("SELECT batch, count(*)::int AS n FROM drill GROUP BY batch ORDER BY batch");
  const beforeCounts = Object.fromEntries(before.rows.map((r) => [r.batch, r.n]));
  check(
    "the primary holds both batches before recovery",
    beforeCounts.A === ROWS && beforeCounts.B === ROWS,
    `A=${beforeCounts.A} B=${beforeCounts.B}`,
  );

  /**
   * Force the segment holding the target into the archive.
   *
   * Without this the WAL containing batch A and the target may still be the
   * current segment, unarchived, and recovery would stop short of the target —
   * which looks exactly like PITR "not working" and is really just an
   * un-flushed segment. archive_timeout would get there eventually; the
   * switch makes it immediate and deterministic.
   */
  say("forcing a WAL switch so the target segment is archived...");
  await client.query("SELECT pg_switch_wal()");
  const archivedCount = await waitFor(
    "the switched segment to be archived",
    async () => {
      const r = await client.query(
        "SELECT archived_count > 0 AND last_failed_wal IS NULL AS ok, archived_count, last_failed_wal FROM pg_stat_archiver",
      );
      return r.rows[0].ok;
    },
  );

  const archiverState = await client.query(
    "SELECT archived_count, failed_count, last_failed_wal, last_failed_time FROM pg_stat_archiver",
  );
  check(
    "the archiver reports no failures",
    archiverState.rows[0].failed_count === "0" || Number(archiverState.rows[0].failed_count) === 0,
    `archived=${archiverState.rows[0].archived_count} failed=${archiverState.rows[0].failed_count}` +
      (archiverState.rows[0].last_failed_wal ? ` last_failed=${archiverState.rows[0].last_failed_wal}` : ""),
  );
  void archivedCount;

  await client.end();

  /**
   * Stop the primary hard, with no clean shutdown checkpoint.
   *
   * `-m immediate` is the honest simulation. A real disaster does not give the
   * database a chance to flush; if the drill relied on a graceful shutdown it
   * would be testing a scenario that never happens.
   */
  say("stopping the primary with -m immediate (simulating a loss)...");
  mustRun(PG_CTL, ["-D", PRIMARY, "-m", "immediate", "-w", "stop"], "pg_ctl stop");

  // ------------------------------------------------------------------ 4
  /**
   * Recover to the target.
   *
   * recovery_target_inclusive = off means "stop just BEFORE the target",
   * which is the conservative direction: err towards losing a moment rather
   * than replaying the thing you are recovering from.
   *
   * recovery.signal is what tells a cluster to enter archive recovery at all.
   * An otherwise correct configuration without that file simply starts up as
   * a normal server on the old data, and you conclude PITR failed.
   */
  say("configuring the restored cluster and starting recovery...");
  appendFileSync(
    join(RESTORED, "postgresql.conf"),
    [
      "",
      "# --- added by scripts/pitr-drill.mjs (recovery) ---",
      `port = ${RESTORE_PORT}`,
      "listen_addresses = '127.0.0.1'",
      "archive_mode = off",
      `restore_command = 'copy "${archiveForConf}\\\\%f" "%p"'`,
      `recovery_target_time = '${TARGET}'`,
      "recovery_target_inclusive = off",
      "recovery_target_action = 'promote'",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(join(RESTORED, "recovery.signal"), "", "utf8");

  /**
   * THE RTO MEASUREMENT.
   *
   * Timed from "we decide to start the restore" to "the database accepts
   * queries", because that is the interval the service is down. It excludes
   * the base-backup copy above, which in a real recovery is a download from
   * wherever the backup lives and is entirely dependent on your network and
   * your backup size — measure that separately against your own storage.
   */
  const t0 = Date.now();
  mustRun(PG_CTL, ["-D", RESTORED, "-l", join(ROOT, "restored.log"), "-w", "start"], "pg_ctl start (restored)");

  let restored;
  await waitFor("the restored cluster to accept queries", async () => {
    try {
      restored = await connect(RESTORE_PORT);
      await restored.query("SELECT 1");
      return true;
    } catch {
      if (restored) {
        try {
          await restored.end();
        } catch {
          /* the connection never opened */
        }
        restored = undefined;
      }
      return false;
    }
  });
  const rtoMs = Date.now() - t0;

  // ------------------------------------------------------------------ 5
  const inRecovery = await restored.query("SELECT pg_is_in_recovery() AS r");
  check(
    "recovery completed and the cluster was promoted",
    inRecovery.rows[0].r === false,
    "accepting writes",
  );

  const after = await restored.query(
    "SELECT batch, count(*)::int AS n FROM drill GROUP BY batch ORDER BY batch",
  );
  const counts = Object.fromEntries(after.rows.map((r) => [r.batch, r.n]));

  check(
    "data written BEFORE the target survived",
    counts.A === ROWS,
    `batch A: ${counts.A ?? 0} of ${ROWS} rows`,
  );

  /**
   * The check that distinguishes PITR from a restore-from-dump.
   *
   * Recovering everything is easy and useless when what you are recovering
   * FROM is in the data. If batch B is present, the target was ignored — and
   * an operator who trusted it would have reinstated the bad DELETE, the bad
   * migration, or the attacker's writes.
   */
  check(
    "data written AFTER the target is GONE",
    (counts.B ?? 0) === 0,
    counts.B ? `batch B: ${counts.B} rows survived — the target was NOT honoured` : "batch B: 0 rows",
  );

  const total = await restored.query("SELECT count(*)::int AS n FROM drill");
  check(
    "the restored database is internally consistent",
    total.rows[0].n === (counts.A ?? 0) + (counts.B ?? 0),
    `${total.rows[0].n} rows total`,
  );

  await restored.end();
  mustRun(PG_CTL, ["-D", RESTORED, "-m", "fast", "-w", "stop"], "pg_ctl stop (restored)");

  // ------------------------------------------------------------------ 6
  const archiveFiles = readdirSync(ARCHIVE);
  const archiveBytes = archiveFiles.reduce((a, f) => a + statSync(join(ARCHIVE, f)).size, 0);

  console.log("");
  console.log("RECORD THIS:");
  console.log(`  rows per batch           ${ROWS}`);
  console.log(`  base backup              ${copied.files} files, ${(copied.bytes / 1024 / 1024).toFixed(1)}MB`);
  console.log(`  WAL archived             ${archiveFiles.length} segments, ${(archiveBytes / 1024 / 1024).toFixed(1)}MB`);
  console.log(`  RTO (start -> queryable) ${(rtoMs / 1000).toFixed(1)}s`);
  console.log(`  RPO bound                archive_timeout, set to 10s for this drill`);
  console.log("");
  console.log(
    "  RTO excludes fetching the base backup from wherever it is stored,\n" +
      "  which in a real recovery dominates. Measure that against your own\n" +
      "  storage and add it.",
  );
  console.log("");

  if (!KEEP) {
    rmSync(ROOT, { recursive: true, force: true });
  } else {
    say(`kept: ${ROOT}`);
  }

  console.log(`[pitr-drill] ${passed} passed, ${failed} failed`);
  // Not process.exit(): it races the closing sockets and trips a libuv
  // assertion on Windows, which is how this project learned the difference.
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(async (err) => {
  console.error(`\n[pitr-drill] ${err.message}`);
  // Leave nothing running on a failure path, or the next run cannot initdb
  // over a directory a live postmaster still owns.
  for (const dir of [PRIMARY, RESTORED]) {
    if (existsSync(join(dir, "postmaster.pid"))) {
      run(PG_CTL, ["-D", dir, "-m", "immediate", "-w", "stop"]);
    }
  }
  say(`clusters left at ${ROOT} for inspection`);
  process.exitCode = 1;
});
