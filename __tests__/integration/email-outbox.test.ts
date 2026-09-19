/**
 * C2 — the email outbox lifecycle, against the real database.
 *
 * WHAT WAS WRONG
 *
 * Queued mail lived in an array on the process. A restart threw away
 * everything not yet sent, silently; retry was per-instance; and nothing
 * outside that process could see the queue, so "was the invitation sent?" had
 * no answer for anyone.
 *
 * The flows that depend on this are the ones a locked-out user cannot work
 * around — password resets, OTP codes, invitations — so a dropped send is a
 * support ticket at best.
 *
 * WHAT IS ASSERTED
 *
 * Mostly failure and restart, because the happy path was never the problem:
 * mail went out fine when the provider was up and the process stayed alive.
 * What did not exist was any behaviour when either was untrue.
 *
 * `sendEmail` is stubbed. The SMTP conversation is not what this is testing,
 * and a test that needs a mail server is a test nobody runs.
 */

import { PrismaClient } from "@prisma/client";
import { assertSafeTestDatabase } from "./harness";

const dbUrl = assertSafeTestDatabase(process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const RUN = `eo${Date.now().toString(36)}`;
const TO = `${RUN}@outbox.test`;

// Stubbed before the module under test is loaded, so its import binding picks
// up the mock rather than the real transport.
let sendResult: () => Promise<any> | any;
const sendCalls: any[] = [];

jest.mock("@/lib/email", () => ({
  sendEmail: (...args: any[]) => {
    sendCalls.push(args[0]);
    return (global as any).__sendResult();
  },
  DEFAULT_SENDER_EMAIL: "noreply@test.local",
  DEFAULT_SENDER_NAME: "Test",
}));

(global as any).__sendResult = () => ({ status: "SENT", messageId: "m1" });

import {
  enqueueEmail,
  runDueEmails,
  replayEmail,
  whenEmailWorkerIdle,
  MAX_EMAIL_ATTEMPTS,
} from "@/lib/email-outbox";

afterAll(async () => {
  await prisma.emailOutbox.deleteMany({ where: { to: { startsWith: RUN } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await whenEmailWorkerIdle();
  sendCalls.length = 0;
  (global as any).__sendResult = () => ({ status: "SENT", messageId: "m1" });
  await prisma.emailOutbox.deleteMany({ where: { to: { startsWith: RUN } } });
});

const rows = () =>
  prisma.emailOutbox.findMany({ where: { to: { startsWith: RUN } }, orderBy: { createdAt: "asc" } });

async function makeDue() {
  await prisma.emailOutbox.updateMany({
    where: { to: { startsWith: RUN } },
    data: { nextAttemptAt: new Date(Date.now() - 1000) },
  });
}

// ---------------------------------------------------------------------------
describe("the message is persisted before it is sent", () => {
  it("survives as a row, so a restart cannot lose it", async () => {
    // The headline property. The old array was gone the moment the process was.
    const id = await enqueueEmail({ to: TO, templateKey: "WELCOME", variables: { userName: "A" } });
    expect(id).toBeTruthy();

    await whenEmailWorkerIdle();
    const [row] = await rows();
    expect(row).toBeTruthy();
    expect(row.to).toBe(TO);
    expect(JSON.parse(row.variables!)).toEqual({ userName: "A" });
  });

  it("is visible to anything with a database connection", async () => {
    // "Was the invitation sent?" now has an answer, for support and for the
    // admin view, without attaching to the process that queued it.
    await enqueueEmail({ to: TO, customSubject: "visible" });
    await whenEmailWorkerIdle();

    const viaSeparateConnection = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    const found = await viaSeparateConnection.emailOutbox.count({ where: { to: TO } });
    await viaSeparateConnection.$disconnect();

    expect(found).toBe(1);
  });

  it("refuses a duplicate carrying the same idempotency key", async () => {
    // A durable queue faithfully persists a double-enqueue, so the guard has
    // to be at the insert. Without it, a retried request sends two invitations.
    const key = `${RUN}-invite-1`;
    const first = await enqueueEmail({ to: TO, customSubject: "invite", idempotencyKey: key });
    const second = await enqueueEmail({ to: TO, customSubject: "invite", idempotencyKey: key });

    expect(first).toBeTruthy();
    expect(second).toBeNull();
    await whenEmailWorkerIdle();
    expect(await rows()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("sending", () => {
  it("marks the row SENT and records when", async () => {
    await enqueueEmail({ to: TO, customSubject: "ok" });
    await makeDue();
    await runDueEmails();

    const [row] = await rows();
    expect(row.status).toBe("SENT");
    expect(row.attempts).toBe(1);
    expect(row.sentAt).not.toBeNull();
  });

  it("passes the stored template and variables to the sender", async () => {
    await enqueueEmail({ to: TO, templateKey: "WELCOME", variables: { userName: "Bo" } });
    await makeDue();
    await runDueEmails();

    expect(sendCalls[0]).toMatchObject({
      to: TO,
      templateKey: "WELCOME",
      variables: { userName: "Bo" },
    });
  });

  it("treats MOCKED as done, so a developer without SMTP accrues no backlog", async () => {
    (global as any).__sendResult = () => ({ status: "MOCKED", messageId: "mock" });
    await enqueueEmail({ to: TO, customSubject: "dev" });
    await makeDue();
    await runDueEmails();

    expect((await rows())[0].status).toBe("SENT");
  });
});

// ---------------------------------------------------------------------------
describe("a failing provider", () => {
  it("is retried rather than losing the message", async () => {
    (global as any).__sendResult = () => ({ status: "FAILED", error: "smtp 451" });
    await enqueueEmail({ to: TO, customSubject: "retry me" });
    await makeDue();
    await runDueEmails();

    const [row] = await rows();
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(1);
    expect(row.error).toContain("451");
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("respects the backoff instead of retrying immediately", async () => {
    /**
     * The regression guard for the timezone bug that made the webhook backoff
     * inert: Prisma writes `timestamp` without a zone, `now()` is a
     * `timestamptz`, and comparing them reads the column as session-local — so
     * on a non-UTC database every scheduled retry looks due. Invisible on the
     * UTC machines CI runs on.
     *
     * Note this does NOT call makeDue(). That is the point.
     */
    (global as any).__sendResult = () => ({ status: "FAILED", error: "down" });
    await enqueueEmail({ to: TO, customSubject: "backoff" });
    await makeDue();
    await runDueEmails();
    expect((await rows())[0].attempts).toBe(1);

    const before = sendCalls.length;
    await runDueEmails();

    expect(sendCalls.length).toBe(before);
    expect((await rows())[0].attempts).toBe(1);
  });

  it("succeeds on a later attempt once the provider recovers", async () => {
    (global as any).__sendResult = () => ({ status: "FAILED", error: "down" });
    await enqueueEmail({ to: TO, customSubject: "recovers" });
    await makeDue();
    await runDueEmails();

    (global as any).__sendResult = () => ({ status: "SENT", messageId: "m2" });
    await makeDue();
    await runDueEmails();

    const [row] = await rows();
    expect(row.status).toBe("SENT");
    expect(row.attempts).toBe(2);
  });

  it("dead-letters after the attempt limit", async () => {
    (global as any).__sendResult = () => ({ status: "FAILED", error: "permanent" });
    await enqueueEmail({ to: TO, customSubject: "dead" });

    for (let i = 0; i < MAX_EMAIL_ATTEMPTS; i++) {
      await makeDue();
      await runDueEmails();
    }

    const [row] = await rows();
    expect(row.status).toBe("DEAD");
    expect(row.attempts).toBe(MAX_EMAIL_ATTEMPTS);

    // And it is not picked up again.
    const before = sendCalls.length;
    await makeDue();
    await runDueEmails();
    expect(sendCalls.length).toBe(before);
  });

  it("dead-letters immediately on an error retrying cannot fix", async () => {
    // Corrupt stored variables are not a transient condition; five attempts
    // would just be five identical failures.
    // deliverNow:false — the opportunistic kick would send this before the
    // variables below are corrupted, and the test would assert on the wrong run.
    const id = await enqueueEmail({ to: TO, customSubject: "bad vars" }, { deliverNow: false });
    await prisma.emailOutbox.update({ where: { id: id! }, data: { variables: "{not json" } });
    await makeDue();
    await runDueEmails();

    const [row] = await rows();
    expect(row.status).toBe("DEAD");
    expect(row.attempts).toBe(1);
    expect(sendCalls).toHaveLength(0);
  });

  it("records a thrown error rather than losing the row", async () => {
    (global as any).__sendResult = () => {
      throw new Error("transport exploded");
    };
    await enqueueEmail({ to: TO, customSubject: "throws" });
    await makeDue();
    await runDueEmails();

    const [row] = await rows();
    expect(row.status).toBe("FAILED");
    expect(row.error).toContain("transport exploded");
  });
});

// ---------------------------------------------------------------------------
describe("multi-instance and recovery", () => {
  it("does not send a message another instance is working on", async () => {
    await enqueueEmail({ to: TO, customSubject: "claimed" }, { deliverNow: false });
    const [created] = await rows();
    await prisma.emailOutbox.update({
      where: { id: created.id },
      data: { status: "SENDING", claimedBy: "another-instance", claimedAt: new Date() },
    });

    const result = await runDueEmails();
    expect(result.attempted).toBe(0);
    expect(sendCalls).toHaveLength(0);
  });

  it("reclaims a message abandoned by an instance that died mid-send", async () => {
    // Without this a deploy during a send leaves the row SENDING forever, and
    // the outbox quietly stops draining while looking healthy.
    await enqueueEmail({ to: TO, customSubject: "abandoned" }, { deliverNow: false });
    const [created] = await rows();
    await prisma.emailOutbox.update({
      where: { id: created.id },
      data: {
        status: "SENDING",
        claimedBy: "an-instance-that-is-gone",
        claimedAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    });

    await runDueEmails();
    expect((await rows())[0].status).toBe("SENT");
  });

  it("a dead message can be replayed once the cause is fixed", async () => {
    (global as any).__sendResult = () => ({ status: "FAILED", error: "bad address" });
    const id = await enqueueEmail({ to: TO, customSubject: "replay" });
    await prisma.emailOutbox.update({
      where: { id: id! },
      data: { status: "DEAD", attempts: MAX_EMAIL_ATTEMPTS },
    });

    (global as any).__sendResult = () => ({ status: "SENT", messageId: "m3" });
    expect(await replayEmail(id!)).toBe(true);
    await makeDue();
    await runDueEmails();

    const [row] = await rows();
    expect(row.status).toBe("SENT");
    // Reset, so the replay is not killed by its predecessor's history.
    expect(row.attempts).toBe(1);
  });

  it("a SENT message cannot be replayed", async () => {
    const id = await enqueueEmail({ to: TO, customSubject: "already sent" });
    await makeDue();
    await runDueEmails();
    expect((await rows())[0].status).toBe("SENT");

    expect(await replayEmail(id!)).toBe(false);
  });
});
