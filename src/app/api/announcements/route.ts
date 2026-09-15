import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ announcements: [] });
    }

    const now = new Date();
    const announcements = await prisma.systemAnnouncement.findMany({
      where: {
        isActive: true,
        startsAt: { lte: now },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      orderBy: [
        { severity: "desc" },
        { createdAt: "desc" },
      ],
      take: 10,
    });

    return NextResponse.json({ announcements });
  } catch (error: any) {
    console.error("[Announcements API] Error:", error);
    return NextResponse.json({ announcements: [] });
  }
}
