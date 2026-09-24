/**
 * Allocating the next ticket key for a project.
 *
 * Modeled after `allocateIssueKey` in `src/lib/issue-keys.ts`.
 *
 * Counter increment AND reconciliation against `max(ticketNumber)` inside an atomic
 * Prisma transaction client guarantees no race conditions or duplicate keys under
 * concurrent submissions.
 */

import type { Prisma } from "@prisma/client";

export interface AllocatedTicketKey {
  ticketNumber: number;
  ticketKey: string;
  project: Prisma.ProjectGetPayload<{
    include: { workflows: { include: { statuses: true } } };
  }>;
}

export async function allocateTicketKey(
  tx: Prisma.TransactionClient,
  projectId: string
): Promise<AllocatedTicketKey> {
  const maxTicket = await tx.ticket.findFirst({
    where: { projectId },
    orderBy: { ticketNumber: "desc" },
    select: { ticketNumber: true },
  });
  const maxExistingKey = maxTicket?.ticketNumber || 0;

  const include = {
    workflows: {
      include: { statuses: { orderBy: { position: "asc" as const } } },
    },
  };

  let project = await tx.project.update({
    where: { id: projectId },
    data: { ticketCounter: { increment: 1 } },
    include,
  });

  let ticketNumber = project.ticketCounter;
  if (ticketNumber <= maxExistingKey) {
    // The counter had fallen behind reality. Jump it past the highest key that exists
    ticketNumber = maxExistingKey + 1;
    project = await tx.project.update({
      where: { id: projectId },
      data: { ticketCounter: ticketNumber },
      include,
    });
  }

  return {
    ticketNumber,
    ticketKey: `${project.key}-TKT-${ticketNumber}`,
    project,
  };
}
