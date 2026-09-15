const http = require("http");

// ─── HTTP Helper ───────────────────────────────────────────────────
function req(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "localhost",
      port: 3000,
      path,
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (cookie) opts.headers.Cookie = cookie;
    const r = http.request(opts, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        let json;
        try { json = JSON.parse(d); } catch { json = d; }
        resolve({ status: res.statusCode, headers: res.headers, data: json });
      });
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
function extractCookie(res) {
  const sc = res.headers["set-cookie"];
  return sc ? sc[0].split(";")[0] : "";
}

let passed = 0, failed = 0, total = 0;
function section(name) { console.log(`\n━━━ ${name} ━━━`); }
function assert(ok, name, detail) {
  total++;
  if (ok) { console.log(`  ✅ ${name}`); passed++; }
  else { console.error(`  ❌ ${name}  →  ${detail || "assertion failed"}`); failed++; }
}

(async () => {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  EITEKH WORKOS — NEW FEATURES TEST SUITE (Phase 2 & 3)     ║");
  console.log("║  Testing all newly implemented APIs and improvements        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Login as different roles
  const adminLogin = await req("POST", "/api/auth/demo-login", { role: "admin" });
  const adminCookie = extractCookie(adminLogin);
  const leadLogin = await req("POST", "/api/auth/demo-login", { role: "lead" });
  const leadCookie = extractCookie(leadLogin);
  const devLogin = await req("POST", "/api/auth/demo-login", { role: "dev" });
  const devCookie = extractCookie(devLogin);
  const ownerLogin = await req("POST", "/api/auth/demo-login", { role: "owner" });
  const ownerCookie = extractCookie(ownerLogin);

  // Get project and org info
  const meRes = await req("GET", "/api/auth/me", null, leadCookie);
  const org = meRes.data.user.organizations[0];
  const orgId = org.id;
  const ws = org.workspaces[0];
  const wsId = ws.id;
  const projectId = ws.projects[0].id;

  // ================================================================
  // NEW: PASSWORD CHANGE API
  // ================================================================
  section("NEW: Change Password API (/api/auth/change-password)");

  const weakPwd = await req("POST", "/api/auth/change-password", {
    currentPassword: "Password123!",
    newPassword: "weak",
  }, leadCookie);
  assert(weakPwd.status === 400, "Password — weak password rejected");

  const wrongCurrent = await req("POST", "/api/auth/change-password", {
    currentPassword: "WrongPassword!",
    newPassword: "NewSecure99!",
  }, leadCookie);
  assert(wrongCurrent.status === 400 || wrongCurrent.status === 401, "Password — wrong current password rejected");

  const goodPwd = await req("POST", "/api/auth/change-password", {
    currentPassword: "Password123!",
    newPassword: "NewSecure99!",
  }, leadCookie);
  assert(goodPwd.status === 200, "Password — valid change accepted");

  // Change back for subsequent tests
  await req("POST", "/api/auth/change-password", {
    currentPassword: "NewSecure99!",
    newPassword: "Password123!",
  }, leadCookie);

  // ================================================================
  // NEW: SESSIONS API
  // ================================================================
  section("NEW: Sessions API (/api/auth/sessions)");

  const sessRes = await req("GET", "/api/auth/sessions", null, leadCookie);
  assert(sessRes.status === 200, "Sessions — list sessions");
  assert(sessRes.data.sessions?.length >= 1, `Sessions — ${sessRes.data.sessions?.length} active session(s)`);
  const hasCurrent = sessRes.data.sessions?.some(s => s.isCurrent);
  assert(hasCurrent, "Sessions — current session marked");

  // ================================================================
  // NEW: MFA TOGGLE API
  // ================================================================
  section("NEW: MFA Toggle API (/api/auth/mfa)");

  const enableMfa = await req("PATCH", "/api/auth/mfa", { enabled: true }, leadCookie);
  assert(enableMfa.status === 200 && enableMfa.data.mfaEnabled === true, "MFA — enabled successfully");
  assert(enableMfa.data.recoveryCodes?.length >= 4, `MFA — ${enableMfa.data.recoveryCodes?.length} recovery codes generated`);

  const disableMfa = await req("PATCH", "/api/auth/mfa", { enabled: false }, leadCookie);
  assert(disableMfa.status === 200 && disableMfa.data.mfaEnabled === false, "MFA — disabled successfully");

  // ================================================================
  // NEW: PROFILE API
  // ================================================================
  section("NEW: Profile API (/api/auth/profile)");

  const profileUpdate = await req("PATCH", "/api/auth/profile", {
    firstName: "Sarah",
    lastName: "Chen-Updated",
    jobTitle: "Principal Architect",
    timezone: "America/Los_Angeles",
  }, leadCookie);
  assert(profileUpdate.status === 200, "Profile — updated successfully");

  // Revert
  await req("PATCH", "/api/auth/profile", { lastName: "Chen", jobTitle: "Lead Software Architect", timezone: "America/New_York" }, leadCookie);

  // ================================================================
  // NEW: PASSWORD STRENGTH ON REGISTER
  // ================================================================
  section("NEW: Password Strength Validation on Register");

  const weakReg = await req("POST", "/api/auth/register", {
    firstName: "Test", lastName: "Weak", email: `weak_${Date.now()}@test.com`,
    password: "short", company: "Test",
  });
  assert(weakReg.status === 400, "Register — weak password rejected at API level");

  // ================================================================
  // NEW: ORGANIZATION SETTINGS API
  // ================================================================
  section("NEW: Organization Settings API (/api/orgs/:id)");

  const orgGet = await req("GET", `/api/orgs/${orgId}`, null, ownerCookie);
  assert(orgGet.status === 200, "Org — get organization details");

  const orgPatch = await req("PATCH", `/api/orgs/${orgId}`, {
    timezone: "America/Chicago",
  }, ownerCookie);
  assert(orgPatch.status === 200, "Org — updated timezone");

  // Revert
  await req("PATCH", `/api/orgs/${orgId}`, { timezone: "America/New_York" }, ownerCookie);

  // ================================================================
  // NEW: ORGANIZATION MEMBERS API
  // ================================================================
  section("NEW: Organization Members API (/api/orgs/:id/members)");

  const membersRes = await req("GET", `/api/orgs/${orgId}/members`, null, ownerCookie);
  assert(membersRes.status === 200, "Org Members — listed members");
  const membersList = Array.isArray(membersRes.data) ? membersRes.data : membersRes.data.members;
  assert(membersList?.length >= 3, `Org Members — ${membersList?.length} members found`);

  // ================================================================
  // NEW: WORKSPACE API
  // ================================================================
  section("NEW: Workspace CRUD API (/api/workspaces)");

  const newWs = await req("POST", "/api/workspaces", {
    orgId, name: "QA Testing Workspace", description: "For automated tests",
  }, ownerCookie);
  assert(newWs.status === 201 || newWs.status === 200, "Workspace — created new workspace");
  const newWsId = newWs.data.workspace?.id || newWs.data.id;

  if (newWsId) {
    const wsGet = await req("GET", `/api/workspaces/${newWsId}`, null, ownerCookie);
    assert(wsGet.status === 200, "Workspace — fetched details");

    const wsPatch = await req("PATCH", `/api/workspaces/${newWsId}`, {
      description: "Updated description",
    }, ownerCookie);
    assert(wsPatch.status === 200, "Workspace — updated");
  }

  // ================================================================
  // NEW: TEAM API
  // ================================================================
  section("NEW: Team CRUD API (/api/teams)");

  const newTeam = await req("POST", "/api/teams", {
    workspaceId: wsId, name: "QA Automation Team", description: "Test team",
  }, leadCookie);
  assert(newTeam.status === 201 || newTeam.status === 200, "Team — created new team");
  const teamId = newTeam.data.team?.id || newTeam.data.id;

  if (teamId) {
    const teamGet = await req("GET", `/api/teams/${teamId}`, null, leadCookie);
    assert(teamGet.status === 200, "Team — fetched details");

    const teamPatch = await req("PATCH", `/api/teams/${teamId}`, {
      description: "Updated QA team",
    }, leadCookie);
    assert(teamPatch.status === 200, "Team — updated");
  }

  // ================================================================
  // NEW: PROJECT CRUD API
  // ================================================================
  section("NEW: Project CRUD API (/api/projects)");

  const projKey = "TP" + Math.floor(Math.random() * 899 + 100);
  const newProject = await req("POST", "/api/projects", {
    workspaceId: wsId, name: "Test Project Alpha", key: projKey, description: "Automated test project",
  }, leadCookie);
  assert(newProject.status === 201 || newProject.status === 200, "Project — created new project");
  const testProjId = newProject.data.project?.id || newProject.data.id;

  if (testProjId) {
    const projGet = await req("GET", `/api/projects/${testProjId}`, null, leadCookie);
    assert(projGet.status === 200, "Project — fetched details");

    const projPatch = await req("PATCH", `/api/projects/${testProjId}`, {
      description: "Updated test project",
    }, leadCookie);
    assert(projPatch.status === 200, "Project — updated");
  }

  // ================================================================
  // NEW: ISSUE DEPENDENCIES API
  // ================================================================
  section("NEW: Issue Dependencies API (/api/issues/:id/dependencies)");

  // Create 2 issues to link
  const issA = await req("POST", `/api/projects/${projectId}/issues`, { title: "Blocker Issue" }, leadCookie);
  const issB = await req("POST", `/api/projects/${projectId}/issues`, { title: "Blocked Issue" }, leadCookie);
  const issAId = issA.data.issue?.id || issA.data.id;
  const issBId = issB.data.issue?.id || issB.data.id;

  const addDep = await req("POST", `/api/issues/${issAId}/dependencies`, {
    targetIssueId: issBId, type: "BLOCKS",
  }, leadCookie);
  assert(addDep.status === 201 || addDep.status === 200, "Dependencies — created BLOCKS relationship");

  const getDeps = await req("GET", `/api/issues/${issAId}/dependencies`, null, leadCookie);
  assert(getDeps.status === 200, "Dependencies — listed dependencies");

  // ================================================================
  // NEW: EPIC MANAGEMENT API
  // ================================================================
  section("NEW: Epic Management API (/api/epics)");

  const newEpic = await req("POST", "/api/epics", {
    projectId, name: "Test Epic", summary: "Testing epic management", color: "#ff6600",
  }, leadCookie);
  assert(newEpic.status === 201 || newEpic.status === 200, "Epic — created");
  const epicId = newEpic.data.epic?.id || newEpic.data.id;

  const listEpics = await req("GET", `/api/epics?projectId=${projectId}`, null, leadCookie);
  const epicsList = Array.isArray(listEpics.data) ? listEpics.data : listEpics.data.epics;
  assert(listEpics.status === 200 && epicsList?.length >= 1, "Epic — listed epics");

  if (epicId) {
    const epicPatch = await req("PATCH", `/api/epics/${epicId}`, { summary: "Updated summary" }, leadCookie);
    assert(epicPatch.status === 200, "Epic — updated");
  }

  // ================================================================
  // NEW: COMPONENT MANAGEMENT API
  // ================================================================
  section("NEW: Component Management API (/api/components)");

  const newComp = await req("POST", "/api/components", {
    projectId, name: "API Gateway", description: "Request routing",
  }, leadCookie);
  assert(newComp.status === 201 || newComp.status === 200, "Component — created");

  const listComps = await req("GET", `/api/components?projectId=${projectId}`, null, leadCookie);
  const compsList = Array.isArray(listComps.data) ? listComps.data : listComps.data.components;
  assert(listComps.status === 200 && compsList?.length >= 1, "Component — listed");

  // ================================================================
  // NEW: WATCHER API
  // ================================================================
  section("NEW: Watcher API (/api/issues/:id/watchers)");

  const addWatcher = await req("POST", `/api/issues/${issAId}/watchers`, {}, leadCookie);
  assert(addWatcher.status === 201 || addWatcher.status === 200, "Watcher — added self as watcher");

  const getWatchers = await req("GET", `/api/issues/${issAId}/watchers`, null, leadCookie);
  assert(getWatchers.status === 200, "Watcher — listed watchers");

  // ================================================================
  // NEW: BULK ISSUE UPDATE
  // ================================================================
  section("NEW: Bulk Issue Update (/api/issues/bulk)");

  const bulkRes = await req("PATCH", "/api/issues/bulk", {
    issueIds: [issAId, issBId],
    updates: { priority: "HIGH" },
  }, leadCookie);
  assert(bulkRes.status === 200, "Bulk Update — updated 2 issues priority to HIGH");

  // Verify
  const verA = await req("GET", `/api/issues/${issAId}`, null, leadCookie);
  assert(verA.data.issue?.priority === "HIGH", "Bulk Update — verified issue A priority");

  // ================================================================
  // NEW: COMMENT EDIT & DELETE
  // ================================================================
  section("NEW: Comment Edit & Delete (/api/comments/:id)");

  const cmt = await req("POST", `/api/issues/${issAId}/comments`, {
    content: "Original comment text",
  }, leadCookie);
  const cmtId = cmt.data.comment?.id;

  if (cmtId) {
    const editCmt = await req("PATCH", `/api/comments/${cmtId}`, {
      content: "Edited comment text",
    }, leadCookie);
    assert(editCmt.status === 200, "Comment — edited successfully");

    const delCmt = await req("DELETE", `/api/comments/${cmtId}`, null, leadCookie);
    assert(delCmt.status === 200, "Comment — deleted successfully");
  }

  // ================================================================
  // NEW: GLOBAL SEARCH
  // ================================================================
  section("NEW: Global Search API (/api/search)");

  const searchRes = await req("GET", "/api/search?q=Kanban", null, leadCookie);
  assert(searchRes.status === 200, "Search — executed global search");

  // ================================================================
  // NEW: WORKFLOW MANAGEMENT
  // ================================================================
  section("NEW: Custom Workflow API (/api/workflows)");

  const listWf = await req("GET", `/api/workflows?projectId=${projectId}`, null, leadCookie);
  assert(listWf.status === 200, "Workflow — listed workflows");

  // ================================================================
  // NEW: CUSTOM FIELDS
  // ================================================================
  section("NEW: Custom Fields API (/api/custom-fields)");

  const newField = await req("POST", "/api/custom-fields", {
    scopeType: "PROJECT", scopeId: projectId,
    name: "Environment", fieldType: "SELECT",
    optionsJson: JSON.stringify(["Development", "Staging", "Production"]),
  }, leadCookie);
  assert(newField.status === 201 || newField.status === 200, "Custom Field — created SELECT field");
  const fieldId = newField.data.customField?.id || newField.data.field?.id;

  if (fieldId) {
    const setVal = await req("PATCH", `/api/issues/${issAId}/custom-fields`, {
      values: [{ customFieldId: fieldId, valueString: "Production" }],
    }, leadCookie);
    assert(setVal.status === 200, "Custom Field — set value on issue");
  }

  // ================================================================
  // NEW: AUTOMATION RULES
  // ================================================================
  section("NEW: Automation Rules API (/api/automations)");

  const newRule = await req("POST", "/api/automations", {
    projectId, name: "Auto-assign on creation",
    triggerType: "ON_CREATION",
    triggerConfig: JSON.stringify({}),
    conditionRules: JSON.stringify({}),
    actionType: "SET_ASSIGNEE",
    actionConfig: JSON.stringify({ assigneeId: meRes.data.user.id }),
  }, leadCookie);
  assert(newRule.status === 201 || newRule.status === 200, "Automation — created rule");

  const listRules = await req("GET", `/api/automations?projectId=${projectId}`, null, leadCookie);
  assert(listRules.status === 200, "Automation — listed rules");

  // ================================================================
  // NEW: RECURRING TASKS
  // ================================================================
  section("NEW: Recurring Tasks API (/api/recurring-tasks)");

  const newRecurring = await req("POST", "/api/recurring-tasks", {
    projectId,
    scheduleCron: "0 9 * * 1",
    templateData: JSON.stringify({ title: "Weekly standup prep", issueType: "TASK", priority: "LOW" }),
    isActive: true,
  }, leadCookie);
  assert(newRecurring.status === 201 || newRecurring.status === 200, "Recurring Task — created weekly task");

  const listRecurring = await req("GET", `/api/recurring-tasks?projectId=${projectId}`, null, leadCookie);
  assert(listRecurring.status === 200, "Recurring Task — listed tasks");

  // ================================================================
  // NEW: WEBHOOKS
  // ================================================================
  section("NEW: Webhooks API (/api/webhooks)");

  const newWebhook = await req("POST", "/api/webhooks", {
    orgId, projectId,
    targetUrl: "https://hooks.example.com/eitekh",
    secret: "wh_secret_12345",
    events: JSON.stringify(["ISSUE_CREATED", "ISSUE_UPDATED"]),
    isActive: true,
  }, leadCookie);
  assert(newWebhook.status === 201 || newWebhook.status === 200, "Webhook — registered");

  const listWebhooks = await req("GET", `/api/webhooks?projectId=${projectId}`, null, leadCookie);
  assert(listWebhooks.status === 200, "Webhook — listed");

  // ================================================================
  // NEW: EXPORT API
  // ================================================================
  section("NEW: Import/Export API (/api/projects/:id/export)");

  const csvExport = await req("GET", `/api/projects/${projectId}/export?format=csv`, null, leadCookie);
  assert(csvExport.status === 200, "Export — CSV export");

  const jsonExport = await req("GET", `/api/projects/${projectId}/export?format=json`, null, leadCookie);
  assert(jsonExport.status === 200, "Export — JSON export");

  // ================================================================
  // NEW: IMPORT API
  // ================================================================
  section("NEW: Import API (/api/projects/:id/import)");

  const csvImport = await req("POST", `/api/projects/${projectId}/import`, {
    csvData: "Title,Type,Priority\nImported Task 1,TASK,MEDIUM\nImported Bug,BUG,HIGH\n",
  }, leadCookie);
  assert(csvImport.status === 200 || csvImport.status === 201, "Import — CSV import");

  // ================================================================
  // NEW: SECURITY BUG FIXES VERIFICATION
  // ================================================================
  section("NEW: Security Bug Fixes Verification");

  // Unauthenticated subtask delete should be blocked
  const unauthSubDel = await req("DELETE", "/api/subtasks/fake-id-123");
  assert(unauthSubDel.status === 401, "Security — unauthenticated subtask DELETE blocked (401)");

  // Unauthenticated feature flag read should be blocked
  const unauthFlags = await req("GET", "/api/super-admin/features");
  assert(unauthFlags.status === 401 || unauthFlags.status === 403, "Security — unauthenticated feature flag GET blocked");

  // Issue detail GET requires auth
  const unauthIssue = await req("GET", `/api/issues/${issAId}`);
  assert(unauthIssue.status === 401, "Security — unauthenticated issue GET blocked (401)");

  // ================================================================
  // FINAL SUMMARY
  // ================================================================
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log(`║  FINAL RESULT: ${passed} PASSED / ${failed} FAILED / ${total} TOTAL`);
  if (failed === 0) {
    console.log("║  🎉 ALL NEW FEATURES VERIFIED SUCCESSFULLY                  ║");
  } else {
    console.log(`║  ⚠️  ${failed} test(s) need attention                              ║`);
  }
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  process.exit(failed > 0 ? 1 : 0);
})();
