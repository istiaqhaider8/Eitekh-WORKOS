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
  console.log("=== Testing User Invite & Super Admin Role Governance ===\n");
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
    // 1. Authenticate as Super Admin & Org Admin
    const superAdminCookie = await login("admin@eitekh.local", "AdminPass123!");
    const orgAdminCookie = await login("sarah@acme.com", "Password123!");
    const memberCookie = await login("marcus@acme.com", "Password123!");
    assert(superAdminCookie && orgAdminCookie && memberCookie, "Authenticated Super Admin, Org Admin, and Member");

    // 2. Resolve Acme Org details
    const meRes = await makeRequest("/api/auth/me", "GET", null, { Cookie: orgAdminCookie });
    const orgId = meRes.data.user.organizations[0].id;
    assert(!!orgId, `Resolved target orgId: ${orgId}`);

    // 3. Super Admin provisions a new platform user with custom role
    const testUserEmail = `qa.lead.${Date.now()}@acme.com`;
    const provisionRes = await makeRequest(
      "/api/super-admin/users",
      "POST",
      {
        email: testUserEmail,
        firstName: "Elena",
        lastName: "Rostova",
        jobTitle: "Lead QA Automation",
        orgId: orgId,
        role: "QA_ENGINEER",
        password: "Password123!",
      },
      { Cookie: superAdminCookie }
    );
    assert(provisionRes.status === 201, `Super Admin provisioned user: ${testUserEmail} (201 Created)`);
    assert(provisionRes.data.isNewUser === true, "Marked as newly provisioned user");

    // 4. Newly provisioned user can log in immediately
    const elenaCookie = await login(testUserEmail, "Password123!");
    assert(!!elenaCookie, "Elena logged in successfully with provisioned credentials");

    // 5. Verify Elena's role is QA_ENGINEER
    const elenaMeRes = await makeRequest("/api/auth/me", "GET", null, { Cookie: elenaCookie });
    assert(elenaMeRes.data.user.organizations[0].role === "QA_ENGINEER", "Elena's organization role verified as QA_ENGINEER");

    // 6. Super Admin changes Elena's role to PROJECT_MANAGER via PATCH /api/super-admin/users
    const updateRoleRes = await makeRequest(
      "/api/super-admin/users",
      "PATCH",
      {
        userId: provisionRes.data.user.id,
        orgId: orgId,
        role: "PROJECT_MANAGER",
      },
      { Cookie: superAdminCookie }
    );
    assert(updateRoleRes.status === 200, "Super Admin updated user role to PROJECT_MANAGER via PATCH");

    // 7. Verify updated role reflected in /api/auth/me
    const elenaMeUpdated = await makeRequest("/api/auth/me", "GET", null, { Cookie: elenaCookie });
    assert(elenaMeUpdated.data.user.organizations[0].role === "PROJECT_MANAGER", "Elena's updated role verified as PROJECT_MANAGER");

    // 8. Org Admin invites a member via POST /api/orgs/:id/members
    const invitedEmail = `invited.dev.${Date.now()}@acme.com`;
    const inviteRes = await makeRequest(
      `/api/orgs/${orgId}/members`,
      "POST",
      {
        email: invitedEmail,
        firstName: "Leo",
        lastName: "Tolstoy",
        jobTitle: "Backend Developer",
        role: "MEMBER",
        password: "Password123!",
      },
      { Cookie: orgAdminCookie }
    );
    assert(inviteRes.status === 201, `Org Admin invited member: ${invitedEmail} (201 Created)`);
    assert(inviteRes.data.member.role === "MEMBER", "Invited member role set to MEMBER");

    // 9. Standard Member (Marcus) CANNOT invite or provision users (MUST FAIL with 403)
    const memberInviteRes = await makeRequest(
      `/api/orgs/${orgId}/members`,
      "POST",
      {
        email: "hacker@acme.com",
        role: "ADMIN",
      },
      { Cookie: memberCookie }
    );
    assert(memberInviteRes.status === 403, "Standard Member blocked from inviting users (403 Forbidden)");

    const memberProvisionRes = await makeRequest(
      "/api/super-admin/users",
      "POST",
      {
        email: "hacker@acme.com",
        role: "ADMIN",
      },
      { Cookie: memberCookie }
    );
    assert(memberProvisionRes.status === 403, "Standard Member blocked from Super Admin provisioning (403 Forbidden)");

    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log(`║  RESULT: ${passed} PASSED / ${total - passed} FAILED / ${total} TOTAL`);
    if (passed === total) {
      console.log("║  🎉 USER INVITATION & ROLE GOVERNANCE VERIFIED!             ║");
    }
    console.log("╚══════════════════════════════════════════════════════════════╝\n");
  } catch (error) {
    console.error("Test error:", error);
  }
}

runTests();
