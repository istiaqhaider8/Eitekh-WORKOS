/**
 * C2 — queued mail must not live in the process.
 *
 * WHAT THIS REPLACES
 *
 * There was a test here called email-queue-leak.test.ts. It guarded a real
 * defect: `NotificationEngine.emailQueue` removed items on SENT and MOCKED but
 * never on FAILED, so every permanently undeliverable message stayed in the
 * array for the life of the process — holding its rendered HTML, re-filtered
 * every three seconds.
 *
 * That test is gone because the array is gone, not because the property
 * stopped mattering. Deleting a test when its subject is deleted is correct;
 * deleting it quietly is how a guarantee disappears. The leak class it covered
 * is now architecturally impossible — there is no in-memory queue to grow —
 * and what replaced it has its own lifecycle tests in
 * __tests__/integration/email-outbox.test.ts, where a real database can
 * exercise the claim, the backoff and the dead-letter.
 *
 * What is left to assert here is the structural claim that makes those
 * integration tests the right place: that the engine does not hold mail in
 * memory at all. If someone reintroduces an array "just for buffering", the
 * restart-loses-everything defect comes back with it, and every symptom is
 * invisible from inside the running app.
 */

import { readFileSync } from "fs";
import { join } from "path";

const code = (name: string) =>
  readFileSync(join(__dirname, "..", name), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("the notification engine holds no email queue", () => {
  const engine = code("notifications.ts");

  it("declares no in-memory queue array", () => {
    // The exact shape of the original: `private emailQueue: EmailQueueItem[]`.
    expect(engine).not.toMatch(/private\s+emailQueue/);
    expect(engine).not.toMatch(/emailQueue\s*:\s*\w+\[\]/);
  });

  it("runs no queue-draining interval of its own", () => {
    // A setInterval on this class was what made retry per-instance: with
    // several instances, each retried only what it had enqueued itself.
    expect(engine).not.toMatch(/setInterval/);
  });

  it("delegates queueing to the durable outbox", () => {
    // A dynamic import, to keep the module graph acyclic.
    expect(engine).toMatch(/import\(["']\.\/email-outbox["']\)/);
    expect(engine).toMatch(/enqueueEmail\(item\)/);
  });

  it("reports depth from the table, not from a local array", () => {
    // getQueueStats used to filter an array, so it described one process's
    // backlog and called it the queue depth.
    expect(engine).toMatch(/prisma\.emailOutbox\.groupBy/);
  });
});

describe("the outbox itself", () => {
  const outbox = code("email-outbox.ts");

  it("writes the row before attempting to send", () => {
    // The ordering that makes a queued message survive a crash: persisted
    // first, sent second.
    const enqueueBody = outbox.slice(outbox.indexOf("export async function enqueueEmail"));
    expect(enqueueBody).toMatch(/prisma\.emailOutbox\.create/);
  });

  it("claims with FOR UPDATE SKIP LOCKED so instances do not double-send", () => {
    expect(outbox).toMatch(/FOR UPDATE SKIP LOCKED/);
  });

  it("compares timestamps as ::timestamp, never against now()", () => {
    /**
     * The regression guard for the bug that made the webhook backoff inert.
     *
     * Prisma stores `DateTime` as `timestamp` WITHOUT time zone, in UTC.
     * Postgres `now()` is a `timestamptz`, and comparing them makes Postgres
     * read the column as session-local — so on a non-UTC database every
     * scheduled retry looks due and every fresh claim looks abandoned. It is
     * invisible on a UTC machine, which is what CI runs on.
     */
    expect(outbox).toMatch(/::timestamp/);
    // `now()` must not appear in SQL here. Date.now() in JS is fine.
    const sqlish = outbox.replace(/Date\.now\(\)/g, "");
    expect(sqlish).not.toMatch(/\bnow\(\)/);
  });

  it("bounds retries and dead-letters", () => {
    expect(outbox).toMatch(/MAX_EMAIL_ATTEMPTS/);
    expect(outbox).toMatch(/["']DEAD["']/);
  });

  it("deduplicates on an idempotency key rather than persisting duplicates", () => {
    // A durable queue faithfully stores a double-enqueue, so the guard has to
    // be at the point of insert.
    expect(outbox).toMatch(/idempotencyKey/);
    expect(outbox).toMatch(/P2002/);
  });
});
