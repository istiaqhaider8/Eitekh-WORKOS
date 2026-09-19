import { prisma } from "./prisma";
import { getCurrentUser } from "./auth";

export interface TenantContext {
  organizationId: string;
  organizationName: string;
  workspaceId?: string;
  workspaceName?: string;
  role: string;
}

export async function getActiveOrgContext(orgId?: string) {
  const user = await getCurrentUser();
  if (!user) return null;

  if (user.isSuperAdmin) {
    // Super Admin can access any active organization
    const org = orgId
      ? await prisma.organization.findUnique({ where: { id: orgId } })
      : await prisma.organization.findFirst();
    if (!org) return null;
    return {
      organization: org,
      role: "SUPER_ADMIN",
      user,
    };
  }

  // Find membership
  const membership = orgId
    ? await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId: user.id } },
        include: { organization: true },
      })
    : await prisma.organizationMember.findFirst({
        where: { userId: user.id },
        include: { organization: true },
      });

  if (!membership || membership.organization.status === "SUSPENDED") return null;

  return {
    organization: membership.organization,
    role: membership.role,
    user,
  };
}

export async function assertOrgAccess(orgId: string, allowedRoles: string[] = ["OWNER", "ADMIN", "MEMBER"]) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized: Please sign in");

  if (user.isSuperAdmin) return { user, role: "SUPER_ADMIN" };

  const membership = await prisma.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: user.id } },
    include: { organization: true },
  });

  if (!membership) {
    throw new Error("Forbidden: You do not belong to this organization");
  }

  if (membership.organization.status === "SUSPENDED") {
    throw new Error("Forbidden: Organization account has been suspended");
  }

  if (!allowedRoles.includes(membership.role)) {
    throw new Error("Forbidden: Insufficient role permissions");
  }

  return { user, role: membership.role, organization: membership.organization };
}

/**
 * Tenant isolation check: verifies the user is a member of the project (or its org).
 * Use for READ-ONLY operations. For mutations, use assertProjectPermission() instead
 * to enforce PBAC capability checks on top of membership.
 */
export async function assertProjectAccess(projectId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized: Please sign in");

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      workspace: {
        include: {
          organization: true,
        },
      },
      members: true,
    },
  });

  if (!project) throw new Error("Project not found");

  if (user.isSuperAdmin) {
    return { user, project, role: "SUPER_ADMIN" };
  }

  // Check tenant isolation: user must belong to parent org
  const orgMember = await prisma.organizationMember.findUnique({
    where: {
      orgId_userId: {
        orgId: project.workspace.orgId,
        userId: user.id,
      },
    },
  });

  if (!orgMember) {
    const { logger } = await import("./logger");
    logger.security("CROSS_TENANT_ACCESS_ATTEMPT", "Cross-organization project access denied", {
      userId: user.id,
      email: user.email,
      projectId,
      targetOrgId: project.workspace.orgId,
    });
    throw new Error("Forbidden: Cross-organization project access denied");
  }

  const projectMember = project.members.find((m) => m.userId === user.id);
  const isOwner = project.ownerId === user.id;

  // STRICT PROJECT-BASED ACCESS CONTROL:
  // A user must be explicitly assigned to this project (ProjectMember) or be the project's creator/owner.
  // Unassigned users (even org members/admins) are strictly forbidden from viewing or performing actions.
  if (!projectMember && !isOwner) {
    const { logger } = await import("./logger");
    logger.security("UNAUTHORIZED_PROJECT_ACCESS", "User attempted to access unassigned project", {
      userId: user.id,
      email: user.email,
      projectId: project.id,
      projectKey: project.key,
    });
    throw new Error("Forbidden: You are not assigned to this project");
  }

  const role = projectMember 
    ? projectMember.role 
    : (isOwner ? "PROJECT_ADMIN" : "MEMBER");

  return { user, project, role };
}

export async function assertIssueAccess(issueId: string) {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { id: true, projectId: true, issueKey: true },
  });

  if (!issue) {
    throw new Error("Issue not found");
  }

  const access = await assertProjectAccess(issue.projectId);
  return { ...access, issue };
}

/**
 * HIGH-PRIORITY PBAC PERMISSION ENFORCEMENT:
 * Asserts that the authenticated user has an exact PBAC permission within the project's parent organization.
 * Super Admins bypass checks. Viewers and restricted roles are blocked if they lack the capability.
 */
export async function assertProjectPermission(projectId: string, permissionKey: string) {
  const access = await assertProjectAccess(projectId);
  const { user, project, role } = access;

  if (user.isSuperAdmin) {
    return { ...access, hasPermission: true };
  }

  const orgId = project.workspace.orgId;
  const { pbacEngine } = await import("./pbac-engine");
  const hasPerm = await pbacEngine.hasPermission(orgId, user.id, permissionKey, role, projectId);

  if (!hasPerm) {
    const { logger } = await import("./logger");
    logger.security("PBAC_ACCESS_DENIED", `User lacks required permission: ${permissionKey}`, {
      userId: user.id,
      email: user.email,
      projectId,
      orgId,
      permissionKey,
      role: access.role,
    });
    const friendlyAction = permissionKey.replace(":", " ").replace("_", " ");
    throw new Error(`You don't have permission to ${friendlyAction}. Contact your project admin for access.`);
  }

  return { ...access, hasPermission: true };
}

/**
 * HIGH-PRIORITY PBAC PERMISSION ENFORCEMENT (ORGANIZATION-LEVEL):
 * Asserts that the authenticated user has an exact PBAC permission within the organization.
 */
export async function assertOrgPermission(orgId: string, permissionKey: string) {
  const access = await assertOrgAccess(orgId);
  const { user, role } = access;

  if (user.isSuperAdmin) {
    return { ...access, hasPermission: true };
  }

  const { pbacEngine } = await import("./pbac-engine");
  const hasPerm = await pbacEngine.hasPermission(orgId, user.id, permissionKey, role);

  if (!hasPerm) {
    const { logger } = await import("./logger");
    logger.security("PBAC_ACCESS_DENIED", `User lacks required permission: ${permissionKey}`, {
      userId: user.id,
      email: user.email,
      orgId,
      permissionKey,
      role: access.role,
    });
    const friendlyAction = permissionKey.replace(":", " ").replace("_", " ");
    throw new Error(`You don't have permission to ${friendlyAction}. Contact your project admin for access.`);
  }

  return { ...access, hasPermission: true };
}

/**
 * Tenant guard for a team, for READ access (PROD-5).
 *
 * This existed as a private `checkTeamAccess` inside
 * `src/app/api/teams/[id]/route.ts` and was used by that route's GET. The
 * members sub-route had only an admin check, used by its POST and DELETE — its
 * GET called nothing at all, and so returned every member's id, **email**,
 * first name, last name and avatar for any team id an authenticated caller
 * cared to name. A user of one organization could enumerate another's team
 * membership and harvest addresses.
 *
 * It was found by the PROD-5 tenant-isolation suite and reproduced live before
 * being fixed. Moving the guard here is the actual remedy: a check that lives
 * privately in one route file is a check the next route will forget, which is
 * precisely what happened.
 *
 * Access is granted to a super admin, to a member of the team, to a project
 * admin or manager of the team's project, to a workspace admin, or to an owner
 * or admin of the team's organization. Everyone else is refused — including
 * members of other organizations, which is the property under test.
 */
export async function assertTeamAccess(teamId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized: Please sign in");
  if (user.isSuperAdmin) return { user, role: "SUPER_ADMIN" as const };

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { workspace: true },
  });
  if (!team) throw new Error("Team not found");

  if (team.projectId) {
    const pm = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: team.projectId, userId: user.id } },
    });
    if (pm && (pm.role === "PROJECT_ADMIN" || pm.role === "PROJECT_MANAGER")) {
      return { user, role: pm.role };
    }
  }

  const teamMember = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: user.id } },
  });
  if (teamMember) return { user, role: teamMember.role };

  const wsMember = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: team.workspaceId, userId: user.id } },
  });
  if (wsMember && wsMember.role === "WORKSPACE_ADMIN") {
    return { user, role: "WORKSPACE_ADMIN" as const };
  }

  const orgMember = await prisma.organizationMember.findUnique({
    where: { orgId_userId: { orgId: team.workspace.orgId, userId: user.id } },
  });
  if (orgMember && (orgMember.role === "OWNER" || orgMember.role === "ADMIN")) {
    return { user, role: "WORKSPACE_ADMIN" as const };
  }

  const { logger } = await import("./logger");
  logger.security("CROSS_TENANT_ACCESS_ATTEMPT", "Cross-organization team access denied", {
    userId: user.id,
    email: user.email,
    teamId,
    targetOrgId: team.workspace.orgId,
  });
  throw new Error("Forbidden: Cross-organization team access denied");
}
