import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

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

    const permissionRoles = [
      {
        role: "SUPERADMIN",
        level: "Platform",
        description: "Full platform governance, security controls, cross-tenant administration, system settings",
        permissions: ["ALL_ACCESS", "SYSTEM_SETTINGS", "TENANT_MANAGEMENT", "GLOBAL_SECURITY", "FEATURE_FLAGS", "AUDIT_EXPORT"],
      },
      {
        role: "OWNER (Org)",
        level: "Organization",
        description: "Organization ownership, billing, domain settings, member invitation, workspace creation",
        permissions: ["ORG_UPDATE", "ORG_INVITE", "WORKSPACE_CREATE", "BILLING_MANAGE", "ORG_AUDIT"],
      },
      {
        role: "WORKSPACE_ADMIN",
        level: "Workspace",
        description: "Manage workspace settings, teams, and initiate projects within the workspace",
        permissions: ["WORKSPACE_UPDATE", "TEAM_CREATE", "PROJECT_CREATE", "WORKSPACE_MEMBERS"],
      },
      {
        role: "PROJECT_ADMIN",
        level: "Project",
        description: "Full administrative control of project issues, workflows, components, epics, and settings",
        permissions: ["PROJECT_UPDATE", "MEMBER_MANAGE", "WORKFLOW_EDIT", "ISSUE_DELETE", "SPRINT_MANAGE", "EXPORT_DATA"],
      },
      {
        role: "PROJECT_MANAGER",
        level: "Project",
        description: "Sprint lifecycle management, backlog grooming, issue assignment, and milestone tracking",
        permissions: ["SPRINT_START_COMPLETE", "ISSUE_CREATE_EDIT", "ESTIMATES_EDIT", "REPORTS_VIEW"],
      },
      {
        role: "MEMBER",
        level: "Project",
        description: "Create, comment, update assigned issues, log work, and participate in active sprints",
        permissions: ["ISSUE_CREATE", "ISSUE_EDIT_ASSIGNED", "COMMENT_ADD", "TIME_TRACK", "ATTACH_FILES"],
      },
      {
        role: "VIEWER",
        level: "Project",
        description: "Read-only access to project issues, boards, calendar, and timeline views",
        permissions: ["READ_ONLY", "COMMENT_VIEW", "EXPORT_VIEW"],
      },
    ];

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
      unauthorizedAccessLogs,
      orgHierarchy,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}