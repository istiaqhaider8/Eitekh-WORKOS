/**
 * A2 — start/due date ordering on an issue update.
 *
 * WHY THIS IS A MODULE AND NOT FOUR LINES IN A ROUTE
 *
 * It was four lines in a route, and it was wrong in a way that took a
 * two-hour soak to notice. The rule has a subtlety that does not survive being
 * inlined: it must constrain what a request CHANGES, not what the row already
 * holds.
 *
 * The original compared EFFECTIVE values on every update — the submitted date
 * when present, the stored one otherwise. An issue whose stored `dueDate`
 * already preceded its `startDate` therefore rejected every later update,
 * including ones that touched no date at all. Editing a title, moving a card,
 * setting an assignee: all refused with "Due Date cannot be earlier than Start
 * Date", naming two fields the request never sent. Those rows were
 * permanently uneditable through the API.
 *
 * It was found by the A2 soak rather than by review: 1,441 of 21,579 issue
 * updates returned 400 while the journey submitted nothing but
 * `{description}`. The cause is in the data — 1,371 of 20,000 issues in the
 * volume dataset (6.9%) hold inverted dates, matching the failure count
 * closely. Legacy rows acquired them before the check existed, and a
 * production database should be assumed no cleaner.
 *
 * WHAT THE RULE ACTUALLY IS
 *
 * Validate the ORDER only when the request supplies at least one of the two
 * dates. That keeps every useful property:
 *
 *   - a request changing only `startDate` is still checked against the stored
 *     `dueDate`, so a consistent row cannot be inverted one field at a time;
 *   - a request changing neither is untouched by the rule, so inherited
 *     inconsistency stops blocking unrelated edits;
 *   - no new way to create bad data is introduced, because anything that
 *     supplies a date is still compared against the other date's effective
 *     value;
 *   - a partial repair still works: on a row stored as start=Jan 10 /
 *     due=Jan 5, setting due=Jan 20 is accepted, because the effective pair
 *     is then consistent.
 */

/** What the caller sent. `undefined` means "absent from the request body". */
export interface SubmittedDates {
  startDate?: string | Date | null;
  dueDate?: string | Date | null;
}

/** What the row currently holds. */
export interface StoredDates {
  startDate?: Date | null;
  dueDate?: Date | null;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  // An unparseable value is rejected separately, by the format check, with a
  // message that names the right field. Treating it as absent here avoids
  // producing a misleading ordering error for what is really a format problem.
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Is this request changing either date?
 *
 * Presence, not truthiness: `{ dueDate: null }` is a deliberate clearing of
 * the field and must be validated, while a body with no `dueDate` key at all
 * must not be.
 */
export function isChangingEitherDate(submitted: SubmittedDates): boolean {
  return submitted.startDate !== undefined || submitted.dueDate !== undefined;
}

/**
 * True when the update must be refused because it would leave the issue with
 * a due date before its start date.
 *
 * Returns false whenever the request changes neither date, regardless of what
 * the stored values are.
 */
export function violatesDateOrder(submitted: SubmittedDates, stored: StoredDates): boolean {
  if (!isChangingEitherDate(submitted)) return false;

  const effectiveStart =
    submitted.startDate !== undefined ? toDate(submitted.startDate) : toDate(stored.startDate);
  const effectiveDue =
    submitted.dueDate !== undefined ? toDate(submitted.dueDate) : toDate(stored.dueDate);

  if (!effectiveStart || !effectiveDue) return false;
  return effectiveDue < effectiveStart;
}

export const DATE_ORDER_ERROR = "Due Date cannot be earlier than Start Date";
