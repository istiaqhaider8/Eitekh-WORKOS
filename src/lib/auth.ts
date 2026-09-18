import bcrypt from "bcryptjs";
import { cache } from "react";
import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "./prisma";

// The JWT primitives moved to ./session-token (PROD-2) so that middleware can
// import them without pulling in next/headers, Prisma or bcrypt. The comment
// at the top of that file explains why that matters: importing next/headers
// into the middleware module graph fails silently, and turns every response
// into a bare 500 with nothing in the log.
import {
  COOKIE_NAME,
  SESSION_EXPIRY_DAYS,
  SESSION_COOKIE_MAX_AGE,
  createToken,
  verifyToken,
  type TokenPayload,
} from "./session-token";

const BCRYPT_COST = 12;
const MAX_PASSWORD_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  // bcrypt silently truncates at 72 bytes; cap earlier so a long passphrase
  // is not authenticated by only its prefix.
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(
  userId: string,
  userAgent?: string,
  ipAddress?: string,
  userParam?: { id: string; email: string; isSuperAdmin: boolean }
) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

  // Generate random token string for database lookup
  const sessionRecord = await prisma.session.create({
    data: {
      userId,
      token: crypto.randomUUID(),
      userAgent: userAgent || "Unknown Browser",
      ipAddress: ipAddress || "127.0.0.1",
      expiresAt,
    },
  });

  const user = userParam || (await prisma.user.findUnique({ where: { id: userId } }));
  if (!user) throw new Error("User not found");

  const jwtToken = createToken({
    userId: user.id,
    email: user.email,
    isSuperAdmin: user.isSuperAdmin,
    sessionId: sessionRecord.id,
  });

  return { sessionRecord, jwtToken };
}

// `lastActiveAt` drives the "Active 5 minutes ago" line in the session lists
// and the admin security view. It is display metadata: session expiry is
// enforced by `expiresAt`, which is read and checked on every request below.
// Refreshing it on every request turned each authenticated READ into a write,
// and on SQLite writes serialise -- so a ten-request page load paid for ten
// write transactions. A minute of granularity is finer than anything the UI
// renders, so only write once the stored value is actually that stale.
const SESSION_ACTIVITY_REFRESH_MS = 60_000;

async function loadCurrentUser() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;

    const payload = verifyToken(token);
    if (!payload) return null;

    // Enforce server-side session state so logout, password reset, and admin
    // force-logout actually revoke access. A valid JWT alone is not enough.
    if (payload.sessionId) {
      const session = await prisma.session.findUnique({
        where: { id: payload.sessionId },
        select: { id: true, userId: true, expiresAt: true, lastActiveAt: true },
      });
      if (
        !session ||
        session.userId !== payload.userId ||
        session.expiresAt <= new Date()
      ) {
        return null;
      }
      // Best-effort activity refresh; never block the request on it.
      if (
        Date.now() - new Date(session.lastActiveAt).getTime() >=
        SESSION_ACTIVITY_REFRESH_MS
      ) {
        prisma.session
          .update({ where: { id: session.id }, data: { lastActiveAt: new Date() } })
          .catch(() => {});
      }
    } else {
      // Legacy tokens without a session id are no longer trusted.
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        jobTitle: true,
        company: true,
        timezone: true,
        language: true,
        isSuperAdmin: true,
        isSupportAdmin: true,
        status: true,
        mfaEnabled: true,
        emailVerifiedAt: true,
        orgMemberships: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (!user || user.status === "SUSPENDED" || user.status === "INACTIVE") return null;

    return {
      ...user,
      fullName: `${user.firstName} ${user.lastName}`,
    };
  } catch (error) {
    console.error("Failed to get current user:", error);
    return null;
  }
}

/**
 * Request-scoped memoisation of the session check.
 *
 * A single route commonly resolves the current user two or three times: the
 * handler calls `getCurrentUser()` itself, then `assertProjectAccess()` (or
 * `assertProjectPermission()`, which wraps it) calls it again, and
 * `logAuditEvent()` will call it a third time when no actor is passed. 57 route
 * handlers hit that pattern, so each request was paying for the cookie parse,
 * the JWT verify and two queries several times over.
 *
 * `cache()` is scoped to one request by React's own context, so the result is
 * never shared between requests or between users, and the security properties
 * are unchanged: the session is still validated against the database on every
 * request -- just once per request instead of repeatedly. A revoked session
 * still fails the very next request.
 */
export const getCurrentUser = cache(loadCurrentUser);

// Re-exported so that the existing importers of "@/lib/auth" are unaffected
// by the move to ./session-token.
export {
  COOKIE_NAME,
  SESSION_EXPIRY_DAYS,
  SESSION_COOKIE_MAX_AGE,
  createToken,
  verifyToken,
};
export type { TokenPayload };
