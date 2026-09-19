import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const inspectUserId = searchParams.get("userId");

    // If specific user inspection requested
    if (inspectUserId) {
      const targetUser = await prisma.user.findUnique({
        where: { id: inspectUserId },
        include: {
          orgMemberships: {
            include: { organization: true },
          },
          workspaceMemberships: {
            include: {
              workspace: {
                include: { organization: true },
              },
            },
          },
          projectMemberships: {
            include: {
              project: {
                include: {
                  workspace: {
                    include: { organization: true },
                  },
                },
              },
            },
          },
          teamMemberships: {
            include: {
              team: {
                include: { workspace: true },
              },
            },
          },
          sessions: {
            orderBy: { lastActiveAt: "desc" },
            take: 5,
          },
        },
      });

      if (!targetUser) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      return NextResponse.json({
        userInspection: {
          id: targetUser.id,
          email: targetUser.email,
          name: `${targetUser.firstName} ${targetUser.lastName}`,
          isSuperAdmin: targetUser.isSuperAdmin,
          isSupportAdmin: targetUser.isSupportAdmin,
          status: targetUser.status,
          mfaEnabled: targetUser.mfaEnabled,
          createdAt: targetUser.createdAt,
          orgs: targetUser.orgMemberships.map((m) => ({
            orgId: m.orgId,
            orgName: m.organization.name,
            orgSlug: m.organization.slug,
            role: m.role,
          })),
          workspaces: targetUser.workspaceMemberships.map((m) => ({
            workspaceId: m.workspaceId,
            workspaceName: m.workspace.name,
            orgName: m.workspace.organization.name,
            role: m.role,
          })),
          projects: targetUser.projectMemberships.map((m) => ({
            projectId: m.projectId,
            projectName: m.project.name,
            projectKey: m.project.key,
            workspaceName: m.project.workspace.name,
            orgName: m.project.workspace.organization.name,
            role: m.role,
          })),
          teams: targetUser.teamMemberships.map((m) => ({
            teamId: m.teamId,
            teamName: m.team.name,
            role: m.role,
          })),
          recentSessions: targetUser.sessions.map((s) => ({
            id: s.id,
            ipAddress: s.ipAddress,
            browser: s.browser,
            os: s.os,
            lastActiveAt: s.lastActiveAt,
            expiresAt: s.expiresAt,
          })),
        },
      });
    }

    // High level PBAC Summary
    const [
      orgMembersCount,
      workspaceMembersCount,
      projectMembersCount,
      superAdminsCount,
      suspendedUsersCount,
      roleDistribution,
      unauthorizedAccessLogs,
      orgHierarchy,
    ] = await Promise.all([
      prisma.organizationMember.count(),
      prisma.workspaceMember.count(),
      prisma.projectMember.count(),
      prisma.user.count({ where: { isSuperAdmin: true } }),
      prisma.user.count({ where: { status: "SUSPENDED" } }),
      prisma.projectMember.groupBy({
        by: ["role"],
        _count: { role: true },
      }),
      prisma.platformAuditLog.findMany({
        where: {
          action: { in: ["UNAUTHORIZED_ACCESS", "403_FORBIDDEN", "CROSS_PROJECT_ATTEMPT", "ROLE_CHANGED"] },
        },
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
      prisma.organization.findMany({
        include: {
          workspaces: {
            include: {
              projects: {
                select: {
                  id: true,
                  name: true,
                  key: true,
                  _count: { select: { members: true, issues: true } },
                },
              },
            },
          },
          _count: { select: { members: true, workspaces: true } },
        },
        take: 10,
      }),
    ]);

    const { pbacEngine, PBAC_PERMISSION_CATEGORIES } = await import("@/lib/pbac-engine");
    // No phantom fallback: asking the engine for a non-existent org seeds a
    // fictional tenant into the PBAC store, which is how a stray 'default-org'
    // role set came to exist and leak into the roles UI.
    const firstOrg = orgHierarchy[0]?.id;
    const systemRoles = firstOrg ? await pbacEngine.getRoles(firstOrg) : [];

    const permissionRoles = systemRoles.map((r: any) => ({
      role: r.name,
      slug: r.slug,
      level: r.scope,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.permissions,
      permissionCount: r.permissions.length,
    }));

    return NextResponse.json({
      summary: {
        orgMembersCount,
        workspaceMembersCount,
        projectMembersCount,
        superAdminsCount,
        suspendedUsersCount,
      },
      roleDistribution: roleDistribution.map((r) => ({ role: r.role, count: r._count.role })),
      permissionRoles,
      permissionCategories: PBAC_PERMISSION_CATEGORIES,
      unauthorizedAccessLogs,
      orgHierarchy,
    });
  } catch (error: any) {
    return handleApiError(error, "super-admin/access-governance");
  }
}