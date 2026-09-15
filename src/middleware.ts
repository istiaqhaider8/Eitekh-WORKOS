import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function getOrigin(req: NextRequest): string | null {
  return req.headers.get("origin") || req.headers.get("referer")?.replace(/\/[^/]*$/, "") || null;
}

export function middleware(req: NextRequest) {
  if (!MUTATING_METHODS.has(req.method)) {
    return NextResponse.next();
  }

  if (!req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
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

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
