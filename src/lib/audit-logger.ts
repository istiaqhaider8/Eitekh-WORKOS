import { prisma } from './prisma';
import { getCurrentUser } from './auth';

export type AuditCategory =
  | 'AUTH'
  | 'PBAC'
  | 'PROJECT'
  | 'ISSUE'
  | 'ORG'
  | 'SECURITY'
  | 'CACHE'
  | 'SETTINGS'
  | 'SYSTEM';

export type AuditSeverity = 'INFO' | 'NOTICE' | 'WARNING' | 'CRITICAL';

export interface LogAuditParams {
  actor?: {
    id: string;
    name?: string;
    email?: string;
  } | null;
  actorId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  action: string;
  category?: AuditCategory;
  targetResource: string;
  orgId?: string | null;
  projectId?: string | null;
  details?: Record<string, any> | string;
  ipAddress?: string | null;
  previousState?: any;
  newState?: any;
  req?: Request | any;
  severity?: AuditSeverity;
  status?: 'SUCCESS' | 'FAILURE';
}

/**
 * Determine category from action name if not explicitly provided
 */
function inferCategory(action: string): AuditCategory {
  const upper = action.toUpperCase();
  if (upper.includes('LOGIN') || upper.includes('LOGOUT') || upper.includes('PASSWORD') || upper.includes('MFA') || upper.includes('SESSION')) {
    return 'AUTH';
  }
  if (upper.includes('ROLE') || upper.includes('PERMISSION') || upper.includes('PBAC') || upper.includes('CAPABILITY')) {
    return 'PBAC';
  }
  if (upper.includes('CACHE') || upper.includes('SYSTEM_REFRESH')) {
    return 'CACHE';
  }
  if (upper.includes('PROJECT') || upper.includes('WORKSPACE') || upper.includes('TEAM')) {
    return 'PROJECT';
  }
  if (upper.includes('ISSUE') || upper.includes('TASK') || upper.includes('SUBTASK') || upper.includes('EPIC') || upper.includes('SPRINT') || upper.includes('COMMENT')) {
    return 'ISSUE';
  }
  if (upper.includes('ORG') || upper.includes('TENANT')) {
    return 'ORG';
  }
  if (upper.includes('FLAG') || upper.includes('SETTING') || upper.includes('EMAIL')) {
    return 'SETTINGS';
  }
  if (upper.includes('THREAT') || upper.includes('ALERT') || upper.includes('SUSPICIOUS')) {
    return 'SECURITY';
  }
  return 'SYSTEM';
}

/**
 * Determine severity from action name
 */
function inferSeverity(action: string, status?: string): AuditSeverity {
  if (status === 'FAILURE') return 'WARNING';
  const upper = action.toUpperCase();
  if (upper.includes('DELETE') || upper.includes('SUSPEND') || upper.includes('PURGE') || upper.includes('THREAT')) {
    return 'CRITICAL';
  }
  if (upper.includes('UPDATE') || upper.includes('REVOKE') || upper.includes('BUMP') || upper.includes('MFA')) {
    return 'WARNING';
  }
  if (upper.includes('ASSIGN') || upper.includes('INVITE') || upper.includes('CREATE')) {
    return 'NOTICE';
  }
  return 'INFO';
}

/**
 * Enterprise Audit Logger
 * Ensures every action across Eitekh WorkOS is logged with structured metadata,
 * actor identity, target resource, and zero sensitive secrets.
 */
export async function logAuditEvent(params: LogAuditParams) {
  try {
    let actorId = params.actorId || params.actor?.id;
    let actorName = params.actorName || params.actor?.name;
    let actorEmail = params.actorEmail || params.actor?.email;

    // If actor is not provided, try to resolve from current session
    if (!actorId) {
      try {
        const user = await getCurrentUser();
        if (user) {
          actorId = user.id;
          actorName = `${user.firstName} ${user.lastName}`.trim() || user.email;
          actorEmail = user.email;
        }
      } catch {
        // Fallback to system
      }
    }

    // Default to System Provisioning if still no actor
    actorId = actorId || 'system';
    actorName = actorName || (actorId === 'system' ? 'System Service' : 'Platform User');
    actorEmail = actorEmail || (actorId === 'system' ? 'system@eitekh.local' : '');

    const category = params.category || inferCategory(params.action);
    const severity = params.severity || inferSeverity(params.action, params.status);
    const status = params.status || 'SUCCESS';

    // Parse and sanitize details (strip passwords, tokens, secrets)
    let detailsObj: Record<string, any> = {};
    if (typeof params.details === 'string') {
      try {
        detailsObj = JSON.parse(params.details);
      } catch {
        detailsObj = { message: params.details };
      }
    } else if (params.details && typeof params.details === 'object') {
      detailsObj = { ...params.details };
    }

    // Attach previous/new states if present
    if (params.previousState !== undefined && detailsObj.previousState === undefined) {
      detailsObj.previousState = params.previousState;
    }
    if (params.newState !== undefined && detailsObj.newState === undefined) {
      detailsObj.newState = params.newState;
    }

    // Strip any sensitive fields
    delete detailsObj.password;
    delete detailsObj.currentPassword;
    delete detailsObj.newPassword;
    delete detailsObj.passwordHash;
    delete detailsObj.token;
    delete detailsObj.jwtToken;
    delete detailsObj.secret;

    // Extract IP
    let clientIp = params.ipAddress;
    if (!clientIp && params.req) {
      try {
        clientIp =
          params.req.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim() ||
          params.req.headers?.get?.('x-real-ip') ||
          '127.0.0.1';
      } catch {
        clientIp = '127.0.0.1';
      }
    }
    clientIp = clientIp || '127.0.0.1';

    // Enrich details
    detailsObj.actorName = actorName;
    detailsObj.actorEmail = actorEmail;
    detailsObj.category = category;
    detailsObj.severity = severity;
    detailsObj.status = status;
    if (params.projectId) detailsObj.projectId = params.projectId;

    // Create DB Audit Record
    const record = await prisma.platformAuditLog.create({
      data: {
        actorId,
        action: params.action,
        targetResource: params.targetResource,
        orgId: params.orgId || null,
        details: JSON.stringify(detailsObj),
        ipAddress: clientIp,
      },
    });

    return record;
  } catch (error) {
    // Non-blocking: Audit log failure must not crash business transaction
    console.error('Failed to write audit log event:', error);
    return null;
  }
}
