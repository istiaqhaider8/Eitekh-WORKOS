import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { assertOrgAccess } from '@/lib/tenant';
import { pbacEngine } from '@/lib/pbac-engine';
import { pbacRoleUsersSchema, parseBody, parseJsonBody } from '@/lib/validation';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });

    // Strict Tenant Isolation
    await assertOrgAccess(orgId);

    const role = await pbacEngine.getRole(orgId, id);
    if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 });

    return NextResponse.json({ users: role.assignedUsers || [], total: role.assignedUserCount });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to fetch role users' }, { status: e.message?.includes('Forbidden') ? 403 : 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const parsed = await parseJsonBody(req, pbacRoleUsersSchema);
    if (!parsed.success) return parsed.error;
    const orgId = parsed.data.orgId || searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
    const { userId, userIds } = parsed.data;

    await assertOrgAccess(orgId, ['OWNER', 'ADMIN']);

    const actor = {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim() || user.email,
      email: user.email,
    };

    if (Array.isArray(userIds) && userIds.length > 0) {
      const result = await pbacEngine.bulkAddUsersToRole(orgId, id, userIds, actor);
      return NextResponse.json({ success: true, ...result });
    } else if (userId) {
      const result = await pbacEngine.addUserToRole(orgId, id, userId, actor);
      return NextResponse.json({ success: true, ...result });
    } else {
      return NextResponse.json({ error: 'userId or userIds required' }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to assign role to users' }, { status: e.message?.includes('Forbidden') ? 403 : 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const parsedDel = await parseJsonBody(req, pbacRoleUsersSchema);
    if (!parsedDel.success) return parsedDel.error;
    const orgId = parsedDel.data.orgId || searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
    const { userId, userIds } = parsedDel.data;

    // Strict Tenant Isolation & Privilege Escalation Guard
    await assertOrgAccess(orgId, ['OWNER', 'ADMIN']);

    const actor = {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim() || user.email,
      email: user.email,
    };

    if (Array.isArray(userIds) && userIds.length > 0) {
      const result = await pbacEngine.bulkRemoveUsersFromRole(orgId, id, userIds, actor);
      return NextResponse.json({ success: true, ...result });
    } else if (userId) {
      const result = await pbacEngine.removeUserFromRole(orgId, id, userId, actor);
      return NextResponse.json({ success: true, ...result });
    } else {
      return NextResponse.json({ error: 'userId or userIds required' }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to remove role from users' }, { status: e.message?.includes('Forbidden') ? 403 : 500 });
  }
}
