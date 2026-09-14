import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { assertOrgAccess } from '@/lib/tenant';
import { pbacEngine } from '@/lib/pbac-engine';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id: roleId } = await params;
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId') || 'default-org';

    await assertOrgAccess(orgId);

    const role = await pbacEngine.getRole(orgId, roleId);
    if (!role) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    return NextResponse.json({ role });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || 'Failed to fetch role' },
      { status: e.message?.includes('Forbidden') ? 403 : 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id: roleId } = await params;
    const body = await req.json();
    const { searchParams } = new URL(req.url);
    const orgId = body.orgId || searchParams.get('orgId') || 'default-org';
    const { status, name, description, permissions, scope, projectId, projectName } = body;

    await assertOrgAccess(orgId, ['OWNER', 'ADMIN']);

    const actor = {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim() || user.email,
      email: user.email,
    };

    let updatedRole;
    if (status !== undefined && !name && !permissions) {
      updatedRole = await pbacEngine.toggleRoleStatus(orgId, roleId, status, actor);
    } else {
      updatedRole = await pbacEngine.saveRole(
        orgId,
        {
          id: roleId,
          name: name || 'Updated Role',
          description,
          scope,
          projectId,
          projectName,
          status,
          permissions: permissions || [],
        },
        actor
      );
    }

    return NextResponse.json({ role: updatedRole, success: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || 'Failed to update role' },
      { status: e.message?.includes('Forbidden') ? 403 : 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id: roleId } = await params;
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId') || 'default-org';
    const force = searchParams.get('force') === 'true';

    // Strict Tenant Isolation (Super Admin / Org Admin / Owner required)
    await assertOrgAccess(orgId, ['OWNER', 'ADMIN']);

    const actor = {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim() || user.email,
      email: user.email,
    };

    await pbacEngine.deleteRole(orgId, roleId, actor, force);

    return NextResponse.json({ success: true, message: 'Role deleted successfully' });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || 'Failed to delete role' },
      { status: e.message?.includes('Forbidden') ? 403 : 500 }
    );
  }
}
