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

    const effectiveAccess = await pbacEngine.getEffectiveUserAccess(orgId, id);
    return NextResponse.json(effectiveAccess);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to fetch user roles' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const body = await req.json();
    const orgId = body.orgId || searchParams.get('orgId') || 'default-org';
    const { roleIds } = body;

    if (!Array.isArray(roleIds)) {
      return NextResponse.json({ error: 'roleIds array required' }, { status: 400 });
    }

    const actor = {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim() || user.email,
      email: user.email,
    };

    const result = await pbacEngine.assignRolesToUser(orgId, id, roleIds, actor);
    return NextResponse.json({ success: true, result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to assign user roles' }, { status: 500 });
  }
}
