/**
 * Session token minting and verification, with no framework dependencies.
 *
 * WHY THIS IS SEPARATE FROM auth.ts
 *
 * `auth.ts` imports `next/headers` (for `cookies()`), Prisma and bcrypt. All
 * three are fine in a route handler and none of them belong in middleware:
 * importing `next/headers` from the middleware module graph breaks the
 * request, and it does so *silently* — the middleware itself runs to
 * completion and sets its headers, then every response becomes a bare 500 with
 * nothing in the log. That is a genuinely nasty failure to diagnose, so the
 * fix is structural rather than a workaround: the token primitives live here,
 * where middleware can import them without dragging the rest of auth.ts along,
 * and `auth.ts` re-exports them so existing callers are unaffected.
 *
 * Nothing here touches the database or the request context. It is pure
 * signing and verification.
 */

import jwt from "jsonwebtoken";

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

export const COOKIE_NAME = "eitekh_session_token";

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
