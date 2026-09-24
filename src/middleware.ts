import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/session-token";
import { clientIpFromForwarded, parseTrustedProxyHops } from "@/lib/client-ip";
import { getRateLimitStore, maybeSweepRateLimits, type RateLimitSpec } from "@/lib/rate-limit-store";
import { logger } from "@/lib/logger";

/**
 * RUNTIME: nodejs, not edge. This matters (PROD-2).
 *
 * The general API rate limit lives here, and after PROD-2 it is backed by a
 * store every instance shares — Postgres, reached through Prisma. Prisma
 * cannot run on the edge runtime, so this middleware must run on Node. The
 * `runtime` export below is what arranges that, and `isNodeRuntime()` checks
 * it actually happened rather than trusting the configuration.
 *
 * Node middleware became STABLE in Next 16 (A3). It previously needed
 * `experimental.nodeMiddleware` in next.config.mjs, which the build did not
 * even recognise in its config schema — one of the reasons that upgrade was
 * worth doing. If the runtime were ever lost, the build fails on the Prisma
 * import rather than quietly falling back to edge, so the failure is loud.
 */
export const runtime = "nodejs";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const RATE_LIMIT_WINDOW_SECONDS = 60;

// Per-subject ceilings. For authenticated traffic the subject is the user, so
// these are now a genuine per-user budget.
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_MAX_MUTATION = 30;

/**
 * A second, much looser ceiling on the source address, charged in the same
 * round-trip as the per-user one.
 *
 * Per-user keying alone has a gap the roadmap did not raise: an attacker
 * holding many valid sessions gets a fresh budget per account, so N stolen
 * accounts from one host means N x 100 req/min. This backstop bounds that
 * while sitting far enough above normal use that a shared office NAT never
 * reaches it — which is the whole point of B11. Twenty simultaneous users on
 * one address stay comfortably inside it; a credential-stuffing run does not.
 */
const RATE_LIMIT_MAX_IP_BACKSTOP = 600;
const RATE_LIMIT_MAX_IP_BACKSTOP_MUTATION = 200;

/**
 * The old implementation kept a `new Map()` here and swept it on a
 * `setInterval`. Both are gone: the Map made the limit per-process (so N
 * instances meant N x the limit, and every deploy reset every counter), and
 * the interval is the wrong shape for a shared store. Cleanup is now an
 * occasional opportunistic sweep inside the store itself.
 */

/**
 * How many proxies sit in front of this process. See src/lib/client-ip.ts.
 *
 * Read once: it is configuration, not per-request state, and re-parsing an
 * environment variable on every request is work for nothing.
 */
const TRUSTED_PROXY_HOPS = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS);

/**
 * This used to read `x-forwarded-for` left-to-right, which let any caller pick
 * their own rate-limit bucket by sending the header themselves — verified
 * against the running server, where rotating the value reset the remaining
 * count every time. `x-real-ip` was the same hole with a different name.
 *
 * The chain is now read from the right, by a configured number of trusted
 * hops, and an unconfigured deployment gets one shared bucket rather than one
 * bucket per forged value.
 */
function getClientIp(req: NextRequest): string {
  return clientIpFromForwarded(req.headers.get("x-forwarded-for"), TRUSTED_PROXY_HOPS);
}

/**
 * Identify who to charge the request to.
 *
 * B11: the general limit used to be keyed on raw IP, so an office behind one
 * NAT shared a single 100 req/min budget between everyone in it — and the
 * Super Admin panel's polling spent about a fifth of it unaided. Authenticated
 * requests now charge the user, which is both fairer and a tighter control,
 * since a limit per account cannot be widened by changing address.
 *
 * Unauthenticated requests still charge the IP: there is no other identifier,
 * and those are the routes where brute force actually happens.
 *
 * A token that fails verification counts as unauthenticated, which is correct
 * — an expired or forged token must not mint a private budget.
 */
function resolveSubject(req: NextRequest): { subject: string; authenticated: boolean } {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (token) {
    const payload = verifyToken(token);
    if (payload?.userId) {
      return { subject: `u:${payload.userId}`, authenticated: true };
    }
  }
  return { subject: `ip:${getClientIp(req)}`, authenticated: false };
}

/**
 * Fail closed if this is not the Node runtime.
 *
 * Without this the degradation is silent in the worst way: on the edge runtime
 * the Prisma-backed store would throw on every request, the limiter would
 * report an error, and whether traffic is limited at all would depend on how
 * the error is handled. Checking the runtime directly turns an assumption
 * about build configuration into something observed at request time.
 */
function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}

interface LimitDecision {
  allowed: boolean;
  resetIn: number;
  remaining: number;
}

async function checkApiRateLimit(req: NextRequest, isMutation: boolean): Promise<LimitDecision> {
  const { subject } = resolveSubject(req);
  const bucket = isMutation ? "mut" : "read";
  const subjectLimit = isMutation ? RATE_LIMIT_MAX_MUTATION : RATE_LIMIT_MAX;
  const ipLimit = isMutation ? RATE_LIMIT_MAX_IP_BACKSTOP_MUTATION : RATE_LIMIT_MAX_IP_BACKSTOP;
  const ipSubject = `ip:${getClientIp(req)}`;

  // When the subject already *is* the IP, one bucket is enough — charging the
  // same key twice would halve the effective limit for unauthenticated users.
  const specs: RateLimitSpec[] = [{ key: `api:${bucket}:${subject}`, windowSeconds: RATE_LIMIT_WINDOW_SECONDS }];
  const limits = [subjectLimit];
  if (subject !== ipSubject) {
    specs.push({ key: `api:${bucket}:backstop:${ipSubject}`, windowSeconds: RATE_LIMIT_WINDOW_SECONDS });
    limits.push(ipLimit);
  }

  const hits = await getRateLimitStore().hitMany(specs);
  maybeSweepRateLimits();

  // A request is allowed only if it is under *every* ceiling it was charged
  // against. When more than one is breached, report the longest wait, so a
  // client that honours Retry-After does not come back to a second refusal.
  let remaining = Number.MAX_SAFE_INTEGER;
  let breachedResetIn = 0;

  for (let i = 0; i < hits.length; i += 1) {
    remaining = Math.min(remaining, Math.max(0, limits[i] - hits[i].count));
    if (hits[i].count > limits[i]) {
      const secondsLeft = Math.max(1, Math.ceil((hits[i].resetAt.getTime() - Date.now()) / 1000));
      breachedResetIn = Math.max(breachedResetIn, secondsLeft);
    }
  }

  return {
    allowed: breachedResetIn === 0,
    resetIn: breachedResetIn || RATE_LIMIT_WINDOW_SECONDS,
    remaining,
  };
}

function getOrigin(req: NextRequest): string | null {
  const origin = req.headers.get("origin");
  if (origin) return origin;
  const referer = req.headers.get("referer");
  if (referer) {
    try { return new URL(referer).origin; } catch { return null; }
  }
  return null;
}

function tooManyRequests(resetIn: number): NextResponse {
  return NextResponse.json(
    { error: `Too many requests. Please try again in ${resetIn} seconds.` },
    { status: 429, headers: { "Retry-After": String(resetIn) } },
  );
}

export async function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const ip = getClientIp(req);
  const isMutation = MUTATING_METHODS.has(req.method);

  if (isMutation || req.nextUrl.pathname.startsWith("/api/super-admin")) {
    console.log(`[API] ${req.method} ${req.nextUrl.pathname} from ${ip}`);
  }

  if (!isNodeRuntime()) {
    // Not a theoretical branch: it is the difference between a shared limiter
    // and none. Refusing is the only safe answer, because the alternative is
    // serving traffic with a security control that is not running.
    logger.error(
      "RATE_LIMIT_RUNTIME_INVALID",
      "Middleware is not running on the Node runtime, so the shared rate-limit store " +
        'is unreachable. Check that `export const runtime = "nodejs"` is still present ' +
        "in src/middleware.ts.",
    );
    return NextResponse.json({ error: "Service misconfigured." }, { status: 503 });
  }

  let rl: LimitDecision;
  try {
    rl = await checkApiRateLimit(req, isMutation);
  } catch (error) {
    // FAIL CLOSED. The store is this application's own Postgres: if it is
    // unreachable, virtually every route behind this middleware is failing
    // anyway, so denying costs nothing that was working. Failing open would
    // instead remove the brute-force ceiling during a database incident,
    // which is precisely when nobody is watching for one.
    logger.error(
      "RATE_LIMIT_UNAVAILABLE",
      "Denying an API request: the shared rate-limit store could not be reached.",
      error,
      { path: req.nextUrl.pathname, method: req.method },
    );
    return NextResponse.json(
      { error: "Service temporarily unavailable. Please retry shortly." },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  }

  if (!rl.allowed) {
    /**
     * Count the refusal, so the alerting can see it.
     *
     * A credential-stuffing run hits the rate limit almost immediately, which
     * means the 429s ARE the signal — and until now nothing recorded them, so
     * the attack that the limiter successfully blunted was invisible to the
     * alert rule watching for exactly that. Being throttled is not the same
     * as being noticed.
     *
     * Only for unauthenticated traffic on auth routes: a signed-in user who
     * hits their own budget is a busy tab, not an attack, and counting that
     * would bury the signal in noise.
     */
    if (req.nextUrl.pathname.startsWith("/api/auth/")) {
      logger.security(
        "AUTH_RATE_LIMITED",
        `Rate limit refused a request to ${req.nextUrl.pathname}`,
        { path: req.nextUrl.pathname },
      );
    }
    return tooManyRequests(rl.resetIn);
  }

  if (!isMutation) {
    const response = NextResponse.next();
    response.headers.set("X-API-Version", "2.0");
    response.headers.set("X-RateLimit-Remaining", String(rl.remaining));
    return response;
  }

  /**
   * Endpoints a SCHEDULER calls, which must not be subject to the Origin check.
   *
   * WHY THEY WERE UNREACHABLE
   *
   * Every mutating request needs an `Origin` header, and cron sends none:
   *
   *     curl -X POST https://host/api/internal/alerts/check \
   *       -H "x-alert-secret: …"
   *     -> 403 Forbidden: missing Origin header
   *
   * Adding one does not help either, because the allow-list is the
   * application's own public URL, and a scheduler on the same host calls
   * 127.0.0.1:
   *
   *     -H "Origin: http://127.0.0.1:3000"
   *     -> 403 Forbidden: cross-origin request
   *
   * So the three scheduled jobs in DEPLOYMENT.md §7a could not run AT ALL, as
   * documented. That is the structural reason the alert rules had never fired:
   * not that nobody had configured a schedule, but that a schedule would not
   * have worked. Silent, because a cron job that 403s writes to a log nobody
   * reads.
   *
   * WHY EXEMPTING THEM IS SAFE
   *
   * CSRF exists because browsers attach cookies automatically: an attacker's
   * page can cause a request that carries the victim's session. These routes
   * do not read cookies at all — they authenticate on a shared secret in a
   * custom header, and a browser cannot add a custom header cross-origin
   * without a preflight the server never approves. There is no ambient
   * credential to abuse, so there is no CSRF exposure to protect against.
   *
   * The list is explicit and short on purpose. It must only ever contain
   * routes that authenticate on a secret and ignore cookies entirely — a
   * session-authenticated route added here would lose real protection.
   */
  const SECRET_AUTHENTICATED_PATHS = new Set([
    "/api/internal/alerts/check",
    "/api/recurring-tasks/trigger",
  ]);

  const origin = getOrigin(req);
  if (!origin && !SECRET_AUTHENTICATED_PATHS.has(req.nextUrl.pathname)) {
    return NextResponse.json(
      { error: "Forbidden: missing Origin header" },
      { status: 403 },
    );
  }
  if (!origin) {
    // A scheduler's call: no cookies, no ambient credential, nothing for the
    // Origin check to protect. The route's own secret is the gate.
    const response = NextResponse.next();
    response.headers.set("X-API-Version", "2.0");
    response.headers.set("X-RateLimit-Remaining", String(rl.remaining));
    return response;
  }

  // BASE_URL must be included too: it is the variable documented in
  // .env.example, so an operator may set only that one. Omitting it would
  // reject legitimate cross-origin requests behind a proxy as CSRF.
  const localPort = req.nextUrl.port || "3000";
  const allowed = new Set([
    req.nextUrl.origin,
    process.env.NEXTAUTH_URL,
    process.env.BASE_URL,
    ...(process.env.ALLOW_LOCAL_BASE_URL === "1"
      ? [
          `http://localhost:${localPort}`,
          `http://127.0.0.1:${localPort}`,
          "http://localhost:3000",
          "http://127.0.0.1:3000",
          "http://localhost:3100",
          "http://127.0.0.1:3100",
        ]
      : []),
  ].filter(Boolean));

  let originHost: string;
  try {
    originHost = new URL(origin).origin;
  } catch {
    return NextResponse.json(
      { error: "Forbidden: invalid Origin" },
      { status: 403 },
    );
  }

  if (!allowed.has(originHost)) {
    return NextResponse.json(
      { error: "Forbidden: cross-origin request" },
      { status: 403 },
    );
  }

  const response = NextResponse.next();
  response.headers.set("X-API-Version", "2.0");
  response.headers.set("X-RateLimit-Remaining", String(rl.remaining));
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
