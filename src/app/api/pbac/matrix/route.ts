import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { pbacEngine, PBAC_PERMISSION_CATEGORIES } from '@/lib/pbac-engine';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId') || 'default-org';
    const search = searchParams.get('search') || '';
    const roleId = searchParams.get('roleId') || 'all';
    const workspaceId = searchParams.get('workspaceId') || 'all';
    const projectId = searchParams.get('projectId') || 'all';
    const status = searchParams.get('status') || 'all';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limitParam = searchParams.get('limit') || '25';
    const limit = limitParam === 'all' ? 'all' : parseInt(limitParam, 10);

    const [matrixResult, roles] = await Promise.all([
      pbacEngine.getUsersWithRoles(orgId, {
        search,
        roleId,
        workspaceId,
        projectId,
        status,
        page,
        limit,
      }),
      pbacEngine.getRoles(orgId),
    ]);

    return NextResponse.json({
      ...matrixResult,
      roles,
      categories: PBAC_PERMISSION_CATEGORIES,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to fetch access matrix' }, { status: 500 });
  }
}
