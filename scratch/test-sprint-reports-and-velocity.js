const { PrismaClient } = require('@prisma/client');
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
      userAgent: 'Test Runner',
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
  console.log('🔥 ZENITH WORKOS: SPRINT & VELOCITY REPORTS VERIFICATION SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name} - ${details}`);
      failed++;
    }
  }

  try {
    const user = await prisma.user.findFirst({ where: { isSuperAdmin: true } });
    if (!user) throw new Error('No user found');
    const cookie = await createAuthCookie(user);

    const project = await prisma.project.findFirst({
      where: { key: 'CP' },
      include: { sprints: true }
    }) || await prisma.project.findFirst({ include: { sprints: true } });

    if (!project) throw new Error('No project found');
    console.log(`Target Project: ${project.name} (${project.key}), ID: ${project.id}\n`);

    // Test 1: GET /api/projects/[id]/analytics
    const analyticsRes = await fetch(`${BASE_URL}/api/projects/${project.id}/analytics`, {
      headers: { Cookie: cookie }
    });
    assert(analyticsRes.status === 200, 'Analytics endpoint returns 200 OK');
    const analyticsData = await analyticsRes.json();
    assert(typeof analyticsData.sprintAnalytics === 'object', 'sprintAnalytics payload exists');
    assert(Array.isArray(analyticsData.sprintAnalytics.allSprints), 'allSprints is an array');
    console.log(`  ℹ Total Sprints in Analytics: ${analyticsData.sprintAnalytics.allSprints.length}`);
    if (analyticsData.sprintAnalytics.activeSprint) {
      console.log(`  ℹ Active Sprint: ${analyticsData.sprintAnalytics.activeSprint.name} (${analyticsData.sprintAnalytics.activeSprint.totalPoints} pts, ${analyticsData.sprintAnalytics.activeSprint.totalIssues} tasks)`);
      assert(analyticsData.sprintAnalytics.activeSprint.totalIssues > 0, 'Active sprint contains tasks');
    }

    // Test 2: Sprint Report CSV Export
    const csvRes = await fetch(`${BASE_URL}/api/projects/${project.id}/reports/download?reportType=sprint-report&format=csv`, {
      headers: { Cookie: cookie }
    });
    assert(csvRes.status === 200, 'Sprint Report CSV download returns 200 OK');
    const csvText = await csvRes.text();
    assert(csvText.includes('Key') && csvText.includes('Title'), 'Sprint Report CSV contains standard headers');

    // Test 3: Sprint Burndown Report PDF/HTML Export
    const burndownRes = await fetch(`${BASE_URL}/api/projects/${project.id}/reports/download?reportType=sprint-burndown&format=pdf`, {
      headers: { Cookie: cookie }
    });
    assert(burndownRes.status === 200, 'Sprint Burndown PDF download returns 200 OK');
    const burndownHtml = await burndownRes.text();
    assert(burndownHtml.includes('Sprint Burndown Report'), 'Sprint Burndown report title rendered');

    // Test 4: Sprint Velocity Report Excel Export
    const velocityRes = await fetch(`${BASE_URL}/api/projects/${project.id}/reports/download?reportType=sprint-velocity&format=excel`, {
      headers: { Cookie: cookie }
    });
    assert(velocityRes.status === 200, 'Sprint Velocity Excel download returns 200 OK');

    // Test 5: Sprint Burnup Report CSV Export
    const burnupRes = await fetch(`${BASE_URL}/api/projects/${project.id}/reports/download?reportType=sprint-burnup&format=csv`, {
      headers: { Cookie: cookie }
    });
    assert(burnupRes.status === 200, 'Sprint Burnup CSV download returns 200 OK');

    // Test 6: Sprint Comparison Report PDF Export
    const compRes = await fetch(`${BASE_URL}/api/projects/${project.id}/reports/download?reportType=sprint-comparison&format=pdf`, {
      headers: { Cookie: cookie }
    });
    assert(compRes.status === 200, 'Sprint Comparison PDF download returns 200 OK');

    console.log('\n================================================================');
    console.log(`📊 SPRINT REPORTS TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    if (failed > 0) process.exit(1);
  } catch (e) {
    console.error('Test error:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
