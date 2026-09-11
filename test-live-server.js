const http = require("http");

async function request(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json,
        });
      });
    });

    req.on("error", (err) => reject(err));

    if (postData) {
      req.write(typeof postData === "string" ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runLiveTests() {
  console.log("🚀 Starting Full Live HTTP Server Test Suite against http://localhost:3000...\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details) {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name} -> ${details || ""}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST 1: Authentication & Invalid Credentials Guard
    // -------------------------------------------------------------
    const badLoginRes = await request(
      {
        hostname: "localhost",
        port: 3000,
        path: "/api/auth/login",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      { email: "nonexistent@zenith.local", password: "wrong" }
    );
    assert(badLoginRes.status === 401, "Invalid credentials correctly returns HTTP 401", `Status: ${badLoginRes.status}`);

    // -------------------------------------------------------------
    // TEST 2: Demo 1-Click Login as Lead Architect (Sarah)
    // -------------------------------------------------------------
    const leadLoginRes = await request(
      {
        hostname: "localhost",
        port: 3000,
        path: "/api/auth/demo-login",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      { role: "lead" }
    );
    assert(leadLoginRes.status === 200 && leadLoginRes.data.user?.email === "sarah@acme.com", "Demo login as Lead Architect successful");

    // Extract session cookie
    const setCookie = leadLoginRes.headers["set-cookie"];
    const sessionCookie = setCookie ? setCookie[0].split(";")[0] : "";
    assert(sessionCookie.includes("zenith_session_token"), "Secure session token cookie issued");

    // -------------------------------------------------------------
    // TEST 3: Auth Session Verification (/api/auth/me)
    // -------------------------------------------------------------
    const meRes = await request({
      hostname: "localhost",
      port: 3000,
      path: "/api/auth/me",
      method: "GET",
      headers: { Cookie: sessionCookie },
    });
    assert(meRes.status === 200 && meRes.data.user?.organizations?.length > 0, "/api/auth/me returns authenticated user with active organizations");

    // Get the first project from user's organization
    const org = meRes.data.user.organizations[0];
    const project = org.workspaces[0].projects[0];
    assert(project && project.key === "CP", "Located active Project Customer Portal (CP)");

    // -------------------------------------------------------------
    // TEST 4: Fetch Project Issues
    // -------------------------------------------------------------
    const issuesRes = await request({
      hostname: "localhost",
      port: 3000,
      path: `/api/projects/${project.id}/issues`,
      method: "GET",
      headers: { Cookie: sessionCookie },
    });
    assert(issuesRes.status === 200 && Array.isArray(issuesRes.data.issues), "Fetched project issues successfully");
    const initialCount = issuesRes.data.issues.length;

    // -------------------------------------------------------------
    // TEST 5: Atomic Issue Creation with Sequential Key Generator
    // -------------------------------------------------------------
    const createIssueRes = await request(
      {
        hostname: "localhost",
        port: 3000,
        path: `/api/projects/${project.id}/issues`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: sessionCookie,
        },
      },
      {
        title: "Automated Live Test Issue",
        issueType: "BUG",
        priority: "CRITICAL",
        estimatePoints: 5,
      }
    );
    assert(createIssueRes.status === 201, "Created new issue via API (HTTP 201)");
    const createdIssue = createIssueRes.data.issue;
    assert(createdIssue && createdIssue.issueKey.startsWith("CP-"), `Generated sequential issue key: ${createdIssue.issueKey}`);

    // -------------------------------------------------------------
    // TEST 6: Issue Details & Inline Updates
    // -------------------------------------------------------------
    const issueDetailRes = await request({
      hostname: "localhost",
      port: 3000,
      path: `/api/issues/${createdIssue.id}`,
      method: "GET",
      headers: { Cookie: sessionCookie },
    });
    assert(issueDetailRes.status === 200 && issueDetailRes.data.issue.title === "Automated Live Test Issue", "Fetched individual issue details");

    const updateIssueRes = await request(
      {
        hostname: "localhost",
        port: 3000,
        path: `/api/issues/${createdIssue.id}`,
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      },
      { priority: "HIGH" }
    );
    assert(updateIssueRes.status === 200 && updateIssueRes.data.issue.priority === "HIGH", "Updated issue priority via PATCH");

    // -------------------------------------------------------------
    // TEST 7: Subtask Creation & Toggle
    // -------------------------------------------------------------
    const subtaskRes = await request(
      {
        hostname: "localhost",
        port: 3000,
        path: `/api/issues/${createdIssue.id}/subtasks`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      },
      { title: "Test Subtask 1" }
    );
    assert(subtaskRes.status === 201 && subtaskRes.data.subtask.title === "Test Subtask 1", "Added subtask to issue");

    const toggleSubtaskRes = await request(
      {
        hostname: "localhost",
        port: 3000,
        path: `/api/subtasks/${subtaskRes.data.subtask.id}`,
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      },
      { isCompleted: true }
    );
    assert(toggleSubtaskRes.status === 200 && toggleSubtaskRes.data.subtask.isCompleted === true, "Toggled subtask completion");

    // -------------------------------------------------------------
    // TEST 8: Comments with @Mentions
    // -------------------------------------------------------------
    const commentRes = await request(
      {
        hostname: "localhost",
        port: 3000,
        path: `/api/issues/${createdIssue.id}/comments`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      },
      { content: "Hello @marcus, this is a test comment for live verification!" }
    );
    assert(commentRes.status === 201 && commentRes.data.comment.content.includes("@marcus"), "Added comment with @mention trigger");

    // -------------------------------------------------------------
    // TEST 9: Time Tracking Logger
    // -------------------------------------------------------------
    const timeRes = await request(
      {
        hostname: "localhost",
        port: 3000,
        path: `/api/issues/${createdIssue.id}/time-entries`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      },
      { durationMinutes: 90, description: "Automated test development work" }
    );
    assert(timeRes.status === 201 && timeRes.data.timeEntry.durationMinutes === 90, "Logged 90 minutes of work against issue");

    // -------------------------------------------------------------
    // TEST 10: Super Admin Role Security Guard
    // -------------------------------------------------------------
    // Lead Architect (Sarah) should receive HTTP 403 when trying to access Super Admin API
    const nonAdminForbiddenRes = await request({
      hostname: "localhost",
      port: 3000,
      path: "/api/super-admin/stats",
      method: "GET",
      headers: { Cookie: sessionCookie },
    });
    assert(nonAdminForbiddenRes.status === 403, "Non-Super-Admin correctly blocked with HTTP 403 from Super Admin API");

    // -------------------------------------------------------------
    // TEST 11: Super Admin Access & Feature Flags
    // -------------------------------------------------------------
    const adminLoginRes = await request(
      {
        hostname: "localhost",
        port: 3000,
        path: "/api/auth/demo-login",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      { role: "admin" }
    );
    const adminSetCookie = adminLoginRes.headers["set-cookie"];
    const adminCookie = adminSetCookie ? adminSetCookie[0].split(";")[0] : "";

    const adminStatsRes = await request({
      hostname: "localhost",
      port: 3000,
      path: "/api/super-admin/stats",
      method: "GET",
      headers: { Cookie: adminCookie },
    });
    assert(adminStatsRes.status === 200 && adminStatsRes.data.kpis?.totalOrgs >= 1, "Super Admin successfully queries platform KPIs & System Health");

    // Test feature flag toggle
    const toggleFlagRes = await request(
      {
        hostname: "localhost",
        port: 3000,
        path: "/api/super-admin/features",
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
      },
      { key: "SCRUM", isGlobalEnabled: true }
    );
    assert(toggleFlagRes.status === 200 && toggleFlagRes.data.flag.key === "SCRUM", "Super Admin toggled feature access flag");

    console.log(`\n🎉 Live Server Integration Summary: ${passed} Passed, ${failed} Failed\n`);
  } catch (err) {
    console.error("Live test suite crashed:", err);
    process.exit(1);
  }
}

runLiveTests();
