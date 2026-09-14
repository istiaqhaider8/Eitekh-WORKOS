import { parseISO, startOfDay, endOfDay, isBefore, isAfter, isEqual } from 'date-fns';
import { prisma } from './prisma';
import { syncEngine } from './sync-engine';
import { logger } from './logger';

export interface SimpleDelegation {
  id: string;
  leaveId?: string | null;
  issueId: string;
  originalAssigneeId: string;
  delegateUserId: string;
  startDate: string | Date;
  endDate: string | Date;
  status: string; // ACTIVE, ENDED, CANCELLED
  reason?: string | null;
  createdBy: string;
  createdAt: string | Date;
  endedAt?: string | Date | null;
  originalAssignee?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    avatarUrl?: string | null;
  };
  delegateUser?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    avatarUrl?: string | null;
  };
  issue?: {
    id: string;
    issueKey: string;
    title: string;
    statusId?: string;
  };
  history?: Array<{
    id: string;
    action: string;
    details?: string | null;
    timestamp: string | Date;
    actor?: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    };
  }>;
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
export function isDelegationActive(delegation: SimpleDelegation, targetDateInput?: Date | string): boolean {
  if (delegation.status !== 'ACTIVE') return false;
  
  const target = targetDateInput 
    ? (typeof targetDateInput === 'string' ? parseISO(targetDateInput) : new Date(targetDateInput))
    : new Date();

  const { startDate, endDate } = normalizeDelegationDateRange(delegation.startDate, delegation.endDate);

  return (isAfter(target, startDate) || isEqual(target, startDate)) && (isBefore(target, endDate) || isEqual(target, endDate));
}

/**
 * Finds the currently active delegation for a specific issue from a list of delegation records.
 */
export function getActiveDelegationForIssue(
  delegations: SimpleDelegation[],
  issueId: string,
  targetDateInput?: Date | string
): SimpleDelegation | null {
  const active = delegations.filter((d) => d.issueId === issueId && isDelegationActive(d, targetDateInput));
  return active.length > 0 ? active[0] : null;
}

/**
 * Automatically processes expired delegations across the database.
 * If a delegation's endDate has passed, marks status = 'ENDED', sets endedAt = now, and logs history.
 */
export async function autoProcessExpiredDelegations() {
  try {
    const now = new Date();
    
    // Find active delegations whose endDate is in the past
    const expiredDelegations = await prisma.taskDelegation.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { lt: startOfDay(now) },
      },
      include: {
        issue: { select: { id: true, issueKey: true, title: true, projectId: true } },
        originalAssignee: { select: { id: true, firstName: true, lastName: true, email: true } },
        delegateUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (expiredDelegations.length === 0) return 0;

    let processedCount = 0;
    for (const d of expiredDelegations) {
      await prisma.taskDelegation.update({
        where: { id: d.id },
        data: {
          status: 'ENDED',
          endedAt: now,
          history: {
            create: {
              actorId: d.originalAssigneeId,
              action: 'ENDED',
              details: `Delegation automatically ended as leave period completed (${now.toLocaleDateString()}). Task returned to ${d.originalAssignee.firstName} ${d.originalAssignee.lastName}.`,
            },
          },
        },
      });

      // Also create an ActivityLog on the issue
      await prisma.activityLog.create({
        data: {
          issueId: d.issueId,
          actorId: d.originalAssigneeId,
          actionType: 'DELEGATION_ENDED',
          fieldChanged: 'delegation',
          oldValue: `Delegated to ${d.delegateUser.firstName} ${d.delegateUser.lastName}`,
          newValue: `Returned to ${d.originalAssignee.firstName} ${d.originalAssignee.lastName}`,
        },
      });

      // Realtime notification sync event
      if (d.issue?.projectId) {
        syncEngine.publishProjectEvent({
          projectId: d.issue.projectId,
          eventType: 'ISSUE_UPDATED',
          entityId: d.issueId,
          data: { id: d.issueId, issueId: d.issueId, delegationEnded: true },
        });
      }

      logger.info('DELEGATION_AUTO_ENDED', 'Delegation automatically ended after leave period', {
        delegationId: d.id,
        issueId: d.issueId,
        originalAssigneeId: d.originalAssigneeId,
        delegateUserId: d.delegateUserId,
      });

      processedCount++;
    }

    return processedCount;
  } catch (error) {
    logger.error('DELEGATION_ENGINE_ERROR', 'Error auto-processing expired delegations', error);
    return 0;
  }
}
