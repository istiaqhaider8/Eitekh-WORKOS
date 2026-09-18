/**
 * PROD-4 — guards on cross-instance SSE fan-out.
 *
 * The behavioural claim (an event published on instance A reaches a browser
 * connected to instance B) needs two servers and cannot be made in one
 * process; it is verified live and recorded in the PROD-4 section of
 * PRODUCTION-READINESS.md.
 *
 * What is worth pinning here is the set of properties that are easy to break
 * silently later — and "silently" is the operative word: this defect produced
 * a system that worked perfectly in single-instance testing and failed only
 * under a load balancer.
 */

import { readFileSync } from "fs";
import { join } from "path";

const code = (p: string) =>
  readFileSync(join(__dirname, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("sync events are relayed between instances", () => {
  it("publishing announces the event to other instances", () => {
    const engine = code("../sync-engine.ts");
    expect(engine).toMatch(/from '\.\/sync-bus'/);
    // Both publish paths must relay: a project event and a personal
    // notification are equally lost when the recipient is on another instance.
    const relays = engine.match(/syncBus\.publish\(/g) || [];
    expect(relays.length).toBe(2);
  });

  it("relayed events are delivered without being re-published", () => {
    // Re-publishing on receipt would make two instances echo each other
    // forever. The receive path must deliver only.
    const engine = code("../sync-engine.ts");
    const fnStart = engine.indexOf("public deliverRelayedEvent");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = engine.slice(fnStart, engine.indexOf("\n  private ensureBusStarted", fnStart));
    expect(fnBody).not.toMatch(/syncBus\.publish/);
  });

  it("an instance ignores the echo of its own publishes", () => {
    // The publishing instance already delivered locally and synchronously, so
    // relaying its own event back would double-deliver it.
    expect(code("../sync-bus.ts")).toMatch(/event\.originId === ORIGIN_ID/);
  });

  it("the relay re-applies subscription rules rather than trusting the sender", () => {
    // An event arriving over the bus is data, not permission. Project events
    // must still be scoped to subscribers of that project, and personal
    // notifications to that user alone.
    const engine = code("../sync-engine.ts");
    const fnStart = engine.indexOf("public deliverRelayedEvent");
    const fnBody = engine.slice(fnStart, engine.indexOf("\n  private ensureBusStarted", fnStart));
    expect(fnBody).toMatch(/client\.userId === event\.userId/);
    expect(fnBody).toMatch(/client\.projectId === event\.projectId/);
    expect(fnBody).toMatch(/isUserScopedStream/);
  });

  it("fan-out failure cannot fail the mutation that produced the event", () => {
    // Relaying is best-effort. A publish that threw into the request path
    // would turn a real-time inconvenience into a failed write.
    const engine = code("../sync-engine.ts");
    expect(engine).toMatch(/void syncBus\.publish\(/);
  });

  it("degrades to polling rather than silently reverting to single-instance", () => {
    const bus = code("../sync-bus.ts");
    expect(bus).toMatch(/startPolling/);
    expect(bus).toMatch(/SYNC_BUS_LISTEN_FAILED/);
    // And keeps trying to restore push delivery.
    expect(bus).toMatch(/RECONNECT_DELAY_MS/);
  });

  it("outbox rows are swept, so the relay table cannot grow without bound", () => {
    const bus = code("../sync-bus.ts");
    expect(bus).toMatch(/OUTBOX_RETENTION_MS/);
    expect(bus).toMatch(/deleteMany\(\{ where: \{ createdAt: \{ lt:/);
  });

  it("the notification carries an id, not the payload", () => {
    // NOTIFY payloads are capped at 8000 bytes and sync payloads can exceed
    // that; the row holds the data and the channel carries only its id.
    const bus = code("../sync-bus.ts");
    expect(bus).toMatch(/NOTIFY \$\{CHANNEL\}, '\$\{input\.eventId/);
  });
});

describe("server-only modules stay out of the browser bundle", () => {
  it("client components import the pure date helpers, not the delegation engine", () => {
    // `delegation-engine` imports Prisma and the sync engine. Five client
    // components needed only `isDelegationActive`, which dragged all of it
    // into the browser bundle — and broke the production build outright once
    // the sync engine gained the `pg` driver, since `pg` requires `fs`.
    const clients = [
      "../../components/issues/IssueDetailModal.tsx",
      "../../components/views/KanbanBoardView.tsx",
      "../../components/views/ListView.tsx",
      "../../components/views/TimelineGanttView.tsx",
      "../../components/views/WorkloadView.tsx",
    ];
    for (const c of clients) {
      expect(code(c)).not.toMatch(/@\/lib\/delegation-engine/);
    }
  });

  it("the client-safe module has no server imports", () => {
    const dates = code("../delegation-dates.ts");
    expect(dates).not.toMatch(/from '\.\/prisma'/);
    expect(dates).not.toMatch(/from '\.\/sync-engine'/);
    expect(dates).not.toMatch(/from ['"]pg['"]/);
  });
});
