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

/**
 * The fixture's role labels, and the two vocabularies each one maps to.
 *
 * These are deliberately spelled out rather than reused as a single string,
 * because the codebase has two separate role vocabularies that were once
 * conflated (see src/lib/project-roles.ts):
 *
 *   OrganizationMember.role — OWNER | ADMIN | MEMBER | GUEST
 *   ProjectMember.role      — PROJECT_ADMIN | PROJECT_MANAGER | MEMBER | VIEWER | …
 *
 * An earlier version of this fixture wrote `ProjectMember.role = "OWNER"`,
 * which is not a valid project role at all. The tests still passed, because
 * nothing asserted on the project role — a fixture that creates data the API
 * would reject makes every test built on it suspect.
 */
export interface RoleSpec {
  label: string;
  orgRole: "OWNER" | "ADMIN" | "MEMBER";
  projectRole: "PROJECT_ADMIN" | "PROJECT_MANAGER" | "MEMBER" | "VIEWER";
  /** Authority rank, highest first. Used by the escalation tests. */
  rank: number;
}

export const ROLE_SPECS: RoleSpec[] = [
  { label: "OWNER", orgRole: "OWNER", projectRole: "PROJECT_ADMIN", rank: 0 },
  { label: "ADMIN", orgRole: "ADMIN", projectRole: "PROJECT_ADMIN", rank: 1 },
  { label: "MANAGER", orgRole: "MEMBER", projectRole: "PROJECT_MANAGER", rank: 2 },
  { label: "MEMBER", orgRole: "MEMBER", projectRole: "MEMBER", rank: 3 },
  { label: "VIEWER", orgRole: "MEMBER", projectRole: "VIEWER", rank: 4 },
];

export type Role = "OWNER" | "ADMIN" | "MANAGER" | "MEMBER" | "VIEWER";

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

  const users: Record<string, TestUser> = {};
  for (const spec of ROLE_SPECS) {
    users[spec.label] = makeUser(prisma, `${tag}_${spec.label.toLowerCase()}`);
  }

  await prisma.organization.create({
    data: { id: orgId, name: `Integration Org ${tag}`, slug: orgId },
  });

  for (const spec of ROLE_SPECS) {
    await persistUser(prisma, users[spec.label]);
    await prisma.organizationMember.create({
      // The organization vocabulary has no VIEWER or MANAGER: those are
      // project-level roles held by an organization MEMBER.
      data: { orgId, userId: users[spec.label].id, role: spec.orgRole },
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
  for (const spec of ROLE_SPECS) {
    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: users[spec.label].id,
        role: spec.orgRole === "MEMBER" ? "MEMBER" : "WORKSPACE_ADMIN",
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

  for (const spec of ROLE_SPECS) {
    // The PROJECT vocabulary — PROJECT_ADMIN / PROJECT_MANAGER / MEMBER /
    // VIEWER. Writing an organization role here (an earlier version wrote
    // "OWNER") produces a row the API's own whitelist would reject.
    await prisma.projectMember.create({
      data: { projectId, userId: users[spec.label].id, role: spec.projectRole },
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

  /**
   * Two more statuses, and exactly one transition between them.
   *
   * A workflow with a single status cannot express a forbidden move, so a
   * fixture with one status makes transition enforcement untestable — the
   * suite would pass whether the rule worked or not. Here:
   *
   *   To Do --(transition exists)--> In Progress     allowed
   *   To Do --(no transition)------> Done            must be refused
   *
   * "Done" is the status a bypass reaches, which is the realistic shape: the
   * gate someone skips is the one that closes work.
   */
  const statusInProgressId = `${RUN}_stip${tag}`;
  await prisma.workflowStatus.create({
    data: { id: statusInProgressId, workflowId, name: "In Progress", category: "IN_PROGRESS", color: "#3b82f6", position: 2 },
  });
  const statusDoneId = `${RUN}_stdone${tag}`;
  await prisma.workflowStatus.create({
    data: { id: statusDoneId, workflowId, name: "Done", category: "DONE", color: "#22c55e", position: 3 },
  });
  await prisma.workflowTransition.create({
    data: {
      id: `${RUN}_tr${tag}`,
      workflowId,
      fromStatusId: statusId,
      toStatusId: statusInProgressId,
    },
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
  for (const spec of ROLE_SPECS) {
    await prisma.teamMember.create({
      data: { teamId, userId: users[spec.label].id, role: spec.rank === 0 ? "LEAD" : "MEMBER" },
    });
  }

  // An organization member who is deliberately NOT a project member. Routes
  // that assign someone to a project validate organization membership first,
  // so using a total outsider as the target produces a 400 from validation
  // before any permission check runs — and the test proves nothing.
  const spare = makeUser(prisma, `${tag}_spare`);
  await persistUser(prisma, spare);
  await prisma.organizationMember.create({ data: { orgId, userId: spare.id, role: "MEMBER" } });

  /**
   * A sprint and an epic per tenant.
   *
   * These exist so the "foreign id in the request body" tests have something
   * real to point at. Without them the only outcome would be a 404 for a
   * non-existent id, which proves nothing about whether the route checks
   * OWNERSHIP of an id that does exist.
   */
  const sprintId = `${RUN}_sprint${tag}`;
  await prisma.sprint.create({
    data: { id: sprintId, projectId, name: `Sprint of tenant ${tag}`, status: "ACTIVE" },
  });
  const epicId = `${RUN}_epic${tag}`;
  await prisma.epic.create({
    data: { id: epicId, projectId, name: `Epic of tenant ${tag}`, status: "ACTIVE" },
  });

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

  /**
   * Leaf resources (B4).
   *
   * Each of these is reachable by its own id, on a route whose path contains
   * no project or organization. That is the shape both vulnerabilities found
   * so far had: `GET /api/teams/[id]/members` leaked emails because nothing in
   * the path told the handler which tenant to check against, so nothing did.
   *
   * They exist in the fixture only so a denial test has a REAL id to ask for.
   * A test that requests a made-up id proves the 404 path, not the guard.
   */
  const commentId = `${RUN}_comment${tag}`;
  await prisma.comment.create({
    data: { id: commentId, issueId, userId: users.OWNER.id, content: `Comment of tenant ${tag}` },
  });

  const subtaskId = `${RUN}_subtask${tag}`;
  await prisma.subtask.create({
    data: { id: subtaskId, parentIssueId: issueId, title: `Subtask of tenant ${tag}` },
  });

  const componentId = `${RUN}_component${tag}`;
  await prisma.component.create({
    data: { id: componentId, projectId, name: `Component of tenant ${tag}` },
  });

  const customFieldId = `${RUN}_cf${tag}`;
  await prisma.customField.create({
    data: { id: customFieldId, scopeType: "PROJECT", scopeId: projectId, name: `Field of tenant ${tag}`, fieldType: "TEXT" },
  });

  // fileUrl holds a base64 data URI today (see B3). The content here is a
  // marker the leak assertions can search for.
  const attachmentId = `${RUN}_attach${tag}`;
  await prisma.attachment.create({
    data: {
      id: attachmentId,
      issueId,
      uploaderId: users.OWNER.id,
      fileName: `secret-of-tenant-${tag}.txt`,
      fileSize: 32,
      mimeType: "text/plain",
      fileUrl: `data:text/plain;base64,${Buffer.from(`ATTACHMENT BODY OF TENANT ${tag}`).toString("base64")}`,
    },
  });

  // The webhook SECRET is the sensitive part: it is what a receiver uses to
  // verify payloads, so leaking it lets another tenant forge them.
  const webhookId = `${RUN}_webhook${tag}`;
  await prisma.webhook.create({
    data: {
      id: webhookId,
      orgId,
      projectId,
      targetUrl: `https://hooks.tenant-${tag}.test/incoming`,
      secret: `whsec_secret_of_tenant_${tag}`,
      events: "issue.created",
    },
  });

  const automationId = `${RUN}_automation${tag}`;
  await prisma.automationRule.create({
    data: {
      id: automationId,
      projectId,
      name: `Automation of tenant ${tag}`,
      triggerType: "ISSUE_CREATED",
      actionType: "NOTIFY",
    },
  });

  /**
   * H4 — the rows the last of the KNOWN_GAPS routes need.
   *
   * Each of these is reachable by its own id on a path that names no tenant,
   * which is the shape both previously found vulnerabilities had. They could
   * not be tested before for a mundane reason: the fixture provisioned no row
   * of the right kind, so a denial test would have been asking for an id that
   * does not exist and proving only the 404 path.
   */
  const pbacRoleId = `${RUN}_pbacrole${tag}`;
  await prisma.pbacRole.create({
    data: {
      id: pbacRoleId,
      orgId,
      name: `Role of tenant ${tag}`,
      slug: `role-of-tenant-${tag}`,
      description: `PBAC SECRET OF TENANT ${tag}`,
      permissions: ["issues:view"],
    },
  });
  await prisma.pbacUserRoleAssignment.create({
    data: { userId: spare.id, roleId: pbacRoleId, orgId },
  });

  const recurringTaskId = `${RUN}_recurring${tag}`;
  await prisma.recurringTask.create({
    data: {
      id: recurringTaskId,
      projectId,
      scheduleCron: "DAILY",
      templateData: JSON.stringify({ title: `Recurring of tenant ${tag}` }),
      isActive: true,
      // Far in the future: a fixture row must not be swept up by a trigger run
      // from another test in the same suite.
      nextRunAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  const leaveId = `${RUN}_leave${tag}`;
  await prisma.leave.create({
    data: {
      id: leaveId,
      userId: users.OWNER.id,
      organizationId: orgId,
      startDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      note: `LEAVE NOTE OF TENANT ${tag}`,
    },
  });

  const delegationId = `${RUN}_delegation${tag}`;
  await prisma.taskDelegation.create({
    data: {
      id: delegationId,
      leaveId,
      issueId,
      originalAssigneeId: users.OWNER.id,
      delegateUserId: spare.id,
      startDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      reason: `DELEGATION REASON OF TENANT ${tag}`,
      createdBy: users.OWNER.id,
    },
  });

  return {
    orgId, workspaceId, projectId, projectKey, issueId, issueKey, teamId,
    spareUserId: spare.id,
    workflowId, statusId, statusInProgressId, statusDoneId, sprintId, epicId,
    commentId, subtaskId, componentId, customFieldId, attachmentId, webhookId, automationId,
    pbacRoleId, recurringTaskId, leaveId, delegationId,
    users,
  };
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
  // Leaf resources first: they reference the issue and the project.
  await prisma.attachment.deleteMany({ where: { id: like } });
  await prisma.comment.deleteMany({ where: { id: like } });
  await prisma.subtask.deleteMany({ where: { id: like } });
  await prisma.customField.deleteMany({ where: { id: like } });
  await prisma.automationRule.deleteMany({ where: { id: like } });
  await prisma.webhook.deleteMany({ where: { id: like } });
  // H4 rows. Delegations reference the issue and the leave, so they go before
  // both; history cascades from the delegation but is removed explicitly so a
  // test that created its own history row does not survive teardown.
  await prisma.delegationHistory.deleteMany({ where: { delegation: { issueId: like } } });
  await prisma.taskDelegation.deleteMany({ where: { issueId: like } });
  await prisma.recurringTask.deleteMany({ where: { projectId: like } });
  await prisma.issue.deleteMany({ where: { projectId: like } });
  await prisma.component.deleteMany({ where: { projectId: like } });
  // Sprints and epics are referenced BY issues, so they go after them.
  await prisma.sprint.deleteMany({ where: { projectId: like } });
  await prisma.epic.deleteMany({ where: { projectId: like } });
  await prisma.workflowTransition.deleteMany({ where: { workflow: { projectId: like } } });
  await prisma.workflowStatus.deleteMany({ where: { workflow: { projectId: like } } });
  await prisma.workflow.deleteMany({ where: { projectId: like } });
  await prisma.teamMember.deleteMany({ where: { teamId: like } });
  await prisma.team.deleteMany({ where: { id: like } });
  await prisma.projectMember.deleteMany({ where: { projectId: like } });
  await prisma.project.deleteMany({ where: { id: like } });
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: like } });
  await prisma.workspace.deleteMany({ where: { id: like } });
  await prisma.leave.deleteMany({ where: { organizationId: like } });
  await prisma.pbacUserRoleAssignment.deleteMany({ where: { orgId: like } });
  await prisma.pbacRole.deleteMany({ where: { orgId: like } });
  await prisma.pbacAuditRecord.deleteMany({ where: { orgId: like } });
  await prisma.pbacOrgState.deleteMany({ where: { orgId: like } });
  await prisma.organizationMember.deleteMany({ where: { orgId: like } });
  await prisma.session.deleteMany({ where: { id: like } });
  await prisma.user.deleteMany({ where: { id: like } });
  await prisma.organization.deleteMany({ where: { id: like } });
}
