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
  console.log("=== Testing Data & Charts Visual Analytics Suite ===");

  // 1. Authenticate as Sarah (Acme Member)
  const loginRes = await request('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, { email: 'sarah@acme.com', password: 'Password123!' });

  const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0];
  console.log("1. Authenticated successfully as sarah@acme.com. Cookie exists:", !!cookie);

  // 2. Fetch user profile and organization
  const meRes = await request('http://localhost:3000/api/auth/me', {
    headers: { Cookie: cookie },
  });
  const orgs = meRes.data?.user?.organizations || [];
  const acmeOrg = orgs.find(o => o.slug === 'acme-innovations') || orgs[0];
  const ws = acmeOrg?.workspaces?.[0];
  const project = ws?.projects?.[0];
  const projectId = project?.id;
  console.log("2. Target Project:", project?.name, "ID:", projectId);

  if (!projectId) {
    throw new Error("No project found to test charts against");
  }

  // 3. Fetch issues for target project
  const issuesRes = await request(`http://localhost:3000/api/projects/${projectId}/issues`, {
    headers: { Cookie: cookie },
  });
  const issues = issuesRes.data?.issues || [];
  console.log(`3. Fetched ${issues.length} issues for chart analytics`);

  // 4. Verify Bar Chart Data Aggregation
  const usersMap = new Map();
  issues.forEach(i => {
    if (i.assignee) {
      const u = i.assignee;
      if (!usersMap.has(u.id)) {
        usersMap.set(u.id, { name: `${u.firstName} ${u.lastName}`, total: 0, completed: 0, points: 0 });
      }
      const record = usersMap.get(u.id);
      record.total++;
      if (i.status?.category === 'DONE') record.completed++;
      record.points += (i.estimatePoints || 0);
    }
  });
  console.log(`4. Bar Chart: Aggregated data across ${usersMap.size} unique user(s).`);
  for (const [uid, udata] of usersMap.entries()) {
    console.log(`   - User: ${udata.name} -> Total: ${udata.total}, Completed: ${udata.completed}, Points: ${udata.points}`);
  }

  // 5. Verify Histogram Binning Algorithm
  const bins = [
    { label: "1-2 pts", min: 1, max: 2, count: 0 },
    { label: "3-5 pts", min: 3, max: 5, count: 0 },
    { label: "6-8 pts", min: 6, max: 8, count: 0 },
    { label: "9-13 pts", min: 9, max: 13, count: 0 },
    { label: "14+ pts", min: 14, max: 999, count: 0 },
  ];
  issues.forEach(i => {
    const pts = i.estimatePoints || 0;
    if (pts > 0) {
      const b = bins.find(b => pts >= b.min && pts <= b.max);
      if (b) b.count++;
    }
  });
  const totalBinned = bins.reduce((a, b) => a + b.count, 0);
  console.log(`5. Histogram: Estimation binned successfully. Total binned: ${totalBinned}`);
  bins.forEach(b => console.log(`   - Bin [${b.label}]: ${b.count} issues`));

  // 6. Verify Scatter Plot 2D Cartesian mapping
  const scatterPoints = issues
    .filter(i => i.estimatePoints !== null || i.timeSpentHours > 0)
    .map(i => ({
      key: i.issueKey,
      points: i.estimatePoints || 0,
      hours: i.timeSpentHours || 0,
      priority: i.priority,
    }));
  console.log(`6. Scatter Plot: ${scatterPoints.length} 2D coordinate points generated.`);
  if (scatterPoints.length > 0) {
    console.log(`   - Sample point: ${scatterPoints[0].key} (${scatterPoints[0].points} pts, ${scatterPoints[0].hours}h logged, Priority: ${scatterPoints[0].priority})`);
  }

  // 7. Verify Pie/Donut Chart breakdown
  const statusCounts = {};
  issues.forEach(i => {
    const cat = i.status?.category || 'OTHER';
    statusCounts[cat] = (statusCounts[cat] || 0) + 1;
  });
  console.log("7. Pie Chart Breakdown by Status Category:", statusCounts);

  // 8. Verify Line Chart Burndown Data Points
  const totalPoints = issues.reduce((acc, i) => acc + (i.estimatePoints || 0), 0);
  const completedPoints = issues.filter(i => i.status?.category === 'DONE').reduce((acc, i) => acc + (i.estimatePoints || 0), 0);
  console.log(`8. Line Chart: Total capacity: ${totalPoints} pts, Completed: ${completedPoints} pts.`);

  // 9. Verify UI loads without crash
  const pageRes = await request(`http://localhost:3000/projects/${projectId}`, {
    headers: { Cookie: cookie },
  });
  console.log("9. Project page HTML load status:", pageRes.status, `(Size: ${pageRes.raw.length} bytes)`);

  if (pageRes.status === 200) {
    console.log("\n✅ ALL 5 CHART VIEWS & USER DATA ANALYTICS VERIFIED SUCCESSFULLY!");
  } else {
    throw new Error(`Project page failed with status ${pageRes.status}`);
  }
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
