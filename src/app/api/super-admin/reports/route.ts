import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { securityEngine } from '@/lib/security-engine';
import { syncEngine } from '@/lib/sync-engine';

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: 'Forbidden: Super Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const reportType = searchParams.get('type') || 'EXECUTIVE_SUMMARY';
    const format = searchParams.get('format') || 'json'; // json, csv
    const period = searchParams.get('period') || 'today'; // today, 7d, 30d

    const scoreCard = await securityEngine.calculateSecurityScore();
    const syncMetrics = syncEngine.getSyncMetrics();

    // Date range calculations
    const now = new Date();
    let startDate = new Date();
    if (period === '7d') startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    else if (period === '30d') startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    else startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Today

    const [
      totalOrgs,
      activeOrgs,
      totalUsers,
      activeUsers,
      totalProjects,
      totalIssues,
      completedIssues,
      auditLogs,
      emailLogs,
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.organization.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count(),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.project.count(),
      prisma.issue.count(),
      prisma.issue.count({ where: { status: { category: 'DONE' } } }),
      prisma.platformAuditLog.findMany({
        where: { createdAt: { gte: startDate } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.emailLog.findMany({
        where: { createdAt: { gte: startDate } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Catalog of 15 Comprehensive Reports
    const reportCatalog = [
      { id: 'SECURITY_REPORT', name: '1. Platform Security Report', category: 'Security' },
      { id: 'THREAT_DETECTION', name: '2. Threat Detection Report', category: 'Security' },
      { id: 'ACCESS_CONTROL', name: '3. Access Control & PBAC Report', category: 'Governance' },
      { id: 'PROJECT_ISOLATION', name: '4. Project Isolation Security Report', category: 'Governance' },
      { id: 'AUTHENTICATION_REPORT', name: '5. Authentication & MFA Report', category: 'Identity' },
      { id: 'AUTHORIZATION_FAILURES', name: '6. Authorization Failure Report', category: 'Security' },
      { id: 'REALTIME_SYNC', name: '7. Real-Time Synchronization Report', category: 'Operations' },
      { id: 'SYNC_FAILURE', name: '8. Sync Failure & Recovery Report', category: 'Operations' },
      { id: 'API_HEALTH', name: '9. API Performance & Latency Report', category: 'Performance' },
      { id: 'BACKGROUND_JOBS', name: '10. Background Job & Queue Report', category: 'Operations' },
      { id: 'SYSTEM_HEALTH', name: '11. Subsystem Health Diagnostics Report', category: 'Performance' },
      { id: 'AUDIT_ACTIVITY', name: '12. Audit Activity & Compliance Report', category: 'Compliance' },
      { id: 'DATA_CONSISTENCY', name: '13. Data Consistency & State Report', category: 'Operations' },
      { id: 'INCIDENT_REPORT', name: '14. Security Incident Report', category: 'Security' },
      { id: 'EXECUTIVE_SUMMARY', name: '15. Platform Executive Summary', category: 'Executive' },
    ];

    // Build specific report payload
    const reportData: any = {
      generatedAt: now.toISOString(),
      reportType,
      period,
      generatedBy: user.email,
      scoreCard,
      syncMetrics,
      kpis: {
        totalOrgs,
        activeOrgs,
        totalUsers,
        activeUsers,
        totalProjects,
        totalIssues,
        completedIssues,
        auditLogsCount: auditLogs.length,
        emailLogsCount: emailLogs.length,
      },
      auditLogs: auditLogs.slice(0, 50),
      isolationViolations: securityEngine.getIsolationViolations(),
      activeThreats: securityEngine.getActiveThreats(),
    };

    if (format === 'csv') {
      let csvContent = '';
      if (reportType === 'SECURITY_REPORT' || reportType === 'THREAT_DETECTION') {
        const rows = [
          ['Threat ID', 'Severity', 'Status', 'Event Type', 'Resource', 'Detected At', 'Description'].join(','),
          ...securityEngine.getActiveThreats().map((t) =>
            [
              `"${t.id}"`,
              `"${t.severity}"`,
              `"${t.status}"`,
              `"${t.eventType}"`,
              `"${t.resource.replace(/"/g, '""')}"`,
              `"${t.detectedAt}"`,
              `"${t.description.replace(/"/g, '""')}"`,
            ].join(',')
          ),
        ];
        csvContent = rows.join('\n');
      } else {
        const rows = [
          ['Log ID', 'Timestamp', 'Actor ID', 'Action', 'Target Resource', 'Details'].join(','),
          ...auditLogs.map((l) =>
            [
              `"${l.id}"`,
              `"${l.createdAt.toISOString()}"`,
              `"${l.actorId}"`,
              `"${l.action}"`,
              `"${l.targetResource.replace(/"/g, '""')}"`,
              `"${(l.details || '').replace(/"/g, '""')}"`,
            ].join(',')
          ),
        ];
        csvContent = rows.join('\n');
      }

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="eitekh_${reportType.toLowerCase()}_${period}_${Date.now()}.csv"`,
        },
      });
    }

    return NextResponse.json({
      reportCatalog,
      reportData,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}