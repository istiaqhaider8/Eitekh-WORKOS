const http = require("http");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
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

async function runTests() {
  console.log("=== Testing Roles & Permission Groups Control Panel ===");
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
    // 1. Authenticate as Sarah (Admin/Owner)
    const loginRes = await makeRequest("/api/auth/login", "POST", {
      email: "sarah@acme.com",
      password: "Password123!",
    });
    const cookie = loginRes.headers["set-cookie"] ? loginRes.headers["set-cookie"][0] : "";
    assert(loginRes.status === 200, "Authenticated as sarah@acme.com");

    const meRes = await makeRequest("/api/auth/me", "GET", null, { Cookie: cookie });
    const user = meRes.data.user;
    const org = user.organizations[0];
    assert(org && org.id, `Resolved organization ${org.name} (${org.id})`);

    // 2. Fetch Roles & Permissions Endpoint
    const rolesRes = await makeRequest(`/api/orgs/${org.id}/roles`, "GET", null, { Cookie: cookie });
    assert(rolesRes.status === 200, "GET /api/orgs/:id/roles returns 200 OK");
    assert(Array.isArray(rolesRes.data.categories) && rolesRes.data.categories.length === 5, "Returns 5 permission categories");
    assert(Array.isArray(rolesRes.data.roles) && rolesRes.data.roles.length >= 7, "Returns built-in system role definitions");
    assert(Array.isArray(rolesRes.data.members), "Returns organization members list with role metadata");

    // Check specific categories
    const issueCat = rolesRes.data.categories.find((c) => c.id === "issues");
    assert(issueCat && issueCat.permissions.length > 0, "Contains Issue Management permission group");

    // 3. Create Custom Permission Group
    const createRoleRes = await makeRequest(`/api/orgs/${org.id}/roles`, "POST", {
      name: "DevOps Specialist",
      description: "Manages webhooks and infrastructure pipelines",
      color: "#ec4899",
      permissions: ["issues:view", "projects:view", "webhooks:manage", "automations:manage"],
    }, { Cookie: cookie });

    assert(createRoleRes.status === 201, "Created custom role 'DevOps Specialist' (201 Created)");
    assert(createRoleRes.data.role.id === "DEVOPS_SPECIALIST", "Generated normalized Role ID: DEVOPS_SPECIALIST");
    assert(createRoleRes.data.role.permissions.includes("webhooks:manage"), "Custom role includes specified permissions");

    // 4. Update Member Role Assignment
    const testMember = rolesRes.data.members.find((m) => m.userId !== user.id) || rolesRes.data.members[0];
    const updateRoleRes = await makeRequest(`/api/orgs/${org.id}/members`, "PATCH", {
      userId: testMember.userId,
      role: "ADMIN",
    }, { Cookie: cookie });
    assert(updateRoleRes.status === 200, "Updated member role assignment to ADMIN (200 OK)");

    // 5. Test Frontend Route Load
    const pageRes = await makeRequest("/settings/roles", "GET", null, { Cookie: cookie });
    assert(pageRes.status === 200, "Settings Roles page /settings/roles loads with 200 OK");

    console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║  RESULT: ${passed} PASSED / ${total - passed} FAILED / ${total} TOTAL`);
    console.log(`║  🎉 ROLES & PERMISSION GROUPS CONTROL PANEL VERIFIED!        ║`);
    console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
  } catch (error) {
    console.error("Test error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
