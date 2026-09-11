import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { pbacEngine } from '@/lib/pbac-engine';

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

    const result = await pbacEngine.getUsersWithRoles(orgId, {
      search,
      roleId,
      workspaceId,
      projectId,
      status,
      page,
      limit,
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to fetch directory users' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const body = await req.json();
    const orgId = body.orgId || searchParams.get('orgId') || 'default-org';
    const { action, userIds, roleId, simulate } = body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: 'userIds array is required' }, { status: 400 });
    }

    if (simulate && roleId) {
      const simulation = await pbacEngine.simulateBulkAssignment(orgId, userIds, roleId);
      return NextResponse.json({ simulation });
    }

    const actor = {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim() || user.email,
      email: user.email,
    };

    if (action === 'ASSIGN_ROLE' && roleId) {
      const result = await pbacEngine.bulkAddUsersToRole(orgId, roleId, userIds, actor);
      return NextResponse.json({ success: true, result });
    } else if (action === 'REMOVE_ROLE' && roleId) {
      const result = await pbacEngine.bulkRemoveUsersFromRole(orgId, roleId, userIds, actor);
      return NextResponse.json({ success: true, result });
    }

    return NextResponse.json({ error: 'Invalid bulk action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed bulk user operation' }, { status: 500 });
  }
}
