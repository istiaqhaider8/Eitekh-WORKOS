import { existsSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

/**
 * Backup status, for the admin UI to report honestly (A1).
 *
 * HISTORY, BECAUSE IT EXPLAINS THE SHAPE OF THIS FILE
 *
 * This module used to copy `prisma/dev.db`. After the Postgres migration that
 * file was either absent or a stale pre-migration snapshot, so `createBackup`
 * was left deliberately failing — a backup feature that reports success and
 * produces nothing is worse than none, because it is discovered during a
 * restore.
 *
 * It is no longer a backup implementation at all. Backups are taken **outside
 * the application**, by `scripts/db-backup.mjs` on a schedule, or by the
 * database provider's point-in-time recovery. That is deliberate:
 *
 *   - An app process should not hold credentials that can read every tenant's
 *     data in bulk, nor write it to local disk.
 *   - A backup on the same host as the application does not survive the
 *     failure it exists for.
 *   - `pg_dump` handles sequences, constraints, extensions and collations
 *     correctly. A hand-rolled exporter is found to have missed one of them
 *     during a restore, under pressure.
 *
 * What remains here is read-only: report what the admin UI can truthfully say.
 */

const BACKUP_DIR = resolve(process.env.BACKUP_DIR || join(process.cwd(), "backups"));

export interface BackupStatus {
  /** Whether backups are configured to be visible to this process at all. */
  visible: boolean;
  directory: string;
  backups: Array<{ name: string; size: number; createdAt: string }>;
  /** Shown verbatim in the admin UI. */
  notice: string;
}

/**
 * List any dumps visible to this process.
 *
 * Usually empty in production, and that is correct rather than a fault:
 * backups belong off-host. An empty list here says nothing about whether
 * backups exist — only that this container cannot see them.
 */
export function listBackups(): Array<{ name: string; size: number; createdAt: string }> {
  try {
    if (!existsSync(BACKUP_DIR)) return [];
    return readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".dump"))
      .map((name) => {
        const stat = statSync(join(BACKUP_DIR, name));
        return { name, size: stat.size, createdAt: stat.birthtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function getBackupStatus(): BackupStatus {
  const backups = listBackups();
  return {
    visible: backups.length > 0,
    directory: BACKUP_DIR,
    backups,
    notice:
      backups.length > 0
        ? `${backups.length} local dump(s) visible to this process. Local copies are not a ` +
          "backup: confirm they are replicated off-host, and that a restore has been rehearsed."
        : "No backups are visible from this process, which is expected: they are taken " +
          "outside the application by scripts/db-backup.mjs or by the database provider's " +
          "point-in-time recovery. This is NOT a statement that backups exist — check the " +
          "schedule and the last verified restore. See DEPLOYMENT.md.",
  };
}

/**
 * Deliberately absent: there is no `createBackup`.
 *
 * Triggering a database-wide dump from an HTTP request would mean the web
 * process holds bulk-export credentials and writes tenant data to local disk,
 * and it would let one admin's click consume the disk the database is running
 * on. Backups are a scheduled operation, not a request handler.
 */
