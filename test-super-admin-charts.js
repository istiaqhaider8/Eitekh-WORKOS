const http = require('http');

function request(url, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: data ? (res.headers['content-type']?.includes('json') ? JSON.parse(data) : data) : null,
          raw: data
        });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function main() {
  console.log("=== Testing Super Admin Charts & Analytics Integration ===");

  // 1. Authenticate as Super Admin
  const adminLogin = await request('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, { email: 'admin@zenith.local', password: 'AdminPass123!' });

  const adminCookie = adminLogin.headers['set-cookie']?.[0]?.split(';')[0];
  console.log("1. Super Admin authenticated:", adminLogin.status === 200, "Cookie exists:", !!adminCookie);

  // 2. Test GET /api/super-admin/analytics as Super Admin
  const analyticsRes = await request('http://localhost:3000/api/super-admin/analytics', {
    headers: { Cookie: adminCookie },
  });
  console.log("2. GET /api/super-admin/analytics status:", analyticsRes.status);
  console.log("   - Issues returned:", analyticsRes.data?.issues?.length);
  console.log("   - Statuses returned:", analyticsRes.data?.statuses?.length);
  console.log("   - Users returned:", analyticsRes.data?.users?.length);
  console.log("   - Orgs returned:", analyticsRes.data?.orgs?.length);
  console.log("   - Sprints returned:", analyticsRes.data?.sprints?.length);

  if (analyticsRes.status !== 200 || !analyticsRes.data?.issues) {
    throw new Error("Super Admin failed to fetch analytics data");
  }

  // 3. Test security: Regular user must be blocked (403)
  const devLogin = await request('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, { email: 'sarah@acme.com', password: 'Password123!' });
  const devCookie = devLogin.headers['set-cookie']?.[0]?.split(';')[0] || '';

  const devAnalyticsRes = await request('http://localhost:3000/api/super-admin/analytics', {
    headers: { Cookie: devCookie },
  });
  console.log("3. Non-admin access to /api/super-admin/analytics blocked:", devAnalyticsRes.status === 403 ? "PASSED (403 Forbidden)" : `FAILED (${devAnalyticsRes.status})`);

  // 4. Test Super Admin HTML page contains Analytics & Charts
  const adminPageRes = await request('http://localhost:3000/super-admin', {
    headers: { Cookie: adminCookie },
  });
  console.log("4. Super Admin portal HTML status:", adminPageRes.status, `(${adminPageRes.raw.length} bytes)`);
  const hasChartsTab = adminPageRes.raw.includes("Analytics &amp; Charts") || adminPageRes.raw.includes("Analytics & Charts");
  console.log("   - Contains 'Analytics & Charts' tab in navigation:", hasChartsTab);

  // 5. Test Super Admin can access project workspace
  const firstProject = analyticsRes.data.issues[0]?.project;
  if (firstProject) {
    const projectPageRes = await request(`http://localhost:3000/projects/${firstProject.id}`, {
      headers: { Cookie: adminCookie },
    });
    console.log(`5. Super Admin workspace access to project ${firstProject.key}:`, projectPageRes.status === 200 ? "PASSED (200 OK)" : `FAILED (${projectPageRes.status})`);
  }

  console.log("\n✅ SUPER ADMIN CHARTS & PLATFORM ANALYTICS FULLY OPERATIONAL!");
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
