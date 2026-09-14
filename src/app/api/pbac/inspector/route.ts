import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { assertOrgAccess } from '@/lib/tenant';
import { pbacEngine } from '@/lib/pbac-engine';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId') || user.orgMemberships?.[0]?.organization?.id || 'default-org';
    const userId = searchParams.get('userId');
    const projectId = searchParams.get('projectId') || undefined;

    // Strict Tenant Isolation Check
    await assertOrgAccess(orgId);

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const result = typeof pbacEngine.getInspectorData === 'function'
      ? await pbacEngine.getInspectorData(orgId, userId, projectId)
      : await (pbacEngine as any).getEffectiveUserAccess(orgId, userId, projectId);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to inspect user access' }, { status: e.message?.includes('Forbidden') ? 403 : 500 });
  }
}
