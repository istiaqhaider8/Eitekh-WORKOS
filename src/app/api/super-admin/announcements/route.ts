import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const announcements = await prisma.systemAnnouncement.findMany({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ announcements });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const body = await req.json();
    const {
      title,
      message,
      severity = "INFO",
      targetAudience = "ALL",
      isActive = true,
      startsAt,
      expiresAt,
    } = body;

    if (!title || !title.trim()) {
      return NextResponse.json({ error: "Announcement title is required" }, { status: 400 });
    }
    if (!message || !message.trim()) {
      return NextResponse.json({ error: "Announcement message is required" }, { status: 400 });
    }

    const announcement = await prisma.systemAnnouncement.create({
      data: {
        title: title.trim(),
        message: message.trim(),
        severity: ["INFO", "WARNING", "CRITICAL"].includes(severity) ? severity : "INFO",
        targetAudience: ["ALL", "ORGS", "USERS"].includes(targetAudience) ? targetAudience : "ALL",
        isActive: Boolean(isActive),
        startsAt: startsAt ? new Date(startsAt) : new Date(),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "ANNOUNCEMENT_CREATED",
        targetResource: `SystemAnnouncement:${announcement.id}`,
        details: JSON.stringify({
          title: announcement.title,
          severity: announcement.severity,
          targetAudience: announcement.targetAudience,
          isActive: announcement.isActive,
          createdBy: user.email,
        }),
      },
    });

    return NextResponse.json({ announcement, message: "Announcement published successfully" }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const body = await req.json();
    const { id, title, message, severity, targetAudience, isActive, startsAt, expiresAt } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const existing = await prisma.systemAnnouncement.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
    }

    const updateData: any = {};
    if (title !== undefined) updateData.title = title.trim();
    if (message !== undefined) updateData.message = message.trim();
    if (severity !== undefined && ["INFO", "WARNING", "CRITICAL"].includes(severity)) updateData.severity = severity;
    if (targetAudience !== undefined && ["ALL", "ORGS", "USERS"].includes(targetAudience)) updateData.targetAudience = targetAudience;
    if (typeof isActive === "boolean") updateData.isActive = isActive;
    if (startsAt !== undefined) updateData.startsAt = startsAt ? new Date(startsAt) : new Date();
    if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;

    const updated = await prisma.systemAnnouncement.update({
      where: { id },
      data: updateData,
    });

    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: typeof isActive === "boolean" && isActive !== existing.isActive ? (isActive ? "ANNOUNCEMENT_ACTIVATED" : "ANNOUNCEMENT_DEACTIVATED") : "ANNOUNCEMENT_UPDATED",
        targetResource: `SystemAnnouncement:${id}`,
        details: JSON.stringify({
          previous: { title: existing.title, isActive: existing.isActive, severity: existing.severity },
          updated: updateData,
        }),
      },
    });

    return NextResponse.json({ announcement: updated, message: "Announcement updated successfully" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    let id = searchParams.get("id");

    if (!id) {
      try {
        const body = await req.json();
        id = body.id;
      } catch (e) {}
    }

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const existing = await prisma.systemAnnouncement.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
    }

    await prisma.systemAnnouncement.delete({ where: { id } });

    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "ANNOUNCEMENT_DELETED",
        targetResource: `SystemAnnouncement:${id}`,
        details: JSON.stringify({
          deletedTitle: existing.title,
          severity: existing.severity,
          deletedBy: user.email,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: `Announcement '${existing.title}' deleted permanently`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
