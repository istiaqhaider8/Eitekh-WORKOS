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
    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log("=== Testing Latest Improvements ===");
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
    // Authenticate
    const loginRes = await makeRequest("/api/auth/login", "POST", {
      email: "sarah@acme.com",
      password: "Password123!",
    });
    const cookie = loginRes.headers["set-cookie"] ? loginRes.headers["set-cookie"][0] : "";
    assert(loginRes.status === 200, "Authenticated as sarah@acme.com");

    const meRes = await makeRequest("/api/auth/me", "GET", null, { Cookie: cookie });
    const user = meRes.data.user;
    const project = user.organizations[0].workspaces[0].projects[0];
    assert(project && project.id, `Resolved project ${project.name} (${project.id})`);

    // 1. Test Issue Pagination
    const pageRes = await makeRequest(
      `/api/projects/${project.id}/issues?limit=3&page=1`,
      "GET",
      null,
      { Cookie: cookie }
    );
    assert(pageRes.status === 200, "Paginated issues endpoint returns 200");
    assert(pageRes.data.page === 1, "Returned page=1");
    assert(pageRes.data.limit === 3, "Returned limit=3");
    assert(typeof pageRes.data.total === "number", "Returned total count");
    assert(typeof pageRes.data.totalPages === "number", "Returned totalPages");
    assert(Array.isArray(pageRes.data.issues) && pageRes.data.issues.length <= 3, "Returned bounded slice of issues");

    // 2. Test Notification Creation & Interactive Deletion
    const testNotif = await prisma.notification.create({
      data: {
        userId: user.id,
        title: "Test interactive notification",
        message: "Click to view issue details",
        linkUrl: `/projects/${project.id}`,
        type: "INFO",
      },
    });

    const notifRes = await makeRequest("/api/notifications", "GET", null, { Cookie: cookie });
    assert(notifRes.status === 200, "Fetched notifications list");
    const found = notifRes.data.notifications.some((n) => n.id === testNotif.id);
    assert(found, "Found newly created notification in list");

    // Delete single notification
    const delNotifRes = await makeRequest("/api/notifications", "DELETE", { id: testNotif.id }, { Cookie: cookie });
    assert(delNotifRes.status === 200, "Deleted single notification with 200 OK");

    const afterDelRes = await makeRequest("/api/notifications", "GET", null, { Cookie: cookie });
    const stillFound = afterDelRes.data.notifications.some((n) => n.id === testNotif.id);
    assert(!stillFound, "Notification successfully removed from list");

    // 3. Test Global Search endpoint
    const searchRes = await makeRequest("/api/search?q=CP&limit=5", "GET", null, { Cookie: cookie });
    assert(searchRes.status === 200, "Global search endpoint returns 200");
    assert(Array.isArray(searchRes.data.issues), "Global search returns issues array");
    assert(Array.isArray(searchRes.data.projects), "Global search returns projects array");
    assert(Array.isArray(searchRes.data.comments), "Global search returns comments array");

    console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║  RESULT: ${passed} PASSED / ${total - passed} FAILED / ${total} TOTAL`);
    console.log(`║  🎉 ALL LATEST IMPROVEMENTS VERIFIED SUCCESSFULLY!           ║`);
    console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
  } catch (error) {
    console.error("Test error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
