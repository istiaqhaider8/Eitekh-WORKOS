/**
 * The ticket lifecycle rules, tested without a server.
 *
 * These lived inline in the status route until 2026-09-24, so proving that
 * a ticket cannot go from CLOSED back to UNDER_REVIEW meant building a
 * database, a session and an HTTP request. Nobody did, and the module's nine
 * unit tests reached only Zod schemas and the key allocator — which is how a
 * conversion path that failed 100% of the time shipped green.
 */

import {
  ALLOWED_TRANSITIONS,
  buildOriginHeader,
  commentVisibilityFilter,
  issueTypeForCategory,
  rejectionRefusal,
  statusAfter,
  ticketVisibilityFilter,
  transitionRefusal,
} from "@/lib/ticket-engine";

describe("The state machine", () => {
  it("allows the path a ticket actually takes", () => {
    expect(transitionRefusal("NEW", "UNDER_REVIEW")).toBeNull();
    expect(transitionRefusal("UNDER_REVIEW", "APPROVED")).toBeNull();
    expect(transitionRefusal("UNDER_REVIEW", "PENDING_INFO")).toBeNull();
    expect(transitionRefusal("PENDING_INFO", "UNDER_REVIEW")).toBeNull();
    expect(transitionRefusal("REJECTED", "CLOSED")).toBeNull();
  });

  it("refuses a jump straight from NEW to APPROVED", () => {
    // Triage is the point. Approving without review is the thing the queue
    // exists to prevent.
    expect(transitionRefusal("NEW", "APPROVED")).toMatch(/Cannot move ticket from NEW to APPROVED/);
  });

  it("refuses anything out of a terminal state, and says it is terminal", () => {
    for (const terminal of ["CONVERTED", "CLOSED"]) {
      const refusal = transitionRefusal(terminal, "UNDER_REVIEW");
      expect(refusal).toMatch(/None \(terminal state\)/);
    }
  });

  it("refuses an unknown source status rather than allowing it", () => {
    // A status the machine has never heard of must not be a free pass. This
    // is the shape of bug where a typo in a seed script silently unlocks
    // every transition.
    expect(transitionRefusal("BANANA", "APPROVED")).toMatch(/Cannot move ticket/);
  });

  it("has no unreachable state — every source is reachable as a target", () => {
    /**
     * The regression this pins. `APPROVED: ["CONVERTED"]` used to sit in this
     * table while approval converted in the same transaction, so nothing could
     * ever BE approved: the row was dead, and a dashboard offering "Approved"
     * as a filter showed an empty bucket for ever.
     */
    /**
     * Reachability is measured in STORED statuses, not in the verbs a caller
     * sends — `statusAfter` is what stands between the two. CONVERTED is never
     * a literal target anywhere in the table and is still perfectly reachable,
     * because asking for APPROVED produces it. Comparing raw targets against
     * sources reports it as dead, which is how a correct table gets "fixed"
     * into a broken one.
     */
    const reachable = new Set(
      Object.values(ALLOWED_TRANSITIONS).flat().map((target) => statusAfter(target))
    );
    const unreachable = Object.keys(ALLOWED_TRANSITIONS).filter(
      (source) => source !== "NEW" && !reachable.has(source)
    );
    expect(unreachable).toEqual([]);

    // And the verb that produces it is genuinely offered somewhere.
    expect(Object.values(ALLOWED_TRANSITIONS).flat()).toContain("APPROVED");
  });
});

describe("What approving actually stores", () => {
  it("stores CONVERTED when the caller asks to APPROVE", () => {
    expect(statusAfter("APPROVED")).toBe("CONVERTED");
  });

  it("leaves every other verb alone", () => {
    for (const s of ["UNDER_REVIEW", "REJECTED", "PENDING_INFO", "CLOSED"]) {
      expect(statusAfter(s)).toBe(s);
    }
  });
});

describe("A rejection must say why", () => {
  it("refuses an empty or whitespace reason", () => {
    expect(rejectionRefusal("REJECTED", undefined)).toMatch(/reason is required/);
    expect(rejectionRefusal("REJECTED", "")).toMatch(/reason is required/);
    expect(rejectionRefusal("REJECTED", "   ")).toMatch(/reason is required/);
  });

  it("accepts a real one, and applies to no other transition", () => {
    expect(rejectionRefusal("REJECTED", "Out of contract scope")).toBeNull();
    expect(rejectionRefusal("APPROVED", undefined)).toBeNull();
  });
});

describe("Visibility", () => {
  it("narrows a CLIENT to their own tickets", () => {
    expect(ticketVisibilityFilter({ id: "u1", userType: "CLIENT" })).toEqual({ createdById: "u1" });
  });

  it("does not narrow an employee", () => {
    expect(ticketVisibilityFilter({ id: "u1", userType: "EMPLOYEE" })).toEqual({});
    // A missing userType must behave as staff, not silently as a client —
    // otherwise a user record without the column disappears from their own
    // queue with no error anywhere.
    expect(ticketVisibilityFilter({ id: "u1" })).toEqual({});
  });

  it("keeps internal notes away from a CLIENT", () => {
    expect(commentVisibilityFilter({ userType: "CLIENT" })).toEqual({ isInternal: false });
    expect(commentVisibilityFilter({ userType: "EMPLOYEE" })).toEqual({});
  });
});

describe("Category mapping", () => {
  it("maps the two categories the board has a type for", () => {
    expect(issueTypeForCategory("BUG_REPORT")).toBe("BUG");
    expect(issueTypeForCategory("FEATURE_REQUEST")).toBe("FEATURE");
  });

  it("falls back to TASK for everything else, including the unknown", () => {
    for (const c of ["GENERAL", "SUPPORT", "CHANGE_REQUEST", "SOMETHING_NEW"]) {
      expect(issueTypeForCategory(c)).toBe("TASK");
    }
  });
});

describe("The origin header written into the converted issue", () => {
  const ticket = {
    id: "t1",
    ticketKey: "DEV-TKT-7",
    title: "Printer is on fire",
    description: "Again.",
    category: "SUPPORT",
    priority: "HIGH",
    createdById: "u1",
    assignedManagerId: null,
    dueDate: null,
    createdBy: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
  };

  it("names the ticket, its category and the person who raised it", () => {
    const header = buildOriginHeader(ticket);
    expect(header).toContain("DEV-TKT-7");
    expect(header).toContain("Printer is on fire");
    expect(header).toContain("SUPPORT");
    expect(header).toContain("Ada Lovelace (ada@example.com)");
  });

  it("includes the approval note only when there is one", () => {
    expect(buildOriginHeader(ticket, "In scope")).toContain("**Approval Note:** In scope");
    expect(buildOriginHeader(ticket)).not.toContain("Approval Note");
  });

  it("contains nothing outside Latin-1", () => {
    /**
     * THE REGRESSION THIS EXISTS FOR.
     *
     * This header carried a decorative emoji. The database is WIN1252, so
     * `0xf0 0x9f 0x8e 0xab has no equivalent in encoding "WIN1252"` aborted
     * the insert and rolled back the whole conversion — every approval since
     * the module shipped returned 500, and no test noticed because none of
     * them ever reached this code.
     *
     * The encoding is the deeper defect (DB-1) and this assertion does not
     * fix it. What it does is stop US putting a character into stored data
     * that the database cannot hold.
     */
    const header = buildOriginHeader(ticket, "note");
    const outside = [...header].filter((ch) => ch.codePointAt(0)! > 0xff);
    expect(outside).toEqual([]);
  });

  it("survives a client with no name recorded", () => {
    const anonymous = { ...ticket, createdBy: { firstName: null, lastName: null, email: "x@y.z" } };
    expect(buildOriginHeader(anonymous)).toContain("(x@y.z)");
  });
});
