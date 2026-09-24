import { prisma } from "./prisma";
import { allocateIssueKey, defaultStatusIdFor } from "./issue-keys";

/**
 * The ticket lifecycle: what may follow what, and what approval actually does.
 *
 * WHY THIS IS A LIBRARY AND NOT A ROUTE
 *
 * All of this lived inline in `tickets/[ticketId]/status/route.ts`, which is
 * why the module's nine unit tests could only reach Zod schemas and the key
 * allocator: to test a transition you had to build a server, a database and a
 * session. SAP Activate went the other way — `activate-gates.ts` holds the
 * rules and the routes stay thin — and its rules are unit-testable in
 * milliseconds. This file is the same move for tickets.
 *
 * It also meant the conversion had never once been executed in a test. It had
 * never worked: it wrote an emoji into the issue description and the database
 * rejected it, so every approval since the module shipped returned 500.
 */

/* -------------------------------------------------------------------------
 * The state machine
 * ---------------------------------------------------------------------- */

/**
 * WHAT A CALLER MAY ASK FOR, keyed by where the ticket is now.
 *
 * `APPROVED` appears as a TARGET and never as a source, and that is
 * deliberate rather than an oversight. Approving a ticket converts it in the
 * same transaction, so a ticket is never durably `APPROVED` — it is
 * `UNDER_REVIEW` one moment and `CONVERTED` the next.
 *
 * The previous version also carried `APPROVED: ["CONVERTED"]`, a row nothing
 * could ever reach. Unreachable states are not free: a dashboard that offers
 * "Approved" as a filter shows an empty bucket for ever, and the next person
 * to read the enum reasonably concludes there is a step between approval and
 * conversion that they need to call. There is not.
 *
 * So: `APPROVED` is the verb a caller uses to ask, `CONVERTED` is the state
 * that results. `statusAfter()` below is the one place that mapping lives.
 */
export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  NEW: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "PENDING_INFO"],
  PENDING_INFO: ["UNDER_REVIEW", "REJECTED"],
  REJECTED: ["CLOSED"],
  CONVERTED: [], // terminal: the work now lives on the board
  CLOSED: [], // terminal
};

/**
 * The status actually stored when a caller asks for `target`.
 *
 * Generic so the caller's narrow union survives. Returning a bare `string`
 * would force every call site to widen its own variable, and the first thing
 * to widen would be the one the database writes — which is exactly the type
 * you want kept narrow.
 */
export function statusAfter<T extends string>(target: T): T | "CONVERTED" {
  return target === "APPROVED" ? "CONVERTED" : target;
}

/**
 * Why this transition is refused, or null when it is allowed.
 *
 * Returns the message rather than throwing so the route decides the status
 * code, and so this can be exercised without a server.
 */
export function transitionRefusal(from: string, to: string): string | null {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (allowed.includes(to)) return null;
  return (
    `Invalid transition: Cannot move ticket from ${from} to ${to}. ` +
    `Allowed: ${allowed.join(", ") || "None (terminal state)"}`
  );
}

/** A rejection has to say why. An unexplained refusal is not a decision. */
export function rejectionRefusal(target: string, reason?: string | null): string | null {
  if (target !== "REJECTED") return null;
  if (reason && reason.trim()) return null;
  return "A rejection reason is required when rejecting a ticket";
}

/* -------------------------------------------------------------------------
 * What a client may see
 * ---------------------------------------------------------------------- */

/**
 * Narrow a ticket query to what this person is allowed to see.
 *
 * A CLIENT sees only what they filed. This is a second axis from PBAC: a role
 * says which ACTIONS you may take, this says which ROWS exist for you, and no
 * role can widen it. Three routes need the same rule, which is the usual
 * reason a rule ends up written three slightly different ways.
 */
export function ticketVisibilityFilter(user: { id: string; userType?: string | null }) {
  return user.userType === "CLIENT" ? { createdById: user.id } : {};
}

/** Clients never see staff deliberation, whatever else they may do. */
export function commentVisibilityFilter(user: { userType?: string | null }) {
  return user.userType === "CLIENT" ? { isInternal: false } : {};
}

/* -------------------------------------------------------------------------
 * Conversion
 * ---------------------------------------------------------------------- */

/** A ticket category becomes the nearest issue type the board understands. */
export function issueTypeForCategory(category: string): string {
  switch (category) {
    case "BUG_REPORT":
      return "BUG";
    case "FEATURE_REQUEST":
      return "FEATURE";
    default:
      return "TASK";
  }
}

export interface TicketForConversion {
  id: string;
  ticketKey: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  createdById: string;
  assignedManagerId: string | null;
  dueDate: Date | null;
  createdBy: { firstName: string | null; lastName: string | null; email: string };
}

/**
 * The provenance block prepended to the converted issue's description.
 *
 * PLAIN TEXT ONLY — no emoji, no decorative characters. This string is stored
 * in a user's issue description, so every character in it has to survive the
 * database. It carried a `🎫` until 2026-09-24, and because the database is
 * WIN1252 that one character failed the insert and rolled back the entire
 * conversion, every time, for the life of the module. Decoration in stored
 * data buys nothing and can break the write.
 */
export function buildOriginHeader(ticket: TicketForConversion, note?: string | null): string {
  const client = `${ticket.createdBy.firstName || ""} ${ticket.createdBy.lastName || ""}`.trim();
  return (
    `> **Converted from Ticket [${ticket.ticketKey}]:** ${ticket.title}\n` +
    `> **Category:** ${ticket.category} | **Priority:** ${ticket.priority}\n` +
    `> **Client:** ${client} (${ticket.createdBy.email})\n` +
    (note ? `> **Approval Note:** ${note}\n` : "") +
    `\n---\n\n`
  );
}

/**
 * Turn an approved ticket into a real issue on the project's board.
 *
 * Takes the transaction rather than opening one: the issue, its activity log
 * and the ticket's own status have to land together or not at all. A ticket
 * marked CONVERTED beside an issue that was never created is a lie the
 * dashboard would repeat for ever.
 */
export async function convertTicketToIssue(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  input: { projectId: string; ticket: TicketForConversion; actorId: string; note?: string | null }
) {
  const { projectId, ticket, actorId, note } = input;

  const allocated = await allocateIssueKey(tx, projectId);
  const issue = await tx.issue.create({
    data: {
      projectId,
      keyNumber: allocated.keyNumber,
      issueKey: allocated.issueKey,
      title: ticket.title,
      description: `${buildOriginHeader(ticket, note)}${ticket.description || ""}`,
      issueType: issueTypeForCategory(ticket.category),
      priority: ticket.priority,
      statusId: defaultStatusIdFor(allocated.project),
      reporterId: ticket.createdById,
      // Falls back to whoever approved it: an issue with no assignee drops
      // into the backlog unowned, which is how converted work goes quiet.
      assigneeId: ticket.assignedManagerId || actorId,
      dueDate: ticket.dueDate,
    },
    include: { status: true },
  });

  await tx.activityLog.create({
    data: {
      issueId: issue.id,
      actorId,
      actionType: "CREATED",
      newValue: `Created from approved Ticket ${ticket.ticketKey}`,
    },
  });

  return issue;
}
