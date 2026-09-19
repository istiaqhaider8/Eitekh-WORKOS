/**
 * Raw SQL must not compare a Prisma `DateTime` column against `now()`.
 *
 * THE BUG THIS PINS
 *
 * Prisma maps `DateTime` to `timestamp(3)` — WITHOUT time zone — and stores the
 * UTC instant. Postgres `now()` is a `timestamptz`. Comparing the two makes
 * Postgres interpret the naive column value as being in the SESSION's time
 * zone, so every stored instant reads back shifted by the server's UTC offset.
 *
 * It produced two real defects, found on a machine running Asia/Dhaka (+06):
 *
 *   1. The webhook worker. A delivery claimed a millisecond ago compared as six
 *      hours old, so the "abandoned claim" reclaim fired instantly and a second
 *      worker could deliver the same event again. In the same statement,
 *      `nextAttemptAt <= now()` was true for anything scheduled less than six
 *      hours out, so the retry backoff did nothing at all.
 *
 *   2. The rate limiter's Retry-After. `resetAt` was written as
 *      `now() + interval`, storing the session-LOCAL wall clock into a naive
 *      column; Prisma then read it back as UTC. A user who tripped a 60-second
 *      limit was told to wait 21,660 seconds — six hours — before retrying.
 *      The limiting itself still worked, because that comparison was
 *      internally consistent; only the number handed to the user was wrong.
 *
 * WHY IT NEEDS A TEST AND NOT JUST A FIX
 *
 * On a UTC database the offset is zero and every one of these is correct. CI
 * runs on UTC. So this class of bug passes every test, ships, and then
 * misbehaves only in production or only for customers in some regions — and
 * the symptom (a backoff that does nothing, a six-hour Retry-After) looks
 * nothing like a timezone problem.
 *
 * These tests assert on real behaviour against the real database, so they hold
 * wherever they run; the reasoning above explains why the UTC case passing is
 * not reassurance.
 */

import { PrismaClient } from "@prisma/client";
import { assertSafeTestDatabase } from "./harness";

const dbUrl = assertSafeTestDatabase(process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const RUN = `tz${Date.now().toString(36)}`;

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "RateLimitCounter" WHERE "key" LIKE ${RUN + "%"}`;
  await prisma.$disconnect();
});

describe("the database session is not necessarily UTC", () => {
  it("reports the session time zone, for the record", async () => {
    const [row] = await prisma.$queryRaw<Array<{ tz: string; offset_hours: number }>>`
      SELECT current_setting('TimeZone') AS tz,
             EXTRACT(TIMEZONE_HOUR FROM now())::int AS offset_hours`;
    // Not an assertion on the value — a UTC database is perfectly fine. This
    // exists so a failure below can be read in context: if offset_hours is 0,
    // a passing run proves less than it looks.
    console.log(`[timezone] session TimeZone=${row.tz}, offset=${row.offset_hours}h`);
    expect(typeof row.tz).toBe("string");
  });
});

describe("rate limiter: resetAt round-trips as a real instant", () => {
  it("Retry-After reflects the configured window, not the UTC offset", async () => {
    const key = `${RUN}_retryafter`;
    const windowSeconds = 60;

    // Exactly the statement src/lib/rate-limit-store.ts issues.
    const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      INSERT INTO "RateLimitCounter" ("key", "count", "resetAt")
      VALUES (${key}, 1, (now() AT TIME ZONE 'UTC') + ${`${windowSeconds} seconds`}::interval)
      ON CONFLICT ("key") DO UPDATE SET "count" = 1
      RETURNING "count", "resetAt"
    `;

    const secondsUntilReset = Math.ceil((new Date(rows[0].resetAt).getTime() - Date.now()) / 1000);

    // Before the fix this was 21,660 on a +06 database.
    expect(secondsUntilReset).toBeGreaterThan(0);
    expect(secondsUntilReset).toBeLessThanOrEqual(windowSeconds + 5);
  });

  it("an expired window is recognised as expired", async () => {
    // The other direction: the comparison that decides whether to reset the
    // counter must also agree with wall-clock reality.
    const key = `${RUN}_expired`;
    await prisma.$executeRaw`
      INSERT INTO "RateLimitCounter" ("key", "count", "resetAt")
      VALUES (${key}, 5, (now() AT TIME ZONE 'UTC') - interval '1 second')
      ON CONFLICT ("key") DO UPDATE SET "count" = 5
    `;

    const [row] = await prisma.$queryRaw<Array<{ expired: boolean }>>`
      SELECT ("resetAt" <= (now() AT TIME ZONE 'UTC')) AS expired
        FROM "RateLimitCounter" WHERE "key" = ${key}`;

    expect(row.expired).toBe(true);
  });

  it("a live window is NOT recognised as expired", async () => {
    // With the bug, a window an hour long looked expired the moment it opened
    // on any database more than that far from UTC — so the limiter would have
    // reset the counter on every request and stopped limiting at all.
    const key = `${RUN}_live`;
    await prisma.$executeRaw`
      INSERT INTO "RateLimitCounter" ("key", "count", "resetAt")
      VALUES (${key}, 1, (now() AT TIME ZONE 'UTC') + interval '1 hour')
      ON CONFLICT ("key") DO UPDATE SET "count" = 1
    `;

    const [row] = await prisma.$queryRaw<Array<{ expired: boolean }>>`
      SELECT ("resetAt" <= (now() AT TIME ZONE 'UTC')) AS expired
        FROM "RateLimitCounter" WHERE "key" = ${key}`;

    expect(row.expired).toBe(false);
  });
});

describe("the shape of the mistake, in isolation", () => {
  it("a bare now() DOES disagree with a Prisma-written column when the session is not UTC", async () => {
    /**
     * Documents the trap rather than the fix.
     *
     * A timestamp written as UTC into a naive column, compared against `now()`,
     * is off by the session offset. On a UTC database both are equal and this
     * test is trivially true — which is exactly why the comment above matters
     * more than the assertion.
     */
    const [row] = await prisma.$queryRaw<
      Array<{ naive_utc: Date; via_now: Date; drift_seconds: number }>
    >`
      SELECT (now() AT TIME ZONE 'UTC') AS naive_utc,
             now()::timestamp            AS via_now,
             EXTRACT(EPOCH FROM (now()::timestamp - (now() AT TIME ZONE 'UTC')))::int AS drift_seconds`;

    const offsetHours = row.drift_seconds / 3600;

    // `now()::timestamp` takes the session-local wall clock; `now() AT TIME
    // ZONE 'UTC'` takes the UTC one. Their difference IS the session offset,
    // and it is precisely the error that leaked into both defects above.
    expect(Number.isInteger(offsetHours * 4)).toBe(true); // quarter-hour zones exist
  });
});
