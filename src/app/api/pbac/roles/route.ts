import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { assertOrgAccess } from '@/lib/tenant';
import { pbacEngine, PBAC_PERMISSION_CATEGORIES, ALL_PBAC_PERMISSION_KEYS, HIGH_RISK_PERMISSIONS } from '@/lib/pbac-engine';
import { pbacRoleCreateSchema, parseBody, parseJsonBody } from '@/lib/validation';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
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
    const parsed = await parseJsonBody(req, pbacRoleCreateSchema);
    if (!parsed.success) return parsed.error;
    const { id, name, description, scope, projectId, projectName, status, permissions, cloneFromId } = parsed.data;
    const orgId = parsed.data.orgId || searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });

    await assertOrgAccess(orgId, ['OWNER', 'ADMIN']);

    // Reject permission keys that are not in the catalogue. The schema only
    // bounds their length, so a typo such as "issues:delet" was stored happily
    // and produced a role that silently granted nothing — the failure would
    // surface much later as a user mysteriously lacking access.
    if (permissions?.length) {
      const { ALL_PBAC_PERMISSION_KEYS } = await import('@/lib/pbac-engine');
      const known = new Set(ALL_PBAC_PERMISSION_KEYS);
      const unknown = permissions.filter((p: string) => !known.has(p));
      if (unknown.length) {
        return NextResponse.json(
          { error: `Unknown permission key(s): ${unknown.slice(0, 10).join(', ')}` },
          { status: 400 }
        );
      }
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
    const msg = e?.message || 'Failed to save role';
    // saveRole enforces rules the operator can act on — a duplicate name, a
    // system role that may not be edited, or granting a permission the actor
    // does not hold. Returning 500 for those hid an actionable message behind a
    // generic server error.
    const status = msg.includes('Forbidden') || /do not hold/i.test(msg)
      ? 403
      : msg.includes('not found')
      ? 404
      : /already exists|duplicate|system role|cannot/i.test(msg)
      ? 409
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
