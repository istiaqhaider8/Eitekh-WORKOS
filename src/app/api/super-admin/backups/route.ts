import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getBackupStatus } from "@/lib/backup";
import { handleApiError } from "@/lib/api-error";

/**
 * Backup status for the admin UI (A1).
 *
 * The POST that used to live here "created a backup". It called a function
 * that copied a SQLite file which, after the Postgres migration, was either
 * absent or a stale snapshot. It has been removed rather than repointed:
 * triggering a database-wide dump from an HTTP request would mean the web
 * process holds bulk-export credentials and writes every tenant's data to
 * local disk, and one admin's click could fill the disk the database runs on.
 *
 * Backups are a scheduled operation — `scripts/db-backup.mjs`, or the
 * provider's point-in-time recovery. This endpoint only reports what is true.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    return NextResponse.json(getBackupStatus());
  } catch (error) {
    return handleApiError(error, "super-admin/backups");
  }
}
