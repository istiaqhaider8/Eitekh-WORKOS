/**
 * Eitekh WorkOS Enterprise Notification & Asynchronous Email Engine
 * Handles In-App, Real-Time SSE, and Queued Email dispatch with deduplication,
 * intelligent grouping, retries, and PBAC project boundaries.
 */

import { prisma } from './prisma';
import { sendEmail } from './email';
import { syncEngine } from './sync-engine';
import { getBaseUrl } from './config';

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

export interface EmailQueueItem {
  id: string;
  to: string;
  templateKey?: string;
  variables?: Record<string, any>;
  customSubject?: string;
  customHtml?: string;
  retryCount: number;
  maxRetries: number;
  status: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';
  error?: string;
  createdAt: string;
  nextAttemptAt: number;
}

class NotificationEngine {
  private emailQueue: EmailQueueItem[] = [];
  private isWorkerRunning = false;
  private processedEventIds = new Set<string>();

  constructor() {
    // Start background queue processor
    if (typeof setInterval !== 'undefined') {
      setInterval(() => {
        this.processEmailQueue();
      }, 3000);
    }
  }

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

          this.enqueueEmail({
            to: r.email,
            templateKey: emailTemplateKey,
            variables: vars,
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
  public enqueueEmail(item: {
    to: string;
    templateKey?: string;
    variables?: Record<string, any>;
    customSubject?: string;
    customHtml?: string;
  }) {
    const queueItem: EmailQueueItem = {
      id: `mail_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      to: item.to,
      templateKey: item.templateKey,
      variables: item.variables,
      customSubject: item.customSubject,
      customHtml: item.customHtml,
      retryCount: 0,
      maxRetries: 3,
      status: 'QUEUED',
      createdAt: new Date().toISOString(),
      nextAttemptAt: Date.now(),
    };

    this.emailQueue.push(queueItem);
  }

  /**
   * Asynchronous Background Email Worker with Exponential Backoff
   */
  private async processEmailQueue() {
    if (this.isWorkerRunning || this.emailQueue.length === 0) return;
    this.isWorkerRunning = true;

    try {
      const now = Date.now();
      const readyItems = this.emailQueue.filter(
        (item) => item.status === 'QUEUED' && item.nextAttemptAt <= now
      );

      for (const item of readyItems) {
        item.status = 'SENDING';
        try {
          const result = await sendEmail({
            to: item.to,
            templateKey: item.templateKey,
            variables: item.variables,
            customSubject: item.customSubject,
            customHtml: item.customHtml,
          });

          if (result.status === 'SENT') {
            item.status = 'SENT';
            // Remove from queue
            this.emailQueue = this.emailQueue.filter((q) => q.id !== item.id);
          } else if (result.status === 'MOCKED') {
            // SMTP not configured — remove from queue but log warning
            console.warn(`[EmailQueue] Email to ${item.to} was MOCKED (SMTP not configured). Removing from queue.`);
            this.emailQueue = this.emailQueue.filter((q) => q.id !== item.id);
          } else {
            throw new Error(result.error || 'Failed to dispatch email');
          }
        } catch (err: any) {
          item.retryCount += 1;
          item.error = err.message || 'Email dispatch failed';

          if (item.retryCount >= item.maxRetries) {
            item.status = 'FAILED';
            console.error(`[EmailQueue] Dead-letter item ${item.id} to ${item.to} exceeded max retries.`);
            try {
              await prisma.emailLog.create({
                data: {
                  to: item.to,
                  from: 'noreply@eitekh.com',
                  subject: item.customSubject || item.templateKey || 'notification',
                  templateKey: item.templateKey,
                  status: 'FAILED',
                  error: item.error,
                },
              });
            } catch {}
          } else {
            item.status = 'QUEUED';
            // Exponential backoff: 2s, 6s, 18s
            item.nextAttemptAt = Date.now() + Math.pow(3, item.retryCount) * 2000;
          }
        }
      }
    } catch (e) {
      console.error('[NotificationEngine] Error in email worker tick:', e);
    } finally {
      this.isWorkerRunning = false;
    }
  }

  public getQueueStats() {
    return {
      totalQueued: this.emailQueue.filter((i) => i.status === 'QUEUED').length,
      totalSending: this.emailQueue.filter((i) => i.status === 'SENDING').length,
      totalFailed: this.emailQueue.filter((i) => i.status === 'FAILED').length,
      queueDepth: this.emailQueue.length,
    };
  }
}

export const notificationEngine = new NotificationEngine();
