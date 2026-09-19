/**
 * C3 — who should hear about something that happened to an issue.
 *
 * WHY THIS EXISTS
 *
 * The notification preferences page offered ten toggles. Four of them
 * corresponded to a notification the server actually sends; six did not, so
 * turning them on or off changed nothing at all. A control that does nothing
 * is worse than a missing one: the user believes they have configured
 * something, and when the notification never arrives they conclude the product
 * is broken rather than that the switch was decorative.
 *
 * Two of the six — COMMENT and STATUS — are the notifications anyone expects
 * from an issue tracker, and the data needed to send them was already loaded
 * at both call sites. What was missing was an answer to "to whom", which is
 * this module.
 *
 * THE RULE
 *
 * Watchers, the assignee and the reporter. That set is deliberate:
 *
 *   - a WATCHER has explicitly asked to hear about this issue;
 *   - the ASSIGNEE is the person expected to act on it;
 *   - the REPORTER raised it and is waiting on the outcome.
 *
 * Not project members. A comment on one issue is not news to two hundred
 * people, and the fastest way to make a notification system worthless is to
 * make it noisy enough that everyone mutes it.
 *
 * The actor is always removed. Being told about your own action is the single
 * most common complaint about notification systems, and the engine's own
 * dispatch already filters the actor — this does it too so the caller can tell
 * in advance whether there is anyone left to notify.
 */

import { prisma } from "./prisma";

export interface IssueSubscriberQuery {
  issueId: string;
  /** Excluded from the result: nobody is notified of their own action. */
  actorId?: string | null;
  /**
   * Also excluded. Used by the comment path, where a mentioned user has
   * already received a MENTION for the same comment — two notifications for
   * one event is noise, and the more specific one wins.
   */
  excludeUserIds?: Iterable<string>;
}

/**
 * The user ids that should be notified about a change to this issue.
 *
 * One query. An earlier shape would have been three (watchers, assignee,
 * reporter) on a path that already runs inside a request the user is waiting
 * on.
 */
export async function getIssueSubscribers({
  issueId,
  actorId,
  excludeUserIds,
}: IssueSubscriberQuery): Promise<string[]> {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: {
      assigneeId: true,
      reporterId: true,
      watchers: { select: { userId: true } },
    },
  });
  if (!issue) return [];

  const excluded = new Set<string>(excludeUserIds ?? []);
  if (actorId) excluded.add(actorId);

  const recipients = new Set<string>();
  for (const w of issue.watchers) recipients.add(w.userId);
  if (issue.assigneeId) recipients.add(issue.assigneeId);
  if (issue.reporterId) recipients.add(issue.reporterId);

  for (const id of excluded) recipients.delete(id);

  return [...recipients];
}
