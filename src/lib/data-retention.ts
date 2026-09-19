/**
 * Data Retention Engine
 * Defines per-entity retention periods (configurable via env vars) and
 * performs hard-delete cleanup of records older than those periods.
 *
 * Retention defaults (override in .env):
 *   SESSION_RETENTION_DAYS        = 90
 *   NOTIFICATION_RETENTION_DAYS   = 90
 *   ACTIVITY_LOG_RETENTION_DAYS   = 180
 *   EMAIL_LOG_RETENTION_DAYS      = 90
 *   AUDIT_LOG_RETENTION_DAYS      = 365
 */

import { container } from './container';

export interface RetentionPolicy {
  entity: string;
  retentionDays: number;
  description: string;
}

export interface RetentionRunResult {
  entity: string;
  retentionDays: number;
  cutoffDate: string;
  deletedCount: number;
  error?: string;
}

function getRetentionDays(envKey: string, defaultDays: number): number {
  const raw = process.env[envKey];
  if (!raw) return defaultDays;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultDays;
}

export function getRetentionPolicies(): RetentionPolicy[] {
  return [
    {
      entity: 'Session',
      retentionDays: getRetentionDays('SESSION_RETENTION_DAYS', 90),
      description: 'Expired and old auth sessions',
    },
    {
      entity: 'OtpCode',
      // Not a retention window: the purge condition is expiry, not age. The
      // value is kept only so the policy reports consistently.
      retentionDays: getRetentionDays('OTP_RETENTION_DAYS', 1),
      description: 'Expired one-time passcodes (purged once expired)',
    },
    {
      entity: 'Notification',
      retentionDays: getRetentionDays('NOTIFICATION_RETENTION_DAYS', 90),
      description: 'Read in-app notifications',
    },
    {
      entity: 'ActivityLog',
      retentionDays: getRetentionDays('ACTIVITY_LOG_RETENTION_DAYS', 180),
      description: 'Issue activity history entries',
    },
    {
      entity: 'EmailLog',
      retentionDays: getRetentionDays('EMAIL_LOG_RETENTION_DAYS', 90),
      description: 'Email delivery log entries',
    },
    {
      entity: 'EmailOutbox',
      retentionDays: getRetentionDays('EMAIL_OUTBOX_RETENTION_DAYS', 30),
      description: 'Completed outbox rows (SENT and DEAD). Pending and retrying rows are never purged: they are work still to do.',
    },
    {
      entity: 'PlatformAuditLog',
      retentionDays: getRetentionDays('AUDIT_LOG_RETENTION_DAYS', 365),
      description: 'Super-admin platform audit log entries',
    },
  ];
}

function cutoffDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

async function purgeEntity(
  entity: string,
  days: number,
): Promise<{ deletedCount: number; error?: string }> {
  const cutoff = cutoffDate(days);
  try {
    switch (entity) {
      case 'Session': {
        const r = await container.prisma.session.deleteMany({
          where: { expiresAt: { lt: cutoff } },
        });
        return { deletedCount: r.count };
      }
      case 'OtpCode': {
        // Expired one-time codes are spent secrets — purge on expiry rather
        // than after a retention window. Previously nothing purged them at all,
        // so every code ever issued stayed in the table indefinitely.
        const r = await container.prisma.otpCode.deleteMany({
          where: { expiresAt: { lt: new Date() } },
        });
        return { deletedCount: r.count };
      }
      case 'Notification': {
        // Only delete read notifications; unread are kept regardless of age
        const r = await container.prisma.notification.deleteMany({
          where: { isRead: true, createdAt: { lt: cutoff } },
        });
        return { deletedCount: r.count };
      }
      case 'ActivityLog': {
        const r = await container.prisma.activityLog.deleteMany({
          where: { timestamp: { lt: cutoff } },
        });
        return { deletedCount: r.count };
      }
      case 'EmailLog': {
        const r = await container.prisma.emailLog.deleteMany({
          where: { createdAt: { lt: cutoff } },
        });
        return { deletedCount: r.count };
      }
      case 'EmailOutbox': {
        // ONLY terminal rows. A PENDING or FAILED row is a message still
        // waiting to go out, and deleting it would reintroduce exactly the
        // silent loss the outbox replaced — this time by our own hand.
        const r = await container.prisma.emailOutbox.deleteMany({
          where: { createdAt: { lt: cutoff }, status: { in: ['SENT', 'DEAD'] } },
        });
        return { deletedCount: r.count };
      }
      case 'PlatformAuditLog': {
        const r = await container.prisma.platformAuditLog.deleteMany({
          where: { createdAt: { lt: cutoff } },
        });
        return { deletedCount: r.count };
      }
      default:
        return { deletedCount: 0, error: `Unknown entity: ${entity}` };
    }
  } catch (err: any) {
    return { deletedCount: 0, error: err.message || 'Unknown error' };
  }
}

export async function runDataRetention(): Promise<RetentionRunResult[]> {
  const policies = getRetentionPolicies();
  const results: RetentionRunResult[] = [];

  for (const policy of policies) {
    const cutoff = cutoffDate(policy.retentionDays);
    const { deletedCount, error } = await purgeEntity(policy.entity, policy.retentionDays);
    results.push({
      entity: policy.entity,
      retentionDays: policy.retentionDays,
      cutoffDate: cutoff.toISOString(),
      deletedCount,
      ...(error ? { error } : {}),
    });
  }

  return results;
}
