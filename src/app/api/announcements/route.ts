import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { resolveAnnouncementsForUser } from "@/lib/announcement-targeting";

/**
 * The announcements the signed-in user should see.
 *
 * Targeting is enforced here, server-side. This endpoint used to return every
 * active announcement to every signed-in user — `targetAudience` was stored but
 * never read — so an announcement aimed at one project was served to the whole
 * platform. Hiding it in the client would not have helped: the payload was
 * already in the browser.
 *
 * `targets` is deliberately not returned. A reader has no use for the audience
 * rules, and they can name projects, teams and individual users the reader is
 * not otherwise entitled to know about.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ announcements: [] });
    }

    const announcements = await resolveAnnouncementsForUser(user.id);

    return NextResponse.json({
      announcements: announcements.map((a) => ({
        id: a.id,
        title: a.title,
        message: a.message,
        severity: a.severity,
        startsAt: a.startsAt,
        expiresAt: a.expiresAt,
        createdAt: a.createdAt,
      })),
    });
  } catch (error: any) {
    console.error("[Announcements API] Error:", error);
    return NextResponse.json({ announcements: [] });
  }
}
