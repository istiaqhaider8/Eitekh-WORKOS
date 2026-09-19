import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/audit-logger";
import { handleApiError } from "@/lib/api-error";
import { logger } from "@/lib/logger";

/**
 * Log out: revoke the server-side session, then clear the cookie.
 *
 * THE DELETE MUST BE AWAITED.
 *
 * It was not. The line was:
 *
 *     prisma.session.delete({ where: { id: payload.sessionId } }).catch(() => {});
 *
 * — fire-and-forget, with the error swallowed. src/lib/auth.ts validates every
 * request against the Session row precisely so that "logout, password reset,
 * and admin force-logout actually revoke access", and the JWT stays
 * cryptographically valid until it expires. So if that delete lost its race
 * with the response, or failed for any reason, the outcome was: the cookie is
 * gone from this browser, the user is told they logged out, and the token
 * remains usable by anyone who has a copy of it — for the rest of
 * SESSION_EXPIRY_DAYS. Nothing logged, nothing to notice.
 *
 * `deleteMany` rather than `delete` because logging out twice is not an error:
 * `delete` throws P2025 when the row is already gone, which the old `.catch()`
 * was probably hiding.
 *
 * If revocation genuinely fails we still clear the cookie — that removes the
 * token from this browser and is strictly better than leaving it — but we say
 * so in the response and log it at security severity rather than reporting a
 * clean logout.
 */
export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    let revoked = true;

    if (token) {
      const payload = verifyToken(token);
      if (payload?.sessionId) {
        try {
          await prisma.session.deleteMany({ where: { id: payload.sessionId } });
        } catch (err) {
          revoked = false;
          logger.error(
            "AUTH_LOGOUT_REVOKE_FAILED",
            "Logout could not delete the session row; the token is still valid server-side.",
            err,
            { sessionId: payload.sessionId, userId: payload.userId }
          );
        }

        // Awaited, unlike before: a logout that vanishes from the audit trail
        // is the one an investigation needs. It must not fail the logout,
        // though, so its own error is caught separately.
        await logAuditEvent({
          actor: { id: payload.userId, email: payload.email },
          action: 'AUTH_LOGOUT',
          category: 'AUTH',
          severity: revoked ? 'INFO' : 'WARNING',
          targetResource: `User:${payload.userId}`,
          details: { sessionId: payload.sessionId, revoked },
        }).catch((err) => console.error('Failed to log logout audit event:', err));
      }
    }

    const response = NextResponse.json({ success: true, revoked });
    response.cookies.delete(COOKIE_NAME);
    return response;
  } catch (error: any) {
    return handleApiError(error, "auth/logout");
  }
}
