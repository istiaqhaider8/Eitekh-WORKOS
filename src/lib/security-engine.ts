import { prisma } from './prisma';
import { logger } from './logger';

export type ThreatSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ThreatStatus = 'OPEN' | 'INVESTIGATING' | 'MITIGATED' | 'RESOLVED' | 'FALSE_POSITIVE';

export interface SecurityThreat {
  id: string;
  severity: ThreatSeverity;
  status: ThreatStatus;
  detectedAt: string;
  userEmail?: string;
  userId?: string;
  orgId?: string;
  orgName?: string;
  projectId?: string;
  projectName?: string;
  resource: string;
  source: string;
  eventType: string;
  description: string;
  detectionRule: string;
  recommendedAction: string;
  timeline: Array<{ timestamp: string; note: string; actor?: string }>;
  resolvedAt?: string;
  resolutionNote?: string;
}

export interface SecurityScoreCard {
  score: number; // 0 - 100
  status: 'SECURE' | 'ATTENTION_REQUIRED' | 'HIGH_RISK' | 'CRITICAL';
  currentRiskLevel: 'MINIMAL' | 'ELEVATED' | 'HIGH' | 'CRITICAL';
  openThreats: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  resolvedToday: number;
  mfaAdoptionPct: number;
  activeSessions: number;
  suspendedUsers: number;
  pbacViolations24h: number;
}

export interface IsolationViolationEvent {
  id: string;
  timestamp: string;
  userId: string;
  userEmail: string;
  attemptedProjectId: string;
  authorizedProjects: string[];
  actionType: 'ISSUE_READ' | 'ISSUE_MUTATE' | 'EXPORT_DATA' | 'REPORT_VIEW' | 'SYNC_STREAM' | 'SEARCH_LEAK';
  ipAddress?: string;
  userAgent?: string;
  prevented: boolean;
}

class PlatformSecurityEngine {
  private threats: Map<string, SecurityThreat> = new Map();
  private isolationViolations: IsolationViolationEvent[] = [];
  private maxEvents = 500;
  private maxThreats = 1000;
  private startTime = Date.now();

  constructor() {
    // Initial scan
    this.runContinuousSecurityScan().catch(() => {});

    // Periodic scan every 15 seconds
    if (typeof setInterval !== 'undefined') {
      setInterval(() => {
        this.runContinuousSecurityScan().catch((e) =>
          logger.error('SECURITY_SCAN_ERROR', 'Background scan failure', { error: e.message })
        );
      }, 15000);
    }
  }

  public recordThreat(params: {
    severity: ThreatSeverity;
    eventType: string;
    resource: string;
    description: string;
    detectionRule: string;
    recommendedAction: string;
    userEmail?: string;
    userId?: string;
    orgId?: string;
    projectId?: string;
    source?: string;
    customId?: string;
  }): SecurityThreat {
    const threatId = params.customId || `thr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const existing = this.threats.get(threatId);
    if (existing) {
      return existing;
    }

    const threat: SecurityThreat = {
      id: threatId,
      severity: params.severity,
      status: 'OPEN',
      detectedAt: now,
      userEmail: params.userEmail,
      userId: params.userId,
      orgId: params.orgId,
      projectId: params.projectId,
      resource: params.resource,
      source: params.source || 'PBAC_MONITOR',
      eventType: params.eventType,
      description: params.description,
      detectionRule: params.detectionRule,
      recommendedAction: params.recommendedAction,
      timeline: [
        {
          timestamp: now,
          note: `Threat detected by rule [${params.detectionRule}]: ${params.description}`,
        },
      ],
    };

    this.threats.set(threatId, threat);
    this.evictOldThreats();

    logger.warn('SECURITY_THREAT_DETECTED', `[${params.severity}] ${params.eventType} - ${params.description}`, {
      threatId,
      severity: params.severity,
      userEmail: params.userEmail,
      resource: params.resource,
    });

    return threat;
  }

  private evictOldThreats(): void {
    if (this.threats.size <= this.maxThreats) return;
    const resolved = Array.from(this.threats.entries())
      .filter(([, t]) => t.status === 'RESOLVED' || t.status === 'FALSE_POSITIVE')
      .sort((a, b) => new Date(a[1].detectedAt).getTime() - new Date(b[1].detectedAt).getTime());
    for (const [id] of resolved) {
      if (this.threats.size <= this.maxThreats) break;
      this.threats.delete(id);
    }
    if (this.threats.size > this.maxThreats) {
      const oldest = Array.from(this.threats.entries())
        .sort((a, b) => new Date(a[1].detectedAt).getTime() - new Date(b[1].detectedAt).getTime());
      while (this.threats.size > this.maxThreats && oldest.length) {
        this.threats.delete(oldest.shift()![0]);
      }
    }
  }

  public recordIsolationViolation(event: Omit<IsolationViolationEvent, 'id' | 'timestamp' | 'prevented'>) {
    const violation: IsolationViolationEvent = {
      id: `iso_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      prevented: true,
      ...event,
    };

    this.isolationViolations.unshift(violation);
    if (this.isolationViolations.length > this.maxEvents) {
      this.isolationViolations.pop();
    }

    // Automatically record critical severity threat
    this.recordThreat({
      severity: 'CRITICAL',
      eventType: 'CROSS_PROJECT_ISOLATION_ATTEMPT',
      resource: `Project:${event.attemptedProjectId}`,
      userEmail: event.userEmail,
      userId: event.userId,
      projectId: event.attemptedProjectId,
      source: 'PROJECT_ISOLATION_GUARD',
      description: `User ${event.userEmail} attempted unauthorized ${event.actionType} on project ${event.attemptedProjectId}`,
      detectionRule: 'STRICT_PBAC_PROJECT_MEMBERSHIP_ENFORCEMENT',
      recommendedAction: 'Verify user credentials and inspect for unauthorized session hijacking or cross-tenant URL manipulation.',
    });

    // Write immutable platform audit log
    prisma.platformAuditLog
      .create({
        data: {
          actorId: event.userId,
          action: 'UNAUTHORIZED_CROSS_PROJECT_ACCESS_BLOCKED',
          targetResource: `Project:${event.attemptedProjectId}`,
          details: JSON.stringify({
            userEmail: event.userEmail,
            actionType: event.actionType,
            authorizedProjects: event.authorizedProjects,
            ipAddress: event.ipAddress || '127.0.0.1',
          }),
        },
      })
      .catch((err) => console.error('Failed to write audit log:', err));
  }

  public updateThreatStatus(threatId: string, status: ThreatStatus, note?: string, actor?: string): SecurityThreat | null {
    const threat = this.threats.get(threatId);
    if (!threat) return null;

    threat.status = status;
    const now = new Date().toISOString();
    if (status === 'RESOLVED' || status === 'MITIGATED') {
      threat.resolvedAt = now;
      threat.resolutionNote = note;
    }

    threat.timeline.push({
      timestamp: now,
      note: `Status updated to ${status}${note ? ': ' + note : ''}`,
      actor: actor || 'SuperAdmin',
    });

    return threat;
  }

  public async runContinuousSecurityScan(): Promise<SecurityThreat[]> {
    try {
      // 1. Scan Database Audit Logs for Security Events
      const auditLogs = await prisma.platformAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      for (const log of auditLogs) {
        const actionUpper = (log.action || '').toUpperCase();
        const isSecurityRelevant =
          actionUpper.includes('SUSPENDED') ||
          actionUpper.includes('UNAUTHORIZED') ||
          actionUpper.includes('FORBIDDEN') ||
          actionUpper.includes('CROSS_PROJECT') ||
          actionUpper.includes('SECURITY') ||
          actionUpper.includes('MAINTENANCE') ||
          actionUpper.includes('ROLE') ||
          actionUpper.includes('PROVISIONED') ||
          actionUpper.includes('DISABLED') ||
          actionUpper.includes('REVOKE');

        if (isSecurityRelevant) {
          const threatKey = `thr_audit_${log.id}`;
          if (!this.threats.has(threatKey)) {
            const isCrossProject = actionUpper.includes('CROSS_PROJECT') || actionUpper.includes('UNAUTHORIZED') || actionUpper.includes('FORBIDDEN');
            const isSuspension = actionUpper.includes('SUSPENDED');
            const isRole = actionUpper.includes('ROLE');

            this.threats.set(threatKey, {
              id: threatKey,
              severity: isCrossProject ? 'CRITICAL' : isSuspension ? 'HIGH' : isRole ? 'MEDIUM' : 'LOW',
              status: 'OPEN',
              detectedAt: log.createdAt ? log.createdAt.toISOString() : new Date().toISOString(),
              userId: log.actorId,
              resource: log.targetResource || 'Platform System',
              source: 'PLATFORM_AUDIT_STREAM',
              eventType: log.action,
              description: `Security audit event [${log.action}] targeting resource ${log.targetResource}`,
              detectionRule: 'AUDIT_ANOMALY_MONITOR',
              recommendedAction: isSuspension
                ? 'Review tenant or account suspension reason and check if reactivation is required.'
                : isRole
                ? 'Verify role escalation authorization.'
                : 'Inspect actor session and verify token validity.',
              timeline: [
                {
                  timestamp: log.createdAt ? log.createdAt.toISOString() : new Date().toISOString(),
                  note: `Captured from PlatformAuditLog: ${log.details || log.action}`,
                },
              ],
            });
          }
        }
      }

      // 2. Scan MFA Policy Adoption
      const [totalUsers, mfaUsers, suspendedUsers, suspendedOrgs, activeSessionsCount] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { mfaEnabled: true } }),
        prisma.user.findMany({ where: { status: 'SUSPENDED' }, select: { id: true, email: true } }),
        prisma.organization.findMany({ where: { status: 'SUSPENDED' }, select: { id: true, name: true, slug: true } }),
        prisma.session.count({ where: { expiresAt: { gt: new Date() } } }),
      ]);

      const mfaPct = totalUsers > 0 ? Math.round((mfaUsers / totalUsers) * 100) : 0;
      if (mfaPct < 50) {
        const mfaThreatId = 'thr_policy_mfa_adoption';
        if (!this.threats.has(mfaThreatId)) {
          this.threats.set(mfaThreatId, {
            id: mfaThreatId,
            severity: 'MEDIUM',
            status: 'OPEN',
            detectedAt: new Date().toISOString(),
            resource: 'Identity & Authentication Policy',
            source: 'POLICY_COMPLIANCE_ENGINE',
            eventType: 'LOW_MFA_ADOPTION',
            description: `Only ${mfaUsers} of ${totalUsers} registered users (${mfaPct}%) have TOTP MFA configured.`,
            detectionRule: 'MFA_ORGANIZATIONAL_ENFORCEMENT_POLICY',
            recommendedAction: 'Mandate multi-factor authentication enrollment for administrators and project leads.',
            timeline: [
              {
                timestamp: new Date().toISOString(),
                note: `MFA adoption evaluated at ${mfaPct}% across ${totalUsers} users.`,
              },
            ],
          });
        }
      }

      // 3. Scan Suspended Users
      for (const u of suspendedUsers) {
        const suspKey = `thr_user_susp_${u.id}`;
        if (!this.threats.has(suspKey)) {
          this.threats.set(suspKey, {
            id: suspKey,
            severity: 'HIGH',
            status: 'OPEN',
            detectedAt: new Date().toISOString(),
            userEmail: u.email,
            userId: u.id,
            resource: `User:${u.id}`,
            source: 'IDENTITY_GOVERNANCE',
            eventType: 'ACCOUNT_SUSPENSION_ACTIVE',
            description: `User account ${u.email} is currently suspended and blocked from authentication.`,
            detectionRule: 'ACCOUNT_LOCKOUT_STATUS_GUARD',
            recommendedAction: 'Inspect recent user activity or reinstate account if access review passes.',
            timeline: [
              {
                timestamp: new Date().toISOString(),
                note: `User ${u.email} locked out from platform access.`,
              },
            ],
          });
        }
      }

      // 4. Scan Suspended Organizations
      for (const org of suspendedOrgs) {
        const orgKey = `thr_org_susp_${org.id}`;
        if (!this.threats.has(orgKey)) {
          this.threats.set(orgKey, {
            id: orgKey,
            severity: 'HIGH',
            status: 'OPEN',
            detectedAt: new Date().toISOString(),
            orgId: org.id,
            orgName: org.name,
            resource: `Organization:${org.id}`,
            source: 'TENANT_ISOLATION_GUARD',
            eventType: 'TENANT_SUSPENSION_ACTIVE',
            description: `Organization tenant ${org.name} (/${org.slug}) is currently suspended.`,
            detectionRule: 'TENANT_ISOLATION_BOUNDARY_MONITOR',
            recommendedAction: 'Verify tenant subscription or administrative freeze status.',
            timeline: [
              {
                timestamp: new Date().toISOString(),
                note: `Tenant ${org.name} access suspended across all workspaces and projects.`,
              },
            ],
          });
        }
      }

      // 5. Active Session Volume & Concurrency Check
      if (activeSessionsCount > 100) {
        const sessThreatId = 'thr_session_concurrency_load';
        if (!this.threats.has(sessThreatId)) {
          this.threats.set(sessThreatId, {
            id: sessThreatId,
            severity: 'LOW',
            status: 'OPEN',
            detectedAt: new Date().toISOString(),
            resource: 'Session Management Engine',
            source: 'SESSION_LOAD_MONITOR',
            eventType: 'ELEVATED_ACTIVE_SESSIONS',
            description: `${activeSessionsCount} active device tokens currently authenticated in session registry.`,
            detectionRule: 'SESSION_CONCURRENCY_POLICY',
            recommendedAction: 'Review active session IP distributions and revoke stale device tokens.',
            timeline: [
              {
                timestamp: new Date().toISOString(),
                note: `${activeSessionsCount} active sessions monitored in registry.`,
              },
            ],
          });
        }
      }
    } catch (e: any) {
      console.error('Continuous scan error:', e.message);
    }
    return Array.from(this.threats.values());
  }

  public async calculateSecurityScore(): Promise<SecurityScoreCard> {
    await this.runContinuousSecurityScan();

    const [
      totalUsers,
      mfaUsers,
      suspendedUsers,
      activeSessions,
      recentPbacAudit,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { mfaEnabled: true } }),
      prisma.user.count({ where: { status: 'SUSPENDED' } }),
      prisma.session.count({ where: { expiresAt: { gt: new Date() } } }),
      prisma.platformAuditLog.count({
        where: {
          action: { in: ['UNAUTHORIZED_ACCESS', '403_FORBIDDEN', 'CROSS_PROJECT_ATTEMPT'] },
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const threatsList = Array.from(this.threats.values());
    const openThreats = threatsList.filter((t) => t.status === 'OPEN' || t.status === 'INVESTIGATING');
    const criticalIssues = openThreats.filter((t) => t.severity === 'CRITICAL').length;
    const highIssues = openThreats.filter((t) => t.severity === 'HIGH').length;
    const mediumIssues = openThreats.filter((t) => t.severity === 'MEDIUM').length;

    const resolvedToday = threatsList.filter(
      (t) =>
        (t.status === 'RESOLVED' || t.status === 'MITIGATED') &&
        t.resolvedAt &&
        new Date(t.resolvedAt).getTime() > Date.now() - 24 * 60 * 60 * 1000
    ).length;

    const mfaAdoptionPct = totalUsers > 0 ? Math.round((mfaUsers / totalUsers) * 100) : 0;

    // Dynamic Score Calculation
    let score = 100;
    score -= criticalIssues * 20;
    score -= highIssues * 10;
    score -= mediumIssues * 5;
    score -= recentPbacAudit * 5;
    if (mfaAdoptionPct < 30) score -= 10;
    else if (mfaAdoptionPct < 70) score -= 5;

    score = Math.max(10, Math.min(100, score));

    let status: 'SECURE' | 'ATTENTION_REQUIRED' | 'HIGH_RISK' | 'CRITICAL' = 'SECURE';
    let currentRiskLevel: 'MINIMAL' | 'ELEVATED' | 'HIGH' | 'CRITICAL' = 'MINIMAL';

    if (score < 50 || criticalIssues > 0) {
      status = 'CRITICAL';
      currentRiskLevel = 'CRITICAL';
    } else if (score < 70 || highIssues > 1) {
      status = 'HIGH_RISK';
      currentRiskLevel = 'HIGH';
    } else if (score < 95 || mediumIssues > 0 || mfaAdoptionPct < 50) {
      status = 'ATTENTION_REQUIRED';
      currentRiskLevel = 'ELEVATED';
    }

    return {
      score,
      status,
      currentRiskLevel,
      openThreats: openThreats.length,
      criticalIssues,
      highIssues,
      mediumIssues,
      resolvedToday,
      mfaAdoptionPct,
      activeSessions,
      suspendedUsers,
      pbacViolations24h: recentPbacAudit,
    };
  }

  public getActiveThreats(filterStatus?: string): SecurityThreat[] {
    const list = Array.from(this.threats.values());
    if (!filterStatus || filterStatus === 'ALL') {
      return list.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
    }
    return list
      .filter((t) => t.status === filterStatus)
      .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
  }

  public getIsolationViolations(): IsolationViolationEvent[] {
    return this.isolationViolations;
  }
}

// Export singleton engine instance
export const securityEngine = new PlatformSecurityEngine();