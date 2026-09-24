/**
 * seed-demo-data.mjs — Comprehensive demo data for client demonstrations.
 *
 * ADDITIVE: runs on top of the base seed (prisma/seed.js). Does NOT delete
 * existing data — the base seed already created the super-admin, Acme org,
 * Customer Portal project, etc. This script adds four more projects, eight
 * more users, three more teams, hundreds of issues, comments, time entries,
 * dependencies, custom fields, automations, webhooks, and notifications.
 *
 * Usage:
 *   node scripts/seed-demo-data.mjs
 *
 * Prerequisites:
 *   - Postgres running on 54329 (node scripts/dev-postgres.mjs)
 *   - Base seed already applied (node prisma/seed.js)
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────────────

function d(offset) {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt;
}
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

const PRIORITIES = ["CRITICAL", "HIGHEST", "HIGH", "MEDIUM", "LOW", "LOWEST"];
const ISSUE_TYPES = ["TASK", "BUG", "STORY", "FEATURE", "INCIDENT"];

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Loading comprehensive demo data...\n");

  // ── 1. Fetch existing records ──────────────────────────────────────
  const superAdmin = await prisma.user.findFirst({ where: { isSuperAdmin: true } });
  const existingOrg = await prisma.organization.findFirst();
  const existingWorkspace = await prisma.workspace.findFirst();
  const existingUsers = await prisma.user.findMany();

  if (!superAdmin || !existingOrg || !existingWorkspace) {
    console.error("❌ Base seed not found. Run `node prisma/seed.js` first.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash("Password123!", 10);

  // ── 2. Create additional users ─────────────────────────────────────
  console.log("👥 Creating users...");
  const newUsers = [];
  const userDefs = [
    { email: "emma@acme.com", firstName: "Emma", lastName: "Rodriguez", jobTitle: "Senior Frontend Developer" },
    { email: "james@acme.com", firstName: "James", lastName: "Park", jobTitle: "Backend Engineer" },
    { email: "priya@acme.com", firstName: "Priya", lastName: "Sharma", jobTitle: "QA Lead" },
    { email: "david@acme.com", firstName: "David", lastName: "Kim", jobTitle: "DevOps Engineer" },
    { email: "lisa@acme.com", firstName: "Lisa", lastName: "Thompson", jobTitle: "Product Manager" },
    { email: "omar@acme.com", firstName: "Omar", lastName: "Hassan", jobTitle: "UX Designer" },
    { email: "nina@acme.com", firstName: "Nina", lastName: "Petrov", jobTitle: "Data Engineer" },
    { email: "carlos@acme.com", firstName: "Carlos", lastName: "Mendez", jobTitle: "Mobile Developer" },
  ];

  for (const u of userDefs) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (existing) {
      newUsers.push(existing);
    } else {
      const created = await prisma.user.create({
        data: {
          ...u,
          passwordHash,
          company: "Acme Innovations",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });
      newUsers.push(created);
    }
  }

  const allUsers = [...existingUsers, ...newUsers];
  // Filter to only non-superadmin users for assignment
  const assignableUsers = allUsers.filter(u => !u.isSuperAdmin);

  // ── 3. Add new users to org ────────────────────────────────────────
  console.log("🏢 Adding users to organization...");
  for (const u of newUsers) {
    await prisma.organizationMember.upsert({
      where: { orgId_userId: { orgId: existingOrg.id, userId: u.id } },
      update: {},
      create: { orgId: existingOrg.id, userId: u.id, role: "MEMBER" },
    });
  }

  // ── 4. Add new users to workspace ──────────────────────────────────
  console.log("📂 Adding users to workspace...");
  for (const u of newUsers) {
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: existingWorkspace.id, userId: u.id } },
      update: {},
      create: { workspaceId: existingWorkspace.id, userId: u.id, role: "MEMBER" },
    });
  }

  // ── 5. Create additional teams ─────────────────────────────────────
  console.log("👥 Creating teams...");
  const teamDefs = [
    { name: "Frontend Guild", description: "UI/UX implementation and component library", leadIdx: 0, memberIdxs: [0, 5, 7] },
    { name: "Backend Services", description: "API development, database, and integrations", leadIdx: 1, memberIdxs: [1, 3, 6] },
    { name: "Quality Assurance", description: "Testing, automation, and release validation", leadIdx: 2, memberIdxs: [2, 4] },
  ];

  const teams = [];
  for (const t of teamDefs) {
    const existing = await prisma.team.findFirst({ where: { name: t.name, workspaceId: existingWorkspace.id } });
    if (existing) {
      teams.push(existing);
      continue;
    }
    const team = await prisma.team.create({
      data: {
        workspaceId: existingWorkspace.id,
        name: t.name,
        description: t.description,
        leadId: newUsers[t.leadIdx].id,
        members: {
          create: [
            { userId: newUsers[t.leadIdx].id, role: "LEAD" },
            ...t.memberIdxs.filter(i => i !== t.leadIdx).map(i => ({ userId: newUsers[i].id, role: "MEMBER" })),
          ],
        },
      },
    });
    teams.push(team);
  }

  // ── 6. Create projects ─────────────────────────────────────────────
  console.log("📋 Creating projects...");

  const projectDefs = [
    {
      name: "Project ATLAS", key: "ATLAS", template: "SCRUM",
      description: "Enterprise resource planning module — inventory, procurement, and warehouse management",
      status: "ACTIVE", priority: "CRITICAL",
      ownerIdx: 4, teamIdx: 1,
      startDate: d(-45), targetDate: d(90),
    },
    {
      name: "Project HELIOS", key: "HELIOS", template: "KANBAN",
      description: "Real-time analytics dashboard with streaming data visualization and alerting",
      status: "ACTIVE", priority: "HIGH",
      ownerIdx: 0, teamIdx: 0,
      startDate: d(-30), targetDate: d(60),
    },
    {
      name: "Project NOVA", key: "NOVA", template: "SCRUM",
      description: "Mobile-first field service management — work orders, scheduling, and GPS tracking",
      status: "ACTIVE", priority: "HIGH",
      ownerIdx: 7, teamIdx: 1,
      startDate: d(-15), targetDate: d(120),
    },
    {
      name: "Project ORION", key: "ORION", template: "SCRUM",
      description: "AI-powered customer support platform with ticket routing, SLA tracking, and knowledge base",
      status: "PLANNING", priority: "MEDIUM",
      ownerIdx: 4, teamIdx: 2,
      startDate: d(0), targetDate: d(180),
    },
  ];

  const projects = [];
  for (const pDef of projectDefs) {
    const existing = await prisma.project.findFirst({
      where: { key: pDef.key, workspaceId: existingWorkspace.id },
    });
    if (existing) {
      projects.push(existing);
      continue;
    }

    const project = await prisma.project.create({
      data: {
        workspaceId: existingWorkspace.id,
        teamId: teams[pDef.teamIdx].id,
        name: pDef.name,
        key: pDef.key,
        description: pDef.description,
        ownerId: newUsers[pDef.ownerIdx].id,
        template: pDef.template,
        status: pDef.status,
        priority: pDef.priority,
        issueCounter: 0,
        startDate: pDef.startDate,
        targetDate: pDef.targetDate,
      },
    });
    projects.push(project);

    // Add members to each project
    const memberUsers = [newUsers[pDef.ownerIdx], ...assignableUsers.slice(0, 6)];
    const uniqueMembers = [...new Map(memberUsers.map(u => [u.id, u])).values()];
    for (let i = 0; i < uniqueMembers.length; i++) {
      await prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: project.id, userId: uniqueMembers[i].id } },
        update: {},
        create: {
          projectId: project.id,
          userId: uniqueMembers[i].id,
          role: i === 0 ? "PROJECT_ADMIN" : i < 3 ? "PROJECT_MANAGER" : "MEMBER",
        },
      });
    }
  }

  // ── 7. Create workflows, statuses, and transitions for each project ─
  console.log("🔄 Creating workflows...");

  const statusDefs = [
    { name: "Backlog", category: "BACKLOG", color: "#64748b", position: 0 },
    { name: "To Do", category: "TO_DO", color: "#3b82f6", position: 1 },
    { name: "In Progress", category: "IN_PROGRESS", color: "#f59e0b", position: 2, wipLimit: 5 },
    { name: "Code Review", category: "REVIEW", color: "#8b5cf6", position: 3, wipLimit: 3 },
    { name: "QA Testing", category: "TESTING", color: "#ec4899", position: 4, wipLimit: 3 },
    { name: "Done", category: "DONE", color: "#10b981", position: 5 },
  ];

  const projectWorkflows = {};
  for (const project of projects) {
    const existingWf = await prisma.workflow.findFirst({ where: { projectId: project.id } });
    if (existingWf) {
      const statuses = await prisma.workflowStatus.findMany({ where: { workflowId: existingWf.id }, orderBy: { position: "asc" } });
      projectWorkflows[project.id] = { workflow: existingWf, statuses };
      continue;
    }

    const workflow = await prisma.workflow.create({
      data: { projectId: project.id, name: "Standard Agile Workflow", isDefault: true },
    });

    const statuses = [];
    for (const sd of statusDefs) {
      const s = await prisma.workflowStatus.create({
        data: { workflowId: workflow.id, ...sd },
      });
      statuses.push(s);
    }

    // Create transitions (each status can move to any other)
    for (let i = 0; i < statuses.length; i++) {
      for (let j = 0; j < statuses.length; j++) {
        if (i !== j) {
          await prisma.workflowTransition.create({
            data: { workflowId: workflow.id, fromStatusId: statuses[i].id, toStatusId: statuses[j].id },
          });
        }
      }
    }

    projectWorkflows[project.id] = { workflow, statuses };
  }

  // ── 8. Create epics for each project ───────────────────────────────
  console.log("🎯 Creating epics...");

  const epicDefs = {
    ATLAS: [
      { name: "Inventory Management", summary: "Real-time stock tracking, warehouse zones, and automated reorder points", color: "#ef4444" },
      { name: "Procurement Workflow", summary: "Purchase requisitions, vendor management, and approval chains", color: "#3b82f6" },
      { name: "Reporting & Analytics", summary: "Business intelligence dashboards and automated report generation", color: "#10b981" },
    ],
    HELIOS: [
      { name: "Dashboard Framework", summary: "Responsive widget grid with drag-and-drop layout customization", color: "#f59e0b" },
      { name: "Data Connectors", summary: "Real-time streaming adapters for Kafka, MQTT, and REST APIs", color: "#8b5cf6" },
      { name: "Alert Engine", summary: "Configurable threshold alerts with escalation and notification routing", color: "#ef4444" },
    ],
    NOVA: [
      { name: "Work Order System", summary: "Create, assign, and track field service work orders end-to-end", color: "#06b6d4" },
      { name: "Scheduling Engine", summary: "AI-assisted technician scheduling with route optimization", color: "#f97316" },
      { name: "Mobile App", summary: "Offline-capable PWA for field technicians with GPS and photo capture", color: "#84cc16" },
    ],
    ORION: [
      { name: "Ticket Management", summary: "Multi-channel ticket intake, categorization, and routing", color: "#6366f1" },
      { name: "Knowledge Base", summary: "Self-service help center with full-text search and AI suggestions", color: "#14b8a6" },
      { name: "SLA Framework", summary: "Response/resolution time targets with breach alerting and escalation", color: "#e11d48" },
    ],
  };

  const projectEpics = {};
  for (const project of projects) {
    const defs = epicDefs[project.key] || [];
    const epics = [];
    for (const eDef of defs) {
      const existing = await prisma.epic.findFirst({ where: { projectId: project.id, name: eDef.name } });
      if (existing) { epics.push(existing); continue; }
      const epic = await prisma.epic.create({
        data: {
          projectId: project.id,
          name: eDef.name,
          summary: eDef.summary,
          color: eDef.color,
          ownerId: rand(assignableUsers).id,
          status: "ACTIVE",
          startDate: d(randInt(-30, -5)),
          targetDate: d(randInt(30, 90)),
        },
      });
      epics.push(epic);
    }
    projectEpics[project.id] = epics;
  }

  // ── 9. Create sprints for each project ─────────────────────────────
  console.log("🏃 Creating sprints...");

  const projectSprints = {};
  for (const project of projects) {
    const existingSprints = await prisma.sprint.findMany({ where: { projectId: project.id } });
    if (existingSprints.length >= 3) {
      projectSprints[project.id] = existingSprints;
      continue;
    }

    const sprints = [];
    const sprintDefs = [
      { name: `${project.key} Sprint 1: Foundation`, goal: "Core infrastructure, data models, and base UI", status: "COMPLETED", offset: -28, completedPoints: randInt(20, 35) },
      { name: `${project.key} Sprint 2: Core Features`, goal: "Primary feature implementation and integration", status: "ACTIVE", offset: -14 },
      { name: `${project.key} Sprint 3: Polish & Testing`, goal: "Bug fixes, performance optimization, and QA", status: "FUTURE", offset: 0 },
      { name: `${project.key} Sprint 4: Release Prep`, goal: "Final testing, documentation, and deployment preparation", status: "FUTURE", offset: 14 },
    ];

    for (let i = 0; i < sprintDefs.length; i++) {
      const sd = sprintDefs[i];
      const sprint = await prisma.sprint.create({
        data: {
          projectId: project.id,
          teamId: project.teamId,
          name: sd.name,
          goal: sd.goal,
          startDate: d(sd.offset),
          endDate: d(sd.offset + 14),
          status: sd.status,
          position: i,
          plannedPoints: randInt(25, 40),
          completedPoints: sd.completedPoints || null,
          completedAt: sd.status === "COMPLETED" ? d(sd.offset + 14) : null,
        },
      });
      sprints.push(sprint);
    }
    projectSprints[project.id] = sprints;
  }

  // ── 10. Create labels for each project ─────────────────────────────
  console.log("🏷️  Creating labels...");

  const labelDefs = [
    { name: "frontend", color: "#3b82f6" },
    { name: "backend", color: "#10b981" },
    { name: "security", color: "#ef4444" },
    { name: "performance", color: "#f59e0b" },
    { name: "documentation", color: "#6b7280" },
    { name: "ux", color: "#8b5cf6" },
    { name: "infrastructure", color: "#06b6d4" },
    { name: "bug-fix", color: "#ec4899" },
  ];

  const projectLabels = {};
  for (const project of projects) {
    const labels = [];
    for (const ld of labelDefs) {
      const existing = await prisma.label.findFirst({ where: { projectId: project.id, name: ld.name } });
      if (existing) { labels.push(existing); continue; }
      const label = await prisma.label.create({
        data: { projectId: project.id, name: ld.name, color: ld.color },
      });
      labels.push(label);
    }
    projectLabels[project.id] = labels;
  }

  // ── 11. Create components for each project ─────────────────────────
  console.log("🧩 Creating components...");

  const componentDefs = {
    ATLAS: ["Inventory Module", "Procurement Module", "Warehouse API", "Reports Engine"],
    HELIOS: ["Widget Framework", "Data Pipeline", "Alert Service", "Dashboard UI"],
    NOVA: ["Work Order API", "Scheduling Service", "Mobile PWA", "GPS Integration"],
    ORION: ["Ticket Router", "Knowledge Base", "SLA Monitor", "Chat Widget"],
  };

  const projectComponents = {};
  for (const project of projects) {
    const defs = componentDefs[project.key] || [];
    const components = [];
    for (const name of defs) {
      const existing = await prisma.component.findFirst({ where: { projectId: project.id, name } });
      if (existing) { components.push(existing); continue; }
      const comp = await prisma.component.create({
        data: { projectId: project.id, name, description: `${name} component`, ownerId: rand(assignableUsers).id },
      });
      components.push(comp);
    }
    projectComponents[project.id] = components;
  }

  // ── 12. Create issues for each project ─────────────────────────────
  console.log("📝 Creating issues (this may take a moment)...");

  const issueTitles = {
    ATLAS: [
      "Design inventory data model with SKU hierarchy",
      "Implement real-time stock level tracking API",
      "Build warehouse zone management UI",
      "Add barcode scanner integration",
      "Create purchase requisition workflow",
      "Implement vendor onboarding portal",
      "Build approval chain engine for POs",
      "Design inventory movement audit trail",
      "Add automated reorder point calculations",
      "Implement multi-warehouse transfer logic",
      "Build receiving dock inspection form",
      "Create inventory valuation reports (FIFO/LIFO)",
      "Add lot tracking and expiry management",
      "Implement cycle count scheduling",
      "Build supplier performance dashboard",
      "Add purchase order line-item matching",
      "Create demand forecasting algorithm",
      "Implement safety stock optimization",
      "Build warehouse capacity planning view",
      "Add inventory discrepancy resolution workflow",
      "Create ABC classification engine",
      "Implement goods receipt note generation",
      "Build pick/pack/ship workflow",
      "Add inventory snapshot and rollback",
      "Create material requirements planning module",
    ],
    HELIOS: [
      "Build responsive dashboard grid layout",
      "Implement real-time data streaming connector",
      "Create customizable widget library",
      "Add drag-and-drop dashboard builder",
      "Implement threshold-based alert rules",
      "Build notification routing engine",
      "Create time-series chart component",
      "Add KPI scoreboard widget",
      "Implement data aggregation pipeline",
      "Build alert escalation workflow",
      "Create dashboard sharing and embedding",
      "Add geographical heat map widget",
      "Implement data source connection wizard",
      "Build real-time gauge and meter widgets",
      "Create automated report scheduler",
      "Add dashboard template marketplace",
      "Implement WebSocket data streaming",
      "Build anomaly detection alerts",
      "Create multi-tenant dashboard isolation",
      "Add custom formula builder for metrics",
      "Implement snapshot and comparison views",
      "Build data drill-down navigation",
      "Add mobile-responsive dashboard mode",
      "Create PDF/Excel export for dashboards",
      "Implement role-based dashboard access control",
    ],
    NOVA: [
      "Design work order lifecycle state machine",
      "Implement technician assignment algorithm",
      "Build offline-capable mobile interface",
      "Add GPS tracking and route visualization",
      "Create customer appointment scheduling",
      "Implement parts inventory for field kits",
      "Build inspection checklist builder",
      "Add photo/video capture and annotation",
      "Create service history timeline view",
      "Implement SLA countdown timers",
      "Build technician availability calendar",
      "Add customer signature capture",
      "Create work order template library",
      "Implement multi-stop route optimization",
      "Build field service KPI dashboard",
      "Add push notification engine",
      "Create equipment maintenance scheduler",
      "Implement skill-based technician matching",
      "Build customer satisfaction survey flow",
      "Add real-time dispatch board",
      "Create warranty tracking system",
      "Implement recurring maintenance plans",
      "Build asset QR code management",
      "Add travel time estimation",
      "Create invoicing from work order completion",
    ],
    ORION: [
      "Design multi-channel ticket intake system",
      "Implement AI-powered ticket categorization",
      "Build ticket queue management UI",
      "Add email-to-ticket conversion pipeline",
      "Create SLA policy configuration",
      "Implement response time tracking",
      "Build knowledge base article editor",
      "Add full-text search with AI suggestions",
      "Create ticket merging and linking",
      "Implement customer portal with self-service",
      "Build agent performance analytics",
      "Add canned response template library",
      "Create ticket escalation rules engine",
      "Implement live chat widget",
      "Build CSAT and NPS survey integration",
      "Add ticket collision detection",
      "Create bulk ticket operations",
      "Implement auto-assignment round-robin",
      "Build SLA breach notification system",
      "Add ticket time tracking",
      "Create help center theme customization",
      "Implement article version control",
      "Build chatbot conversation builder",
      "Add ticket sentiment analysis",
      "Create reporting and export module",
    ],
  };

  const allCreatedIssues = {};

  for (const project of projects) {
    const titles = issueTitles[project.key] || [];
    const wf = projectWorkflows[project.id];
    const sprints = projectSprints[project.id] || [];
    const epics = projectEpics[project.id] || [];
    const labels = projectLabels[project.id] || [];
    const components = projectComponents[project.id] || [];
    const issues = [];

    // Check current issue counter
    const currentProject = await prisma.project.findUnique({ where: { id: project.id } });
    let counter = currentProject.issueCounter || 0;

    for (let i = 0; i < titles.length; i++) {
      counter++;
      const issueKey = `${project.key}-${counter}`;
      const statusIdx = randInt(0, wf.statuses.length - 1);
      const statusId = wf.statuses[statusIdx].id;
      const isDone = wf.statuses[statusIdx].category === "DONE";
      const assignee = rand(assignableUsers);
      const sprint = sprints.length > 0 ? rand(sprints) : null;
      const epic = epics.length > 0 ? rand(epics) : null;
      const component = components.length > 0 ? rand(components) : null;
      const points = rand([1, 2, 3, 5, 8, 13]);
      const hours = points * randInt(2, 6);
      const spent = isDone ? hours : randInt(0, Math.floor(hours * 0.7));

      const issue = await prisma.issue.create({
        data: {
          projectId: project.id,
          keyNumber: counter,
          issueKey,
          title: titles[i],
          description: `### Overview\n${titles[i]}\n\n### Acceptance Criteria\n- [ ] Feature implemented and tested\n- [ ] Code review passed\n- [ ] Documentation updated\n- [ ] Performance benchmarked`,
          issueType: rand(ISSUE_TYPES),
          statusId,
          priority: rand(PRIORITIES),
          reporterId: rand(assignableUsers).id,
          assigneeId: assignee.id,
          teamId: project.teamId,
          epicId: epic?.id || null,
          sprintId: sprint?.id || null,
          componentId: component?.id || null,
          estimatePoints: points,
          estimateHours: hours,
          remainingHours: isDone ? 0 : Math.max(0, hours - spent),
          timeSpentHours: spent,
          startDate: d(randInt(-30, -1)),
          dueDate: d(randInt(1, 45)),
          completedAt: isDone ? d(randInt(-10, -1)) : null,
          position: i + 1,
        },
      });
      issues.push(issue);

      // Add 1-2 labels per issue
      const issueLabels = [rand(labels), rand(labels)].filter((v, i, a) => a.indexOf(v) === i);
      for (const lb of issueLabels) {
        await prisma.issueLabel.upsert({
          where: { issueId_labelId: { issueId: issue.id, labelId: lb.id } },
          update: {},
          create: { issueId: issue.id, labelId: lb.id },
        });
      }
    }

    // Update project issue counter
    await prisma.project.update({
      where: { id: project.id },
      data: { issueCounter: counter },
    });

    allCreatedIssues[project.id] = issues;
  }

  // ── 13. Create subtasks ────────────────────────────────────────────
  console.log("📋 Creating subtasks...");

  for (const project of projects) {
    const issues = allCreatedIssues[project.id] || [];
    // Add subtasks to first 10 issues of each project
    for (let i = 0; i < Math.min(10, issues.length); i++) {
      const subtaskCount = randInt(2, 5);
      const subtaskTitles = [
        "Research and technical design",
        "Implement core logic",
        "Write unit tests",
        "Update documentation",
        "Code review fixes",
        "Integration testing",
        "Performance optimization",
      ];
      for (let s = 0; s < subtaskCount; s++) {
        const completed = Math.random() > 0.4;
        await prisma.subtask.create({
          data: {
            parentIssueId: issues[i].id,
            title: subtaskTitles[s % subtaskTitles.length],
            assigneeId: rand(assignableUsers).id,
            status: completed ? "DONE" : rand(["TO_DO", "IN_PROGRESS"]),
            priority: rand(PRIORITIES),
            isCompleted: completed,
            estimateHours: randInt(1, 8),
            dueDate: d(randInt(1, 30)),
          },
        });
      }
    }
  }

  // ── 14. Create comments ────────────────────────────────────────────
  console.log("💬 Creating comments...");

  const commentTemplates = [
    "Great progress on this! Let me know if you need help with the API integration.",
    "I've reviewed the design doc — looks solid. One concern: we should add rate limiting.",
    "Tested on staging and found an edge case with null values. Adding a regression test.",
    "Moving this to QA. All acceptance criteria met, code review complete.",
    "Updated the implementation based on feedback. Please re-review when you get a chance.",
    "This is blocked by the authentication service migration. Waiting for ATLAS-12.",
    "Performance benchmarks look good — 95th percentile under 200ms for this endpoint.",
    "Added error handling for the new edge cases. Also improved the error messages.",
    "Can we schedule a design review for the UI changes? I have some suggestions.",
    "Deployed to staging. Let's do a quick smoke test before moving to production.",
    "The data model changes look correct. Schema migration tested on a copy of prod data.",
    "Fixed the flaky test — it was a race condition in the async handler.",
  ];

  for (const project of projects) {
    const issues = allCreatedIssues[project.id] || [];
    for (let i = 0; i < Math.min(15, issues.length); i++) {
      const commentCount = randInt(1, 4);
      for (let c = 0; c < commentCount; c++) {
        await prisma.comment.create({
          data: {
            issueId: issues[i].id,
            userId: rand(assignableUsers).id,
            content: rand(commentTemplates),
          },
        });
      }
    }
  }

  // ── 15. Create time entries ────────────────────────────────────────
  console.log("⏱️  Creating time entries...");

  for (const project of projects) {
    const issues = allCreatedIssues[project.id] || [];
    for (let i = 0; i < Math.min(20, issues.length); i++) {
      const entryCount = randInt(1, 3);
      for (let t = 0; t < entryCount; t++) {
        await prisma.timeEntry.create({
          data: {
            issueId: issues[i].id,
            userId: issues[i].assigneeId || rand(assignableUsers).id,
            durationMinutes: randInt(30, 480),
            workDate: d(randInt(-14, 0)),
            description: rand([
              "Implementation work", "Bug investigation", "Code review",
              "Testing and debugging", "Documentation", "Design review",
              "Pair programming session", "Performance profiling",
            ]),
          },
        });
      }
    }
  }

  // ── 16. Create dependencies between issues ─────────────────────────
  console.log("🔗 Creating issue dependencies...");

  for (const project of projects) {
    const issues = allCreatedIssues[project.id] || [];
    for (let i = 1; i < Math.min(12, issues.length); i += 2) {
      await prisma.issueDependency.create({
        data: {
          sourceIssueId: issues[i - 1].id,
          targetIssueId: issues[i].id,
          type: rand(["BLOCKS", "FINISH_TO_START", "RELATES_TO"]),
        },
      }).catch(() => { /* skip duplicates */ });
    }
  }

  // ── 17. Create activity logs ───────────────────────────────────────
  console.log("📊 Creating activity logs...");

  const activityTypes = ["CREATED", "UPDATED_STATUS", "UPDATED_ASSIGNEE", "UPDATED_PRIORITY", "COMMENTED"];

  for (const project of projects) {
    const issues = allCreatedIssues[project.id] || [];
    for (let i = 0; i < Math.min(20, issues.length); i++) {
      const logCount = randInt(2, 5);
      for (let a = 0; a < logCount; a++) {
        const actionType = rand(activityTypes);
        await prisma.activityLog.create({
          data: {
            issueId: issues[i].id,
            actorId: rand(assignableUsers).id,
            actionType,
            fieldChanged: actionType === "UPDATED_STATUS" ? "status" : actionType === "UPDATED_PRIORITY" ? "priority" : null,
            oldValue: actionType === "UPDATED_STATUS" ? "To Do" : null,
            newValue: actionType === "UPDATED_STATUS" ? "In Progress" : null,
            timestamp: d(randInt(-20, 0)),
          },
        });
      }
    }
  }

  // ── 18. Create watchers ────────────────────────────────────────────
  console.log("👁️  Creating watchers...");

  for (const project of projects) {
    const issues = allCreatedIssues[project.id] || [];
    for (let i = 0; i < Math.min(10, issues.length); i++) {
      const watcherCount = randInt(1, 3);
      const watcherUsers = assignableUsers.sort(() => Math.random() - 0.5).slice(0, watcherCount);
      for (const wu of watcherUsers) {
        await prisma.watcher.upsert({
          where: { issueId_userId: { issueId: issues[i].id, userId: wu.id } },
          update: {},
          create: { issueId: issues[i].id, userId: wu.id },
        });
      }
    }
  }

  // ── 19. Create custom fields ───────────────────────────────────────
  console.log("🔧 Creating custom fields...");

  const customFieldDefs = [
    { name: "Business Value", fieldType: "NUMBER", isRequired: false },
    { name: "Customer Impact", fieldType: "DROPDOWN", optionsJson: JSON.stringify(["None", "Low", "Medium", "High", "Critical"]) },
    { name: "Target Release", fieldType: "TEXT", isRequired: false },
    { name: "Review Date", fieldType: "DATE", isRequired: false },
  ];

  for (const project of projects) {
    for (const cfDef of customFieldDefs) {
      const existing = await prisma.customField.findFirst({
        where: { scopeId: project.id, name: cfDef.name },
      });
      if (existing) continue;
      const cf = await prisma.customField.create({
        data: { scopeType: "PROJECT", scopeId: project.id, ...cfDef },
      });

      // Assign values to first 5 issues
      const issues = allCreatedIssues[project.id] || [];
      for (let i = 0; i < Math.min(5, issues.length); i++) {
        if (cfDef.fieldType === "NUMBER") {
          await prisma.customFieldValue.create({
            data: { customFieldId: cf.id, issueId: issues[i].id, valueNumber: randInt(1, 100) },
          });
        } else if (cfDef.fieldType === "TEXT") {
          await prisma.customFieldValue.create({
            data: { customFieldId: cf.id, issueId: issues[i].id, valueString: `v${randInt(1, 5)}.${randInt(0, 9)}` },
          });
        }
      }
    }
  }

  // ── 20. Create automation rules ────────────────────────────────────
  console.log("⚡ Creating automation rules...");

  for (const project of projects) {
    const existingRules = await prisma.automationRule.count({ where: { projectId: project.id } });
    if (existingRules > 0) continue;

    await prisma.automationRule.createMany({
      data: [
        {
          projectId: project.id,
          name: "Auto-assign to reporter when unassigned",
          triggerType: "ISSUE_CREATED",
          conditionRules: JSON.stringify({ assigneeId: null }),
          actionType: "ASSIGN_USER",
          actionConfig: JSON.stringify({ assignTo: "reporter" }),
          isActive: true,
        },
        {
          projectId: project.id,
          name: "Notify team on critical issues",
          triggerType: "ISSUE_CREATED",
          conditionRules: JSON.stringify({ priority: "CRITICAL" }),
          actionType: "NOTIFY",
          actionConfig: JSON.stringify({ channel: "team", message: "Critical issue created" }),
          isActive: true,
        },
        {
          projectId: project.id,
          name: "Move to Done when all subtasks complete",
          triggerType: "STATUS_CHANGED",
          conditionRules: JSON.stringify({ allSubtasksComplete: true }),
          actionType: "CHANGE_STATUS",
          actionConfig: JSON.stringify({ targetCategory: "DONE" }),
          isActive: true,
        },
      ],
    });
  }

  // ── 21. Create recurring tasks ─────────────────────────────────────
  console.log("🔁 Creating recurring tasks...");

  for (const project of projects) {
    const existing = await prisma.recurringTask.count({ where: { projectId: project.id } });
    if (existing > 0) continue;

    await prisma.recurringTask.createMany({
      data: [
        {
          projectId: project.id,
          scheduleCron: "WEEKLY",
          templateData: JSON.stringify({
            title: `[${project.key}] Weekly dependency audit`,
            issueType: "TASK",
            priority: "MEDIUM",
            description: "Review and update project dependencies, check for security advisories",
          }),
          isActive: true,
          nextRunAt: d(7),
        },
        {
          projectId: project.id,
          scheduleCron: "MONTHLY",
          templateData: JSON.stringify({
            title: `[${project.key}] Monthly performance review`,
            issueType: "TASK",
            priority: "LOW",
            description: "Run performance benchmarks and compare against baseline metrics",
          }),
          isActive: true,
          nextRunAt: d(30),
        },
      ],
    });
  }

  // ── 22. Create webhooks ────────────────────────────────────────────
  console.log("🪝 Creating webhooks...");

  for (const project of projects) {
    const existing = await prisma.webhook.count({ where: { projectId: project.id } });
    if (existing > 0) continue;

    await prisma.webhook.create({
      data: {
        orgId: existingOrg.id,
        projectId: project.id,
        targetUrl: "https://hooks.slack.example.com/services/T00/B00/xxx",
        events: JSON.stringify(["issue.created", "issue.status_changed", "comment.created"]),
        secret: `whsec_${project.key.toLowerCase()}_demo_secret`,
        isActive: true,
      },
    });
  }

  // ── 23. Create notifications ───────────────────────────────────────
  console.log("🔔 Creating notifications...");

  const notifTemplates = [
    { title: "New issue assigned to you", type: "ASSIGNMENT" },
    { title: "Issue status updated", type: "STATUS" },
    { title: "You were mentioned in a comment", type: "MENTION" },
    { title: "Issue due date approaching", type: "DUE_DATE" },
  ];

  for (const u of assignableUsers.slice(0, 6)) {
    for (let i = 0; i < 5; i++) {
      const tmpl = rand(notifTemplates);
      await prisma.notification.create({
        data: {
          userId: u.id,
          actorId: rand(assignableUsers.filter(x => x.id !== u.id)).id,
          title: tmpl.title,
          message: `${tmpl.title} — check your dashboard for details.`,
          type: tmpl.type,
          isRead: Math.random() > 0.5,
          linkUrl: `/projects/${rand(projects).id}`,
        },
      });
    }
  }

  // ── 24. Create system announcements ────────────────────────────────
  console.log("📢 Creating system announcements...");

  const existingAnnouncements = await prisma.systemAnnouncement.count();
  if (existingAnnouncements < 3) {
    await prisma.systemAnnouncement.createMany({
      data: [
        {
          title: "Platform Update: SAP Activate Methodology",
          message: "The SAP Activate delivery methodology is now available for all projects. Enable it from Project Settings to access structured phase gates, fit-to-standard workshops, and compliance tracking.",
          severity: "INFO",
          targetAudience: "ALL",
          isActive: true,
        },
        {
          title: "Scheduled Maintenance Window",
          message: "A brief maintenance window is planned for this weekend (Saturday 02:00–04:00 UTC) for database optimization. No downtime expected.",
          severity: "WARNING",
          targetAudience: "ALL",
          isActive: true,
        },
      ],
    });
  }

  // ── Done ───────────────────────────────────────────────────────────
  const finalCounts = {
    users: await prisma.user.count(),
    organizations: await prisma.organization.count(),
    workspaces: await prisma.workspace.count(),
    teams: await prisma.team.count(),
    projects: await prisma.project.count(),
    epics: await prisma.epic.count(),
    sprints: await prisma.sprint.count(),
    issues: await prisma.issue.count(),
    subtasks: await prisma.subtask.count(),
    comments: await prisma.comment.count(),
    timeEntries: await prisma.timeEntry.count(),
    dependencies: await prisma.issueDependency.count(),
    labels: await prisma.label.count(),
    activityLogs: await prisma.activityLog.count(),
    customFields: await prisma.customField.count(),
    automationRules: await prisma.automationRule.count(),
    recurringTasks: await prisma.recurringTask.count(),
    webhooks: await prisma.webhook.count(),
    notifications: await prisma.notification.count(),
    watchers: await prisma.watcher.count(),
  };

  console.log("\n✅ Demo data loaded successfully!\n");
  console.log("┌──────────────────────────────────────┐");
  console.log("│   EITEKH WORKOS — DEMO DATA SUMMARY  │");
  console.log("├──────────────────────────────────────┤");
  for (const [key, val] of Object.entries(finalCounts)) {
    const label = key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).padEnd(22);
    console.log(`│  ${label} ${String(val).padStart(8)}  │`);
  }
  console.log("└──────────────────────────────────────┘");
  console.log("\n🔑 Login credentials:");
  console.log("   Super Admin:  cocofbd@gmail.com / AdminPass123!");
  console.log("   Demo User:    alex@acme.com / Password123!");
  console.log("   All new users: Password123!");
}

main()
  .catch((e) => {
    console.error("❌ Demo seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
