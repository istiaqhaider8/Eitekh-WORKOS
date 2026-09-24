import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const BASE_URL = "http://127.0.0.1:3100";

let testResults = [];
function record(name, passed, detail = "") {
  testResults.push({ name, passed, detail });
  const icon = passed ? "✅" : "❌";
  console.log(`${icon} ${name} ${detail ? `(${detail})` : ""}`);
}

async function loginUser(email, password) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${email}: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get("set-cookie");
  const data = await res.json();
  return { data, cookie: setCookie };
}

async function run() {
  console.log("=== Starting Live Ticket Management Module Full Test ===");

  try {
    // 1. Ensure test users & project exist in DB
    const passwordHash = await bcrypt.hash("Password123!", 10);
    
    // Find or create Organization
    let org = await prisma.organization.findFirst();
    if (!org) {
      org = await prisma.organization.create({
        data: { name: "Live Test Org", slug: "live-test-org" },
      });
    }

    // Manager user
    let manager = await prisma.user.findUnique({ where: { email: "manager.ticket.test@example.com" } });
    if (!manager) {
      manager = await prisma.user.create({
        data: {
          email: "manager.ticket.test@example.com",
          passwordHash,
          firstName: "Manager",
          lastName: "Test",
          status: "ACTIVE",
          userType: "EMPLOYEE",
          emailVerifiedAt: new Date(),
        },
      });
    }

    // Client user
    let clientUser = await prisma.user.findUnique({ where: { email: "client.ticket.test@example.com" } });
    if (!clientUser) {
      clientUser = await prisma.user.create({
        data: {
          email: "client.ticket.test@example.com",
          passwordHash,
          firstName: "Client",
          lastName: "Customer",
          status: "ACTIVE",
          userType: "CLIENT",
          emailVerifiedAt: new Date(),
        },
      });
    }

    // Viewer user
    let viewerUser = await prisma.user.findUnique({ where: { email: "viewer.ticket.test@example.com" } });
    if (!viewerUser) {
      viewerUser = await prisma.user.create({
        data: {
          email: "viewer.ticket.test@example.com",
          passwordHash,
          firstName: "Viewer",
          lastName: "Auditor",
          status: "ACTIVE",
          userType: "EMPLOYEE",
          emailVerifiedAt: new Date(),
        },
      });
    }

    // Find existing project in the database
    let project = await prisma.project.findFirst({
      include: { workspace: true },
    });
    if (!project) {
      // Find workspace
      let ws = await prisma.workspace.findFirst();
      if (!ws) {
        ws = await prisma.workspace.create({
          data: { name: "Default WS", slug: "default-ws", organizationId: org.id },
        });
      }
      project = await prisma.project.create({
        data: {
          name: "Ticket Test Project",
          key: "TTP",
          workspaceId: ws.id,
        },
        include: { workspace: true },
      });
    }

    // Ensure OrganizationMember exists for org isolation checks
    const orgId = project.workspace.orgId;
    await prisma.organizationMember.upsert({
      where: { orgId_userId: { orgId, userId: manager.id } },
      update: { role: "ADMIN" },
      create: { orgId, userId: manager.id, role: "ADMIN" },
    });
    await prisma.organizationMember.upsert({
      where: { orgId_userId: { orgId, userId: clientUser.id } },
      update: { role: "MEMBER" },
      create: { orgId, userId: clientUser.id, role: "MEMBER" },
    });
    await prisma.organizationMember.upsert({
      where: { orgId_userId: { orgId, userId: viewerUser.id } },
      update: { role: "MEMBER" },
      create: { orgId, userId: viewerUser.id, role: "MEMBER" },
    });

    // Add memberships
    // Manager -> PROJECT_MANAGER
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: manager.id } },
      update: { role: "PROJECT_MANAGER" },
      create: { projectId: project.id, userId: manager.id, role: "PROJECT_MANAGER" },
    });
    // Viewer -> VIEWER
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: viewerUser.id } },
      update: { role: "VIEWER" },
      create: { projectId: project.id, userId: viewerUser.id, role: "VIEWER" },
    });
    // Client -> MEMBER
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: clientUser.id } },
      update: { role: "MEMBER" },
      create: { projectId: project.id, userId: clientUser.id, role: "MEMBER" },
    });

    console.log(`Setup complete. Project: ${project.key} (${project.id})`);

    // 2. Log in users
    const managerSession = await loginUser("manager.ticket.test@example.com", "Password123!");
    const clientSession = await loginUser("client.ticket.test@example.com", "Password123!");
    const viewerSession = await loginUser("viewer.ticket.test@example.com", "Password123!");

    const managerHeaders = {
      "Content-Type": "application/json",
      Origin: BASE_URL,
      Cookie: managerSession.cookie,
    };
    const clientHeaders = {
      "Content-Type": "application/json",
      Origin: BASE_URL,
      Cookie: clientSession.cookie,
    };
    const viewerHeaders = {
      "Content-Type": "application/json",
      Origin: BASE_URL,
      Cookie: viewerSession.cookie,
    };

    // Test 1: Unauthenticated request to /api/projects/[id]/tickets
    const unauthRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets`);
    record("1. Unauthenticated ticket access rejected", unauthRes.status === 401 || unauthRes.status === 403, `Status: ${unauthRes.status}`);

    // Test 2: Create ticket with Task Assigned Manager option
    const createRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        title: "Live Test Ticket with Assigned Manager",
        description: "Checking that assignedManagerId persists and notifies in live environment",
        category: "BUG_REPORT",
        priority: "HIGH",
        dueDate: new Date(Date.now() + 86400000 * 2).toISOString(),
        assignedManagerId: manager.id,
      }),
    });
    const createdTicketData = await createRes.json();
    const t1 = createdTicketData.ticket;
    record(
      "2. Create ticket with assignedManagerId",
      createRes.status === 201 && t1 && t1.assignedManagerId === manager.id,
      `Status: ${createRes.status}, Ticket: ${t1?.ticketKey}, Manager: ${t1?.assignedManager?.email}`
    );

    // Test 3: Create ticket as CLIENT user
    const clientCreateRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets`, {
      method: "POST",
      headers: clientHeaders,
      body: JSON.stringify({
        title: "Client Raised Issue with UI",
        description: "Dropdown cuts off on small viewports",
        category: "SUPPORT",
        priority: "MEDIUM",
      }),
    });
    const clientTicketData = await clientCreateRes.json();
    const tClient = clientTicketData.ticket;
    record(
      "3. Client user can raise a ticket",
      clientCreateRes.status === 201 && tClient && tClient.createdById === clientUser.id,
      `Status: ${clientCreateRes.status}, Key: ${tClient?.ticketKey}`
    );

    // Test 4: Client list scoping — client should see tClient but NOT t1 (created by manager)
    const clientListRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets`, {
      headers: clientHeaders,
    });
    const clientList = await clientListRes.json();
    const clientSeesManagerTicket = clientList.tickets.some((t) => t.id === t1.id);
    const clientSeesOwnTicket = clientList.tickets.some((t) => t.id === tClient.id);
    record(
      "4. Client data isolation (sees only own tickets)",
      !clientSeesManagerTicket && clientSeesOwnTicket,
      `Sees own: ${clientSeesOwnTicket}, Sees others: ${clientSeesManagerTicket}`
    );

    // Test 5: Staff manager list — manager sees both
    const managerListRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets`, {
      headers: managerHeaders,
    });
    const managerList = await managerListRes.json();
    const managerSeesBoth =
      managerList.tickets.some((t) => t.id === t1.id) && managerList.tickets.some((t) => t.id === tClient.id);
    record("5. Staff manager sees all project tickets", managerSeesBoth, `Total: ${managerList.pagination?.total ?? managerList.total}`);

    // Test 6: Filter by status, category, priority, and search
    const filterCatRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets?category=BUG_REPORT`, {
      headers: managerHeaders,
    });
    const filterCatData = await filterCatRes.json();
    const allBugs = filterCatData.tickets.every((t) => t.category === "BUG_REPORT");
    record("6. Filter by category BUG_REPORT", allBugs && filterCatData.tickets.length > 0, `Count: ${filterCatData.tickets.length}`);

    const searchRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets?search=${encodeURIComponent(t1.ticketKey)}`, {
      headers: managerHeaders,
    });
    const searchData = await searchRes.json();
    record("7. Search by ticket key", searchData.tickets.length === 1 && searchData.tickets[0].id === t1.id);

    // Test 8: Details endpoint
    const detailRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${t1.id}`, {
      headers: managerHeaders,
    });
    const detailData = await detailRes.json();
    record("8. Fetch ticket details", detailRes.status === 200 && detailData.ticket.id === t1.id);

    // Test 9: Reassign ticket to viewer / manager
    const assignRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${t1.id}/assign`, {
      method: "PATCH",
      headers: managerHeaders,
      body: JSON.stringify({ assignedManagerId: manager.id, version: t1.version }),
    });
    const assignData = await assignRes.json();
    let currentTicket = assignData.ticket || t1;
    record("9. Manager can assign ticket", assignRes.status === 200, `Status: ${assignRes.status}`);

    // Test 10: Viewer cannot assign ticket
    const viewerAssignRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${t1.id}/assign`, {
      method: "PATCH",
      headers: viewerHeaders,
      body: JSON.stringify({ assignedManagerId: viewerUser.id, version: currentTicket.version }),
    });
    record("10. Viewer denied assign permission (403)", viewerAssignRes.status === 403, `Status: ${viewerAssignRes.status}`);

    // Test 11: Comments & internal notes isolation
    // Staff posts public comment
    const publicCommentRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${tClient.id}/comments`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({ content: "Hello! We are looking into your request.", isInternal: false }),
    });
    const publicCommentData = await publicCommentRes.json();

    // Staff posts internal note
    const internalCommentRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${tClient.id}/comments`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({ content: "CONFIDENTIAL INTERNAL NOTE: Needs engineering review.", isInternal: true }),
    });
    const internalCommentData = await internalCommentRes.json();

    // Client fetches comments: must receive public comment, but NOT internal note
    const clientCommentsRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${tClient.id}/comments`, {
      headers: clientHeaders,
    });
    const clientComments = await clientCommentsRes.json();
    const clientSeesPublic = clientComments.comments.some((c) => c.content.includes("Hello! We are looking into"));
    const clientSeesInternal = clientComments.comments.some((c) => c.content.includes("CONFIDENTIAL INTERNAL NOTE"));
    record(
      "11. Internal notes concealed from client",
      clientSeesPublic && !clientSeesInternal,
      `Public visible: ${clientSeesPublic}, Internal visible: ${clientSeesInternal}`
    );

    // Test 12: Client attempts to post internal note: must get 403
    const clientPostInternalRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${tClient.id}/comments`, {
      method: "POST",
      headers: clientHeaders,
      body: JSON.stringify({ content: "Client trying to post internal note", isInternal: true }),
    });
    record("12. Client prohibited from posting internal note (403)", clientPostInternalRes.status === 403);

    // Test 13: Attachment upload and retrieval
    const dummyBase64 = "data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZz4+ZW5kb2JqCnRyYWlsZXI8PC9Sb290IDEgMCBSPj4lJUVPRg==";
    const attachUploadRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${t1.id}/attachments`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        fileName: "test-log.pdf",
        fileSize: 1024,
        mimeType: "application/pdf",
        fileUrl: dummyBase64,
      }),
    });
    const attachData = await attachUploadRes.json();
    record("13. Upload ticket attachment", attachUploadRes.status === 201 && attachData.attachment?.id);

    // Create dedicated ticket for lifecycle state machine test
    const lcRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        title: "Lifecycle Verification Ticket",
        description: "Testing state machine transitions",
        category: "FEATURE_REQUEST",
        priority: "MEDIUM",
      }),
    });
    const lcData = await lcRes.json();
    let lcTicket = lcData.ticket;

    // Test 14: State transition rules
    // Jump NEW -> APPROVED must fail (400)
    const jumpRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${lcTicket.id}/status`, {
      method: "PATCH",
      headers: managerHeaders,
      body: JSON.stringify({ status: "APPROVED", version: lcTicket.version }),
    });
    record("14. Invalid direct jump NEW -> APPROVED refused (400)", jumpRes.status === 400, `Status: ${jumpRes.status}`);

    // Valid NEW -> UNDER_REVIEW
    const startReviewRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${lcTicket.id}/status`, {
      method: "PATCH",
      headers: managerHeaders,
      body: JSON.stringify({ status: "UNDER_REVIEW", version: lcTicket.version }),
    });
    const reviewData = await startReviewRes.json();
    lcTicket = reviewData.ticket;
    record("15. Transition NEW -> UNDER_REVIEW succeeds", startReviewRes.status === 200 && lcTicket?.status === "UNDER_REVIEW", `Status: ${startReviewRes.status}`);

    // Concurrency control: Stale version must fail (409)
    const staleRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${lcTicket.id}/status`, {
      method: "PATCH",
      headers: managerHeaders,
      body: JSON.stringify({ status: "PENDING_INFO", version: 999 }), // Stale version != current version
    });
    record("16. Optimistic concurrency control (409 on stale version)", staleRes.status === 409, `Status: ${staleRes.status}`);

    // Convert ticket to Backlog issue via APPROVAL
    const approveRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${lcTicket.id}/status`, {
      method: "PATCH",
      headers: managerHeaders,
      body: JSON.stringify({ status: "APPROVED", version: lcTicket.version }),
    });
    const approveData = await approveRes.json();
    const approvedTicket = approveData.ticket;
    record(
      "17. Approve ticket converts to Backlog issue",
      approveRes.status === 200 &&
        approvedTicket?.status === "CONVERTED" &&
        approvedTicket?.convertedIssueKey !== null &&
        approvedTicket?.convertedIssueId !== null,
      `Status: ${approvedTicket?.status}, IssueKey: ${approvedTicket?.convertedIssueKey}`
    );

    // Verify converted issue actually exists in project issues table
    if (approvedTicket?.convertedIssueId) {
      const issue = await prisma.issue.findUnique({
        where: { id: approvedTicket.convertedIssueId },
      });
      record(
        "18. Converted issue verified in database",
        issue !== null && issue.title.includes(lcTicket.title),
        `Issue Key: ${issue?.key}, StatusId: ${issue?.statusId}`
      );
    } else {
      record("18. Converted issue verified in database", false, "Missing convertedIssueId");
    }

    // Test 19: Ticket Dashboard KPI metrics
    const dashRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/dashboard`, {
      headers: managerHeaders,
    });
    const dashData = await dashRes.json();
    const stats = dashData.stats || {};
    record(
      "19. Ticket Dashboard metrics calculated",
      dashRes.status === 200 &&
        typeof stats.totalTickets === "number" &&
        stats.totalTickets >= 2 &&
        Array.isArray(stats.categoryDistribution) &&
        Array.isArray(stats.managerStats),
      `Total: ${stats.totalTickets}, New: ${stats.newTickets}, Converted: ${stats.approvedTickets}`
    );

    // Test 20: Viewer denied dashboard access
    const viewerDashRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/dashboard`, {
      headers: viewerHeaders,
    });
    record("20. Viewer denied dashboard access (403)", viewerDashRes.status === 403);

    // Test 21: Viewer cannot delete ticket
    const viewerDeleteRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${tClient.id}`, {
      method: "DELETE",
      headers: viewerHeaders,
    });
    record("21. Viewer cannot delete ticket (403)", viewerDeleteRes.status === 403);

    // Test 22: Project Manager without admin role cannot delete ticket (403)
    const managerDeleteRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${tClient.id}`, {
      method: "DELETE",
      headers: managerHeaders,
    });
    record("22. Manager denied delete without PROJECT_ADMIN (403)", managerDeleteRes.status === 403, `Status: ${managerDeleteRes.status}`);

    // Promote manager to PROJECT_ADMIN for deletion check
    await prisma.projectMember.update({
      where: { projectId_userId: { projectId: project.id, userId: manager.id } },
      data: { role: "PROJECT_ADMIN" },
    });

    const adminDeleteRes = await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${tClient.id}`, {
      method: "DELETE",
      headers: managerHeaders,
    });
    record("23. Project Admin can delete ticket (200)", adminDeleteRes.status === 200, `Status: ${adminDeleteRes.status}`);

    // Cleanup t1 and lcTicket
    await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${t1.id}`, {
      method: "DELETE",
      headers: managerHeaders,
    });
    await fetch(`${BASE_URL}/api/projects/${project.id}/tickets/${lcTicket.id}`, {
      method: "DELETE",
      headers: managerHeaders,
    });

  } catch (error) {
    console.error("Test execution encountered an unhandled error:", error);
    record("Unhandled exception in test runner", false, error.message);
  } finally {
    await prisma.$disconnect();
  }

  const passedCount = testResults.filter((r) => r.passed).length;
  const failedCount = testResults.filter((r) => !r.passed).length;
  console.log(`\n=== Live Test Suite Results: ${passedCount}/${testResults.length} Passed (${failedCount} Failed) ===`);
  if (failedCount > 0) {
    process.exit(1);
  }
}

run();
