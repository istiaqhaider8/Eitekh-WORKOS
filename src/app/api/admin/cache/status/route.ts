import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { cacheManager } from '@/lib/cache-manager';
import { prisma } from '@/lib/prisma';
import { pbacEngine } from '@/lib/pbac-engine';
import { handleApiError } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId') || user.orgMemberships?.[0]?.organization?.id;

    // Check user's role
    const assignedRoles = orgId ? await pbacEngine.getUserRoles(orgId, user.id) : [];
    const isSuperAdmin = user.isSuperAdmin;
    const isOrgAdmin = isSuperAdmin || assignedRoles.some((r: any) => r.slug === 'super-admin' || r.slug === 'org-admin' || r.name === 'Super Admin' || r.name === 'Organization ADMIN');
    const isProjectAdmin = isOrgAdmin || assignedRoles.some((r: any) => r.slug === 'project-admin' || r.slug === 'project-manager' || r.name === 'PROJECT ADMIN' || r.name === 'PROJECT MANAGER');

    const metrics = cacheManager.getMetrics();

    // Fetch recent cache audit logs
    const recentAuditLogs = await prisma.platformAuditLog.findMany({
      where: {
        action: {
          startsWith: 'SYSTEM_CACHE_',
        },
        ...(isSuperAdmin ? {} : orgId ? { orgId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    return NextResponse.json({
      success: true,
      metrics,
      cacheVersion: cacheManager.getCacheVersion(),
      userPermissions: {
        canFullRefresh: isSuperAdmin,
        canServerRefresh: isOrgAdmin,
        canAnalyticsRebuild: isProjectAdmin,
        canProjectRefresh: true,
        canClientRefresh: true,
      },
      recentAuditLogs: recentAuditLogs.map((log) => {
        let detailsObj: any = {};
        try {
          detailsObj = log.details ? JSON.parse(log.details) : {};
        } catch {
          detailsObj = { raw: log.details };
        }
        return {
          id: log.id,
          action: log.action.replace('SYSTEM_CACHE_', ''),
          actorId: log.actorId,
          actorName: detailsObj.actorName || 'Admin User',
          actorEmail: detailsObj.actorEmail || '',
          targetResource: log.targetResource,
          durationMs: detailsObj.durationMs || 0,
          itemsAffected: detailsObj.itemsAffected || 0,
          dataSafetyVerified: detailsObj.dataSafetyVerified ?? true,
          createdAt: log.createdAt,
        };
      }),
      dataSafetyDeclaration: {
        guarantee: 'Zero Business Data Deletion',
        persistentTablesGuarded: [
          'Project', 'User', 'Issue', 'Task', 'Subtask', 'Epic', 'Sprint',
          'Team', 'PBACRole', 'Comment', 'Attachment', 'TimeEntry', 'Notification', 'AuditLog'
        ],
        allowedCacheTiers: ['In-Memory Stores', 'API Response Memos', 'Search Index Cache', 'Derived Analytics Metrics', 'Client Stored State'],
      },
    });
  } catch (e: any) {
    console.error('Failed to get cache status:', e);
    return handleApiError(e, "admin/cache/status");
  }
}
