import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { assertOrgAccess } from '@/lib/tenant';
import { pbacEngine } from '@/lib/pbac-engine';
import { pbacRoleUpdateSchema, parseBody, parseJsonBody } from '@/lib/validation';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id: roleId } = await params;
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });

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
    const parsed = await parseJsonBody(req, pbacRoleUpdateSchema);
    if (!parsed.success) return parsed.error;
    const { searchParams } = new URL(req.url);
    const orgId = parsed.data.orgId || searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
    const { status, name, description, permissions, scope, projectId, projectName } = parsed.data;

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
    const orgId = searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
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
    const msg = e?.message || 'Failed to delete role';
    // Refusing to delete a role that users still hold, or a system role, is a
    // deliberate rule, not a server fault. Both returned 500, which reads as a
    // crash in the UI and in error monitoring, and buries an instruction the
    // operator needs to act on ("Unassign assigned users first...").
    const status = msg.includes('Forbidden')
      ? 403
      : msg.includes('not found')
      ? 404
      : /assigned to|system role|cannot delete/i.test(msg)
      ? 409
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
