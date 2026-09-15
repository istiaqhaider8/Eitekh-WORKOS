const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding Eitekh WorkOS database...");

  // 1. Clean existing records
  await prisma.activityLog.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.timeEntry.deleteMany();
  await prisma.subtask.deleteMany();
  await prisma.issueLabel.deleteMany();
  await prisma.label.deleteMany();
  await prisma.issueDependency.deleteMany();
  await prisma.customFieldValue.deleteMany();
  await prisma.customField.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.sprint.deleteMany();
  await prisma.epic.deleteMany();
  await prisma.component.deleteMany();
  await prisma.workflowTransition.deleteMany();
  await prisma.workflowStatus.deleteMany();
  await prisma.workflow.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.team.deleteMany();
  await prisma.workspaceMember.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.organizationMember.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.session.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.featureFlag.deleteMany();
  await prisma.systemAnnouncement.deleteMany();
  await prisma.platformAuditLog.deleteMany();
  await prisma.user.deleteMany();

  // 2. Create Users
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const adminPasswordHash = await bcrypt.hash("AdminPass123!", 10);

  const superAdmin = await prisma.user.create({
    data: {
      email: "cocofbd@gmail.com",
      passwordHash: adminPasswordHash,
      firstName: "Super",
      lastName: "Administrator",
      jobTitle: "Platform Admin",
      isSuperAdmin: true,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  const orgOwner = await prisma.user.create({
    data: {
      email: "alex@acme.com",
      passwordHash,
      firstName: "Alex",
      lastName: "Morgan",
      jobTitle: "VP of Engineering",
      company: "Acme Innovations",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  const devLead = await prisma.user.create({
    data: {
      email: "sarah@acme.com",
      passwordHash,
      firstName: "Sarah",
      lastName: "Chen",
      jobTitle: "Lead Software Architect",
      company: "Acme Innovations",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  const developer = await prisma.user.create({
    data: {
      email: "marcus@acme.com",
      passwordHash,
      firstName: "Marcus",
      lastName: "Vance",
      jobTitle: "Fullstack Engineer",
      company: "Acme Innovations",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  // 3. Create Organization
  const org = await prisma.organization.create({
    data: {
      name: "Acme Innovations",
      slug: "acme-innovations",
      domain: "acme.com",
      timezone: "America/New_York",
      language: "en",
      dateFormat: "YYYY-MM-DD",
      status: "ACTIVE",
      members: {
        create: [
          { userId: orgOwner.id, role: "OWNER" },
          { userId: devLead.id, role: "ADMIN" },
          { userId: developer.id, role: "MEMBER" },
        ],
      },
    },
  });

  // 4. Create Workspace
  const workspace = await prisma.workspace.create({
    data: {
      orgId: org.id,
      name: "Core Engineering",
      slug: "core-engineering",
      description: "Primary workspace for engineering, design, and product management",
      members: {
        create: [
          { userId: orgOwner.id, role: "WORKSPACE_ADMIN" },
          { userId: devLead.id, role: "WORKSPACE_ADMIN" },
          { userId: developer.id, role: "MEMBER" },
        ],
      },
    },
  });

  // 5. Create Team
  const team = await prisma.team.create({
    data: {
      workspaceId: workspace.id,
      name: "Platform Architecture",
      description: "Core infrastructure, multi-tenancy, and distributed services",
      leadId: devLead.id,
      members: {
        create: [
          { userId: devLead.id, role: "LEAD" },
          { userId: developer.id, role: "MEMBER" },
          { userId: orgOwner.id, role: "MEMBER" },
        ],
      },
    },
  });

  // 6. Create Project
  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      teamId: team.id,
      name: "Customer Portal",
      key: "CP",
      description: "Next-generation customer experience platform and account management",
      ownerId: devLead.id,
      template: "SCRUM",
      status: "ACTIVE",
      priority: "HIGH",
      issueCounter: 5,
      startDate: new Date("2026-09-01"),
      targetDate: new Date("2026-12-31"),
      members: {
        create: [
          { userId: devLead.id, role: "PROJECT_ADMIN" },
          { userId: developer.id, role: "MEMBER" },
          { userId: orgOwner.id, role: "PROJECT_MANAGER" },
        ],
      },
    },
  });

  // 7. Create Workflow & Statuses
  const workflow = await prisma.workflow.create({
    data: {
      projectId: project.id,
      name: "Standard Agile Software Workflow",
      isDefault: true,
    },
  });

  const statusBacklog = await prisma.workflowStatus.create({
    data: { workflowId: workflow.id, name: "Backlog", category: "BACKLOG", color: "#64748b", position: 0 },
  });
  const statusToDo = await prisma.workflowStatus.create({
    data: { workflowId: workflow.id, name: "To Do", category: "TO_DO", color: "#3b82f6", position: 1 },
  });
  const statusInProgress = await prisma.workflowStatus.create({
    data: { workflowId: workflow.id, name: "In Progress", category: "IN_PROGRESS", color: "#f59e0b", position: 2, wipLimit: 5 },
  });
  const statusReview = await prisma.workflowStatus.create({
    data: { workflowId: workflow.id, name: "Code Review", category: "REVIEW", color: "#8b5cf6", position: 3, wipLimit: 3 },
  });
  const statusTesting = await prisma.workflowStatus.create({
    data: { workflowId: workflow.id, name: "QA Testing", category: "TESTING", color: "#ec4899", position: 4, wipLimit: 3 },
  });
  const statusDone = await prisma.workflowStatus.create({
    data: { workflowId: workflow.id, name: "Done", category: "DONE", color: "#10b981", position: 5 },
  });

  // 8. Create Epics & Sprints
  const epicAuth = await prisma.epic.create({
    data: {
      projectId: project.id,
      name: "Multi-Tenant Auth & Security",
      summary: "End-to-end enterprise authentication, RBAC, and session security",
      color: "#6366f1",
      ownerId: devLead.id,
      status: "ACTIVE",
      startDate: new Date("2026-09-01"),
      targetDate: new Date("2026-10-15"),
    },
  });

  const sprint1 = await prisma.sprint.create({
    data: {
      projectId: project.id,
      teamId: team.id,
      name: "Sprint 1: Core Foundation",
      goal: "Implement authentication, multi-tenant isolation, and initial Kanban board",
      startDate: new Date("2026-09-01"),
      endDate: new Date("2026-09-15"),
      status: "ACTIVE",
    },
  });

  const sprint2 = await prisma.sprint.create({
    data: {
      projectId: project.id,
      teamId: team.id,
      name: "Sprint 2: Agile Views & Reports",
      goal: "Ship Timeline Gantt view, Workload management, and Sprint completion flow",
      startDate: new Date("2026-09-16"),
      endDate: new Date("2026-09-30"),
      status: "FUTURE",
    },
  });

  // 9. Create Labels & Components
  const labelFrontend = await prisma.label.create({
    data: { projectId: project.id, name: "frontend", color: "#3b82f6" },
  });
  const labelBackend = await prisma.label.create({
    data: { projectId: project.id, name: "backend", color: "#10b981" },
  });
  const labelSecurity = await prisma.label.create({
    data: { projectId: project.id, name: "security", color: "#ef4444" },
  });

  const compAuth = await prisma.component.create({
    data: { projectId: project.id, name: "Authentication", description: "Identity and session handling", ownerId: devLead.id },
  });

  // 10. Create Issues
  const issue1 = await prisma.issue.create({
    data: {
      projectId: project.id,
      keyNumber: 1,
      issueKey: "CP-1",
      title: "Implement Multi-Tenant Session & RBAC Middleware",
      description: "Ensure that all API routes resolve organization context and block cross-tenant leakage.\n\n### Acceptance Criteria:\n- Verify tenant header / cookies\n- Validate role permissions\n- Unit test with multi-tenant fixtures",
      issueType: "STORY",
      statusId: statusInProgress.id,
      priority: "CRITICAL",
      reporterId: devLead.id,
      assigneeId: developer.id,
      epicId: epicAuth.id,
      sprintId: sprint1.id,
      componentId: compAuth.id,
      estimatePoints: 5,
      estimateHours: 16,
      remainingHours: 6,
      timeSpentHours: 10,
      startDate: new Date("2026-09-02"),
      dueDate: new Date("2026-09-10"),
      position: 1,
      labels: {
        create: [{ labelId: labelBackend.id }, { labelId: labelSecurity.id }],
      },
    },
  });

  const issue2 = await prisma.issue.create({
    data: {
      projectId: project.id,
      keyNumber: 2,
      issueKey: "CP-2",
      title: "Build Drag-and-Drop Kanban Board with Column WIP Limits",
      description: "Interactive visual board with smooth dragging between columns, displaying WIP badges and quick-add issue triggers.",
      issueType: "FEATURE",
      statusId: statusToDo.id,
      priority: "HIGH",
      reporterId: devLead.id,
      assigneeId: devLead.id,
      epicId: epicAuth.id,
      sprintId: sprint1.id,
      estimatePoints: 8,
      estimateHours: 24,
      remainingHours: 24,
      position: 2,
      labels: {
        create: [{ labelId: labelFrontend.id }],
      },
    },
  });

  const issue3 = await prisma.issue.create({
    data: {
      projectId: project.id,
      keyNumber: 3,
      issueKey: "CP-3",
      title: "Add Timeline Gantt View with Finish-to-Start Dependencies",
      description: "Visual schedule chart allowing users to draw dependency arrows and view critical paths.",
      issueType: "FEATURE",
      statusId: statusBacklog.id,
      priority: "MEDIUM",
      reporterId: orgOwner.id,
      estimatePoints: 13,
      position: 3,
    },
  });

  const issue4 = await prisma.issue.create({
    data: {
      projectId: project.id,
      keyNumber: 4,
      issueKey: "CP-4",
      title: "Setup Platform Super Admin Governance & Audit Logging",
      description: "Super Admin dashboard with platform-wide health metrics, tenant suspension control, and feature flag management.",
      issueType: "TASK",
      statusId: statusDone.id,
      priority: "HIGH",
      reporterId: superAdmin.id,
      assigneeId: devLead.id,
      estimatePoints: 3,
      timeSpentHours: 8,
      position: 4,
      labels: {
        create: [{ labelId: labelSecurity.id }],
      },
    },
  });

  // 11. Create Subtasks for Issue 1
  await prisma.subtask.createMany({
    data: [
      { parentIssueId: issue1.id, title: "Design tenant context resolver", assigneeId: developer.id, isCompleted: true, status: "DONE" },
      { parentIssueId: issue1.id, title: "Add RBAC permission check middleware", assigneeId: developer.id, isCompleted: true, status: "DONE" },
      { parentIssueId: issue1.id, title: "Implement session revocation endpoint", assigneeId: developer.id, isCompleted: false, status: "IN_PROGRESS" },
    ],
  });

  // 12. Create Comments & Activity
  await prisma.comment.create({
    data: {
      issueId: issue1.id,
      userId: devLead.id,
      content: "Great progress @marcus! Please verify that guest users cannot query organization settings.",
    },
  });

  await prisma.activityLog.create({
    data: {
      issueId: issue1.id,
      actorId: developer.id,
      actionType: "UPDATED_STATUS",
      fieldChanged: "status",
      oldValue: "To Do",
      newValue: "In Progress",
    },
  });

  await prisma.timeEntry.create({
    data: {
      issueId: issue1.id,
      userId: developer.id,
      durationMinutes: 240,
      description: "Built JWT session decoder and cookies middleware",
    },
  });

  // 13. Super Admin Feature Flags
  await prisma.featureFlag.createMany({
    data: [
      { key: "SCRUM", description: "Enables sprint management and burndown reports", isGlobalEnabled: true },
      { key: "TIMELINE", description: "Enables interactive Gantt timeline views", isGlobalEnabled: true },
      { key: "AUTOMATION", description: "Enables trigger-condition-action automation engine", isGlobalEnabled: true },
      { key: "CUSTOM_FIELDS", description: "Allows creating workspace and project custom attributes", isGlobalEnabled: true },
      { key: "AI_ASSISTANT", description: "AI-assisted issue summaries and planning suggestions", isGlobalEnabled: true },
      { key: "WEBHOOKS", description: "Outbound webhook dispatch on issue events", isGlobalEnabled: true },
    ],
  });

  // 14. System Announcement
  await prisma.systemAnnouncement.create({
    data: {
      title: "Eitekh WorkOS Platform Online",
      message: "Welcome to Eitekh WorkOS v1.0. All services, multi-tenant boundaries, and real-time boards are running nominally.",
      severity: "INFO",
      targetAudience: "ALL",
      isActive: true,
    },
  });

  console.log("✅ Seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
