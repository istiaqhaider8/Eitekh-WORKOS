import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { assertOrgAccess } from '@/lib/tenant';
import { pbacEngine, PBAC_PERMISSION_CATEGORIES } from '@/lib/pbac-engine';
import { handleApiError } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId');
    if (!orgId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 });
    const search = searchParams.get('search') || '';
    const roleId = searchParams.get('roleId') || 'all';
    const workspaceId = searchParams.get('workspaceId') || 'all';
    const projectId = searchParams.get('projectId') || 'all';
    const status = searchParams.get('status') || 'all';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limitParam = searchParams.get('limit') || '25';
    const limit = limitParam === 'all' ? 'all' : parseInt(limitParam, 10);

    // Strict Tenant Isolation Check
    await assertOrgAccess(orgId);

    const [matrixResult, roles] = await Promise.all([
      pbacEngine.getUsersWithRoles(orgId, {
        search,
        roleId,
        workspaceId,
        projectId,
        status,
        page,
        limit,
      }),
      pbacEngine.getRoles(orgId),
    ]);

    return NextResponse.json({
      ...matrixResult,
      roles,
      categories: PBAC_PERMISSION_CATEGORIES,
    });
  } catch (e: any) {
    return handleApiError(e, "pbac/matrix");
  }
}
