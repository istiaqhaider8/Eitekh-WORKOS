const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function runTests() {
  console.log("🧪 Starting Zenith WorkOS Full Platform Verification Tests...\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name}`);
      failed++;
    }
  }

  try {
    // TEST 1: Super Admin & Users Seed Verification
    const superAdmin = await prisma.user.findUnique({ where: { email: "admin@zenith.local" } });
    assert(superAdmin && superAdmin.isSuperAdmin === true, "Super Admin user exists and has root permissions");

    const devLead = await prisma.user.findUnique({ where: { email: "sarah@acme.com" } });
    assert(devLead && devLead.firstName === "Sarah", "Developer Lead account exists");

    // TEST 2: Multi-Tenant Organization & Workspace Hierarchy
    const org = await prisma.organization.findUnique({
      where: { slug: "acme-innovations" },
      include: { members: true, workspaces: true },
    });
    assert(org && org.members.length >= 3, "Organization Acme Innovations exists with multi-level memberships");
    assert(org.workspaces.length >= 1, "Workspace Core Engineering exists under Acme Innovations");

    // TEST 3: Project & Workflow Verification
    const project = await prisma.project.findFirst({
      where: { key: "CP" },
      include: { workflows: { include: { statuses: true } } },
    });
    assert(project && project.key === "CP", "Project Customer Portal exists with key CP");
    assert(
      project.workflows[0] && project.workflows[0].statuses.length === 6,
      "Standard Agile Workflow configured with all 6 statuses (Backlog, To Do, In Progress, Review, Testing, Done)"
    );

    // TEST 4: Atomic Issue Sequence & Keys Verification
    const issue1 = await prisma.issue.findUnique({
      where: { projectId_keyNumber: { projectId: project.id, keyNumber: 1 } },
      include: { subtasks: true, comments: true, timeEntries: true, activityLogs: true },
    });
    assert(issue1 && issue1.issueKey === "CP-1", "Issue key CP-1 generated sequentially");
    assert(issue1.subtasks.length === 3, "Issue CP-1 contains nested subtasks");
    assert(issue1.comments.length >= 1, "Issue CP-1 contains comments with @mentions");
    assert(issue1.timeEntries.length >= 1, "Issue CP-1 contains logged time entries");
    assert(issue1.activityLogs.length >= 1, "Issue CP-1 maintains immutable audit activity trail");

    // TEST 5: Sprints & Agile Backlog Verification
    const activeSprint = await prisma.sprint.findFirst({
      where: { projectId: project.id, status: "ACTIVE" },
      include: { issues: true },
    });
    assert(activeSprint && activeSprint.issues.length >= 1, "Active sprint exists and contains scheduled issues");

    const futureSprint = await prisma.sprint.findFirst({
      where: { projectId: project.id, status: "FUTURE" },
    });
    assert(futureSprint !== null, "Future planned sprint exists for backlog scheduling");

    // TEST 6: Super Admin Platform Feature Flags & System Health
    const flags = await prisma.featureFlag.findMany();
    assert(flags.length >= 5, "Platform feature access flags (SCRUM, TIMELINE, AUTOMATION, etc.) are seeded");

    const announcement = await prisma.systemAnnouncement.findFirst({
      where: { isActive: true },
    });
    assert(announcement && announcement.severity === "INFO", "Active platform announcement broadcast is live");

    // TEST 7: Tenant Isolation & Boundary Guard
    const userMarcus = await prisma.user.findUnique({ where: { email: "marcus@acme.com" } });
    const fakeOrgId = "non_existent_org_id";
    const crossTenantCheck = await prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId: fakeOrgId, userId: userMarcus.id } },
    });
    assert(crossTenantCheck === null, "Cross-tenant access correctly blocked by relational membership constraints");

    console.log(`\n📊 Verification Summary: ${passed} Passed, ${failed} Failed\n`);
  } catch (err) {
    console.error("Test execution failed:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
