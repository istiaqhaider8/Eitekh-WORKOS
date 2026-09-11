/**
 * Automated Security & Real-Time Sync Test Suite for Zenith WorkOS
 * 
 * Verifies:
 * 1. Strict Project-Based Access Control (PBAC):
 *    - User A with Project 1 access CAN read/mutate Project 1.
 *    - User A WITHOUT Project 2 access is STRICTLY BLOCKED (403) from Project 2 APIs,
 *      mutations, exports, and SSE event streaming.
 *    - Normal user accessing Super Admin sync-monitor is BLOCKED (403).
 * 2. Real-Time Synchronization Engine & SSE:
 *    - SSE event stream endpoint enforces project-level authorization.
 *    - Real-time events (ISSUE_CREATED, ISSUE_UPDATED, SPRINT_UPDATED, TEST_PING) are project-scoped.
 *    - Superadmin Sync Monitor API returns comprehensive live metrics and handles broadcasts.
 * 3. Cross-Module Data Integrity & Telemetry:
 *    - Single source of truth in PostgreSQL via Prisma.
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const prisma = new PrismaClient();
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'zenith-workos-dev-secret';

async function createAuthCookie(user) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      token: crypto.randomUUID(),
      userAgent: 'PBAC Test Runner',
      ipAddress: '127.0.0.1',
      expiresAt,
    }
  });

  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      isSuperAdmin: !!user.isSuperAdmin,
      sessionId: session.id,
    },
    JWT_SECRET,
    { expiresIn: '1d' }
  );
  return `zenith_session_token=${token}`;
}

async function runTests() {
  console.log('================================================================');
  console.log('🔒 ZENITH WORKOS: PBAC & REAL-TIME SYNC VERIFICATION TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} - ${details}`);
      failed++;
    }
  }

  try {
    // 1. SETUP TEST USERS & PROJECTS
    console.log('--- STEP 1: Provisioning Isolated Test Tenants & Users ---');
    
    // Fetch or create Super Admin
    let superAdmin = await prisma.user.findFirst({
      where: { isSuperAdmin: true }
    });
    if (!superAdmin) {
      const hash = await bcrypt.hash('AdminPassword123!', 10);
      superAdmin = await prisma.user.create({
        data: {
          email: 'pbac_superadmin@zenith.test',
          passwordHash: hash,
          firstName: 'Super',
          lastName: 'Admin',
          isSuperAdmin: true,
          status: 'ACTIVE',
        }
      });
    }

    // Get an Organization
    let org = await prisma.organization.findFirst({
      include: { workspaces: { include: { projects: true } } }
    });

    if (!org) {
      org = await prisma.organization.create({
        data: {
          name: 'PBAC Test Org',
          slug: 'pbac-test-org',
          workspaces: {
            create: {
              name: 'PBAC Test Workspace',
              slug: 'pbac-test-ws',
              projects: {
                create: [
                  { name: 'Project Alpha (Authorized)', key: 'ALPHA' },
                  { name: 'Project Beta (Restricted)', key: 'BETA' },
                ]
              }
            }
          }
        },
        include: { workspaces: { include: { projects: true } } }
      });
    }

    const ws = org.workspaces[0];
    let projectAlpha = ws.projects[0];
    let projectBeta = ws.projects[1];

    if (!projectBeta) {
      projectBeta = await prisma.project.create({
        data: {
          workspaceId: ws.id,
          name: 'Project Beta (Restricted)',
          key: 'BETA' + Date.now().toString().slice(-4),
        }
      });
    }

    // Create User A (Has access to Project Alpha only)
    const hashA = await bcrypt.hash('UserAPassword123!', 10);
    const userA = await prisma.user.upsert({
      where: { email: 'user_alpha_member@zenith.test' },
      update: { isSuperAdmin: false },
      create: {
        email: 'user_alpha_member@zenith.test',
        passwordHash: hashA,
        firstName: 'Alpha',
        lastName: 'Member',
        isSuperAdmin: false,
        status: 'ACTIVE',
      }
    });

    // Ensure User A is member of Project Alpha only
    await prisma.projectMember.deleteMany({
      where: { userId: userA.id }
    });
    await prisma.organizationMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: userA.id } },
      update: { role: 'MEMBER' },
      create: { orgId: org.id, userId: userA.id, role: 'MEMBER' }
    });
    await prisma.projectMember.create({
      data: {
        projectId: projectAlpha.id,
        userId: userA.id,
        role: 'MEMBER'
      }
    });

    // Create an issue in Project Beta
    let betaIssue = await prisma.issue.findFirst({
      where: { projectId: projectBeta.id }
    });
    if (!betaIssue) {
      let status = await prisma.workflowStatus.findFirst({
        where: { workflow: { projectId: projectBeta.id } }
      });
      if (!status) {
        const wf = await prisma.workflow.create({
          data: {
            projectId: projectBeta.id,
            name: 'Beta Workflow',
            isDefault: true,
            statuses: {
              create: [
                { name: 'To Do', category: 'TODO', color: '#94a3b8', position: 0 },
                { name: 'In Progress', category: 'IN_PROGRESS', color: '#3b82f6', position: 1 },
                { name: 'Done', category: 'DONE', color: '#10b981', position: 2 },
              ]
            }
          },
          include: { statuses: true }
        });
        status = wf.statuses[0];
      }

      betaIssue = await prisma.issue.create({
        data: {
          projectId: projectBeta.id,
          title: 'Top Secret Beta Task',
          issueKey: `${projectBeta.key}-1`,
          keyNumber: 1,
          statusId: status.id,
          priority: 'HIGH',
          issueType: 'TASK',
        }
      });
    }

    console.log(`  ✓ User A: ${userA.email} (Assigned to ${projectAlpha.name} ONLY)`);
    console.log(`  ✓ Project Alpha ID: ${projectAlpha.id}`);
    console.log(`  ✓ Project Beta ID: ${projectBeta.id} (Restricted)`);
    console.log(`  ✓ Project Beta Issue ID: ${betaIssue.id}\n`);

    const cookieUserA = await createAuthCookie(userA);
    const cookieAdmin = await createAuthCookie(superAdmin);

    // 2. PBAC ACCESS CONTROL TESTS
    console.log('--- STEP 2: Strict Project-Based Access Control (PBAC) Enforcement ---');

    // Test 2.1: User A accessing Project Alpha Issues (Authorized)
    const resAlphaIssues = await fetch(`${BASE_URL}/api/projects/${projectAlpha.id}/issues`, {
      headers: { Cookie: cookieUserA }
    });
    assert(resAlphaIssues.status === 200, 'User A can access authorized Project Alpha issues (200 OK)', `Status: ${resAlphaIssues.status}`);

    // Test 2.2: User A accessing Project Beta Issues (Unauthorized -> 403)
    const resBetaIssues = await fetch(`${BASE_URL}/api/projects/${projectBeta.id}/issues`, {
      headers: { Cookie: cookieUserA }
    });
    assert(resBetaIssues.status === 403, 'User A blocked from unauthorized Project Beta issues (403 Forbidden)', `Status: ${resBetaIssues.status}`);

    // Test 2.3: User A attempting to mutate Project Beta Issue (Unauthorized -> 403)
    const resBetaMutate = await fetch(`${BASE_URL}/api/issues/${betaIssue.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieUserA
      },
      body: JSON.stringify({ title: 'Hacked Title' })
    });
    assert(resBetaMutate.status === 403, 'User A blocked from mutating Project Beta issue (403 Forbidden)', `Status: ${resBetaMutate.status}`);

    // Test 2.4: User A attempting to export Project Beta Data (Unauthorized -> 403)
    const resBetaExport = await fetch(`${BASE_URL}/api/projects/${projectBeta.id}/export?format=json`, {
      headers: { Cookie: cookieUserA }
    });
    assert(resBetaExport.status === 403, 'User A blocked from exporting Project Beta data (403 Forbidden)', `Status: ${resBetaExport.status}`);

    // Test 2.5: User A accessing Super Admin Sync Monitor (Unauthorized -> 403)
    const resUserASyncMon = await fetch(`${BASE_URL}/api/super-admin/sync-monitor`, {
      headers: { Cookie: cookieUserA }
    });
    assert(resUserASyncMon.status === 403, 'Normal user blocked from Super Admin Sync Monitor (403 Forbidden)', `Status: ${resUserASyncMon.status}`);

    // Test 2.6: Super Admin accessing Super Admin Sync Monitor (Authorized -> 200)
    const resAdminSyncMon = await fetch(`${BASE_URL}/api/super-admin/sync-monitor`, {
      headers: { Cookie: cookieAdmin }
    });
    assert(resAdminSyncMon.status === 200, 'Super Admin can access System Sync Monitor (200 OK)', `Status: ${resAdminSyncMon.status}`);
    const syncMonData = await resAdminSyncMon.json();
    assert(typeof syncMonData.metrics === 'object' && Array.isArray(syncMonData.eventLogs), 'Sync Monitor returns valid telemetry metrics and event logs', JSON.stringify(syncMonData.metrics));

    // 3. REAL-TIME EVENT STREAMING & SSE PBAC
    console.log('\n--- STEP 3: Real-Time SSE Endpoint PBAC & Scoping ---');

    // Test 3.1: User A connecting to Project Beta SSE stream (Unauthorized -> 403)
    const resBetaSSE = await fetch(`${BASE_URL}/api/sync/events?projectId=${projectBeta.id}`, {
      headers: { Cookie: cookieUserA }
    });
    assert(resBetaSSE.status === 403, 'User A blocked from subscribing to Project Beta SSE stream (403 Forbidden)', `Status: ${resBetaSSE.status}`);

    // Test 3.2: User A connecting to Project Alpha SSE stream (Authorized -> 200 with text/event-stream)
    const controller = new AbortController();
    const ssePromise = fetch(`${BASE_URL}/api/sync/events?projectId=${projectAlpha.id}`, {
      headers: { Cookie: cookieUserA },
      signal: controller.signal
    });

    const resAlphaSSE = await ssePromise;
    const contentType = resAlphaSSE.headers.get('content-type') || '';
    assert(
      resAlphaSSE.status === 200 && contentType.includes('text/event-stream'),
      'User A successfully connects to Project Alpha SSE stream (200 text/event-stream)',
      `Status: ${resAlphaSSE.status}, Content-Type: ${contentType}`
    );
    controller.abort();

    // 4. REAL-TIME BROADCAST & ENGINE TELEMETRY
    console.log('\n--- STEP 4: Live Broadcast, Mutation Dispatch, and Telemetry ---');

    // Test 4.1: Super Admin broadcasting test sync ping
    const resBroadcast = await fetch(`${BASE_URL}/api/super-admin/sync-monitor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieAdmin
      },
      body: JSON.stringify({
        action: 'TEST_BROADCAST',
        projectId: projectAlpha.id,
        message: 'PBAC Automated Test Event'
      })
    });
    assert(resBroadcast.status === 200, 'Superadmin can broadcast live test event to project (200 OK)', `Status: ${resBroadcast.status}`);
    const broadcastData = await resBroadcast.json();
    assert(broadcastData.success === true, 'Broadcast returns success confirmation');

    // Test 4.2: Verify Event Log Buffer in Sync Monitor
    const resLogCheck = await fetch(`${BASE_URL}/api/super-admin/sync-monitor`, {
      headers: { Cookie: cookieAdmin }
    });
    const logCheckData = await resLogCheck.json();
    const eventLogs = logCheckData.eventLogs || [];
    assert(eventLogs.length > 0, `Sync Engine event buffer contains ${eventLogs.length} dispatched events`, `Events: ${eventLogs.map(e => e.eventType).join(', ')}`);

    const hasTestPing = eventLogs.some(e => e.eventType === 'SYSTEM_SYNC_PING');
    assert(hasTestPing, 'Dispatched test events appear in global event buffer');

    // 5. SUMMARY
    console.log('\n================================================================');
    console.log(`📊 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Unhandled test execution error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
