import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { logger } from "./logger";

const DB_PATH = resolve(process.cwd(), "prisma/dev.db");
const BACKUP_DIR = resolve(process.cwd(), "backups");
const MAX_BACKUPS = 10;

function ensureBackupDir(): void {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

export function createBackup(label?: string): { success: boolean; path?: string; error?: string } {
  try {
    if (!existsSync(DB_PATH)) {
      return { success: false, error: "Database file not found" };
    }

    ensureBackupDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const suffix = label ? `-${label.replace(/[^a-zA-Z0-9-_]/g, "")}` : "";
    const backupName = `backup-${timestamp}${suffix}.db`;
    const backupPath = join(BACKUP_DIR, backupName);

    copyFileSync(DB_PATH, backupPath);

    const walPath = DB_PATH + "-wal";
    if (existsSync(walPath)) {
      copyFileSync(walPath, backupPath + "-wal");
    }

    pruneOldBackups();

    logger.info("BACKUP_CREATED", `Database backup created: ${backupName}`, { path: backupPath });
    return { success: true, path: backupPath };
  } catch (error: any) {
    logger.error("BACKUP_FAILED", `Database backup failed: ${error.message}`, { error: error.message });
    return { success: false, error: error.message };
  }
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
