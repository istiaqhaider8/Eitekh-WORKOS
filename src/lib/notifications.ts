/**
 * Eitekh WorkOS Enterprise Notification & Asynchronous Email Engine
 * Handles In-App, Real-Time SSE, and Queued Email dispatch with deduplication,
 * intelligent grouping, retries, and PBAC project boundaries.
 */

import { prisma } from './prisma';
import { sendEmail } from './email';
import { syncEngine } from './sync-engine';
import { getBaseUrl } from './config';
import { logger } from './logger';

export type NotificationType =
  | 'MENTION'
  | 'ASSIGNMENT'
  | 'STATUS'
  | 'PRIORITY'
  | 'DUE_DATE'
  | 'OVERDUE'
  | 'COMMENT'
  | 'SPRINT'
  | 'PROJECT'
  | 'ROLE'
  | 'INFO'
  | 'SYSTEM';

export interface DispatchNotificationOptions {
  recipientUserIds: string[] | string;
  type: NotificationType;
  title: string;
  message: string;
  linkUrl?: string;
  projectId?: string;
  issueId?: string;
  actorId?: string;
  actorName?: string;
  actorEmail?: string;
  // Email Dispatch Options
  emailTemplateKey?: string;
  emailVariables?: Record<string, any>;
  sendEmailAsync?: boolean;
  priority?: 'HIGH' | 'NORMAL' | 'LOW';
  idempotencyKey?: string;
}

class NotificationEngine {
  private processedEventIds = new Set<string>();

  /**
   * Enterprise Multi-Channel Notification Dispatcher
   * Fans out to In-App DB, Real-Time SSE, and Async Email Worker.
   */
  public async dispatch(options: DispatchNotificationOptions) {
    const {
      recipientUserIds,
      type,
      title,
      message,
      linkUrl,
      projectId,
      issueId,
      actorId,
      actorName,
      emailTemplateKey,
      emailVariables,
      sendEmailAsync = true,
      idempotencyKey,
    } = options;

    const userIds = Array.isArray(recipientUserIds) ? recipientUserIds : [recipientUserIds];
    if (userIds.length === 0) return { inAppCount: 0, emailQueuedCount: 0 };

    // 1. Deduplication check
    if (idempotencyKey) {
      if (this.processedEventIds.has(idempotencyKey)) {
        return { duplicate: true, inAppCount: 0, emailQueuedCount: 0 };
      }
      this.processedEventIds.add(idempotencyKey);
      if (this.processedEventIds.size > 2000) {
        const [first] = this.processedEventIds;
        this.processedEventIds.delete(first);
      }
    }

    // 2. Filter out the actor themselves (do not notify yourself of your own changes)
    const targetUserIds = actorId ? userIds.filter((id) => id !== actorId) : userIds;
    if (targetUserIds.length === 0) return { inAppCount: 0, emailQueuedCount: 0 };

    // 2a. Fetch notification preferences for all target users in one query
    const userPrefsRows = await prisma.user.findMany({
      where: { id: { in: targetUserIds }, status: 'ACTIVE' },
      select: { id: true, notificationPrefs: true },
    });
    const prefsMap = new Map(userPrefsRows.map((u) => {
      let prefs: Record<string, { inApp: boolean; email: boolean }> = {};
      try { if (u.notificationPrefs) prefs = JSON.parse(u.notificationPrefs); } catch {}
      return [u.id, prefs];
    }));
    const wantsInApp = (userId: string) => {
      const p = prefsMap.get(userId);
      if (!p || !p[type]) return true; // default on
      return p[type].inApp !== false;
    };
    const wantsEmail = (userId: string) => {
      const p = prefsMap.get(userId);
      if (!p || !p[type]) return true; // default on
      return p[type].email !== false;
    };
    const inAppUserIds = targetUserIds.filter(wantsInApp);
    const emailUserIds = targetUserIds.filter(wantsEmail);

    // 3. Batch insert In-App notifications into database (respecting preferences)
    // One shared timestamp for this batch, so the rows can be read back by an
    // exact createdAt match below rather than a fuzzy time window.
    const batchCreatedAt = new Date();

    const inAppRecords = inAppUserIds.map((userId) => ({
      userId,
      actorId: actorId || null,
      title,
      message,
      linkUrl: linkUrl || null,
      type,
      isRead: false,
      createdAt: batchCreatedAt,
    }));

    // Created rows are read back so the realtime event can carry the same
    // shape the GET endpoint returns (id, actor, timestamps). createMany does
    // not return rows on SQLite, hence the follow-up query.
    let createdNotifications: any[] = [];
    try {
      await prisma.notification.createMany({
        data: inAppRecords,
      });

      if (inAppUserIds.length > 0) {
        createdNotifications = await prisma.notification.findMany({
          where: {
            userId: { in: inAppUserIds },
            type,
            // Exact timestamp of this batch — cannot match an earlier
            // identical notification to the same user.
            createdAt: batchCreatedAt,
          },
          include: {
            actor: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
          },
        });
      }
    } catch (err) {
      console.error('[NotificationEngine] Failed to create in-app notifications:', err);
    }

    // Realtime delivery, one event per recipient.
    //
    // This replaces relying on the project-wide SYSTEM_SYNC_PING below for
    // notification delivery. That broadcast sends every recipient's title and
    // message to all project subscribers, so users could see notifications
    // addressed to other people. publishUserEvent requires an exact userId
    // match, so each person only ever receives their own.
    for (const n of createdNotifications) {
      try {
        syncEngine.publishUserEvent({
          userId: n.userId,
          eventType: 'NOTIFICATION_CREATED',
          entityId: n.id,
          entityType: 'SYSTEM',
          data: { notification: n },
          actor: actorId
            ? { id: actorId, email: options.actorEmail || '', name: actorName || '' }
            : undefined,
        });
      } catch (err) {
        console.error('[NotificationEngine] Failed to publish realtime notification:', err);
      }
    }

    // 4. Real-Time Event Dispatch via Sync Engine
    if (projectId) {
      // Board-level ping only. The notification's title, message and recipient
      // list are deliberately NOT included: this event goes to every subscriber
      // of the project, so including them let users read notifications
      // addressed to other people. Notification content is delivered per-user
      // via publishUserEvent above.
      syncEngine.publishProjectEvent({
        projectId,
        eventType: 'SYSTEM_SYNC_PING',
        entityType: 'SYSTEM',
        data: {
          notification: {
            type,
            recipientCount: targetUserIds.length,
            createdAt: new Date().toISOString(),
          },
        },
        actor: {
          id: actorId || 'system',
          email: options.actorEmail || 'system@eitekh.local',
          name: actorName || 'System',
        },
      });
    }

    // 5. Asynchronous Email Queueing
    let emailQueuedCount = 0;
    if (sendEmailAsync && emailTemplateKey) {
      try {
        const recipients = await prisma.user.findMany({
          where: {
            id: { in: emailUserIds },
            status: 'ACTIVE',
          },
          select: { id: true, email: true, firstName: true, lastName: true },
        });

        for (const r of recipients) {
          const vars = {
            userName: `${r.firstName} ${r.lastName}`.trim() || r.email,
            userEmail: r.email,
            actionUrl: linkUrl ? `${getBaseUrl()}${linkUrl}` : getBaseUrl(),
            ...emailVariables,
          };

          await this.enqueueEmail({
            to: r.email,
            templateKey: emailTemplateKey,
            variables: vars,
            // One notification, one email per recipient, however many times
            // this handler is retried. Without it the durable outbox would
            // faithfully persist duplicates.
            idempotencyKey: idempotencyKey ? `${idempotencyKey}:${r.id}` : undefined,
          });
          emailQueuedCount++;
        }
      } catch (err) {
        console.error('[NotificationEngine] Error queueing emails:', err);
      }
    }

    return {
      inAppCount: targetUserIds.length,
      emailQueuedCount,
    };
  }

  /**
   * Enqueue Email for Asynchronous Non-Blocking Processing
   */
  /**
   * Queue an email.
   *
   * C2 — THIS NO LONGER KEEPS THE MESSAGE IN MEMORY.
   *
   * It used to push onto `this.emailQueue`, a plain array on the process,
   * drained by a setInterval. A restart threw away everything not yet sent,
   * silently; the retry timer was per-instance, so with several instances each
   * retried only what it had enqueued itself; and nothing outside the process
   * could see the queue, so "was the invitation sent?" had no answer.
   *
   * The flows that depend on this are the ones a locked-out user cannot work
   * around — password resets, OTP codes, invitations.
   *
   * src/lib/email-outbox.ts now owns queueing, retry, backoff and
   * dead-lettering against a table. This method remains as the seam its
   * callers already use.
   */
  public async enqueueEmail(item: {
    to: string;
    templateKey?: string;
    variables?: Record<string, any>;
    customSubject?: string;
    customHtml?: string;
    idempotencyKey?: string;
  }): Promise<void> {
    const { enqueueEmail } = await import('./email-outbox');
    await enqueueEmail(item);
  }

  /**
   * Outbox depth by status, for the admin view and /api/health.
   *
   * Reads the table rather than an array, so it reports the whole system's
   * backlog instead of whatever this one process happened to hold.
   */
  public async getQueueStats() {
    const counts = await prisma.emailOutbox.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const by = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
    return {
      totalQueued: (by.PENDING ?? 0) + (by.FAILED ?? 0),
      totalSending: by.SENDING ?? 0,
      totalFailed: by.DEAD ?? 0,
      queueDepth: (by.PENDING ?? 0) + (by.FAILED ?? 0) + (by.SENDING ?? 0),
    };
  }
}

export const notificationEngine = new NotificationEngine();
