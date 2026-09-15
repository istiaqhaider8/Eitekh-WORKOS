import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession, COOKIE_NAME, SESSION_COOKIE_MAX_AGE } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit-logger";
import { loginSchema, parseBody } from "@/lib/validation";

export async function POST(req: Request) {
  try {
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "anonymous";
    const rl = checkRateLimit(`login:${ipAddress}`, { limit: 60, windowSeconds: 60 });
    if (!rl.allowed) {
      await logAuditEvent({
        action: 'AUTH_RATE_LIMITED',
        category: 'SECURITY',
        severity: 'WARNING',
        status: 'FAILURE',
        targetResource: `IP:${ipAddress}`,
        ipAddress: ipAddress === 'anonymous' ? '127.0.0.1' : ipAddress,
        details: { ip: ipAddress, limit: 60 },
      });
      return NextResponse.json(
        { error: `Too many login attempts. Please try again in ${rl.resetInSeconds} seconds.` },
        { status: 429, headers: { "Retry-After": String(rl.resetInSeconds) } }
      );
    }

    const parsed = parseBody(loginSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      await logAuditEvent({
        action: 'AUTH_LOGIN_FAILED',
        category: 'AUTH',
        severity: 'WARNING',
        status: 'FAILURE',
        targetResource: email,
        ipAddress: ipAddress === 'anonymous' ? '127.0.0.1' : ipAddress,
        details: { email, reason: 'User does not exist' },
      });
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    if (user.status === "PENDING_VERIFY") {
      return NextResponse.json({ error: "Please verify your email before signing in." }, { status: 403 });
    }

    if (user.status === "SUSPENDED") {
      await logAuditEvent({
        actor: { id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email },
        action: 'AUTH_LOGIN_BLOCKED',
        category: 'SECURITY',
        severity: 'CRITICAL',
        status: 'FAILURE',
        targetResource: `User:${user.id} (${user.email})`,
        ipAddress: ipAddress === 'anonymous' ? '127.0.0.1' : ipAddress,
        details: { email, status: 'SUSPENDED' },
      });
      return NextResponse.json({ error: "Your account has been suspended. Please contact administrator." }, { status: 403 });
    }

    const isMatch = await verifyPassword(password, user.passwordHash);
    if (!isMatch) {
      await logAuditEvent({
        actor: { id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email },
        action: 'AUTH_LOGIN_FAILED',
        category: 'AUTH',
        severity: 'WARNING',
        status: 'FAILURE',
        targetResource: `User:${user.id} (${user.email})`,
        ipAddress: ipAddress === 'anonymous' ? '127.0.0.1' : ipAddress,
        details: { email, reason: 'Password mismatch' },
      });
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const userAgent = req.headers.get("user-agent") || undefined;

    const { jwtToken } = await createSession(
      user.id,
      userAgent,
      ipAddress === "anonymous" ? undefined : ipAddress,
      { id: user.id, email: user.email, isSuperAdmin: user.isSuperAdmin }
    );

    logAuditEvent({
      actor: { id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email },
      action: 'AUTH_LOGIN_SUCCESS',
      category: 'AUTH',
      severity: 'INFO',
      status: 'SUCCESS',
      targetResource: `User:${user.id} (${user.email})`,
      ipAddress: ipAddress === 'anonymous' ? '127.0.0.1' : ipAddress,
      details: { userAgent, isSuperAdmin: user.isSuperAdmin },
    }).catch((err) => console.error('Failed to log login audit event:', err));

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isSuperAdmin: user.isSuperAdmin,
      },
    });

    response.cookies.set(COOKIE_NAME, jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || process.env.FORCE_HTTPS === "true",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE,
    });

    return response;
  } catch (error: any) {
    console.error("Login error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
