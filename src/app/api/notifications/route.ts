import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { notificationEngine, NotificationType } from "@/lib/notifications";

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({
        notifications: [],
        unreadCount: 0,
        total: 0,
        page: 1,
        totalPages: 0,
      });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const filter = (searchParams.get("filter") || "all").toLowerCase();
    const search = searchParams.get("search") || searchParams.get("q") || "";

    const whereClause: any = { userId: user.id };

    if (filter === "unread") {
      whereClause.isRead = false;
    } else if (filter === "read") {
      whereClause.isRead = true;
    } else if (filter === "mentions") {
      whereClause.type = "MENTION";
    } else if (filter === "assignments") {
      whereClause.type = { in: ["ASSIGNMENT", "TEAM_ASSIGNMENT"] };
    } else if (filter === "system") {
      whereClause.type = { in: ["SYSTEM", "INFO", "ROLE"] };
    }

    if (search.trim()) {
      whereClause.OR = [
        { title: { contains: search.trim() } },
        { message: { contains: search.trim() } },
      ];
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count({ where: whereClause }),
      prisma.notification.count({ where: { userId: user.id, isRead: false } }),
    ]);

    return NextResponse.json({
      notifications,
      unreadCount,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      limit,
    });
  } catch (error: any) {
    console.error("[Notifications API GET] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { id, ids, markAllRead } = body;

    if (markAllRead) {
      await prisma.notification.updateMany({
        where: { userId: user.id, isRead: false },
        data: { isRead: true },
      });
    } else if (Array.isArray(ids) && ids.length > 0) {
      await prisma.notification.updateMany({
        where: { id: { in: ids }, userId: user.id },
        data: { isRead: true },
      });
    } else if (id) {
      await prisma.notification.updateMany({
        where: { id, userId: user.id },
        data: { isRead: true },
      });
    }

    const unreadCount = await prisma.notification.count({
      where: { userId: user.id, isRead: false },
    });

    return NextResponse.json({ success: true, unreadCount });
  } catch (error: any) {
    console.error("[Notifications API PATCH] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let id: string | undefined;
    let ids: string[] | undefined;
    let clearAll: boolean | undefined;

    const { searchParams } = new URL(req.url);
    if (searchParams.get("id")) id = searchParams.get("id") || undefined;
    if (searchParams.get("clearAll") === "true") clearAll = true;

    if (!id && !clearAll) {
      try {
        const body = await req.json();
        id = body.id;
        ids = body.ids;
        clearAll = body.clearAll;
      } catch (e) {}
    }

    if (clearAll) {
      await prisma.notification.deleteMany({
        where: { userId: user.id },
      });
    } else if (Array.isArray(ids) && ids.length > 0) {
      await prisma.notification.deleteMany({
        where: { id: { in: ids }, userId: user.id },
      });
    } else if (id) {
      await prisma.notification.deleteMany({
        where: { id, userId: user.id },
      });
    }

    const unreadCount = await prisma.notification.count({
      where: { userId: user.id, isRead: false },
    });

    return NextResponse.json({ success: true, unreadCount });
  } catch (error: any) {
    console.error("[Notifications API DELETE] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const {
      recipientUserIds,
      type = "INFO",
      title,
      message,
      linkUrl,
      projectId,
      sendEmailAsync = true,
      emailTemplateKey,
      emailVariables,
    } = body;

    if (!title || !message) {
      return NextResponse.json({ error: "Title and message are required" }, { status: 400 });
    }

    const recipients = recipientUserIds || [user.id];

    const result = await notificationEngine.dispatch({
      recipientUserIds: recipients,
      type: type as NotificationType,
      title,
      message,
      linkUrl,
      projectId,
      actorId: user.id,
      actorName: user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      actorEmail: user.email,
      sendEmailAsync,
      emailTemplateKey,
      emailVariables,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error("[Notifications API POST] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

