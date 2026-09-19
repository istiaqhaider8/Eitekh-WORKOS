/**
 * When a recurring task should next run.
 *
 * WHAT WAS WRONG
 *
 * `getNextCronDate` in the trigger route ignored its schedule argument
 * entirely:
 *
 *     function getNextCronDate(cron: string, fromDate = new Date()): Date {
 *       // Simple fallback: add 1 day
 *       const next = new Date(fromDate);
 *       next.setDate(next.getDate() + 1);
 *       return next;
 *     }
 *
 * So a WEEKLY task fired daily and a MONTHLY task fired daily — seven and
 * thirty times more often than the person who configured it asked for. The
 * feature appeared to work, which is why it could sit there: issues were
 * created, on a schedule, just not the one anyone chose.
 *
 * THE FIELD IS NAMED FOR SOMETHING IT IS NOT
 *
 * `RecurringTask.scheduleCron` is a `String` validated as "any text up to 100
 * characters", and the UI labels it "Cron:". It has never held a cron
 * expression — the schema comment says `// DAILY, WEEKLY, MONTHLY` and those
 * are the only values the product produces. Supporting real cron syntax would
 * mean a parser dependency and a much larger surface (timezones, DST, ranges),
 * and it is not what the product offers today.
 *
 * So this implements the three documented cadences, and the write schema is
 * now an enum so no new row can be ambiguous. Existing rows holding something
 * else keep their current daily behaviour rather than silently stopping — but
 * they say so in the log, which is more than they did before.
 */

export const RECURRENCE_VALUES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type Recurrence = (typeof RECURRENCE_VALUES)[number];

export interface NextRun {
  /** When it should next fire. */
  at: Date;
  /**
   * True when the schedule was not one of the known cadences and DAILY was
   * assumed. The caller logs this; it is how a legacy or mistyped value
   * becomes visible instead of just behaving oddly.
   */
  assumedDaily: boolean;
}

/**
 * Add one interval to `from`.
 *
 * MONTHLY clamps to the end of the target month. Without that, JavaScript's
 * date arithmetic turns 31 January into 3 March — `setMonth(1)` on a day-31
 * date overflows into the month after February. A task set up on the 31st
 * would then drift a few days forward every month and eventually land on a
 * different date entirely.
 */
export function nextRunFrom(schedule: string | null | undefined, from: Date): NextRun {
  const normalised = (schedule ?? "").trim().toUpperCase();
  const known = (RECURRENCE_VALUES as readonly string[]).includes(normalised);
  const cadence = known ? (normalised as Recurrence) : "DAILY";

  const next = new Date(from.getTime());

  switch (cadence) {
    case "WEEKLY":
      next.setDate(next.getDate() + 7);
      break;

    case "MONTHLY": {
      const dayOfMonth = next.getDate();
      // Move to the 1st before changing month, so the overflow above cannot
      // happen, then put the day back — clamped to what the month has.
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
      const daysInTargetMonth = new Date(
        next.getFullYear(),
        next.getMonth() + 1,
        0
      ).getDate();
      next.setDate(Math.min(dayOfMonth, daysInTargetMonth));
      break;
    }

    case "DAILY":
    default:
      next.setDate(next.getDate() + 1);
      break;
  }

  return { at: next, assumedDaily: !known };
}
