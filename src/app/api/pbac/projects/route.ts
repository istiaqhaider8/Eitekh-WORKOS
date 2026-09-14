import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { assertOrgAccess } from '@/lib/tenant';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId') || user.orgMemberships?.[0]?.orgId;
    
    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // Strict Tenant Access Enforcement
    await assertOrgAccess(orgId);

    // Find projects strictly bounded by orgId
    const projects = await prisma.project.findMany({
      where: { workspace: { orgId } },
      select: {
        id: true,
        name: true,
        key: true,
        description: true,
        status: true,
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            orgId: true,
          },
        },
        _count: {
          select: {
            members: true,
            issues: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ projects, count: projects.length });
  } catch (e: any) {
    const status = e.message?.includes('Forbidden') ? 403 : e.message?.includes('Unauthorized') ? 401 : 500;
    return NextResponse.json({ error: e.message || 'Failed to fetch projects' }, { status });
  }
}
