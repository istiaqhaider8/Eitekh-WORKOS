import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { assertOrgAccess } from '@/lib/tenant';
import { pbacEngine } from '@/lib/pbac-engine';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
    const search = searchParams.get('search') || '';
    const action = searchParams.get('action') || 'all';
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    // Strict Tenant Isolation & Audit Permission Check
    await assertOrgAccess(orgId);

    const logs = await pbacEngine.getAuditLedger(orgId, { search, action, limit });
    return NextResponse.json({ logs, total: logs.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to fetch audit logs' }, { status: e.message?.includes('Forbidden') ? 403 : 500 });
  }
}
