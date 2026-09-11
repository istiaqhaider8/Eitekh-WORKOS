import { NextResponse } from "next/server";
import { getCurrentUser, verifyToken, COOKIE_NAME } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    let currentSessionId = "";
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        currentSessionId = payload.sessionId;
      }
    }

    const sessions = await prisma.session.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        os: true,
        browser: true,
        location: true,
        lastActiveAt: true,
        createdAt: true,
      },
      orderBy: { lastActiveAt: "desc" },
    });

    const formattedSessions = sessions.map((s) => ({
      ...s,
      isCurrent: s.id === currentSessionId,
    }));

    return NextResponse.json({ sessions: formattedSessions }, { status: 200 });
  } catch (error) {
    console.error("Get sessions error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    let currentSessionId = "";
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        currentSessionId = payload.sessionId;
      }
    }

    const body = await request.json();
    const { sessionId, revokeAll } = body;

    if (revokeAll) {
      if (!currentSessionId) {
        return NextResponse.json({ error: "Current session not identified" }, { status: 400 });
      }
      await prisma.session.deleteMany({
        where: {
          userId: user.id,
          id: { not: currentSessionId },
        },
      });
      return NextResponse.json({ success: true }, { status: 200 });
    }

    if (sessionId) {
      const session = await prisma.session.findFirst({
        where: { id: sessionId, userId: user.id },
      });
      if (!session) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      await prisma.session.delete({
        where: { id: sessionId },
      });
      return NextResponse.json({ success: true }, { status: 200 });
    }

    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (error) {
    console.error("Delete session error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
