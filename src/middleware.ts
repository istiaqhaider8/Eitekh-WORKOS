import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_MAX_MUTATION = 30;

if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetAt <= now) rateLimitStore.delete(key);
    }
  }, 60_000);
}

function getClientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "anonymous";
}

function checkMiddlewareRateLimit(key: string, max: number): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || entry.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: max - 1, resetIn: Math.ceil(RATE_LIMIT_WINDOW / 1000) };
  }
  if (entry.count >= max) {
    return { allowed: false, remaining: 0, resetIn: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  entry.count++;
  return { allowed: true, remaining: max - entry.count, resetIn: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
}

function getOrigin(req: NextRequest): string | null {
  return req.headers.get("origin") || req.headers.get("referer")?.replace(/\/[^/]*$/, "") || null;
}

export function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const start = Date.now();
  const ip = getClientIp(req);
  const isMutation = MUTATING_METHODS.has(req.method);

  if (isMutation || req.nextUrl.pathname.startsWith("/api/super-admin")) {
    console.log(`[API] ${req.method} ${req.nextUrl.pathname} from ${ip}`);
  }
  const limit = isMutation ? RATE_LIMIT_MAX_MUTATION : RATE_LIMIT_MAX;
  const rlKey = isMutation ? `mut:${ip}` : `read:${ip}`;
  const rl = checkMiddlewareRateLimit(rlKey, limit);

  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many requests. Please try again in ${rl.resetIn} seconds.` },
      { status: 429, headers: { "Retry-After": String(rl.resetIn) } },
    );
  }

  if (!isMutation) {
    const response = NextResponse.next();
    response.headers.set("X-API-Version", "2.0");
    return response;
  }

  const origin = getOrigin(req);
  if (!origin) {
    return NextResponse.json(
      { error: "Forbidden: missing Origin header" },
      { status: 403 },
    );
  }

  const allowed = new Set([
    req.nextUrl.origin,
    process.env.NEXTAUTH_URL,
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
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
