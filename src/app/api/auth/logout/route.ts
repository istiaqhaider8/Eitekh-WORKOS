import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/lib/audit-logger";
import { handleApiError } from "@/lib/api-error";

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    if (token) {
      const payload = verifyToken(token);
      if (payload?.sessionId) {
        prisma.session.delete({ where: { id: payload.sessionId } }).catch(() => {});
        logAuditEvent({
          actor: { id: payload.userId, email: payload.email },
          action: 'AUTH_LOGOUT',
          category: 'AUTH',
          severity: 'INFO',
          targetResource: `User:${payload.userId}`,
          details: { sessionId: payload.sessionId },
        }).catch((err) => console.error('Failed to log logout audit event:', err));
      }
    }

    const response = NextResponse.json({ success: true });
    response.cookies.delete(COOKIE_NAME);
    return response;
  } catch (error: any) {
    return handleApiError(error, "auth/logout");
  }
}
