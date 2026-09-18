/**
 * PROD-4 — the cross-instance relay for real-time (SSE) events.
 *
 * WHAT WAS WRONG
 *
 * `syncEngine.clients` is a per-process `Map` of open SSE connections. That
 * part is correct and stays: a connection belongs to the process holding the
 * socket. What was missing is any way for an event published on instance A to
 * reach a browser connected to instance B. Real-time collaboration would
 * appear to "randomly not work" depending on which instance each user landed
 * on — and it works perfectly in single-instance testing, so it would not be
 * caught before launch without deliberate effort.
 *
 * HOW IT WORKS
 *
 * Publish: insert a row into `SyncEventOutbox`, then `NOTIFY sync_events` with
 * the row id. Every instance holds one `LISTEN` connection; on a notification
 * it fetches the row and relays the payload to its own clients.
 *
 * The payload rides in a row rather than on the notification itself for two
 * reasons: NOTIFY payloads are capped at 8000 bytes and sync payloads can
 * exceed that, and a durable row means a client reconnecting with
 * Last-Event-ID can be served what it missed.
 *
 * WHY POSTGRES AND NOT REDIS
 *
 * Same reasoning as PROD-2: no managed Redis has been chosen, so a Redis
 * implementation could be written but not run, and an unverified fan-out is
 * indistinguishable from a broken one. `LISTEN/NOTIFY` costs one dedicated
 * connection per instance — not per client, which is the usual objection to it
 * — and that is a fixed, small cost. If this ever needs to carry high event
 * volume, `publish()` and `subscribe()` are the seam to move onto Redis.
 *
 * DEGRADATION
 *
 * If the LISTEN connection cannot be established or drops, the bus falls back
 * to polling the outbox table, and keeps trying to restore the listener. Fan-out
 * gets slower; it does not stop. The failure is logged rather than silent,
 * because "real-time silently became single-instance again" is precisely the
 * bug this module exists to prevent.
 */

import { Client } from "pg";
import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { logger } from "./logger";

const CHANNEL = "sync_events";

/** Identifies this process, so it can ignore the echo of its own publishes. */
const ORIGIN_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

/** How long outbox rows are kept. Long enough for a reconnect replay, no longer. */
const OUTBOX_RETENTION_MS = 5 * 60_000;

/** Fallback poll interval, used only while the listener is down. */
const POLL_INTERVAL_MS = 1_000;

/** Backoff between attempts to re-establish the listener. */
const RECONNECT_DELAY_MS = 5_000;

export interface SyncBusEvent {
  id: string;
  projectId: string | null;
  userId: string | null;
  payload: unknown;
  originId: string;
}

type Handler = (event: SyncBusEvent) => void;

class SyncBus {
  private listener: Client | null = null;
  private handler: Handler | null = null;
  private started = false;
  private listening = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private lastPolledAt = new Date();

  get originId(): string {
    return ORIGIN_ID;
  }

  /** True when push delivery is active; false while degraded to polling. */
  get isListening(): boolean {
    return this.listening;
  }

  /**
   * Start relaying. Idempotent: the SSE route calls this on every connection,
   * because there is no other reliable "server started" hook in this app.
   */
  start(handler: Handler): void {
    this.handler = handler;
    if (this.started) return;
    this.started = true;

    void this.connectListener();

    // Reclaim old rows. Failures are swallowed: a sweep that does not happen
    // costs disk, while one that throws into a request path costs the request.
    this.sweepTimer = setInterval(() => {
      void prisma.syncEventOutbox
        .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - OUTBOX_RETENTION_MS) } } })
        .catch(() => {});
    }, 60_000);
    this.sweepTimer.unref?.();
  }

  private async connectListener(): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) {
      logger.error("SYNC_BUS_NO_DATABASE_URL", "Cannot start cross-instance sync fan-out without DATABASE_URL.");
      this.startPolling();
      return;
    }

    try {
      const client = new Client({ connectionString: url });
      // A listener that dies quietly is the failure this whole module guards
      // against, so both error and end re-enter the degraded path.
      client.on("error", (err) => {
        logger.error("SYNC_BUS_LISTENER_ERROR", "The sync-event listener connection failed.", err);
        this.onListenerLost();
      });
      client.on("end", () => this.onListenerLost());
      client.on("notification", (msg) => {
        if (msg.channel !== CHANNEL || !msg.payload) return;
        void this.deliverById(msg.payload);
      });

      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);

      this.listener = client;
      this.listening = true;
      this.stopPolling();
      logger.info("SYNC_BUS_LISTENING", `Cross-instance sync fan-out active (origin ${ORIGIN_ID}).`);
    } catch (err) {
      logger.error(
        "SYNC_BUS_LISTEN_FAILED",
        "Could not establish the sync-event listener; falling back to polling. Real-time " +
          "fan-out still works, with added latency.",
        err
      );
      this.onListenerLost();
    }
  }

  private onListenerLost(): void {
    if (this.listener) {
      try { void this.listener.end(); } catch { /* already gone */ }
      this.listener = null;
    }
    if (!this.listening && this.reconnectTimer) return;
    this.listening = false;
    this.startPolling();

    if (!this.reconnectTimer) {
      this.reconnectTimer = setInterval(() => {
        if (this.listening) {
          if (this.reconnectTimer) clearInterval(this.reconnectTimer);
          this.reconnectTimer = null;
          return;
        }
        void this.connectListener();
      }, RECONNECT_DELAY_MS);
      this.reconnectTimer.unref?.();
    }
  }

  /**
   * Degraded mode. Slower than push, but fan-out keeps working — which matters
   * more than latency, because the alternative is silently reverting to
   * single-instance behaviour.
   */
  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollOnce(): Promise<void> {
    try {
      const since = this.lastPolledAt;
      const now = new Date();
      const rows = await prisma.syncEventOutbox.findMany({
        where: { createdAt: { gt: since }, originId: { not: ORIGIN_ID } },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
      this.lastPolledAt = now;
      for (const row of rows) this.dispatch(row as SyncBusEvent);
    } catch {
      // Leave lastPolledAt alone so the next poll retries the same window.
    }
  }

  private async deliverById(id: string): Promise<void> {
    try {
      const row = await prisma.syncEventOutbox.findUnique({ where: { id } });
      if (row) this.dispatch(row as SyncBusEvent);
    } catch (err) {
      logger.error("SYNC_BUS_FETCH_FAILED", `Could not load sync event ${id} after notification.`, err);
    }
  }

  private dispatch(event: SyncBusEvent): void {
    // The publishing instance already delivered to its own clients
    // synchronously, so relaying its own echo would double-deliver.
    if (event.originId === ORIGIN_ID) return;
    try {
      this.handler?.(event);
    } catch (err) {
      logger.error("SYNC_BUS_HANDLER_FAILED", "A relayed sync event could not be delivered locally.", err);
    }
  }

  /**
   * Announce an event to the other instances.
   *
   * Deliberately fire-and-forget from the caller's perspective: publishing is
   * best-effort fan-out, and a failure to reach other instances must not fail
   * the mutation that produced the event. It is logged, not swallowed.
   */
  async publish(input: { projectId?: string | null; userId?: string | null; payload: unknown; eventId: string }): Promise<void> {
    try {
      await prisma.syncEventOutbox.create({
        data: {
          id: input.eventId,
          projectId: input.projectId ?? null,
          userId: input.userId ?? null,
          payload: input.payload as never,
          originId: ORIGIN_ID,
        },
      });
      // NOTIFY carries only the id; the payload is in the row. Payloads are
      // capped at 8000 bytes on this channel and sync events can exceed it.
      await prisma.$executeRawUnsafe(`NOTIFY ${CHANNEL}, '${input.eventId.replace(/'/g, "''")}'`);
    } catch (err) {
      logger.error(
        "SYNC_BUS_PUBLISH_FAILED",
        "A real-time event was delivered locally but could not be relayed to other instances.",
        err,
        { eventId: input.eventId, projectId: input.projectId ?? undefined }
      );
    }
  }
}

export const syncBus = new SyncBus();
export const SYNC_BUS_ORIGIN_ID = ORIGIN_ID;
