/**
 * Pure date logic for delegations — safe to import from client components.
 *
 * WHY THIS IS SEPARATE FROM delegation-engine.ts
 *
 * Five client components (`ListView`, `KanbanBoardView`, `TimelineGanttView`,
 * `WorkloadView`, `IssueDetailModal`) need only `isDelegationActive`, a pure
 * function over dates. It used to live in `delegation-engine.ts`, which also
 * imports Prisma and the sync engine — so importing one predicate pulled the
 * entire server-side engine into the browser bundle.
 *
 * That was invisible until PROD-4 added the `pg` driver to the sync engine's
 * dependencies: `pg` requires `fs`, which does not exist in a browser, and the
 * production build failed. The build error was the first time the problem
 * announced itself, but the bundle had been carrying server code all along.
 *
 * So the fix is to split rather than to teach the bundler to ignore it:
 * client-safe logic lives here, server-only logic stays in
 * `delegation-engine.ts`, and that module re-exports these so existing server
 * callers are unaffected.
 */

import { parseISO, startOfDay, endOfDay, isBefore, isAfter, isEqual } from 'date-fns';

export interface DelegationDateRange {
  status: string;
  startDate: Date | string;
  endDate: Date | string;
}

/**
 * Normalizes date bounds (00:00:00.000 to 23:59:59.999).
 */
export function normalizeDelegationDateRange(startInput: Date | string, endInput: Date | string) {
  const start = typeof startInput === 'string' ? parseISO(startInput) : new Date(startInput);
  const end = typeof endInput === 'string' ? parseISO(endInput) : new Date(endInput);

  return {
    startDate: startOfDay(start),
    endDate: endOfDay(end),
  };
}

/**
 * Evaluates whether a delegation is currently active on a given target date.
 */
export function isDelegationActive(delegation: DelegationDateRange, targetDateInput?: Date | string): boolean {
  if (delegation.status !== 'ACTIVE') return false;

  const target = targetDateInput
    ? (typeof targetDateInput === 'string' ? parseISO(targetDateInput) : new Date(targetDateInput))
    : new Date();

  const { startDate, endDate } = normalizeDelegationDateRange(delegation.startDate, delegation.endDate);

  return (isAfter(target, startDate) || isEqual(target, startDate)) && (isBefore(target, endDate) || isEqual(target, endDate));
}
