const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ENTERPRISE_ROLES = [
  {
    name: 'Product Manager & Strategist',
    slug: 'product-manager-strategist',
    description: 'Leads roadmap initiatives, product backlogs, epic definitions, and cross-functional release goals',
    scope: 'PROJECT',
    isSystem: false,
    permissions: [
      'projects:view',
      'issues:view',
      'issues:create',
      'issues:edit',
      'issues:comment',
      'issues:assign',
      'epics:view',
      'epics:create',
      'epics:edit',
      'sprints:view',
      'backlog:view',
      'backlog:groom',
      'backlog:estimate',
      'calendar:view',
      'timeline:view',
      'reports:view',
      'reports:generate',
      'analytics:view',
      'teams:view',
      'users:view',
      'data:export_csv',
      'data:export_pdf',
    ],
  },
  {
    name: 'DevOps & Platform Architect',
    slug: 'devops-platform-architect',
    description: 'Manages workflow pipelines, custom metadata attributes, automations, and operational telemetry',
    scope: 'PROJECT',
    isSystem: false,
    permissions: [
      'projects:view',
      'projects:edit',
      'issues:view',
      'issues:create',
      'issues:edit',
      'issues:transition',
      'issues:comment',
      'tasks:view',
      'tasks:create',
      'tasks:edit',
      'timeline:view',
      'timeline:manage_deps',
      'settings:view',
      'settings:workflows',
      'settings:custom_fields',
      'settings:automations',
      'analytics:view',
      'analytics:configure',
      'reports:view',
      'data:export_csv',
      'data:import',
    ],
  },
  {
    name: 'Scrum Master & Agile Coach',
    slug: 'scrum-master-agile-coach',
    description: 'Facilitates sprint ceremonies, velocity estimation, team workload balance, and burndown telemetry',
    scope: 'PROJECT',
    isSystem: false,
    permissions: [
      'projects:view',
      'issues:view',
      'issues:edit',
      'issues:transition',
      'issues:assign',
      'issues:comment',
      'issues:bulk_edit',
      'tasks:view',
      'tasks:create',
      'tasks:edit',
      'epics:view',
      'sprints:view',
      'sprints:create',
      'sprints:start',
      'sprints:complete',
      'backlog:view',
      'backlog:groom',
      'backlog:estimate',
      'calendar:view',
      'calendar:reschedule',
      'timeline:view',
      'timeline:manage_deps',
      'workload:view',
      'workload:balance',
      'analytics:view',
      'analytics:configure',
      'reports:view',
      'reports:generate',
      'teams:view',
      'data:export_csv',
    ],
  },
  {
    name: 'Senior Software Engineer',
    slug: 'senior-software-engineer',
    description: 'Delivers backlog items, breaks down subtasks, manages dependencies, and estimates story points',
    scope: 'PROJECT',
    isSystem: false,
    permissions: [
      'projects:view',
      'issues:view',
      'issues:create',
      'issues:edit',
      'issues:transition',
      'issues:assign',
      'issues:comment',
      'tasks:view',
      'tasks:create',
      'tasks:edit',
      'tasks:delete',
      'epics:view',
      'sprints:view',
      'backlog:view',
      'backlog:estimate',
      'calendar:view',
      'timeline:view',
      'timeline:manage_deps',
      'workload:view',
      'reports:view',
      'analytics:view',
      'teams:view',
      'users:view',
      'data:export_csv',
    ],
  },
  {
    name: 'Security & Compliance Auditor',
    slug: 'security-compliance-auditor',
    description: 'Audits access controls, runs provenance checks on user permissions, and reviews audit ledger',
    scope: 'ORG',
    isSystem: false,
    permissions: [
      'projects:view',
      'issues:view',
      'audit:view',
      'audit:inspect_access',
      'reports:view',
      'reports:generate',
      'analytics:view',
      'users:view',
      'settings:view',
      'data:export_csv',
      'data:export_pdf',
    ],
  },
  {
    name: 'Customer Support & Triage Lead',
    slug: 'customer-support-triage-lead',
    description: 'Logs incoming user defects, tags issues with custom fields, verifies workflows, and assigns tickets',
    scope: 'PROJECT',
    isSystem: false,
    permissions: [
      'projects:view',
      'issues:view',
      'issues:create',
      'issues:edit',
      'issues:comment',
      'issues:assign',
      'tasks:view',
      'tasks:create',
      'tasks:edit',
      'calendar:view',
      'reports:view',
      'data:export_csv',
    ],
  },
];

const ENTERPRISE_TARGETS = [
  {
    name: 'Selected Workspace Projects',
    description: 'Applies access boundaries to projects within selected organizational workspaces',
    type: 'SELECTED_WORKSPACE',
  },
];

async function provision() {
  console.log('=== Provisioning Complete Enterprise PBAC Roles & Groups ===\n');

  const admin = await prisma.user.findFirst({ where: { isSuperAdmin: true } });
  const actorId = admin ? admin.id : 'system';

  const orgs = await prisma.organization.findMany();
  console.log(`Found ${orgs.length} organization(s) in database.\n`);

  for (const org of orgs) {
    console.log(`--- Processing Organization: "${org.name}" (${org.id}) ---`);

    // 1. Provision Roles
    const roleMap = {};
    for (const rDef of ENTERPRISE_ROLES) {
      let role = await prisma.permissionRole.findFirst({
        where: { orgId: org.id, slug: rDef.slug },
      });

      if (!role) {
        role = await prisma.permissionRole.create({
          data: {
            orgId: org.id,
            name: rDef.name,
            slug: rDef.slug,
            description: rDef.description,
            scope: rDef.scope,
            isSystem: rDef.isSystem,
            permissions: JSON.stringify(rDef.permissions),
            createdById: actorId,
          },
        });
        console.log(` [+] Created Role: "${role.name}" (${rDef.permissions.length} permissions)`);
      } else {
        console.log(` [=] Role Exists: "${role.name}"`);
      }
      roleMap[rDef.slug] = role;
    }

    // Also fetch existing default roles
    const existingRoles = await prisma.permissionRole.findMany({ where: { orgId: org.id } });
    existingRoles.forEach((r) => {
      roleMap[r.slug] = r;
    });

    // 2. Provision Targets
    const targetMap = {};
    for (const tDef of ENTERPRISE_TARGETS) {
      let target = await prisma.targetPopulation.findFirst({
        where: { orgId: org.id, name: tDef.name },
      });

      if (!target) {
        target = await prisma.targetPopulation.create({
          data: {
            orgId: org.id,
            name: tDef.name,
            description: tDef.description,
            type: tDef.type,
            createdById: actorId,
          },
        });
        console.log(` [+] Created Target Population: "${target.name}" [${target.type}]`);
      } else {
        console.log(` [=] Target Exists: "${target.name}"`);
      }
      targetMap[tDef.type] = target;
    }

    const existingTargets = await prisma.targetPopulation.findMany({ where: { orgId: org.id } });
    existingTargets.forEach((t) => {
      targetMap[t.type] = t;
    });

    // 3. Provision Enterprise Groups
    const ENTERPRISE_GROUPS = [
      {
        name: 'Product Management & Strategy',
        slug: 'product-management-strategy',
        description: 'Product owners, strategists, and business analysts driving roadmap epics and features',
        type: 'DYNAMIC',
        criteriaJson: JSON.stringify({
          match: 'ANY',
          conditions: [
            { field: 'job_title', operator: 'CONTAINS', value: 'Product' },
            { field: 'job_title', operator: 'CONTAINS', value: 'PM' },
            { field: 'job_title', operator: 'CONTAINS', value: 'Strategist' },
          ],
        }),
        bindRoleSlug: 'product-manager-strategist',
        bindTargetType: 'ALL_PROJECTS_WORKSPACE',
      },
      {
        name: 'Engineering Leadership & Scrum Masters',
        slug: 'engineering-leadership-scrum',
        description: 'Engineering VPs, Directors, Tech Leads, and Scrum Masters guiding agile execution',
        type: 'DYNAMIC',
        criteriaJson: JSON.stringify({
          match: 'ANY',
          conditions: [
            { field: 'job_title', operator: 'CONTAINS', value: 'Lead' },
            { field: 'job_title', operator: 'CONTAINS', value: 'Manager' },
            { field: 'job_title', operator: 'CONTAINS', value: 'VP' },
            { field: 'job_title', operator: 'CONTAINS', value: 'Scrum' },
          ],
        }),
        bindRoleSlug: 'scrum-master-agile-coach',
        bindTargetType: 'ALL_PROJECTS_WORKSPACE',
      },
      {
        name: 'Core Software Developers & Engineers',
        slug: 'core-software-developers',
        description: 'Frontend, backend, mobile, and fullstack developers delivering sprint commitments',
        type: 'DYNAMIC',
        criteriaJson: JSON.stringify({
          match: 'ANY',
          conditions: [
            { field: 'job_title', operator: 'CONTAINS', value: 'Engineer' },
            { field: 'job_title', operator: 'CONTAINS', value: 'Developer' },
          ],
        }),
        bindRoleSlug: 'senior-software-engineer',
        bindTargetType: 'ASSIGNED_PROJECTS',
      },
      {
        name: 'DevOps & Reliability Squad',
        slug: 'devops-sre-squad',
        description: 'SRE, DevOps, and cloud infrastructure engineers managing automations and telemetry',
        type: 'DYNAMIC',
        criteriaJson: JSON.stringify({
          match: 'ANY',
          conditions: [
            { field: 'job_title', operator: 'CONTAINS', value: 'DevOps' },
            { field: 'job_title', operator: 'CONTAINS', value: 'SRE' },
            { field: 'job_title', operator: 'CONTAINS', value: 'Platform' },
            { field: 'job_title', operator: 'CONTAINS', value: 'Infrastructure' },
          ],
        }),
        bindRoleSlug: 'devops-platform-architect',
        bindTargetType: 'ALL_PROJECTS_WORKSPACE',
      },
      {
        name: 'Security & Compliance Oversight',
        slug: 'security-compliance-oversight',
        description: 'Security officers, data protection leads, and external compliance auditors',
        type: 'DYNAMIC',
        criteriaJson: JSON.stringify({
          match: 'ANY',
          conditions: [
            { field: 'job_title', operator: 'CONTAINS', value: 'Security' },
            { field: 'job_title', operator: 'CONTAINS', value: 'Audit' },
            { field: 'job_title', operator: 'CONTAINS', value: 'Compliance' },
          ],
        }),
        bindRoleSlug: 'security-compliance-auditor',
        bindTargetType: 'ALL_PROJECTS_WORKSPACE',
      },
      {
        name: 'Executive Leadership & Board',
        slug: 'executive-leadership-board',
        description: 'Executive officers and advisory board members with organizational visibility',
        type: 'STATIC',
        bindRoleSlug: 'owner',
        bindTargetType: 'ALL_PROJECTS_WORKSPACE',
      },
      {
        name: 'Customer Support & Triage Desk',
        slug: 'customer-support-triage',
        description: 'Customer service agents, triage leads, and account managers handling ticket intake',
        type: 'DYNAMIC',
        criteriaJson: JSON.stringify({
          match: 'ANY',
          conditions: [
            { field: 'job_title', operator: 'CONTAINS', value: 'Support' },
            { field: 'job_title', operator: 'CONTAINS', value: 'Success' },
            { field: 'job_title', operator: 'CONTAINS', value: 'Triage' },
          ],
        }),
        bindRoleSlug: 'customer-support-triage-lead',
        bindTargetType: 'ALL_PROJECTS_WORKSPACE',
      },
    ];

    for (const gDef of ENTERPRISE_GROUPS) {
      let group = await prisma.permissionGroup.findFirst({
        where: { orgId: org.id, slug: gDef.slug },
      });

      if (!group) {
        group = await prisma.permissionGroup.create({
          data: {
            orgId: org.id,
            name: gDef.name,
            slug: gDef.slug,
            description: gDef.description,
            type: gDef.type,
            criteriaJson: gDef.criteriaJson || null,
            createdById: actorId,
          },
        });
        console.log(` [+] Created Group: "${group.name}" [${group.type}]`);
      } else {
        console.log(` [=] Group Exists: "${group.name}"`);
      }

      // 4. Create Role Assignment if defined and not existing
      const role = roleMap[gDef.bindRoleSlug];
      const target = targetMap[gDef.bindTargetType] || targetMap['ALL_PROJECTS_WORKSPACE'];

      if (role && target) {
        const existingAssign = await prisma.groupRoleAssignment.findFirst({
          where: {
            orgId: org.id,
            groupId: group.id,
            roleId: role.id,
            targetPopulationId: target.id,
          },
        });

        if (!existingAssign) {
          const newAssign = await prisma.groupRoleAssignment.create({
            data: {
              orgId: org.id,
              groupId: group.id,
              roleId: role.id,
              targetPopulationId: target.id,
              status: 'ACTIVE',
              createdById: actorId,
            },
          });
          console.log(`  └─> Bound to Role "${role.name}" with Target "${target.name}"`);
        }
      }
    }

    // Populate static members for Executive Leadership
    const execGroup = await prisma.permissionGroup.findFirst({
      where: { orgId: org.id, slug: 'executive-leadership-board' },
    });
    if (execGroup) {
      const orgOwners = await prisma.organizationMember.findMany({
        where: { orgId: org.id, role: { in: ['OWNER', 'ADMIN'] } },
        select: { userId: true },
      });

      for (const m of orgOwners) {
        const existingMember = await prisma.permissionGroupMember.findUnique({
          where: { groupId_userId: { groupId: execGroup.id, userId: m.userId } },
        });
        if (!existingMember) {
          await prisma.permissionGroupMember.create({
            data: {
              groupId: execGroup.id,
              userId: m.userId,
              addedById: actorId,
            },
          });
          console.log(`  └─> Added Exec Member User ID: ${m.userId}`);
        }
      }
    }

    console.log();
  }

  console.log('=== All Enterprise Roles, Groups, Targets & Bindings Successfully Provisioned! ===');
}

provision().catch(console.error).finally(() => prisma.$disconnect());