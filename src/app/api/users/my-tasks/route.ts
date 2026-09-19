import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { handleApiError } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

    const where = {
      assigneeId: user.id,
      status: { category: { not: 'DONE' as const } },
    };

    const [tasks, total] = await Promise.all([
      prisma.issue.findMany({
        where,
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
        take: limit,
        skip: (page - 1) * limit,
      }),
      prisma.issue.count({ where }),
    ]);

    return NextResponse.json({ tasks, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error: any) {
    return handleApiError(error, "users/my-tasks");
  }
}
