/**
 * A2 — start/due date ordering on an issue update.
 *
 * WHAT THIS IS GUARDING
 *
 * The check used to compare EFFECTIVE dates on every update — submitted value
 * if present, stored value otherwise. So an issue whose stored `dueDate`
 * already preceded its `startDate` rejected every later update, including ones
 * that touched no date at all, with an error naming two fields the request
 * never sent. Those rows were permanently uneditable through the API.
 *
 * Nothing caught it in review or in the unit suite. It took a two-hour soak:
 * 1,441 of 21,579 updates returned 400 from a journey submitting only
 * `{description}`, matching the 1,371 of 20,000 issues (6.9%) that hold
 * inverted dates.
 *
 * The first test below is the one that matters, and it is the one that would
 * have failed before the fix. The rest exist so the fix cannot be over-applied
 * into "dates are never validated", which would be a worse bug wearing a
 * friendlier face.
 */

import {
  violatesDateOrder,
  isChangingEitherDate,
  DATE_ORDER_ERROR,
} from "../issue-dates";

const JAN_01 = new Date("2026-01-01T00:00:00Z");
const JAN_10 = new Date("2026-01-10T00:00:00Z");
const JAN_20 = new Date("2026-01-20T00:00:00Z");

/** A row that is already inconsistent — due BEFORE start. */
const INVERTED = { startDate: JAN_10, dueDate: JAN_01 };
/** A row that is fine. */
const CONSISTENT = { startDate: JAN_01, dueDate: JAN_20 };

describe("an update that changes neither date", () => {
  it("is allowed even when the stored dates are already inverted", () => {
    // THE BUG. Before the fix this returned true, and a title edit on a
    // legacy row was refused for reasons the caller could not act on.
    expect(violatesDateOrder({ }, INVERTED)).toBe(false);
  });

  it("is allowed for a body carrying other fields", () => {
    const body = { title: "new title", description: "x", assigneeId: "u1" } as Record<string, unknown>;
    expect(violatesDateOrder(body, INVERTED)).toBe(false);
  });

  it("is allowed on a consistent row too, obviously", () => {
    expect(violatesDateOrder({}, CONSISTENT)).toBe(false);
  });
});

describe("an update that changes a date is still validated", () => {
  it("rejects both dates supplied in the wrong order", () => {
    expect(violatesDateOrder({ startDate: JAN_20, dueDate: JAN_10 }, CONSISTENT)).toBe(true);
  });

  it("accepts both dates supplied in the right order", () => {
    expect(violatesDateOrder({ startDate: JAN_01, dueDate: JAN_10 }, CONSISTENT)).toBe(false);
  });

  it("rejects a new startDate that would move past the STORED dueDate", () => {
    /**
     * This is the property that makes the fix safe.
     *
     * If the guard had been "skip whenever the stored row is inconsistent", or
     * "only check when BOTH dates are supplied", a consistent row could be
     * inverted one field at a time and the validation would be decorative.
     */
    expect(violatesDateOrder({ startDate: JAN_20 }, { startDate: JAN_01, dueDate: JAN_10 })).toBe(true);
  });

  it("rejects a new dueDate that would move before the STORED startDate", () => {
    expect(violatesDateOrder({ dueDate: JAN_01 }, { startDate: JAN_10, dueDate: JAN_20 })).toBe(true);
  });
});

describe("repairing an already-inverted row", () => {
  it("accepts a single-field fix that makes the pair consistent", () => {
    // Stored start=Jan 10, due=Jan 01. Setting due=Jan 20 is a repair and
    // must be allowed, or the only way out of bad data is the database.
    expect(violatesDateOrder({ dueDate: JAN_20 }, INVERTED)).toBe(false);
  });

  it("accepts pulling the start date back instead", () => {
    expect(violatesDateOrder({ startDate: JAN_01 }, INVERTED)).toBe(false);
  });

  it("still refuses a change that leaves the pair inverted", () => {
    // start stays Jan 10, due moves Jan 01 -> Jan 05: still inverted.
    expect(violatesDateOrder({ dueDate: new Date("2026-01-05T00:00:00Z") }, INVERTED)).toBe(true);
  });
});

describe("clearing a date", () => {
  it("is a change, so it is evaluated rather than skipped", () => {
    // Presence, not truthiness: `{dueDate: null}` is a deliberate clearing and
    // must reach the rule. A truthiness check would have treated it as absent.
    expect(isChangingEitherDate({ dueDate: null })).toBe(true);
    expect(isChangingEitherDate({ startDate: "" })).toBe(true);
    expect(isChangingEitherDate({})).toBe(false);
  });

  it("cannot violate the order, because one side is now absent", () => {
    expect(violatesDateOrder({ dueDate: null }, INVERTED)).toBe(false);
    expect(violatesDateOrder({ startDate: null }, INVERTED)).toBe(false);
  });
});

describe("equal dates and formats", () => {
  it("allows a same-day start and due", () => {
    // Strictly-earlier is the rule. A one-day task is legitimate, and an
    // off-by-one here would reject a large share of real issues.
    expect(violatesDateOrder({ startDate: JAN_10, dueDate: JAN_10 }, CONSISTENT)).toBe(false);
  });

  it("accepts ISO strings as well as Date objects", () => {
    expect(violatesDateOrder({ startDate: "2026-01-20", dueDate: "2026-01-10" }, CONSISTENT)).toBe(true);
    expect(violatesDateOrder({ startDate: "2026-01-10", dueDate: "2026-01-20" }, CONSISTENT)).toBe(false);
  });

  it("does not report an ordering problem for an unparseable date", () => {
    /**
     * A malformed value is a FORMAT error, reported separately with a message
     * naming the right field. Letting it fall through to the ordering rule
     * would tell the user their dates are in the wrong order when the real
     * problem is that one of them is not a date.
     */
    expect(violatesDateOrder({ dueDate: "not-a-date" }, CONSISTENT)).toBe(false);
  });
});

it("exports the message the route returns, so the two cannot drift", () => {
  expect(DATE_ORDER_ERROR).toBe("Due Date cannot be earlier than Start Date");
});
