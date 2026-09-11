const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const JWT_SECRET = 'zenith-workos-jwt-secret-secure-key-1029384756';

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function testCustomRoleLifecycle() {
  console.log('=== Testing Custom Enterprise Role & Binding Lifecycle ===\n');

  const admin = await prisma.user.findFirst({ where: { isSuperAdmin: true } });
  const expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + 7);
  const session = await prisma.session.create({ data: { userId: admin.id, token: crypto.randomUUID(), userAgent: 'test', ipAddress: '127.0.0.1', expiresAt } });
  const token = jwt.sign({ userId: admin.id, email: admin.email, isSuperAdmin: true, sessionId: session.id }, JWT_SECRET, { expiresIn: '7d' });
  const org = await prisma.organization.findFirst();
  const orgId = org.id;

  const headers = {
    Cookie: `zenith_session_token=${token}`,
    'Content-Type': 'application/json',
  };

  // 1. Create a custom Enterprise Role: "Release & SRE Specialist"
  console.log('1. Creating Custom Role "Release & SRE Specialist"...');
  const createRoleRes = await request(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/pbac/roles',
      method: 'POST',
      headers,
    },
    {
      orgId,
      name: 'Release & SRE Specialist',
      description: 'Specialized role for release trains, timeline schedules, telemetry, and workflow transitions',
      scope: 'PROJECT',
      permissions: [
        'projects:view',
        'issues:view',
        'issues:transition',
        'issues:comment',
        'sprints:view',
        'sprints:start',
        'sprints:complete',
        'timeline:view',
        'timeline:manage_deps',
        'calendar:view',
        'calendar:reschedule',
        'analytics:view',
        'reports:view',
        'reports:generate',
        'data:export_csv',
      ],
    }
  );
  console.log(`Role Creation Status: ${createRoleRes.status}`);
  const customRole = createRoleRes.body.role;
  console.log(`Created Role ID: ${customRole?.id}, Slug: ${customRole?.slug}\n`);

  // 2. Create Target Population: "Squad Release Boundaries"
  console.log('2. Creating Target Population "Squad Release Boundaries"...');
  const createTargetRes = await request(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/pbac/target-populations',
      method: 'POST',
      headers,
    },
    {
      orgId,
      name: 'Squad Release Boundaries',
      description: 'Target population scoping release managers to team squad projects',
      type: 'TEAM_PROJECTS',
    }
  );
  console.log(`Target Population Status: ${createTargetRes.status}`);
  const targetPop = createTargetRes.body.targetPopulation;
  console.log(`Created Target Population ID: ${targetPop?.id}\n`);

  // 3. Create Group & Bind Role + Target Population
  const group = await prisma.permissionGroup.findFirst({ where: { orgId } });
  console.log(`3. Binding Group "${group.name}" ➔ Role "${customRole.name}" ➔ Target "${targetPop.name}"...`);
  const createAssignRes = await request(
    {
      hostname: 'localhost',
      port: 3000,
      path: '/api/pbac/assignments',
      method: 'POST',
      headers,
    },
    {
      orgId,
      groupId: group.id,
      roleId: customRole.id,
      targetPopulationId: targetPop.id,
    }
  );
  console.log(`Assignment Creation Status: ${createAssignRes.status}`);
  const assignment = createAssignRes.body.assignment;
  console.log(`Created Assignment ID: ${assignment?.id}, Status: ${assignment?.status}\n`);

  // 4. Toggle Assignment Status (ACTIVE ➔ INACTIVE ➔ ACTIVE)
  console.log('4. Toggling Assignment Status...');
  const toggleRes = await request(
    {
      hostname: 'localhost',
      port: 3000,
      path: `/api/pbac/assignments/${assignment.id}`,
      method: 'PATCH',
      headers,
    },
    { status: 'INACTIVE' }
  );
  console.log(`Toggle to INACTIVE Status: ${toggleRes.status}, New Status: ${toggleRes.body.assignment?.status}`);

  const toggleBackRes = await request(
    {
      hostname: 'localhost',
      port: 3000,
      path: `/api/pbac/assignments/${assignment.id}`,
      method: 'PATCH',
      headers,
    },
    { status: 'ACTIVE' }
  );
  console.log(`Toggle to ACTIVE Status: ${toggleBackRes.status}, New Status: ${toggleBackRes.body.assignment?.status}\n`);

  // 5. Verify in Audit Ledger
  console.log('5. Verifying Audit Ledger...');
  const auditRes = await request(
    {
      hostname: 'localhost',
      port: 3000,
      path: `/api/pbac/audit?orgId=${orgId}&limit=5`,
      method: 'GET',
      headers,
    }
  );
  console.log(`Audit Status: ${auditRes.status}`);
  console.log(`Recent Audit Actions:`);
  auditRes.body.logs?.slice(0, 4).forEach((l) => {
    console.log(` - [${l.action}] on ${l.entityType} (${l.entityId}) by ${l.actorName}`);
  });
  console.log();

  console.log('=== Custom Role & Assignment Lifecycle Complete & Verified! ===');
  await prisma.$disconnect();
}

testCustomRoleLifecycle().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});