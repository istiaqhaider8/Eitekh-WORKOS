import { format, parseISO, startOfDay, endOfDay, isBefore, isAfter, isEqual } from 'date-fns';

export interface SimpleLeave {
  id: string;
  userId: string;
  startDate: string | Date;
  endDate: string | Date;
  leaveType: string;
  note?: string | null;
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    avatarUrl?: string | null;
  };
}

/**
 * Normalizes date bounds so that start date begins at 00:00:00.000 and end date ends at 23:59:59.999.
 * This guarantees inclusive date range checks.
 */
export function normalizeDateRange(startInput: Date | string, endInput: Date | string) {
  const start = typeof startInput === 'string' ? parseISO(startInput) : new Date(startInput);
  const end = typeof endInput === 'string' ? parseISO(endInput) : new Date(endInput);
  
  return {
    startDate: startOfDay(start),
    endDate: endOfDay(end),
  };
}

/**
 * Formats a leave date range string, e.g. "20 Sep – 25 Sep 2026" or "20 Sep 2026".
 */
export function formatLeaveRange(startInput: Date | string, endInput: Date | string): string {
  const start = typeof startInput === 'string' ? parseISO(startInput) : new Date(startInput);
  const end = typeof endInput === 'string' ? parseISO(endInput) : new Date(endInput);

  const startFormatted = format(start, 'dd MMM yyyy');
  const endFormatted = format(end, 'dd MMM yyyy');

  if (startFormatted === endFormatted) {
    return format(start, 'dd MMM yyyy');
  }

  if (start.getFullYear() === end.getFullYear()) {
    return `${format(start, 'dd MMM')} – ${format(end, 'dd MMM yyyy')}`;
  }

  return `${format(start, 'dd MMM yyyy')} – ${format(end, 'dd MMM yyyy')}`;
}

/**
 * Checks if a user is on leave on a given target date.
 */
export function isUserOnLeave(leaves: SimpleLeave[], targetDateInput: Date | string): { onLeave: boolean; leave?: SimpleLeave } {
  const target = typeof targetDateInput === 'string' ? parseISO(targetDateInput) : new Date(targetDateInput);

  for (const leave of leaves) {
    if ((leave as any).status === 'CANCELLED') continue;
    const { startDate, endDate } = normalizeDateRange(leave.startDate, leave.endDate);
    if ((isAfter(target, startDate) || isEqual(target, startDate)) && (isBefore(target, endDate) || isEqual(target, endDate))) {
      return { onLeave: true, leave };
    }
  }

  return { onLeave: false };
}

/**
 * Checks if a date range (e.g. task start/due date range) overlaps with any of the user's leave records.
 */
export function doesLeaveOverlap(
  leaves: SimpleLeave[],
  rangeStartInput: Date | string,
  rangeEndInput?: Date | string | null
): { hasOverlap: boolean; overlappingLeaves: SimpleLeave[]; warningText?: string } {
  const { startDate: targetStart, endDate: targetEnd } = normalizeDateRange(
    rangeStartInput,
    rangeEndInput || rangeStartInput
  );

  const overlapping: SimpleLeave[] = [];

  for (const leave of leaves) {
    if ((leave as any).status === 'CANCELLED') continue;
    const { startDate: leaveStart, endDate: leaveEnd } = normalizeDateRange(leave.startDate, leave.endDate);

    // Overlap occurs if leaveStart <= targetEnd AND leaveEnd >= targetStart
    const overlaps =
      (isBefore(leaveStart, targetEnd) || isEqual(leaveStart, targetEnd)) &&
      (isAfter(leaveEnd, targetStart) || isEqual(leaveEnd, targetStart));

    if (overlaps) {
      overlapping.push(leave);
    }
  }

  if (overlapping.length === 0) {
    return { hasOverlap: false, overlappingLeaves: [] };
  }

  const firstLeave = overlapping[0];
  const formattedRange = formatLeaveRange(firstLeave.startDate, firstLeave.endDate);
  
  let delegateStr = "";
  const delUser = (firstLeave as any).delegations?.[0]?.delegateUser || (firstLeave as any).delegateUser;
  if (delUser) {
    const dName = delUser.firstName ? `${delUser.firstName} ${delUser.lastName || ""}`.trim() : (delUser.email || "");
    if (dName) {
      delegateStr = ` · Delegated to: ${dName}`;
    }
  }

  const warningText = `🔴 On Leave (${formattedRange}${firstLeave.leaveType ? ` · ${firstLeave.leaveType}` : ""}${delegateStr})`;

  return {
    hasOverlap: true,
    overlappingLeaves: overlapping,
    warningText,
  };
}
