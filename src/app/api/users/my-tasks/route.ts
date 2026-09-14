import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const tasks = await prisma.issue.findMany({
      where: {
        assigneeId: user.id,
        status: { category: { not: 'DONE' } },
      },
      select: {
        id: true,
        issueKey: true,
        title: true,
        priority: true,
        issueType: true,
        projectId: true,
        status: {
          select: { id: true, name: true, category: true, color: true },
        },
        project: {
          select: { id: true, name: true, key: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({ tasks });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch tasks' }, { status: 500 });
  }
}
