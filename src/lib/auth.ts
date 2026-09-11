import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "./prisma";

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('JWT_SECRET required'); })() : 'zenith-workos-dev-secret');
const COOKIE_NAME = "zenith_session_token";

export interface TokenPayload {
  userId: string;
  email: string;
  isSuperAdmin: boolean;
  sessionId: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export async function createSession(userId: string, userAgent?: string, ipAddress?: string) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

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

  const user = await prisma.user.findUnique({ where: { id: userId } });
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

    if (!user || user.status === "SUSPENDED") return null;

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
