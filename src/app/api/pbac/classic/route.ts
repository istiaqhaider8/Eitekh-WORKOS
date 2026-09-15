import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { pbacClassicActionSchema, parseBody } from '@/lib/validation';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: 'Forbidden: Super Admin required' }, { status: 403 });
    }

    const orgId = req.nextUrl.searchParams.get('orgId') || '';

    // Fetch projects for the org
    const projects = await prisma.project.findMany({
      where: orgId ? { workspace: { orgId } } : undefined,
      select: {
        id: true,
        name: true,
        key: true,
        status: true,
        workspace: {
          select: { id: true, name: true, orgId: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const projectIds = projects.map((p) => p.id);

    // Fetch all users with their project memberships in this org
    const users = await prisma.user.findMany({
      where: orgId ? { orgMemberships: { some: { orgId } } } : undefined,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        company: true,
        status: true,
        isSuperAdmin: true,
        mfaEnabled: true,
        avatarUrl: true,
        createdAt: true,
        projectMemberships: {
          where: { projectId: { in: projectIds } },
          select: {
            id: true,
            projectId: true,
            role: true,
            createdAt: true,
            project: {
              select: { id: true, name: true, key: true },
            },
          },
        },
        orgMemberships: {
          where: orgId ? { orgId } : undefined,
          select: {
            id: true,
            role: true,
            organization: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ users, projects });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden: Super Admin required' }, { status: 403 });
    }

    const parsed = parseBody(pbacClassicActionSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { userId, projectId, role, action } = parsed.data;

    if (action === 'DELETE' || action === 'REMOVE') {
      await prisma.projectMember.deleteMany({
        where: { projectId, userId },
      });

      try {
        const { pbacEngine } = await import('@/lib/pbac-engine');
        pbacEngine.invalidateUserCache(userId);
      } catch (e) {}

      await prisma.platformAuditLog.create({
        data: {
          actorId: user.id,
          action: 'REVOKE_PROJECT_ACCESS_CLASSIC',
          targetResource: `Project:${projectId}:User:${userId}`,
          details: JSON.stringify({ userId, projectId, revokedBy: user.email }),
        },
      });

      return NextResponse.json({ success: true, message: 'Project membership revoked' });
    }

    const memberRole = role || 'MEMBER';

    // Upsert project membership
    const membership = await prisma.projectMember.upsert({
      where: {
        projectId_userId: { projectId, userId },
      },
      update: {
        role: memberRole,
      },
      create: {
        projectId,
        userId,
        role: memberRole,
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            key: true,
            workspace: { select: { orgId: true } },
          },
        },
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });

    try {
      const { pbacEngine } = await import('@/lib/pbac-engine');
      await pbacEngine.syncProjectMemberRole(membership.project.workspace.orgId, userId, memberRole, projectId);
    } catch (pbacErr) {
      console.error('Failed to sync classic project role with PBAC engine:', pbacErr);
    }

    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: 'UPDATE_PROJECT_ROLE_CLASSIC',
        targetResource: `Project:${projectId}:User:${userId}`,
        details: JSON.stringify({ userId, projectId, role: memberRole, updatedBy: user.email }),
      },
    });

    return NextResponse.json({ success: true, membership });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
