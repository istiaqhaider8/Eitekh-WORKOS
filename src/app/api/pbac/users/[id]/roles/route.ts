import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { assertOrgAccess } from '@/lib/tenant';
import { pbacEngine } from '@/lib/pbac-engine';
import { pbacUserRolesUpdateSchema, parseBody, parseJsonBody } from '@/lib/validation';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });

    await assertOrgAccess(orgId);

    const effectiveAccess = await pbacEngine.getEffectiveUserAccess(orgId, id);
    return NextResponse.json(effectiveAccess);
  } catch (e: any) {
    const status = e.message?.includes('Forbidden') ? 403 : e.message?.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: e.message || 'Failed to fetch user roles' }, { status });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const parsed = await parseJsonBody(req, pbacUserRolesUpdateSchema);
    if (!parsed.success) return parsed.error;
    const orgId = parsed.data.orgId || searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
    const { roleIds } = parsed.data;

    await assertOrgAccess(orgId, ['OWNER', 'ADMIN']);

    const actor = {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim() || user.email,
      email: user.email,
    };

    const result = await pbacEngine.assignRolesToUser(orgId, id, roleIds, actor);
    return NextResponse.json({ success: true, result });
  } catch (e: any) {
    const status = e.message?.includes('Forbidden') ? 403 : e.message?.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: e.message || 'Failed to assign user roles' }, { status });
  }
}
