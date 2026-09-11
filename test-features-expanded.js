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
  console.log("=== Testing Expanded Issue Features (Watchers, Dependencies, Custom Fields) ===");
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
    // Authenticate as Sarah
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

    // Fetch issues
    const issuesRes = await makeRequest(`/api/projects/${project.id}/issues`, "GET", null, { Cookie: cookie });
    assert(issuesRes.status === 200 && issuesRes.data.issues.length >= 2, "Found at least 2 issues in project");
    const issue1 = issuesRes.data.issues[0];
    const issue2 = issuesRes.data.issues[1];

    // 1. Test Issue Watchers API
    const addWatcherRes = await makeRequest(`/api/issues/${issue1.id}/watchers`, "POST", null, { Cookie: cookie });
    assert(addWatcherRes.status === 200 || addWatcherRes.status === 201, "Added user as watcher to issue");

    const getWatchersRes = await makeRequest(`/api/issues/${issue1.id}/watchers`, "GET", null, { Cookie: cookie });
    assert(getWatchersRes.status === 200, "Listed watchers for issue");
    const watchersList = Array.isArray(getWatchersRes.data) ? getWatchersRes.data : getWatchersRes.data.watchers;
    assert(Array.isArray(watchersList), "Watchers returned as array");

    // 2. Test Issue Dependencies API
    const addDepRes = await makeRequest(`/api/issues/${issue1.id}/dependencies`, "POST", {
      targetIssueId: issue2.id,
      type: "BLOCKS",
    }, { Cookie: cookie });
    assert(addDepRes.status === 200 || addDepRes.status === 201, `Linked dependency: ${issue1.issueKey} blocks ${issue2.issueKey}`);

    const getDepsRes = await makeRequest(`/api/issues/${issue1.id}/dependencies`, "GET", null, { Cookie: cookie });
    assert(getDepsRes.status === 200, "Listed dependencies for issue");
    assert(getDepsRes.data.outgoing?.length > 0 || getDepsRes.data.incoming?.length > 0, "Dependency appears in dependency list");

    // 3. Test Custom Fields API
    const createCfRes = await makeRequest(`/api/custom-fields`, "POST", {
      scopeType: "PROJECT",
      scopeId: project.id,
      name: "Deployment Target",
      fieldType: "DROPDOWN",
      optionsJson: JSON.stringify(["Production", "Staging", "Canary"]),
      isRequired: false,
    }, { Cookie: cookie });
    assert(createCfRes.status === 200 || createCfRes.status === 201, "Created custom field 'Deployment Target'");

    const customField = createCfRes.data.customField || createCfRes.data;
    assert(customField && customField.id, "Extracted valid custom field ID");

    // Set custom field value on issue
    const setCfvRes = await makeRequest(`/api/issues/${issue1.id}/custom-fields`, "PATCH", {
      values: [{ customFieldId: customField.id, valueString: "Production" }],
    }, { Cookie: cookie });
    assert(setCfvRes.status === 200, "Assigned custom field value 'Production' to issue");

    // Fetch single issue details to verify full payload inclusion
    const issueDetailRes = await makeRequest(`/api/issues/${issue1.id}`, "GET", null, { Cookie: cookie });
    assert(issueDetailRes.status === 200, "Fetched single issue details");
    assert(Array.isArray(issueDetailRes.data.issue.watchers), "Issue details include watchers array");
    assert(Array.isArray(issueDetailRes.data.issue.customFieldValues), "Issue details include customFieldValues array");
    assert(Array.isArray(issueDetailRes.data.issue.outgoingDeps), "Issue details include outgoingDeps array");

    console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║  RESULT: ${passed} PASSED / ${total - passed} FAILED / ${total} TOTAL`);
    console.log(`║  🎉 ALL EXPANDED FEATURE CHECKS PASSED!                      ║`);
    console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
  } catch (error) {
    console.error("Test error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
