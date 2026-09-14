import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { assertOrgAccess } from '@/lib/tenant';
import { pbacEngine, PBAC_PERMISSION_CATEGORIES, ALL_PBAC_PERMISSION_KEYS, HIGH_RISK_PERMISSIONS } from '@/lib/pbac-engine';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId') || 'default-org';
    const projectId = searchParams.get('projectId') || undefined;

    // Strict Tenant Isolation
    await assertOrgAccess(orgId);

    const roles = await pbacEngine.getRoles(orgId, projectId);

    return NextResponse.json({
      roles,
      categories: PBAC_PERMISSION_CATEGORIES,
      allKeys: ALL_PBAC_PERMISSION_KEYS,
      highRiskKeys: HIGH_RISK_PERMISSIONS,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to fetch roles' }, { status: e.message?.includes('Forbidden') ? 403 : 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const body = await req.json();
    const orgId = body.orgId || searchParams.get('orgId') || 'default-org';
    const { id, name, description, scope, projectId, projectName, status, permissions, cloneFromId } = body;

    // Strict Tenant Isolation & Privilege Escalation Guard (OWNER or ADMIN required)
    await assertOrgAccess(orgId, ['OWNER', 'ADMIN']);

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Role name is required' }, { status: 400 });
    }

    const actor = {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim() || user.email,
      email: user.email,
    };

    let role;
    if (cloneFromId) {
      role = await pbacEngine.cloneRole(orgId, cloneFromId, { name, description, permissions, projectId, projectName }, actor);
    } else {
      role = await pbacEngine.saveRole(orgId, { id, name, description, scope, projectId, projectName, status, permissions: permissions || [] }, actor);
    }

    return NextResponse.json({ role, success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to save role' }, { status: e.message?.includes('Forbidden') ? 403 : 500 });
  }
}
