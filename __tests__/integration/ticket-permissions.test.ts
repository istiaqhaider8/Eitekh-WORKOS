/**
 * Tickets: who may do what, and whose tickets they can see.
 *
 * WHY THIS FILE EXISTS
 *
 * The ticket routes shipped with `assertProjectAccess` and nothing else. That
 * answers "is this person inside the tenant and on this project" and stops
 * there, so a VIEWER — the lowest project role — could approve a ticket and
 * put work on the delivery board under the project's own issue key. The
 * handler read a `role` it never used. Nothing was exploited only because the
 * table was empty and no screen reached the routes.
 *
 * So this suite is built around three claims:
 *
 *   1. THE ACCEPT CASE FIRST. A manager can run the queue end to end. A suite
 *      of refusals passes just as happily when the feature is broken for
 *      everyone, which is the failure this codebase has already had once.
 *   2. EACH PERMISSION IS SEPARATELY LOAD-BEARING. Approving, rejecting,
 *      triaging and note-taking are four keys, and a role that holds one does
 *      not thereby hold the others.
 *   3. A REFUSAL MUST NOT HAVE WRITTEN ANYTHING. Every denial is asserted
 *      against the database as well as the status code — a 403 does not prove
 *      the write did not land, and that distinction is how the two real
 *      isolation bugs in this repository were found.
 *
 * It also closes the `check:isolation` gap: all six ticket routes were
 * reported "unaccounted for" because no integration test touched them.
 */

import { PrismaClient } from "@prisma/client";
import { api, expectDenied, expectAllowed, waitForServer, type Fixture } from "./harness";
import { createFixture, destroyFixture } from "./fixture";

const prisma = new PrismaClient();
let fx: Fixture;

/** A ticket raised by the MEMBER, reused as the subject of the refusals. */
let ticketId = "";

/**
 * Every route spelled out in full.
 *
 * Composing these from a shared base read more tidily, but the full path then
 * appeared nowhere in the source — and `check:isolation` looks for literal
 * `/api/...` strings to decide which routes a suite exercises, so five routes
 * this file genuinely covers were reported as untested gaps. A human skimming
 * for "which endpoints does this touch" had the same problem.
 */
const P = {
  list: (pid: string) => `/api/projects/${pid}/tickets`,
  detail: (pid: string, t: string) => `/api/projects/${pid}/tickets/${t}`,
  status: (pid: string, t: string) => `/api/projects/${pid}/tickets/${t}/status`,
  assign: (pid: string, t: string) => `/api/projects/${pid}/tickets/${t}/assign`,
  comments: (pid: string, t: string) => `/api/projects/${pid}/tickets/${t}/comments`,
  attachments: (pid: string, t: string) => `/api/projects/${pid}/tickets/${t}/attachments`,
  dashboard: (pid: string) => `/api/projects/${pid}/tickets/dashboard`,
};

beforeAll(async () => {
  await waitForServer();
  fx = await createFixture(prisma);
}, 180_000);

afterAll(async () => {
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("Raising a ticket", () => {
  it("lets a MEMBER raise one, and stamps a per-project key", async () => {
    const res = await api(fx.orgA.users.MEMBER, P.list(fx.orgA.projectId), {
      method: "POST",
      body: { title: "Printer is on fire", description: "Again.", category: "SUPPORT", priority: "HIGH" },
    });
    expectAllowed(res, "a MEMBER raising a ticket");
    ticketId = res.body.ticket?.id ?? res.body.id;
    expect(ticketId).toBeTruthy();

    const row = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { projectId: true, status: true, ticketKey: true, createdById: true },
    });
    expect(row!.projectId).toBe(fx.orgA.projectId);
    expect(row!.status).toBe("NEW");
    expect(row!.createdById).toBe(fx.orgA.users.MEMBER.id);
    expect(row!.ticketKey).toBeTruthy();
  });

  it("lets a VIEWER raise one too — filing a request is not a privileged act", async () => {
    // Deliberate: clients are assigned at VIEWER level, and a permission model
    // that required MEMBER to submit would lock out the audience the module
    // exists for.
    const res = await api(fx.orgA.users.VIEWER, P.list(fx.orgA.projectId), {
      method: "POST",
      body: { title: "Request from a stakeholder", category: "GENERAL", priority: "LOW" },
    });
    expectAllowed(res, "a VIEWER raising a ticket");
  });

  it("refuses an outsider and another organization outright", async () => {
    for (const [who, user] of [
      ["an outsider", fx.outsider],
      ["org B's OWNER", fx.orgB.users.OWNER],
    ] as const) {
      expectDenied(
        await api(user, P.list(fx.orgA.projectId), {
          method: "POST",
          body: { title: "Filed from outside", category: "GENERAL", priority: "LOW" },
        }),
        `${who} raising a ticket in org A`
      );
    }
    // Nothing they sent exists.
    expect(
      await prisma.ticket.count({
        where: { projectId: fx.orgA.projectId, title: "Filed from outside" },
      })
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("Triage and approval are separate powers", () => {
  it("refuses a VIEWER the assignment, and nobody is assigned", async () => {
    expectDenied(
      await api(fx.orgA.users.VIEWER, P.assign(fx.orgA.projectId, ticketId), {
        method: "PATCH",
        body: { assignedManagerId: fx.orgA.users.MANAGER.id },
      }),
      "a VIEWER assigning a ticket"
    );
    expect(
      (await prisma.ticket.findUnique({ where: { id: ticketId }, select: { assignedManagerId: true } }))!
        .assignedManagerId
    ).toBeNull();
  });

  it("refuses a VIEWER the approval, and the ticket does not move", async () => {
    // The one that mattered: approval converts the ticket into a task on the
    // delivery board. Before `tickets:approve` existed, this returned 200.
    const before = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { status: true, convertedIssueId: true },
    });
    expectDenied(
      await api(fx.orgA.users.VIEWER, P.status(fx.orgA.projectId, ticketId), {
        method: "PATCH",
        body: { status: "APPROVED", note: "approving my own request" },
      }),
      "a VIEWER approving a ticket"
    );
    const after = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { status: true, convertedIssueId: true },
    });
    expect(after).toEqual(before);
    expect(after!.convertedIssueId).toBeNull();
  });

  it("refuses a VIEWER an internal note, and none is written", async () => {
    expectDenied(
      await api(fx.orgA.users.VIEWER, P.comments(fx.orgA.projectId, ticketId), {
        method: "POST",
        body: { content: "internal deliberation", isInternal: true },
      }),
      "a VIEWER writing an internal note"
    );
    expect(
      await prisma.ticketComment.count({ where: { ticketId, isInternal: true } })
    ).toBe(0);
  });

  it("refuses a VIEWER the dashboard", async () => {
    expectDenied(
      await api(fx.orgA.users.VIEWER, P.dashboard(fx.orgA.projectId)),
      "a VIEWER reading ticket analytics"
    );
  });

  it("lets a MANAGER assign, note and approve — the accept case", async () => {
    expectAllowed(
      await api(fx.orgA.users.MANAGER, P.assign(fx.orgA.projectId, ticketId), {
        method: "PATCH",
        body: { assignedManagerId: fx.orgA.users.MANAGER.id },
      }),
      "a MANAGER taking the ticket"
    );
    expectAllowed(
      await api(fx.orgA.users.MANAGER, P.comments(fx.orgA.projectId, ticketId), {
        method: "POST",
        body: { content: "Looks in scope. Converting.", isInternal: true },
      }),
      "a MANAGER writing an internal note"
    );
    expectAllowed(
      await api(fx.orgA.users.MANAGER, P.status(fx.orgA.projectId, ticketId), {
        method: "PATCH",
        body: { status: "APPROVED", note: "In scope for this sprint." },
      }),
      "a MANAGER approving the ticket"
    );

    // The conversion really happened, and produced exactly one issue.
    const row = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { status: true, convertedIssueId: true },
    });
    expect(["APPROVED", "CONVERTED"]).toContain(row!.status);
    expect(row!.convertedIssueId).toBeTruthy();
    const issue = await prisma.issue.findUnique({
      where: { id: row!.convertedIssueId! },
      select: { projectId: true, issueKey: true },
    });
    expect(issue!.projectId).toBe(fx.orgA.projectId);
  });

  it("remembers which issue it produced even after that issue is deleted", async () => {
    /**
     * `convertedIssueId` is a foreign key declared `onDelete: SetNull`, so
     * deleting the issue empties it — and the ticket is left saying CONVERTED
     * while pointing at nothing, claiming work nobody can name. Restricting
     * the delete is the other answer and it is the wrong one: removing an
     * issue is a legitimate act that a ticket should not be able to veto.
     *
     * So the key is denormalised as text. This asserts the link breaks and
     * the record does not.
     */
    const before = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { convertedIssueId: true, convertedIssueKey: true, status: true },
    });
    expect(before!.convertedIssueKey).toBeTruthy();

    await prisma.issue.delete({ where: { id: before!.convertedIssueId! } });

    const after = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { convertedIssueId: true, convertedIssueKey: true, status: true },
    });
    expect(after!.convertedIssueId).toBeNull();          // the link is gone
    expect(after!.convertedIssueKey).toBe(before!.convertedIssueKey); // the record is not
    expect(after!.status).toBe(before!.status);
  });
});

// ---------------------------------------------------------------------------

describe("Tenant isolation on every ticket route", () => {
  it("refuses org B on reads and writes alike, and leaves org A's data alone", async () => {
    const PID = fx.orgA.projectId;
    const reads: Array<[string, string]> = [
      ["list", P.list(PID)],
      ["detail", P.detail(PID, ticketId)],
      ["comments", P.comments(PID, ticketId)],
      ["attachments", P.attachments(PID, ticketId)],
      ["dashboard", P.dashboard(PID)],
    ];
    for (const [what, path] of reads) {
      expectDenied(await api(fx.orgB.users.OWNER, path), `org B reading org A's ${what}`);
    }

    const writes: Array<[string, string, string, unknown]> = [
      ["status", "PATCH", P.status(PID, ticketId), { status: "REJECTED", rejectionReason: "no" }],
      ["assign", "PATCH", P.assign(PID, ticketId), { assignedManagerId: fx.orgB.users.OWNER.id }],
      ["comment", "POST", P.comments(PID, ticketId), { content: "from another tenant" }],
      ["attachment", "POST", P.attachments(PID, ticketId), { fileName: "evil.pdf", fileSize: 100, mimeType: "application/pdf", fileUrl: "data:application/pdf;base64,dGVzdA==" }],
      ["update", "PATCH", P.detail(PID, ticketId), { title: "renamed from outside" }],
    ];
    for (const [what, method, path, body] of writes) {
      expectDenied(await api(fx.orgB.users.OWNER, path, { method, body }), `org B ${what}`);
    }

    // The 403s above prove a refusal. These prove nothing was written.
    const row = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { title: true, assignedManagerId: true },
    });
    expect(row!.title).toBe("Printer is on fire");
    expect(row!.assignedManagerId).toBe(fx.orgA.users.MANAGER.id);
    expect(
      await prisma.ticketComment.count({ where: { ticketId, content: "from another tenant" } })
    ).toBe(0);
    expect(
      await prisma.attachment.count({ where: { ticketId, fileName: "evil.pdf" } })
    ).toBe(0);
  });

  it("refuses a delete from another tenant, and the ticket survives", async () => {
    expectDenied(
      await api(fx.orgB.users.OWNER, P.detail(fx.orgA.projectId, ticketId), { method: "DELETE" }),
      "org B deleting org A's ticket"
    );
    expect(await prisma.ticket.count({ where: { id: ticketId } })).toBe(1);
  });

  it("allows a member to upload and list attachments", async () => {
    const PID = fx.orgA.projectId;
    const postRes = await api(fx.orgA.users.MEMBER, P.attachments(PID, ticketId), {
      method: "POST",
      body: {
        fileName: "logs.pdf",
        fileSize: 42,
        mimeType: "application/pdf",
        fileUrl: "data:application/pdf;base64,aGVsbG8gd29ybGQ=",
      },
    });
    expectAllowed(postRes, "a member uploading an attachment");
    expect(postRes.body.attachment?.fileName).toBe("logs.pdf");

    const getRes = await api(fx.orgA.users.MEMBER, P.attachments(PID, ticketId));
    expectAllowed(getRes, "a member listing attachments");
    expect(getRes.body.attachments?.length).toBeGreaterThanOrEqual(1);
    expect(getRes.body.attachments[0].fileName).toBe("logs.pdf");
  });
});

// ---------------------------------------------------------------------------

describe("Optimistic concurrency control (409 Conflict)", () => {
  it("rejects PATCH ticket with a stale version and returns 409", async () => {
    const res = await api(fx.orgA.users.MANAGER, P.detail(fx.orgA.projectId, ticketId), {
      method: "PATCH",
      body: { title: "Stale update attempt", version: 9999 },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Conflict");
  });

  it("rejects status transition with a stale version and returns 409", async () => {
    // Raise a fresh ticket for testing status conflict
    const createRes = await api(fx.orgA.users.MEMBER, P.list(fx.orgA.projectId), {
      method: "POST",
      body: { title: "Status conflict ticket", category: "BUG_REPORT", priority: "MEDIUM" },
    });
    expectAllowed(createRes, "raising ticket for status conflict test");
    const freshId = createRes.body.ticket?.id ?? createRes.body.id;

    const res = await api(fx.orgA.users.MANAGER, P.status(fx.orgA.projectId, freshId), {
      method: "PATCH",
      body: { status: "UNDER_REVIEW", version: 9999 },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Conflict");
  });
});

// ---------------------------------------------------------------------------

describe("Client confidentiality and isolation boundary", () => {
  let clientTicketId = "";

  beforeAll(async () => {
    // Switch VIEWER to userType = CLIENT to exercise the client isolation boundary
    await prisma.user.update({
      where: { id: fx.orgA.users.VIEWER.id },
      data: { userType: "CLIENT" },
    });
  });

  afterAll(async () => {
    // Restore VIEWER to EMPLOYEE
    await prisma.user.update({
      where: { id: fx.orgA.users.VIEWER.id },
      data: { userType: "EMPLOYEE" },
    });
  });

  it("lets a CLIENT raise their own ticket", async () => {
    const res = await api(fx.orgA.users.VIEWER, P.list(fx.orgA.projectId), {
      method: "POST",
      body: { title: "Client confidential inquiry", category: "SUPPORT", priority: "MEDIUM" },
    });
    expectAllowed(res, "a CLIENT raising their ticket");
    clientTicketId = res.body.ticket?.id ?? res.body.id;
    expect(clientTicketId).toBeTruthy();
  });

  it("refuses a CLIENT access to tickets filed by other users in the same project", async () => {
    // ticketId was filed by MEMBER
    const detailRes = await api(fx.orgA.users.VIEWER, P.detail(fx.orgA.projectId, ticketId));
    expect(detailRes.status).toBe(403);

    const commentsRes = await api(fx.orgA.users.VIEWER, P.comments(fx.orgA.projectId, ticketId));
    expect(commentsRes.status).toBe(403);
  });

  it("refuses a CLIENT writing an internal note on their own ticket", async () => {
    const res = await api(fx.orgA.users.VIEWER, P.comments(fx.orgA.projectId, clientTicketId), {
      method: "POST",
      body: { content: "Sneaky internal note", isInternal: true },
    });
    expect(res.status).toBe(403);
  });

  it("never discloses isInternal: true comments to a CLIENT on reads", async () => {
    // 1. Manager posts an internal note
    const internalRes = await api(fx.orgA.users.MANAGER, P.comments(fx.orgA.projectId, clientTicketId), {
      method: "POST",
      body: { content: "Internal staff assessment: confidential", isInternal: true },
    });
    expectAllowed(internalRes, "manager posting internal note");

    // 2. Manager posts a public comment
    const publicRes = await api(fx.orgA.users.MANAGER, P.comments(fx.orgA.projectId, clientTicketId), {
      method: "POST",
      body: { content: "Public response: we are looking into your request.", isInternal: false },
    });
    expectAllowed(publicRes, "manager posting public comment");

    // 3. Client reads comments endpoint
    const listRes = await api(fx.orgA.users.VIEWER, P.comments(fx.orgA.projectId, clientTicketId));
    expectAllowed(listRes, "client reading their comments");
    const comments = listRes.body.comments;
    expect(comments.length).toBeGreaterThanOrEqual(1);
    expect(comments.some((c: any) => c.isInternal === true)).toBe(false);
    expect(comments.some((c: any) => c.content.includes("confidential"))).toBe(false);
    expect(comments.some((c: any) => c.content.includes("Public response"))).toBe(true);

    // 4. Client reads ticket detail endpoint
    const detailRes = await api(fx.orgA.users.VIEWER, P.detail(fx.orgA.projectId, clientTicketId));
    expectAllowed(detailRes, "client reading ticket detail");
    const detailComments = detailRes.body.ticket?.comments ?? [];
    expect(detailComments.some((c: any) => c.isInternal === true)).toBe(false);
    expect(detailComments.some((c: any) => c.content.includes("confidential"))).toBe(false);
  });
});

