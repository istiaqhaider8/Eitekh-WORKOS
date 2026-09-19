import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { assertOrgAccess } from '@/lib/tenant';
import { pbacEngine } from '@/lib/pbac-engine';
import { pbacBulkUserActionSchema, parseBody, parseJsonBody } from '@/lib/validation';
import { handleApiError } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
    const search = searchParams.get('search') || '';
    const roleId = searchParams.get('roleId') || 'all';
    const workspaceId = searchParams.get('workspaceId') || 'all';
    const projectId = searchParams.get('projectId') || 'all';
    const status = searchParams.get('status') || 'all';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limitParam = searchParams.get('limit') || '25';
    const limit = limitParam === 'all' ? 'all' : parseInt(limitParam, 10);

    // Tenant Isolation
    await assertOrgAccess(orgId);

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
    return handleApiError(e, "pbac/users");
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const parsed = await parseJsonBody(req, pbacBulkUserActionSchema);
    if (!parsed.success) return parsed.error;
    const orgId = parsed.data.orgId || searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
    const { action, userIds, roleId, simulate } = parsed.data;

    await assertOrgAccess(orgId, ['OWNER', 'ADMIN']);

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
    return handleApiError(e, "pbac/users");
  }
}
