import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { logger } from "./logger";

/**
 * OBSOLETE AFTER PROD-1, AND DELIBERATELY FAILING.
 *
 * This module copied the SQLite file at prisma/dev.db. The database is now
 * PostgreSQL, so that file is either absent or a stale snapshot from before the
 * migration. Copying it would report success and produce something that looks
 * like a backup and is not one, which is strictly worse than having no backup
 * feature at all: it would be discovered during a restore.
 *
 * So every entry point below refuses. Replacing this with Postgres-native
 * backup (managed PITR, or scheduled pg_dump to off-host storage) plus an
 * actually-performed restore drill is PROD-9.
 */
const POSTGRES_NOTICE =
  "File-copy backup is not available: the database is PostgreSQL, not a local file. " +
  "Use managed point-in-time recovery or a scheduled pg_dump to off-host storage (PROD-9).";

const DB_PATH = resolve(process.cwd(), "prisma/dev.db");
const BACKUP_DIR = resolve(process.cwd(), "backups");
const MAX_BACKUPS = 10;

function ensureBackupDir(): void {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

export function createBackup(_label?: string): { success: boolean; path?: string; error?: string } {
  // The file-copy implementation is gone rather than left unreachable: the
  // point is that this cannot appear to work. It copied prisma/dev.db, which
  // after PROD-1 is either absent or a pre-migration snapshot — and reporting
  // success for that is how a team discovers it has no backups during a
  // restore.
  logger.warn("BACKUP_UNAVAILABLE", POSTGRES_NOTICE);
  return { success: false, error: POSTGRES_NOTICE };
}

export function listBackups(): Array<{ name: string; size: number; createdAt: string }> {
  ensureBackupDir();
  try {
    return readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".db") && f.startsWith("backup-"))
      .map((name) => {
        const stat = statSync(join(BACKUP_DIR, name));
        return { name, size: stat.size, createdAt: stat.birthtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

function pruneOldBackups(): void {
  const backups = listBackups();
  if (backups.length <= MAX_BACKUPS) return;
  const toRemove = backups.slice(MAX_BACKUPS);
  for (const b of toRemove) {
    try {
      unlinkSync(join(BACKUP_DIR, b.name));
      const walFile = join(BACKUP_DIR, b.name + "-wal");
      if (existsSync(walFile)) unlinkSync(walFile);
    } catch {}
  }
}
