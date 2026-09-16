import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "./prisma";

// JWT secret must be supplied via env. No in-source fallback: a hardcoded
// default is publicly known and lets anyone forge tokens for any user.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET environment variable is required. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\""
  );
}
const JWT_ISSUER = "eitekh-workos";
const JWT_AUDIENCE = "eitekh-workos-web";
const COOKIE_NAME = "eitekh_session_token";
const BCRYPT_COST = 12;
const MAX_PASSWORD_LENGTH = 64;

// Session lifetime — configurable via SESSION_EXPIRY_DAYS (default 7).
// Must be a positive integer; invalid values fall back to the default.
function parseSessionExpiryDays(): number {
  const raw = process.env.SESSION_EXPIRY_DAYS;
  if (!raw) return 7;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
}
export const SESSION_EXPIRY_DAYS = parseSessionExpiryDays();
export const SESSION_COOKIE_MAX_AGE = SESSION_EXPIRY_DAYS * 24 * 60 * 60;

export interface TokenPayload {
  userId: string;
  email: string;
  isSuperAdmin: boolean;
  sessionId: string;
}

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

export function createToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET as string, {
    expiresIn: `${SESSION_EXPIRY_DAYS}d`,
    algorithm: "HS256",
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET as string, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as TokenPayload;
  } catch {
    return null;
  }
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

export async function getCurrentUser() {
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
        select: { id: true, userId: true, expiresAt: true },
      });
      if (
        !session ||
        session.userId !== payload.userId ||
        session.expiresAt <= new Date()
      ) {
        return null;
      }
      // Best-effort activity refresh; never block the request on it.
      prisma.session
        .update({ where: { id: session.id }, data: { lastActiveAt: new Date() } })
        .catch(() => {});
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

export { COOKIE_NAME };
