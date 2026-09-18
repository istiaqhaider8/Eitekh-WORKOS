import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { cacheManager, CacheRefreshAction } from '@/lib/cache-manager';
import { pbacEngine } from '@/lib/pbac-engine';
import { cacheRefreshSchema, parseBody, parseJsonBody } from '@/lib/validation';

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = await parseJsonBody(req, cacheRefreshSchema);
    if (!parsed.success) return parsed.error;
    const action: CacheRefreshAction = parsed.data.action;
    const orgId = parsed.data.orgId || user.orgMemberships?.[0]?.organization?.id;
    const projectId = parsed.data.projectId;

    // Determine user role and authorizations
    const assignedRoles = orgId ? await pbacEngine.getUserRoles(orgId, user.id) : [];
    const isSuperAdmin = user.isSuperAdmin;
    const isOrgAdmin = isSuperAdmin || assignedRoles.some((r: any) => r.slug === 'super-admin' || r.slug === 'org-admin' || r.name === 'Super Admin' || r.name === 'Organization ADMIN');
    const isProjectAdmin = isOrgAdmin || assignedRoles.some((r: any) => r.slug === 'project-admin' || r.slug === 'project-manager' || r.name === 'PROJECT ADMIN' || r.name === 'PROJECT MANAGER');

    // Role-based Action Guards
    if (action === 'FULL_SYSTEM_REFRESH' || action === 'BUMP_CACHE_VERSION') {
      if (!isSuperAdmin) {
        return NextResponse.json({
          error: 'Only Super Admin can execute Full System Refresh or bump the global cache version.',
        }, { status: 403 });
      }
    } else if (action === 'CLEAR_SERVER_CACHE') {
      if (!isOrgAdmin) {
        return NextResponse.json({
          error: 'Organization ADMIN or Super Admin role is required to clear server application cache.',
        }, { status: 403 });
      }
    } else if (action === 'REBUILD_ANALYTICS_CACHE') {
      if (!isProjectAdmin) {
        return NextResponse.json({
          error: 'Project Admin or higher role is required to rebuild analytics caches.',
        }, { status: 403 });
      }
    }

    // Execute Safe Refresh Operation
    const result = await cacheManager.executeSafeRefresh(
      action,
      {
        id: user.id,
        name: `${user.firstName} ${user.lastName}`.trim() || user.email,
        email: user.email,
        isSuperAdmin: user.isSuperAdmin,
        roleName: isSuperAdmin ? 'Super Admin' : assignedRoles[0]?.name || 'Member',
      },
      { orgId, projectId }
    );

    return NextResponse.json({
      success: true,
      result,
      safetyNotice: 'Cache and temporary application data cleared successfully. Your projects, users, issues, tasks, permissions, and all business records remain 100% untouched.',
    });
  } catch (e: any) {
    console.error('Failed to execute cache refresh:', e);
    return NextResponse.json({ error: e.message || 'Failed to refresh cache' }, { status: 500 });
  }
}
