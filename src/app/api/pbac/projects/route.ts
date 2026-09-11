import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get('orgId') || 'default-org';

    // Find workspaces in this org, then projects
    const projects = await prisma.project.findMany({
      where: orgId && orgId !== 'default-org'
        ? { workspace: { orgId } }
        : undefined,
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
    return NextResponse.json({ error: e.message || 'Failed to fetch projects' }, { status: 500 });
  }
}
