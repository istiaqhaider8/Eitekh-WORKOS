/**
 * Per-project issue types and priorities.
 *
 * WHAT THIS IS GUARDING
 *
 * `POST /api/projects/[id]/types` and `/priorities` let a project define its
 * own work-item types and priorities, stored as `PROJECT_ISSUE_TYPES` and
 * `PROJECT_PRIORITIES` custom fields. The request schemas hard-coded
 * `z.enum(["BUG","TASK","STORY","EPIC","SUBTASK"])` and
 * `z.enum(["CRITICAL","HIGH","MEDIUM","LOW","NONE"])`, so a value could be
 * created, offered in the UI, and then rejected the moment anyone used it:
 *
 *     POST /api/projects/{id}/issues  {"issueType":"REQUIREMENT"}
 *     -> 400  issueType: Invalid option: expected one of "BUG"|"TASK"|...
 *
 * Proven against a running server before the fix. The feature was reachable,
 * configurable and structurally incapable of working — the same shape as the
 * OTP regex bug.
 *
 * FIVE places defined the issue-type vocabulary and disagreed:
 * DEFAULT_ISSUE_TYPES (4), the zod enum (5), the Prisma column comment (7,
 * including FEATURE and INCIDENT that nothing accepted), ALLOWED_ISSUE_TYPES
 * in bulk-import (5), and the per-project custom field (unbounded).
 *
 * The schema now validates SHAPE and the route validates MEMBERSHIP, the same
 * split already used for statusId. These tests cover the shape half; the
 * membership half needs a database and belongs in the integration suite.
 *
 * The load-bearing tests here are the ones asserting a custom value is
 * ACCEPTED. A suite that only checked rejections passed against the broken
 * enum, because the broken enum rejected everything.
 */

import { issueTypeTokenSchema, priorityTokenSchema } from "../validation";
import { SYSTEM_ISSUE_TYPES, SYSTEM_PRIORITIES, DEFAULT_ISSUE_TYPES, DEFAULT_PRIORITIES } from "../project-context";

describe("issueTypeTokenSchema accepts what a project can configure", () => {
  it("accepts a custom type the old enum rejected", () => {
    // The exact value proven to 400 against the running server.
    expect(issueTypeTokenSchema.safeParse("REQUIREMENT").success).toBe(true);
  });

  it("accepts the other SAP Activate work-item types", () => {
    for (const v of ["RISK", "DECISION", "GAP", "DELIVERABLE", "INCIDENT", "FEATURE"]) {
      expect(issueTypeTokenSchema.safeParse(v).success).toBe(true);
    }
  });

  it("accepts every built-in type", () => {
    for (const t of DEFAULT_ISSUE_TYPES) {
      expect(issueTypeTokenSchema.safeParse(t.value).success).toBe(true);
    }
  });

  it("accepts SUBTASK, which the CSV importer writes", () => {
    // Accepted but deliberately not in DEFAULT_ISSUE_TYPES: there is a
    // separate Subtask model, so it should not be offered as a choice.
    for (const v of SYSTEM_ISSUE_TYPES) {
      expect(issueTypeTokenSchema.safeParse(v).success).toBe(true);
    }
  });

  it("upper-cases and trims, matching what the types route stores", () => {
    // The types route does .toUpperCase().replace(/[^A-Z0-9_]/g,"_"), so a
    // lower-case submission must normalise to the stored form or the
    // membership check in the route would miss.
    const r = issueTypeTokenSchema.safeParse("  requirement  ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("REQUIREMENT");
  });

  it("accepts underscores and digits, which the route's slug rule produces", () => {
    expect(issueTypeTokenSchema.safeParse("DATA_MIGRATION").success).toBe(true);
    expect(issueTypeTokenSchema.safeParse("PHASE_2_GAP").success).toBe(true);
  });
});

describe("issueTypeTokenSchema still refuses malformed values", () => {
  it("rejects an empty value", () => {
    expect(issueTypeTokenSchema.safeParse("").success).toBe(false);
    expect(issueTypeTokenSchema.safeParse("   ").success).toBe(false);
  });

  it("rejects punctuation and whitespace inside the token", () => {
    /**
     * This is the guard that stops the fix becoming a regression.
     *
     * Replacing an enum with a bare string would accept anything, which is
     * worse than the bug: the value is written to a column, rendered in the
     * UI and filtered on. The shape check keeps it to the slug form the types
     * route produces.
     */
    for (const bad of ["Not A Type", "type-with-dash", "type.with.dot", "<script>", "a/b", "TYPE;DROP"]) {
      expect(issueTypeTokenSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("rejects something enormous", () => {
    // Bounded, so nothing unreasonable reaches the database or a log line.
    expect(issueTypeTokenSchema.safeParse("A".repeat(51)).success).toBe(false);
    expect(issueTypeTokenSchema.safeParse("A".repeat(10_000)).success).toBe(false);
  });
});

describe("priorityTokenSchema — the same defect, one file over", () => {
  it("accepts a custom priority the old enum rejected", () => {
    expect(priorityTokenSchema.safeParse("BLOCKER").success).toBe(true);
    expect(priorityTokenSchema.safeParse("P0").success).toBe(true);
  });

  it("accepts every built-in priority", () => {
    for (const p of DEFAULT_PRIORITIES) {
      expect(priorityTokenSchema.safeParse(p.value).success).toBe(true);
    }
  });

  it("accepts NONE, which the schemas have always allowed", () => {
    /**
     * NONE appears in no other place — not in DEFAULT_PRIORITIES, not in any
     * code path, and not on a single row of the 20,000-issue volume dataset.
     * It stays accepted so that any caller already sending it keeps working,
     * and stays out of the defaults so it is not offered.
     */
    for (const v of SYSTEM_PRIORITIES) {
      expect(priorityTokenSchema.safeParse(v).success).toBe(true);
    }
  });

  it("rejects malformed values", () => {
    for (const bad of ["", "very high", "high!", "-".repeat(3)]) {
      expect(priorityTokenSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("the vocabulary sources agree where they must", () => {
  it("keeps SUBTASK out of the offered defaults", () => {
    // If it were added to DEFAULT_ISSUE_TYPES it would appear in every type
    // dropdown, and there is a separate Subtask model for that work.
    const offered = DEFAULT_ISSUE_TYPES.map((t) => t.value);
    for (const sys of SYSTEM_ISSUE_TYPES) {
      expect(offered).not.toContain(sys);
    }
  });

  it("keeps NONE out of the offered priorities", () => {
    const offered = DEFAULT_PRIORITIES.map((p) => p.value);
    for (const sys of SYSTEM_PRIORITIES) {
      expect(offered).not.toContain(sys);
    }
  });

  it("has no lower-case or malformed values among the defaults", () => {
    // Every default must itself pass the shape check, or the membership
    // comparison in the route would fail on a built-in type.
    for (const t of DEFAULT_ISSUE_TYPES) {
      expect(issueTypeTokenSchema.safeParse(t.value).success).toBe(true);
      expect(t.value).toBe(t.value.toUpperCase());
    }
    for (const p of DEFAULT_PRIORITIES) {
      expect(priorityTokenSchema.safeParse(p.value).success).toBe(true);
      expect(p.value).toBe(p.value.toUpperCase());
    }
  });
});
