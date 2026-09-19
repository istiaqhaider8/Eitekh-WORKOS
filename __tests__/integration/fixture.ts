/**
 * PROD-5 / PROD-6 — the two-tenant fixture.
 *
 * Two complete, independent organizations, each with a workspace, a project,
 * members and an issue, plus a super admin and a signed-in user who belongs to
 * nothing. PROD-6 adds one user per role on top of the same fixture.
 *
 * Everything is created with an `it_` prefix and a per-run suffix, so a failed
 * run leaves identifiable rows behind rather than anonymous ones, and a
 * concurrent run cannot collide.
 */

import { PrismaClient } from "@prisma/client";
import { signToken, type Fixture, type TestUser, type TenantFixture } from "./harness";

export const RUN = `it${Date.now().toString(36)}`;

export type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

function makeUser(prisma: PrismaClient, label: string, isSuperAdmin = false): TestUser {
  const id = `${RUN}_${label}`;
  const email = `${id}@integration.test`;
  const sessionId = `${RUN}_sess_${label}`;
  return { id, email, sessionId, label, token: signToken(id, email, sessionId, isSuperAdmin) };
}

async function persistUser(prisma: PrismaClient, u: TestUser, isSuperAdmin = false): Promise<void> {
  await prisma.user.create({
    data: {
      id: u.id,
      email: u.email,
      // Not a usable password: these accounts authenticate by pre-signed
      // session token, never through the login route.
      passwordHash: "integration-test-no-login",
      firstName: "IT",
      lastName: u.label,
      isSuperAdmin,
    },
  });
  await prisma.session.create({
    data: {
      id: u.sessionId,
      userId: u.id,
      token: u.token,
      expiresAt: new Date(Date.now() + 2 * 3600_000),
    },
  });
}

async function buildTenant(prisma: PrismaClient, tag: string): Promise<TenantFixture> {
  const orgId = `${RUN}_org${tag}`;
  const workspaceId = `${RUN}_ws${tag}`;
  const projectId = `${RUN}_proj${tag}`;
  const projectKey = `IT${tag}`;

  const roles: Role[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];
  const users: Record<string, TestUser> = {};
  for (const role of roles) {
    users[role] = makeUser(prisma, `${tag}_${role.toLowerCase()}`);
  }

  await prisma.organization.create({
    data: { id: orgId, name: `Integration Org ${tag}`, slug: orgId },
  });

  for (const role of roles) {
    await persistUser(prisma, users[role]);
    await prisma.organizationMember.create({
      data: {
        orgId,
        userId: users[role].id,
        // The org-level vocabulary has no VIEWER; a viewer is a MEMBER at the
        // organization who holds VIEWER on the project.
        role: role === "VIEWER" ? "MEMBER" : role,
      },
    });
  }

  await prisma.workspace.create({
    data: { id: workspaceId, orgId, name: `Integration WS ${tag}`, slug: workspaceId },
  });

  // Workspace membership matters: several listing routes scope by
  // `workspace.members.some({ userId })` rather than by organization. Without
  // these rows every such listing returns [] for everyone, so a cross-tenant
  // probe against them would pass whether the guard worked or not — and the
  // control case proving the probe reaches live code would fail.
  for (const role of roles) {
    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: users[role].id,
        role: role === "OWNER" || role === "ADMIN" ? "WORKSPACE_ADMIN" : "MEMBER",
      },
    });
  }

  await prisma.project.create({
    data: {
      id: projectId,
      workspaceId,
      name: `Integration Project ${tag}`,
      key: projectKey,
      ownerId: users.OWNER.id,
      template: "KANBAN",
    },
  });

  for (const role of roles) {
    await prisma.projectMember.create({
      data: { projectId, userId: users[role].id, role },
    });
  }

  // An issue needs a status, which needs a workflow. Built explicitly rather
  // than through the API so the fixture does not depend on a route behaving
  // correctly — these tests are about to call that route's guards into
  // question.
  const workflowId = `${RUN}_wf${tag}`;
  await prisma.workflow.create({
    data: { id: workflowId, projectId, name: "Default", isDefault: true },
  });
  const statusId = `${RUN}_st${tag}`;
  await prisma.workflowStatus.create({
    data: { id: statusId, workflowId, name: "To Do", category: "TODO", color: "#888888", position: 1 },
  });

  // A team with members. Needed because several routes are reachable by team
  // id alone, and a fixture that creates no teams cannot detect a leak through
  // them — the collection would be empty whether the guard worked or not.
  const teamId = `${RUN}_team${tag}`;
  await prisma.team.create({
    data: {
      id: teamId,
      workspaceId,
      projectId,
      name: `Integration Team ${tag}`,
      description: `team of tenant ${tag}`,
    },
  });
  for (const role of roles) {
    await prisma.teamMember.create({
      data: { teamId, userId: users[role].id, role: role === "OWNER" ? "LEAD" : "MEMBER" },
    });
  }

  const issueId = `${RUN}_issue${tag}`;
  const issueKey = `${projectKey}-1`;
  await prisma.issue.create({
    data: {
      id: issueId,
      projectId,
      keyNumber: 1,
      issueKey,
      title: `Secret of tenant ${tag}`,
      issueType: "TASK",
      statusId,
      priority: "MEDIUM",
      reporterId: users.OWNER.id,
    },
  });

  return { orgId, workspaceId, projectId, projectKey, issueId, issueKey, teamId, users };
}

export async function createFixture(prisma: PrismaClient): Promise<Fixture> {
  const orgA = await buildTenant(prisma, "A");
  const orgB = await buildTenant(prisma, "B");

  const superAdmin = makeUser(prisma, "superadmin", true);
  await persistUser(prisma, superAdmin, true);

  // Belongs to no organization: the cleanest probe for "authenticated but
  // entitled to nothing".
  const outsider = makeUser(prisma, "outsider");
  await persistUser(prisma, outsider);

  return { orgA, orgB, superAdmin, outsider };
}

/**
 * Remove everything this run created.
 *
 * Scoped by the run prefix rather than by truncating tables: a cleanup that
 * empties tables would be one typo away from deleting real data if the
 * database guard were ever bypassed.
 */
export async function destroyFixture(prisma: PrismaClient): Promise<void> {
  const like = { startsWith: RUN };

  await prisma.syncEventOutbox.deleteMany({ where: { OR: [{ projectId: like }, { userId: like }] } });
  await prisma.issue.deleteMany({ where: { projectId: like } });
  await prisma.workflowStatus.deleteMany({ where: { workflow: { projectId: like } } });
  await prisma.workflow.deleteMany({ where: { projectId: like } });
  await prisma.teamMember.deleteMany({ where: { teamId: like } });
  await prisma.team.deleteMany({ where: { id: like } });
  await prisma.projectMember.deleteMany({ where: { projectId: like } });
  await prisma.project.deleteMany({ where: { id: like } });
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: like } });
  await prisma.workspace.deleteMany({ where: { id: like } });
  await prisma.pbacUserRoleAssignment.deleteMany({ where: { orgId: like } });
  await prisma.pbacRole.deleteMany({ where: { orgId: like } });
  await prisma.pbacAuditRecord.deleteMany({ where: { orgId: like } });
  await prisma.pbacOrgState.deleteMany({ where: { orgId: like } });
  await prisma.organizationMember.deleteMany({ where: { orgId: like } });
  await prisma.session.deleteMany({ where: { id: like } });
  await prisma.user.deleteMany({ where: { id: like } });
  await prisma.organization.deleteMany({ where: { id: like } });
}
