import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/session-token";
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

function getClientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "anonymous";
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
    return tooManyRequests(rl.resetIn);
  }

  if (!isMutation) {
    const response = NextResponse.next();
    response.headers.set("X-API-Version", "2.0");
    response.headers.set("X-RateLimit-Remaining", String(rl.remaining));
    return response;
  }

  const origin = getOrigin(req);
  if (!origin) {
    return NextResponse.json(
      { error: "Forbidden: missing Origin header" },
      { status: 403 },
    );
  }

  // BASE_URL must be included too: it is the variable documented in
  // .env.example, so an operator may set only that one. Omitting it would
  // reject legitimate cross-origin requests behind a proxy as CSRF.
  const allowed = new Set([
    req.nextUrl.origin,
    process.env.NEXTAUTH_URL,
    process.env.BASE_URL,
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
