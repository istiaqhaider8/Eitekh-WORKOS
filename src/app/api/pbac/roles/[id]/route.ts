import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { pbacEngine } from '@/lib/pbac-engine';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId') || 'default-org';

    const role = await pbacEngine.getRole(orgId, id);
    if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 });

    return NextResponse.json({ role });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to fetch role' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const body = await req.json();
    const orgId = body.orgId || searchParams.get('orgId') || 'default-org';
    const { status, name, description, scope, permissions } = body;

    const actor = {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim() || user.email,
      email: user.email,
    };

    let updated;
    if (status) {
      updated = await pbacEngine.toggleRoleStatus(orgId, id, status, actor);
    } else {
      updated = await pbacEngine.saveRole(orgId, { id, name, description, scope, permissions }, actor);
    }

    return NextResponse.json({ role: updated, success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to update role' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId') || 'default-org';

    const actor = {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim() || user.email,
      email: user.email,
    };

    await pbacEngine.deleteRole(orgId, id, actor);
    return NextResponse.json({ success: true, message: 'Role deleted successfully' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to delete role' }, { status: 400 });
  }
}
