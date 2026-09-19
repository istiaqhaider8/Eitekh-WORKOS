import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession, COOKIE_NAME, SESSION_COOKIE_MAX_AGE } from "@/lib/auth";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { logAuditEvent } from "@/lib/audit-logger";
import { logger } from "@/lib/logger";
import { loginSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";

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
      /**
       * Counted as well as audited, because they are different systems.
       *
       * `logAuditEvent` writes a Postgres row; the alert rules read the
       * PROCESS COUNTERS, which only `logger.*` touches. This route already
       * had that distinction fixed for AUTH_LOGIN_FAILED and not for the two
       * throttle paths — so during an actual credential-stuffing run, where
       * the refusals ARE the signal, most of them were invisible to
       * `auth-failure-spike`. Only the far looser middleware ceiling
       * underneath ever reached a counter.
       *
       * Measured: 40 attempts produced 8 failures and 32 refusals, of which
       * exactly 10 were counted. The other 22 were refused here, in silence.
       */
      logger.security(
        "AUTH_RATE_LIMITED",
        "Per-IP login limit refused an attempt",
        { scope: "IP", limit: LOGIN_IP_LIMIT },
      );
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
      /**
       * The strongest single signal this application has.
       *
       * The per-IP ceiling is evaded by distributing the attack; this one is
       * not, because it is keyed on the account under attack rather than on
       * the source. A spike here means someone is working through one
       * address's password list from many hosts — and until now it produced
       * an audit row and nothing that could page anybody.
       *
       * No email or account identifier in the meta: telemetry may leave the
       * host, and the audit row above already holds it for whoever is
       * entitled to look.
       */
      logger.security(
        "AUTH_ACCOUNT_LOCKED",
        "Per-account login limit refused an attempt",
        { scope: "ACCOUNT", limit: LOGIN_ACCOUNT_LIMIT, windowSeconds: LOGIN_ACCOUNT_WINDOW_SECONDS },
      );
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
      /**
       * Two records, deliberately, because they answer different questions.
       *
       * logAuditEvent writes a durable row to Postgres: who tried what, for
       * a human reading history later. logger.security increments the process
       * counter that PROD-7's alert rules evaluate.
       *
       * Only the audit call existed, so `auth-failure-spike` — the rule
       * guarding against credential stuffing — had no counter to read and
       * could never fire. Found by inducing 30 failed logins against a
       * running server and watching nothing happen.
       */
      logger.security("AUTH_LOGIN_FAILED", `Failed login for ${email}: no such user`);
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
      // See above: the audit row is for history, the counter is for alerting.
      logger.security("AUTH_LOGIN_FAILED", `Failed login for ${email}: password mismatch`);
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
    return handleApiError(error, "auth/login");
  }
}
