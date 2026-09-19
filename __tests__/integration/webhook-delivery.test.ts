/**
 * C1 — the delivery lifecycle, against the real database.
 *
 * WHY THIS IS NOT AN HTTP TEST LIKE THE OTHERS
 *
 * The valuable part of this machinery is the SQL: the claim statement that
 * stops two instances delivering the same event, the backoff written onto the
 * row, the dead-letter transition. Those need a real Postgres, so the test
 * calls the library directly and stubs only `fetch`.
 *
 * It cannot go over HTTP to a local receiver, because `isWebhookTargetAllowed`
 * blocks loopback and private addresses — correctly. Weakening that guard to
 * make it testable would trade a real SSRF control for test convenience, so
 * the target here is a plausible external hostname that passes the guard and
 * the network is stubbed instead.
 *
 * WHAT IS BEING ASSERTED
 *
 * Mostly failure. The happy path was never the problem: delivery already
 * worked when the receiver was up. What did not exist was any behaviour at all
 * when it was down — no retry, no record, no dead-letter, no way to find out.
 */

import { PrismaClient } from "@prisma/client";
import { assertSafeTestDatabase } from "./harness";
import {
  enqueueWebhookDeliveries,
  runDueDeliveries,
  replayDelivery,
  MAX_ATTEMPTS,
  CIRCUIT_THRESHOLD,
  whenWebhookWorkerIdle,
} from "@/lib/webhook-delivery";
import { verifyWebhookSignature } from "@/lib/webhook-signature";
import { encryptField } from "@/lib/encryption";

const dbUrl = assertSafeTestDatabase(process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const RUN = `wh${Date.now().toString(36)}`;
const ORG = `${RUN}_org`;
const WS = `${RUN}_ws`;
const PROJECT = `${RUN}_project`;
const WEBHOOK = `${RUN}_webhook`;
const SECRET = "whsec_" + "c".repeat(32);
/** Passes the SSRF guard: not loopback, not private, not .internal/.local. */
const TARGET = "https://hooks.integration-receiver.test/incoming";

type Captured = { url: string; headers: Record<string, string>; body: string };
let captured: Captured[] = [];
let respond: () => Promise<Response> | Response;

const realFetch = global.fetch;

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: "webhook delivery org", slug: ORG } });
  await prisma.workspace.create({ data: { id: WS, orgId: ORG, name: "ws", slug: `${RUN}-ws` } });
  await prisma.user.create({
    data: { id: `${RUN}_user`, email: `${RUN}@wh.test`, passwordHash: "x", firstName: "W", lastName: "H" },
  });
  await prisma.project.create({
    data: { id: PROJECT, workspaceId: WS, name: "p", key: RUN.slice(0, 8).toUpperCase(), ownerId: `${RUN}_user` },
  });
  await prisma.webhook.create({
    data: {
      id: WEBHOOK,
      orgId: ORG,
      projectId: PROJECT,
      targetUrl: TARGET,
      // Stored the way the app stores it, so the test exercises the decrypt.
      secret: encryptField(SECRET),
      events: JSON.stringify(["issue.updated"]),
    },
  });
}, 60_000);

afterAll(async () => {
  global.fetch = realFetch;
  await prisma.webhookDelivery.deleteMany({ where: { webhookId: WEBHOOK } });
  await prisma.webhook.deleteMany({ where: { id: WEBHOOK } });
  await prisma.project.deleteMany({ where: { id: PROJECT } });
  await prisma.workspace.deleteMany({ where: { id: WS } });
  await prisma.user.deleteMany({ where: { id: `${RUN}_user` } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Any run still in flight from the previous test would otherwise land in
  // this one’s captures.
  await whenWebhookWorkerIdle();
  captured = [];
  respond = () => new Response("ok", { status: 200 });
  global.fetch = (async (url: any, init: any) => {
    captured.push({
      url: String(url),
      headers: Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k, String(v)])),
      body: String(init?.body ?? ""),
    });
    return respond();
  }) as any;

  await prisma.webhookDelivery.deleteMany({ where: { webhookId: WEBHOOK } });
  await prisma.webhook.update({
    where: { id: WEBHOOK },
    data: { consecutiveFailures: 0, disabledUntil: null, isActive: true },
  });
});

/** Force every pending row to be due now, bypassing the backoff wait. */
async function makeDue() {
  await prisma.webhookDelivery.updateMany({
    where: { webhookId: WEBHOOK },
    data: { nextAttemptAt: new Date(Date.now() - 1000) },
  });
}

const rows = () =>
  prisma.webhookDelivery.findMany({ where: { webhookId: WEBHOOK }, orderBy: { createdAt: "asc" } });

// ---------------------------------------------------------------------------
describe("the event is recorded before it is sent", () => {
  it("enqueues a durable row per subscribed endpoint", async () => {
    const n = await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    expect(n).toBe(1);

    const [row] = await rows();
    expect(row.eventType).toBe("issue.updated");
    // The row exists whether or not the network worked. That is the whole
    // difference from the fire-and-forget version: an accepted event cannot
    // vanish, only sit in a queue.
    expect(["PENDING", "DELIVERING", "DELIVERED"]).toContain(row.status);
  });

  it("does not enqueue for an event the endpoint is not subscribed to", async () => {
    const n = await enqueueWebhookDeliveries("issue.deleted", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    expect(n).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  it("stores the exact bytes that will be signed, so a retry re-sends them", async () => {
    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    const [row] = await rows();
    const parsed = JSON.parse(row.payload);
    expect(parsed.event).toBe("issue.updated");
    expect(parsed.data).toEqual({ id: "i1" });
  });
});

// ---------------------------------------------------------------------------
describe("what the receiver actually gets", () => {
  it("is signed with a signature the reference verifier accepts", async () => {
    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    await makeDue();
    await runDueDeliveries();

    expect(captured).toHaveLength(1);
    const req = captured[0];

    const verdict = verifyWebhookSignature(
      SECRET,
      req.headers["X-Eitekh-Signature"],
      req.headers["X-Eitekh-Timestamp"],
      req.body
    );
    expect(verdict).toEqual({ ok: true });
  });

  it("does NOT contain the secret in any header", async () => {
    // The defect this replaced: the raw secret travelled on every delivery.
    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    await makeDue();
    await runDueDeliveries();

    const req = captured[0];
    for (const [name, value] of Object.entries(req.headers)) {
      expect(value).not.toContain(SECRET);
      expect(name.toLowerCase()).not.toBe("x-webhook-secret");
    }
  });

  it("carries a delivery id, so a receiver can dedupe an at-least-once retry", async () => {
    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    await makeDue();
    await runDueDeliveries();

    const [row] = await rows();
    expect(captured[0].headers["X-Eitekh-Delivery"]).toBe(row.id);
  });

  it("marks the row DELIVERED on a 2xx and records the response", async () => {
    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    await makeDue();
    await runDueDeliveries();

    const [row] = await rows();
    expect(row.status).toBe("DELIVERED");
    expect(row.responseStatus).toBe(200);
    expect(row.attempts).toBe(1);
    expect(row.deliveredAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("a failing receiver", () => {
  it("is retried rather than losing the event", async () => {
    // The headline defect. A transient 500 used to be permanent.
    respond = () => new Response("kaboom", { status: 500 });

    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    await makeDue();
    await runDueDeliveries();

    const [row] = await rows();
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(1);
    expect(row.responseStatus).toBe(500);
    expect(row.error).toContain("500");
    // Still retryable, and scheduled for later rather than immediately.
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("succeeds on a later attempt once the receiver recovers", async () => {
    respond = () => new Response("down", { status: 503 });
    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    await makeDue();
    await runDueDeliveries();
    expect((await rows())[0].status).toBe("FAILED");

    respond = () => new Response("ok", { status: 200 });
    await makeDue();
    await runDueDeliveries();

    const [row] = await rows();
    expect(row.status).toBe("DELIVERED");
    expect(row.attempts).toBe(2);
  });

  it("is dead-lettered after the attempt limit, not retried forever", async () => {
    respond = () => new Response("nope", { status: 500 });
    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await makeDue();
      // The circuit would otherwise trip and defer the row; this test is about
      // the attempt limit, so keep the endpoint eligible.
      await prisma.webhook.update({
        where: { id: WEBHOOK },
        data: { consecutiveFailures: 0, disabledUntil: null },
      });
      await runDueDeliveries();
    }

    const [row] = await rows();
    expect(row.status).toBe("DEAD");
    expect(row.attempts).toBe(MAX_ATTEMPTS);

    // And a dead row is not picked up again.
    const before = captured.length;
    await makeDue();
    await runDueDeliveries();
    expect(captured.length).toBe(before);
  });

  it("records a timeout as an error rather than losing the row", async () => {
    global.fetch = (async () => {
      throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    }) as any;

    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    await makeDue();
    await runDueDeliveries();

    const [row] = await rows();
    expect(row.status).toBe("FAILED");
    expect(row.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("the per-endpoint circuit breaker", () => {
  it("counts consecutive failures", async () => {
    respond = () => new Response("bad", { status: 500 });
    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    await makeDue();
    await runDueDeliveries();

    const wh = await prisma.webhook.findUniqueOrThrow({ where: { id: WEBHOOK } });
    expect(wh.consecutiveFailures).toBe(1);
  });

  it("suspends the endpoint once the threshold is reached", async () => {
    respond = () => new Response("bad", { status: 500 });
    await prisma.webhook.update({
      where: { id: WEBHOOK },
      data: { consecutiveFailures: CIRCUIT_THRESHOLD - 1 },
    });

    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    await makeDue();
    await runDueDeliveries();

    const wh = await prisma.webhook.findUniqueOrThrow({ where: { id: WEBHOOK } });
    expect(wh.consecutiveFailures).toBeGreaterThanOrEqual(CIRCUIT_THRESHOLD);
    expect(wh.disabledUntil).not.toBeNull();
    expect(wh.disabledUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("does not open a socket while the circuit is open", async () => {
    await prisma.webhook.update({
      where: { id: WEBHOOK },
      data: { consecutiveFailures: CIRCUIT_THRESHOLD, disabledUntil: new Date(Date.now() + 60_000) },
    });

    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    await makeDue();
    await runDueDeliveries();

    // The whole point: stop spending attempts on an endpoint already known to
    // be down, and stop burying the ones that work.
    expect(captured).toHaveLength(0);

    const [row] = await rows();
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(0);
  });

  it("one success closes the circuit", async () => {
    await prisma.webhook.update({
      where: { id: WEBHOOK },
      data: { consecutiveFailures: CIRCUIT_THRESHOLD - 1 },
    });
    respond = () => new Response("ok", { status: 200 });

    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    await makeDue();
    await runDueDeliveries();

    const wh = await prisma.webhook.findUniqueOrThrow({ where: { id: WEBHOOK } });
    expect(wh.consecutiveFailures).toBe(0);
    expect(wh.disabledUntil).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("operational recovery", () => {
  it("a deleted or deactivated endpoint dead-letters rather than retrying", async () => {
    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    await prisma.webhook.update({ where: { id: WEBHOOK }, data: { isActive: false } });

    await makeDue();
    await runDueDeliveries();

    const [row] = await rows();
    expect(row.status).toBe("DEAD");
    expect(captured).toHaveLength(0);
  });

  it("a dead delivery can be replayed, and its attempt count resets", async () => {
    respond = () => new Response("bad", { status: 500 });
    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    const [created] = await rows();
    await prisma.webhookDelivery.update({
      where: { id: created.id },
      data: { status: "DEAD", attempts: MAX_ATTEMPTS },
    });

    respond = () => new Response("ok", { status: 200 });
    expect(await replayDelivery(created.id)).toBe(true);

    await makeDue();
    await runDueDeliveries();

    const [row] = await rows();
    expect(row.status).toBe("DELIVERED");
    // Reset, so the replay is not killed by its predecessor's history.
    expect(row.attempts).toBe(1);
  });

  it("a DELIVERED delivery cannot be replayed", async () => {
    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    await makeDue();
    await runDueDeliveries();
    const [row] = await rows();
    expect(row.status).toBe("DELIVERED");

    expect(await replayDelivery(row.id)).toBe(false);
  });

  it("reclaims a delivery abandoned by an instance that died mid-flight", async () => {
    // Without this, a deploy during a delivery leaves the row DELIVERING
    // forever and the queue quietly stops draining — the classic way a worker
    // looks healthy while doing nothing.
    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    const [created] = await rows();
    await prisma.webhookDelivery.update({
      where: { id: created.id },
      data: {
        status: "DELIVERING",
        claimedBy: "an-instance-that-is-gone",
        claimedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    await runDueDeliveries();

    const [row] = await rows();
    expect(row.status).toBe("DELIVERED");
  });

  it("respects the backoff instead of retrying immediately", async () => {
    /**
     * The regression guard for a timezone bug that made the whole backoff
     * inert.
     *
     * Prisma writes `DateTime` into a `timestamp` column WITHOUT a time zone,
     * as UTC. Postgres `now()` is a `timestamptz`. Comparing them makes
     * Postgres read the naive column as SESSION-local, so on this machine
     * (+06) anything scheduled less than six hours out compared as already
     * due — the backoff did nothing and a dead endpoint was hammered at full
     * rate. On a UTC machine, which is what CI usually is, it would have
     * looked perfect.
     *
     * Note this test does NOT call makeDue(): that is the point.
     */
    respond = () => new Response("bad", { status: 500 });
    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    await makeDue();
    await runDueDeliveries();

    const [afterFirst] = await rows();
    expect(afterFirst.status).toBe("FAILED");
    expect(afterFirst.attempts).toBe(1);

    const before = captured.length;
    await runDueDeliveries();

    expect(captured.length).toBe(before);
    expect((await rows())[0].attempts).toBe(1);
  });

  it("does not reclaim a delivery the instant it is claimed", async () => {
    // The other half of the same bug: a freshly claimed row looked abandoned
    // six hours ago, so a second worker could take it and deliver the same
    // event twice.
    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    const [created] = await rows();
    await prisma.webhookDelivery.update({
      where: { id: created.id },
      data: { status: "DELIVERING", claimedBy: "another-instance", claimedAt: new Date() },
    });

    const result = await runDueDeliveries();
    expect(result.attempted).toBe(0);
  });

  it("does not steal a delivery another instance is actively working on", async () => {
    await enqueueWebhookDeliveries("issue.updated", { id: "i1" }, PROJECT, ORG, { deliverNow: false });
    const [created] = await rows();
    await prisma.webhookDelivery.update({
      where: { id: created.id },
      data: { status: "DELIVERING", claimedBy: "a-live-instance", claimedAt: new Date() },
    });

    const result = await runDueDeliveries();

    expect(result.attempted).toBe(0);
    expect(captured).toHaveLength(0);
  });
});
