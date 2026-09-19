import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { superAdminAnnouncementCreateSchema, superAdminAnnouncementUpdateSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import {
  announcementStatus,
  dedupeTargets,
  resolveRecipientIds,
  validateTargets,
} from "@/lib/announcement-targeting";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const rows = await prisma.systemAnnouncement.findMany({
      orderBy: { createdAt: "desc" },
      include: { targets: { select: { id: true, kind: true, value: true } } },
    });

    // status is derived from isActive + the schedule on every read, so a
    // scheduled announcement becomes ACTIVE and then EXPIRED without a job
    // having to rewrite a stored column.
    const announcements = rows.map((a) => ({ ...a, status: announcementStatus(a) }));

    return NextResponse.json({ announcements });
  } catch (error: any) {
    return handleApiError(error, "super-admin/announcements");
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const parsed = await parseJsonBody(req, superAdminAnnouncementCreateSchema);
    if (!parsed.success) return parsed.error;
    const { title, message, severity, targetAudience, isActive, startsAt, expiresAt,
      audienceMode, matchMode, targets } = parsed.data;

    const { broadcast } = parsed.data as any;

    const cleanTargets = dedupeTargets(targets || []);

    // A FILTERED audience with no rules reaches nobody, which is almost never
    // what the author meant — refuse it rather than publish a silent no-op.
    if (audienceMode === "FILTERED" && cleanTargets.length === 0) {
      return NextResponse.json(
        { error: "A filtered audience needs at least one target. Use audienceMode ALL to reach everyone." },
        { status: 400 }
      );
    }

    // Ids are checked against the database so a mistyped project cannot be
    // stored as an audience that quietly matches no one.
    const targetErrors = await validateTargets(cleanTargets);
    if (targetErrors.length) {
      return NextResponse.json({ error: targetErrors.join("; ") }, { status: 400 });
    }

    const announcement = await prisma.systemAnnouncement.create({
      data: {
        title: title.trim(),
        message: message.trim(),
        severity,
        targetAudience,
        audienceMode,
        matchMode,
        createdById: user.id,
        isActive,
        startsAt: startsAt ? new Date(startsAt) : new Date(),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        targets: cleanTargets.length ? { create: cleanTargets } : undefined,
      },
      include: { targets: { select: { id: true, kind: true, value: true } } },
    });

    let broadcastCount = 0;
    if (broadcast) {
      // Resolved through the same matcher as the feed. This previously notified
      // EVERY active account, so a broadcast ignored the audience entirely and
      // a project-targeted announcement reached the whole platform.
      const recipientIds = await resolveRecipientIds(announcement.id);
      if (recipientIds.length > 0) {
        /**
         * C3 — routed through the notification engine rather than written
         * straight to the table.
         *
         * `prisma.notification.createMany` bypassed the engine entirely, and
         * with it the per-user preference check. A user who had turned SYSTEM
         * notifications off still received every broadcast, so that toggle was
         * partially inert too — it worked for engine-dispatched SYSTEM
         * notifications and silently did nothing for the ones that actually
         * arrive in volume.
         *
         * Dispatching also gets realtime delivery for free: the direct write
         * published no SSE event, so a broadcast only appeared after the
         * recipient's next poll or page load.
         */
        const { notificationEngine } = await import("@/lib/notifications");
        await notificationEngine.dispatch({
          recipientUserIds: recipientIds,
          type: "SYSTEM",
          title: `📢 ${title.trim()}`,
          message: message.trim(),
          actorId: user.id,
          actorEmail: user.email,
          // One announcement, one notification per recipient, however many
          // times this handler is retried.
          idempotencyKey: `announcement:${announcement.id}`,
          sendEmailAsync: false,
        });
        broadcastCount = recipientIds.length;
      }
    }

    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "ANNOUNCEMENT_CREATED",
        targetResource: `SystemAnnouncement:${announcement.id}`,
        details: JSON.stringify({
          title: announcement.title,
          severity: announcement.severity,
          targetAudience: announcement.targetAudience,
          audienceMode: announcement.audienceMode,
          matchMode: announcement.matchMode,
          targets: announcement.targets.map((t) => `${t.kind}:${t.value}`),
          isActive: announcement.isActive,
          createdBy: user.email,
        }),
      },
    });

    return NextResponse.json({
      // status derived here too, so create/update/list all report it the same way
      announcement: { ...announcement, status: announcementStatus(announcement) },
      broadcastCount,
      message: broadcast
        ? `Announcement published and broadcast to ${broadcastCount} users`
        : "Announcement published successfully",
    }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "super-admin/announcements");
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const parsed = await parseJsonBody(req, superAdminAnnouncementUpdateSchema);
    if (!parsed.success) return parsed.error;
    const { id, title, message, severity, targetAudience, isActive, startsAt, expiresAt,
      audienceMode, matchMode, targets } = parsed.data;

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
    if (audienceMode !== undefined) updateData.audienceMode = audienceMode;
    if (matchMode !== undefined) updateData.matchMode = matchMode;

    // Omitting targets leaves the audience alone; sending an array replaces it.
    const cleanTargets = targets === undefined ? null : dedupeTargets(targets);
    const effectiveMode = audienceMode ?? existing.audienceMode;

    if (cleanTargets) {
      const targetErrors = await validateTargets(cleanTargets);
      if (targetErrors.length) {
        return NextResponse.json({ error: targetErrors.join("; ") }, { status: 400 });
      }
    }

    // Guard the same no-op audience as create, including the case where only
    // the mode is switched to FILTERED while no targets exist yet.
    if (effectiveMode === "FILTERED") {
      const willHave = cleanTargets
        ? cleanTargets.length
        : await prisma.announcementTarget.count({ where: { announcementId: id } });
      if (willHave === 0) {
        return NextResponse.json(
          { error: "A filtered audience needs at least one target. Use audienceMode ALL to reach everyone." },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (cleanTargets) {
        // Replace rather than merge, so deselecting an audience in the UI
        // actually removes it.
        await tx.announcementTarget.deleteMany({ where: { announcementId: id } });
        if (cleanTargets.length) {
          await tx.announcementTarget.createMany({
            data: cleanTargets.map((t) => ({ announcementId: id, kind: t.kind, value: t.value })),
          });
        }
      }
      return tx.systemAnnouncement.update({
        where: { id },
        data: updateData,
        include: { targets: { select: { id: true, kind: true, value: true } } },
      });
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

    return NextResponse.json({
      announcement: { ...updated, status: announcementStatus(updated) },
      message: "Announcement updated successfully",
    });
  } catch (error: any) {
    return handleApiError(error, "super-admin/announcements");
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
    return handleApiError(error, "super-admin/announcements");
  }
}
