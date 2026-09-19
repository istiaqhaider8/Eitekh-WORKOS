/**
 * The in-memory email queue must not grow without bound.
 *
 * WHAT WAS WRONG
 *
 * processEmailQueue removed items from the queue on SENT and on MOCKED, but
 * not on FAILED. An email that exhausted its three retries had its status set
 * to 'FAILED', a row written to EmailLog — and then stayed in the array for
 * the lifetime of the process.
 *
 * Each item carries its `variables` and its fully rendered `customHtml`, so
 * this was tens of kilobytes of user data retained per permanently
 * undeliverable message, in an array the worker re-filters every three
 * seconds. A mail provider outage, or a handful of invalid addresses in an
 * imported project, was enough to grow it indefinitely.
 *
 * Dropping the item is safe precisely because the EmailLog row is written
 * first: the failure stays auditable, only the in-memory copy goes.
 */

const sendEmailMock = jest.fn();
const emailLogCreate = jest.fn().mockResolvedValue({});

jest.mock("../email", () => ({
  sendEmail: (...args: any[]) => sendEmailMock(...args),
  DEFAULT_SENDER_EMAIL: "noreply@test.local",
  DEFAULT_SENDER_NAME: "Test",
}));
jest.mock("../prisma", () => ({
  prisma: { emailLog: { create: (...args: any[]) => emailLogCreate(...args) } },
}));
jest.mock("../sync-engine", () => ({
  syncEngine: { publishUserEvent: jest.fn(), publishProjectEvent: jest.fn() },
}));
jest.mock("../config", () => ({ getBaseUrl: () => "http://test.local" }));
jest.mock("../logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), security: jest.fn() },
}));

const WORKER_TICK_MS = 3000;

describe("the email queue releases items it will never send", () => {
  let engine: any;
  let logger: any;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
    engine = require("../notifications").notificationEngine;
    logger = require("../logger").logger;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Let the 3s worker run `ticks` times.
   *
   * advanceTimersByTimeAsync, not advanceTimersByTime: the worker awaits
   * sendEmail and then prisma.emailLog.create for every item, so a synchronous
   * advance leaves those continuations pending and the queue looks fuller than
   * it will be. The async variant drains the microtask queue between timers.
   */
  const runWorker = async (ticks: number) => {
    for (let i = 0; i < ticks; i += 1) {
      await jest.advanceTimersByTimeAsync(WORKER_TICK_MS);
    }
  };

  it("removes an item once it is sent", async () => {
    sendEmailMock.mockResolvedValue({ status: "SENT" });
    engine.enqueueEmail({ to: "ok@test.local", customSubject: "hello" });
    expect(engine.getQueueStats().queueDepth).toBe(1);

    await runWorker(2);

    expect(engine.getQueueStats().queueDepth).toBe(0);
  });

  it("removes an item that permanently fails, after logging it", async () => {
    sendEmailMock.mockResolvedValue({ status: "ERROR", error: "smtp refused" });
    engine.enqueueEmail({ to: "bad@test.local", customSubject: "nope" });

    // Three retries with 2s / 6s / 18s backoff; run well past the last one.
    await runWorker(20);

    const stats = engine.getQueueStats();
    expect(stats.totalFailed).toBe(0);
    expect(stats.queueDepth).toBe(0);

    // The durable record is what makes dropping it acceptable.
    expect(emailLogCreate).toHaveBeenCalledTimes(1);
    expect(emailLogCreate.mock.calls[0][0].data).toMatchObject({
      to: "bad@test.local",
      status: "FAILED",
    });
  });

  it("does not retain a backlog when many items fail", async () => {
    // The shape of the original leak: a provider outage during normal traffic.
    sendEmailMock.mockResolvedValue({ status: "ERROR", error: "provider down" });
    for (let i = 0; i < 25; i += 1) {
      engine.enqueueEmail({
        to: `user${i}@test.local`,
        customSubject: "burst",
        customHtml: "x".repeat(1000),
      });
    }
    expect(engine.getQueueStats().queueDepth).toBe(25);

    await runWorker(30);

    expect(engine.getQueueStats().queueDepth).toBe(0);
    expect(emailLogCreate).toHaveBeenCalledTimes(25);
  });

  it("caps the queue rather than growing until the process dies", async () => {
    // Nothing is draining: the worker never gets a chance to run here, which
    // is the situation the cap exists for.
    for (let i = 0; i < 5200; i += 1) {
      engine.enqueueEmail({ to: `flood${i}@test.local`, customSubject: "flood" });
    }

    expect(engine.getQueueStats().queueDepth).toBeLessThanOrEqual(5000);
    // And it must say so, rather than discarding mail silently.
    expect(logger.error).toHaveBeenCalled();
    expect(logger.error.mock.calls[0][0]).toBe("EMAIL_QUEUE_OVERFLOW");
  });
});
