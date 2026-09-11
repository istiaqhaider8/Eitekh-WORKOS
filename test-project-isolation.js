const http = require("http");
const BASE_URL = "http://localhost:3000";

function makeRequest(urlPath, method = "GET", body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const bodyStr = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;
    const reqHeaders = {
      "Content-Type": "application/json",
      ...headers,
    };
    if (bodyStr) {
      reqHeaders["Content-Length"] = Buffer.byteLength(bodyStr);
    }
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: reqHeaders,
    };

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

    req.on("error", reject);
    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

async function login(email, password) {
  const res = await makeRequest("/api/auth/login", "POST", { email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.data)}`);
  }
  return res.headers["set-cookie"] ? res.headers["set-cookie"][0] : "";
}

async function runTests() {
  console.log("=== Testing Project & Role Access Control Isolation ===\n");
  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
    }
  }

  try {
    // 1. Login as Org Admin (Sarah) and Standard Member (Marcus)
    const adminCookie = await login("sarah@acme.com", "Password123!");
    const memberCookie = await login("marcus@acme.com", "Password123!");
    assert(adminCookie && memberCookie, "Authenticated Sarah (Admin) and Marcus (Member)");

    // 2. Get Admin Context and find workspace / org
    const meAdmin = await makeRequest("/api/auth/me", "GET", null, { Cookie: adminCookie });
    const org = meAdmin.data.user.organizations[0];
    const workspace = org.workspaces[0];
    const orgId = org.id;
    const workspaceId = workspace.id;
    assert(orgId && workspaceId, `Resolved Org: ${org.name}, Workspace: ${workspace.name}`);

    // 3. Create an Isolated Project (Project Secret) with only Sarah as member
    const createProjectRes = await makeRequest(
      "/api/projects",
      "POST",
      {
        workspaceId,
        name: `Secret Project ${Date.now()}`,
        key: `SEC${Math.floor(Math.random() * 1000)}`,
        description: "Restricted access project",
        template: "SCRUM",
      },
      { Cookie: adminCookie }
    );
    assert(createProjectRes.status === 201, "Admin created isolated project");
    const secretProjectId = createProjectRes.data.id;

    // 4. Find assigned Project 1 (where Marcus is a member)
    const meMember = await makeRequest("/api/auth/me", "GET", null, { Cookie: memberCookie });
    const memberAssignedProjects = meMember.data.user.organizations[0].workspaces[0].projects;
    assert(
      !memberAssignedProjects.some((p) => p.id === secretProjectId),
      "Marcus /api/auth/me workspace projects list does NOT include unassigned secret project"
    );

    const assignedProjectId = memberAssignedProjects[0]?.id;
    assert(!!assignedProjectId, `Marcus has assigned project: ${assignedProjectId}`);

    // 5. Test Member Access to UNASSIGNED Project (MUST FAIL with 403)
    const getSecretRes = await makeRequest(`/api/projects/${secretProjectId}`, "GET", null, { Cookie: memberCookie });
    assert(getSecretRes.status === 403, "Marcus GET /api/projects/:secretId returned 403 Forbidden");

    const getSecretIssuesRes = await makeRequest(`/api/projects/${secretProjectId}/issues`, "GET", null, { Cookie: memberCookie });
    assert(getSecretIssuesRes.status === 403, "Marcus GET /api/projects/:secretId/issues returned 403 Forbidden");

    const createSecretIssueRes = await makeRequest(
      `/api/projects/${secretProjectId}/issues`,
      "POST",
      { title: "Unauthorized Issue", issueType: "TASK", priority: "HIGH" },
      { Cookie: memberCookie }
    );
    assert(createSecretIssueRes.status === 403, "Marcus POST /api/projects/:secretId/issues returned 403 Forbidden");

    const getSecretWorkflowsRes = await makeRequest(`/api/workflows?projectId=${secretProjectId}`, "GET", null, { Cookie: memberCookie });
    assert(getSecretWorkflowsRes.status === 403, "Marcus GET /api/workflows?projectId=:secretId returned 403 Forbidden");

    const getSecretExportRes = await makeRequest(`/api/projects/${secretProjectId}/export?format=json`, "GET", null, { Cookie: memberCookie });
    assert(getSecretExportRes.status === 403, "Marcus GET /api/projects/:secretId/export returned 403 Forbidden");

    // 6. Test Member Access to ASSIGNED Project (MUST SUCCEED with 200)
    const getAssignedRes = await makeRequest(`/api/projects/${assignedProjectId}`, "GET", null, { Cookie: memberCookie });
    assert(getAssignedRes.status === 200, "Marcus GET /api/projects/:assignedId returned 200 OK");

    const getAssignedIssuesRes = await makeRequest(`/api/projects/${assignedProjectId}/issues`, "GET", null, { Cookie: memberCookie });
    assert(getAssignedIssuesRes.status === 200, "Marcus GET /api/projects/:assignedId/issues returned 200 OK");

    // 7. Test Roles & Permissions Access Control (Non-admin CANNOT view roles)
    const memberGetRolesRes = await makeRequest(`/api/orgs/${orgId}/roles`, "GET", null, { Cookie: memberCookie });
    assert(memberGetRolesRes.status === 403, "Marcus GET /api/orgs/:id/roles returned 403 Forbidden (Non-admin blocked)");

    const memberCreateRoleRes = await makeRequest(
      `/api/orgs/${orgId}/roles`,
      "POST",
      { name: "Hacker Role", permissions: ["issues:create"] },
      { Cookie: memberCookie }
    );
    assert(memberCreateRoleRes.status === 403, "Marcus POST /api/orgs/:id/roles returned 403 Forbidden");

    // 8. Test Admin CAN access both projects and view roles
    const adminGetSecretRes = await makeRequest(`/api/projects/${secretProjectId}`, "GET", null, { Cookie: adminCookie });
    assert(adminGetSecretRes.status === 200, "Admin Sarah GET /api/projects/:secretId returned 200 OK");

    const adminGetRolesRes = await makeRequest(`/api/orgs/${orgId}/roles`, "GET", null, { Cookie: adminCookie });
    assert(adminGetRolesRes.status === 200, "Admin Sarah GET /api/orgs/:id/roles returned 200 OK");

    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log(`║  RESULT: ${passed} PASSED / ${total - passed} FAILED / ${total} TOTAL`);
    if (passed === total) {
      console.log("║  🎉 PROJECT ISOLATION & ROLE RESTRICTIONS VERIFIED!          ║");
    }
    console.log("╚══════════════════════════════════════════════════════════════╝\n");
  } catch (error) {
    console.error("Test error:", error);
  }
}

runTests();
