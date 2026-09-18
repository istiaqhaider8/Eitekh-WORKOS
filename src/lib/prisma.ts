import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
  prismaPragmasApplied: boolean;
};

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * SQLite connection tuning.
 *
 * The database shipped in rollback-journal mode (`journal_mode=delete`) with
 * `synchronous=FULL`. In that mode a writer takes an exclusive lock on the whole
 * file, so it blocks every concurrent reader, and each commit fsyncs. That is
 * fine for one request at a time, but this app fans out: opening a task fires
 * ten parallel requests and the Super Admin panel fires seven, and every
 * authenticated request touches Session. Measured on the seed database, ten
 * concurrent auth round-trips cost ~6ms as pure reads and ~200ms once the
 * session write is included -- almost all of it lock contention, not query work.
 *
 * WAL lets readers proceed during a write, which is what removes that
 * contention. `synchronous=NORMAL` is the standard companion setting: under WAL
 * it is still crash-safe (a power loss can only cost the last commits, never a
 * corrupt file), which is why it is SQLite's own recommendation for WAL.
 *
 * Only journal_mode is persisted in the database file, so WAL is the change that
 * actually sticks and is the one carrying the win. synchronous and busy_timeout
 * are per-connection, and Prisma pools connections, so a pragma sent here
 * applies to whichever pooled connection served it rather than to all of them.
 * They are issued as a best-effort improvement, not relied upon; correctness
 * does not depend on either. (Prisma's SQLite connector takes no pragma
 * parameters in DATABASE_URL, so there is no way to set them pool-wide.)
 */
async function applySqlitePragmas(client: PrismaClient) {
  const url = process.env.DATABASE_URL || "";
  // Only meaningful for SQLite. Postgres/MySQL would reject these statements.
  if (!url.startsWith("file:") && !url.endsWith(".db")) return;

  // Each pragma is issued separately, and via $queryRaw rather than $executeRaw:
  // `PRAGMA journal_mode = WAL` replies with a row ("wal"), and $executeRaw
  // rejects any statement that returns results. Sending them as one batch, or
  // through $executeRaw, lets the first reply abort the rest -- which silently
  // left synchronous and busy_timeout unset.
  for (const pragma of [
    "PRAGMA journal_mode = WAL",
    "PRAGMA synchronous = NORMAL",
    // Wait rather than fail instantly if another connection holds the lock.
    "PRAGMA busy_timeout = 5000",
  ]) {
    try {
      await client.$queryRawUnsafe(pragma);
    } catch {
      // Never let connection tuning stop the app from booting.
    }
  }
}

if (!globalForPrisma.prismaPragmasApplied) {
  globalForPrisma.prismaPragmasApplied = true;
  void applySqlitePragmas(prisma);
}
