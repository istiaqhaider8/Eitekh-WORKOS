/**
 * The SSE client registry must actually evict clients that have gone away.
 *
 * WHAT WAS WRONG
 *
 * `sendHeartbeats` evicted a client when `now - client.lastPingAt` exceeded
 * five minutes. But `lastPingAt` was written in exactly two places: when the
 * client registered, and at the bottom of `sendHeartbeats` itself. So every
 * 15-second tick refreshed the timestamp it was about to test, and the
 * threshold could never be crossed. The safety net was unreachable code, and
 * nothing failed to say so, because a registry that never evicts looks
 * identical to one with no stale clients.
 *
 * WHY IT MATTERS
 *
 * Ordinary disconnects are handled elsewhere: the SSE route unregisters on
 * `cancel()` and on the request's abort signal. What is left is the half-open
 * connection — a closed laptop, a dropped mobile network — where no FIN
 * arrives. There `enqueue()` keeps succeeding, so the catch never fires, and
 * the entry stays in the map with its chunks piling up in the stream queue.
 * That is a per-connection leak that grows with uptime, which is precisely the
 * failure a short soak test cannot see.
 *
 * SSE has no upstream channel, so the only evidence of a live reader is
 * backpressure: `desiredSize` stays >= 0 while chunks are being consumed and
 * goes negative once they are not. These tests pin that behaviour.
 */

jest.mock("../sync-bus", () => ({
  syncBus: { start: jest.fn(), publish: jest.fn() },
}));
jest.mock("../prisma", () => ({ prisma: {} }));
jest.mock("../logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), security: jest.fn() },
}));

const HEARTBEAT_MS = 15_000;
const STALE_MS = 5 * 60 * 1000;

/** A client whose stream reports a fixed backpressure state. */
function fakeClient(id: string, desiredSize: number | null) {
  const controller = {
    desiredSize,
    enqueue: jest.fn(),
    close: jest.fn(),
  };
  return {
    client: {
      id,
      userId: `user_${id}`,
      userEmail: `${id}@test.local`,
      projectId: "proj_1",
      isSuperAdmin: false,
      controller: controller as unknown as ReadableStreamDefaultController,
      connectedAt: new Date(),
      lastPingAt: new Date(),
      lastDrainedAt: new Date(),
    },
    controller,
  };
}

describe("stale SSE clients are evicted", () => {
  let syncEngine: any;

  beforeEach(() => {
    // The engine is a singleton cached on globalThis, so resetModules alone
    // would hand back the same instance (with its clients and its already
    // scheduled interval). Clear the cache too, so each test gets a fresh
    // registry and a heartbeat timer owned by the current fake clock.
    jest.resetModules();
    delete (globalThis as any).realtimeSyncEngine;
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    syncEngine = require("../sync-engine").syncEngine;
    expect(syncEngine.getActiveClientsCount()).toBe(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Run the heartbeat forward by `ms`, in real 15s ticks. */
  const advance = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += HEARTBEAT_MS) {
      jest.advanceTimersByTime(HEARTBEAT_MS);
    }
  };

  it("keeps a client whose stream is being drained", () => {
    const { client, controller } = fakeClient("alive", 16);
    syncEngine.registerClient(client);

    advance(STALE_MS + 2 * HEARTBEAT_MS);

    expect(syncEngine.getActiveClientsCount()).toBe(1);
    expect(controller.close).not.toHaveBeenCalled();
    // It is still being pinged, which is the point of keeping it.
    expect(controller.enqueue.mock.calls.length).toBeGreaterThan(20);

    syncEngine.unregisterClient("alive");
  });

  it("evicts a client whose stream has stopped draining", () => {
    // desiredSize < 0 means queued chunks are not being read: the consumer is
    // gone, even though enqueue() still succeeds.
    const { client, controller } = fakeClient("halfopen", -1);
    syncEngine.registerClient(client);

    expect(syncEngine.getActiveClientsCount()).toBe(1);

    advance(STALE_MS + 2 * HEARTBEAT_MS);

    expect(syncEngine.getActiveClientsCount()).toBe(0);
    expect(controller.close).toHaveBeenCalled();
  });

  it("does not evict a non-draining client before the threshold", () => {
    // Eviction must be a last resort: a brief burst of backpressure on a slow
    // connection is normal and must not disconnect a working client.
    const { client } = fakeClient("slow", -1);
    syncEngine.registerClient(client);

    advance(STALE_MS - 2 * HEARTBEAT_MS);

    expect(syncEngine.getActiveClientsCount()).toBe(1);
    syncEngine.unregisterClient("slow");
  });

  it("a client that recovers has its eviction clock reset", () => {
    const { client, controller } = fakeClient("recovers", -1);
    syncEngine.registerClient(client);

    advance(STALE_MS - 4 * HEARTBEAT_MS);
    expect(syncEngine.getActiveClientsCount()).toBe(1);

    // The browser catches up: the queue drains again.
    controller.desiredSize = 16;
    advance(2 * HEARTBEAT_MS);

    // Now stop draining again. If the clock had NOT been reset, this would
    // cross the threshold; it must not.
    controller.desiredSize = -1;
    advance(3 * HEARTBEAT_MS);

    expect(syncEngine.getActiveClientsCount()).toBe(1);
    syncEngine.unregisterClient("recovers");
  });

  it("the eviction is measured against drain evidence, not our own pings", () => {
    // The regression guard for the original defect. lastPingAt is refreshed by
    // the heartbeat loop on every tick, so anything measured against it can
    // never expire. If a future edit points the threshold back at lastPingAt,
    // the half-open client above stops being evicted and this fails.
    const { client } = fakeClient("guard", -1);
    syncEngine.registerClient(client);

    advance(STALE_MS + 2 * HEARTBEAT_MS);

    expect(client.lastPingAt.getTime()).toBeGreaterThan(client.lastDrainedAt.getTime());
    expect(syncEngine.getActiveClientsCount()).toBe(0);
  });
});
