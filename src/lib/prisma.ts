import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// The SQLite connection tuning that used to live here (journal_mode=WAL,
// synchronous, busy_timeout) is gone with PROD-1: Postgres rejects PRAGMA, and
// the contention those settings worked around -- one writer locking the file --
// does not exist here. Postgres handles concurrent writers natively, which is
// the whole reason for the move.
//
// What replaces it is connection-pool sizing, and that belongs in DATABASE_URL
// rather than in code: `?connection_limit=N`. The constraint to respect is
//   N_instances x connection_limit  <  Postgres max_connections
// which is a documented and common cause of outages. See DEPLOYMENT.md.
