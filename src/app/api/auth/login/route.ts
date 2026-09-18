import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession, COOKIE_NAME, SESSION_COOKIE_MAX_AGE } from "@/lib/auth";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit-logger";
import { loginSchema, parseBody, parseJsonBody } from "@/lib/validation";

// Login throttling. Both ceilings apply: the IP one stops one host hammering
// many accounts, the account one stops many hosts hammering one account.
const LOGIN_IP_LIMIT = 10;                 // per 60s per IP
const LOGIN_ACCOUNT_LIMIT = 8;             // per window per email address
const LOGIN_ACCOUNT_WINDOW_SECONDS = 900;  // 15 minutes

export async function POST(req: Request) {
  try {
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "anonymous";

    // Per-IP ceiling. 60/min was far too permissive for a credential-stuffing
    // defence (3,600 attempts/hour from one address), so it is tightened here.
    const rl = await checkRateLimit(`login:ip:${ipAddress}`, { limit: LOGIN_IP_LIMIT, windowSeconds: 60 });
    if (!rl.allowed) {
      await logAuditEvent({
        action: 'AUTH_RATE_LIMITED',
        category: 'SECURITY',
        severity: 'WARNING',
        status: 'FAILURE',
        targetResource: `IP:${ipAddress}`,
        ipAddress: ipAddress === 'anonymous' ? '127.0.0.1' : ipAddress,
        details: { ip: ipAddress, limit: LOGIN_IP_LIMIT, scope: 'IP' },
      });
      return NextResponse.json(
        { error: `Too many login attempts. Please try again in ${rl.resetInSeconds} seconds.` },
        { status: 429, headers: { "Retry-After": String(rl.resetInSeconds) } }
      );
    }

    const parsed = await parseJsonBody(req, loginSchema);
    if (!parsed.success) return parsed.error;
    const { email, password } = parsed.data;

    // Per-account ceiling, checked in addition to the per-IP one. Without this a
    // distributed attack against a single account was unconstrained, because
    // the only limiter was keyed on the source address.
    const accountKey = `login:acct:${email.trim().toLowerCase()}`;
    const acctRl = await checkRateLimit(accountKey, {
      limit: LOGIN_ACCOUNT_LIMIT,
      windowSeconds: LOGIN_ACCOUNT_WINDOW_SECONDS,
    });
    if (!acctRl.allowed) {
      await logAuditEvent({
        action: 'AUTH_ACCOUNT_LOCKED',
        category: 'SECURITY',
        severity: 'WARNING',
        status: 'FAILURE',
        targetResource: `account:${email}`,
        ipAddress: ipAddress === 'anonymous' ? '127.0.0.1' : ipAddress,
        details: { email, limit: LOGIN_ACCOUNT_LIMIT, windowSeconds: LOGIN_ACCOUNT_WINDOW_SECONDS, scope: 'ACCOUNT' },
      });
      // Deliberately the same wording as the IP-based message: revealing that a
      // specific account is being throttled would confirm the address exists.
      return NextResponse.json(
        { error: `Too many login attempts. Please try again in ${acctRl.resetInSeconds} seconds.` },
        { status: 429, headers: { "Retry-After": String(acctRl.resetInSeconds) } }
      );
    }

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

    if (user.status === "SUSPENDED" || user.status === "INACTIVE") {
      await logAuditEvent({
        actor: { id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email },
        action: 'AUTH_LOGIN_BLOCKED',
        category: 'SECURITY',
        severity: user.status === "SUSPENDED" ? 'CRITICAL' : 'WARNING',
        status: 'FAILURE',
        targetResource: `User:${user.id} (${user.email})`,
        ipAddress: ipAddress === 'anonymous' ? '127.0.0.1' : ipAddress,
        details: { email, status: user.status },
      });
      const msg = user.status === "SUSPENDED"
        ? "Your account has been suspended. Please contact administrator."
        : "Your account is inactive. Please contact administrator.";
      return NextResponse.json({ error: msg }, { status: 403 });
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

    // Credentials were correct, so discharge the per-account failure counter.
    // Only consecutive failures should count towards the lockout ceiling.
    await resetRateLimit(accountKey);

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
