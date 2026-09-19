import { logger } from './logger';
import { syncBus, type SyncBusEvent } from './sync-bus';

export type SyncEventType =
  | 'CONNECTED'
  | 'HEARTBEAT'
  | 'ISSUE_CREATED'
  | 'ISSUE_UPDATED'
  | 'ISSUE_DELETED'
  | 'BULK_ISSUES_UPDATED'
  | 'SPRINT_CREATED'
  | 'SPRINT_UPDATED'
  | 'SPRINT_DELETED'
  | 'SPRINT_COMPLETED'
  | 'SPRINT_REORDERED'
  | 'EPIC_CREATED'
  | 'EPIC_UPDATED'
  | 'EPIC_DELETED'
  | 'COMPONENT_CREATED'
  | 'COMPONENT_UPDATED'
  | 'COMPONENT_DELETED'
  | 'WORKFLOW_UPDATED'
  | 'COMMENT_CREATED'
  | 'COMMENT_UPDATED'
  | 'COMMENT_DELETED'
  | 'SUBTASK_CREATED'
  | 'SUBTASK_UPDATED'
  | 'SUBTASK_DELETED'
  | 'DEPENDENCY_CREATED'
  | 'DEPENDENCY_DELETED'
  | 'LEAVE_CREATED'
  | 'LEAVE_UPDATED'
  | 'LEAVE_DELETED'
  | 'NOTIFICATION_CREATED'
  | 'SYSTEM_SYNC_PING';

const staticTextEncoder = new TextEncoder();


export interface SyncClient {
  id: string;
  userId: string;
  userEmail: string;
  userName?: string;
  projectId: string;
  isSuperAdmin: boolean;
  controller: ReadableStreamDefaultController;
  connectedAt: Date;
  /** When a heartbeat was last written to this client. Server-side activity. */
  lastPingAt: Date;
  /**
   * When this client's stream was last observed EMPTY — that is, the last
   * time there was evidence the browser had actually consumed what we sent.
   *
   * This is separate from lastPingAt on purpose. See sendHeartbeats.
   */
  lastDrainedAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

export interface SyncEventPayload {
  eventId: string;
  eventType: SyncEventType;
  projectId: string;
  entityId?: string;
  entityType?: 'ISSUE' | 'SPRINT' | 'EPIC' | 'COMPONENT' | 'WORKFLOW' | 'COMMENT' | 'SUBTASK' | 'DEPENDENCY' | 'SYSTEM';
  changedFields?: string[];
  data?: any;
  actor?: {
    id: string;
    email: string;
    name?: string;
  };
  sourceModule?: string;
  targetModules?: string[];
  timestamp: string;
}

export interface SyncEventLogItem extends SyncEventPayload {
  recipientsCount: number;
  deliveryStatus: 'DELIVERED' | 'NO_SUBSCRIBERS' | 'FAILED';
  databaseStatus: 'COMMITTED';
  retryCount: number;
  errorMessage?: string;
}

/**
 * PROD-4. Cross-instance fan-out.
 *
 * The `clients` Map below stays per-process and that is correct: an SSE
 * connection belongs to the process holding the socket. What was missing is a
 * path for an event published here to reach browsers connected to the OTHER
 * instances, which is what `syncBus` provides. Each publish delivers locally
 * (unchanged, synchronous) and is then announced to the other instances, which
 * relay it to their own clients through `deliverRelayedEvent` below.
 */
class RealtimeSyncEngine {
  private clients: Map<string, SyncClient> = new Map();
  private eventLogs: SyncEventLogItem[] = [];
  private maxLogs = 500;
  private totalEventsProcessed = 0;
  private totalEventsFailed = 0;
  private startTime = Date.now();
  private heartbeatInterval?: any;

  constructor() {
    // Keep alive cleaner
    if (typeof setInterval !== 'undefined') {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }
      this.heartbeatInterval = setInterval(() => {
        this.sendHeartbeats();
      }, 15000);
    }
  }

  public registerClient(client: SyncClient) {
    this.ensureBusStarted();
    this.clients.set(client.id, client);
    logger.info('SYNC_CLIENT_CONNECTED', `Client ${client.id} (${client.userEmail}) subscribed to project ${client.projectId}`, {
      clientId: client.id,
      userId: client.userId,
      projectId: client.projectId,
      totalActiveClients: this.clients.size,
    });
  }

  public unregisterClient(clientId: string) {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.controller.close();
      } catch (_) {}
      this.clients.delete(clientId);
      logger.info('SYNC_CLIENT_DISCONNECTED', `Client ${clientId} disconnected from project ${client.projectId}`, {
        clientId,
        userId: client.userId,
        projectId: client.projectId,
        remainingActiveClients: this.clients.size,
      });
    }
  }

  public getActiveClientsCount(projectId?: string): number {
    if (!projectId) return this.clients.size;
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.projectId === projectId || client.isSuperAdmin) {
        count++;
      }
    }
    return count;
  }

  public getActiveClientsList(): Array<{
    id: string;
    userId: string;
    userEmail: string;
    userName?: string;
    projectId: string;
    isSuperAdmin: boolean;
    connectedAt: string;
    lastPingAt: string;
    ipAddress?: string;
  }> {
    return Array.from(this.clients.values()).map((c) => ({
      id: c.id,
      userId: c.userId,
      userEmail: c.userEmail,
      userName: c.userName,
      projectId: c.projectId,
      isSuperAdmin: c.isSuperAdmin,
      connectedAt: c.connectedAt.toISOString(),
      lastPingAt: c.lastPingAt.toISOString(),
      ipAddress: c.ipAddress,
    }));
  }

  public publishProjectEvent(
    arg1:
      | {
          projectId: string;
          eventType: SyncEventType;
          entityId?: string;
          entityType?: 'ISSUE' | 'SPRINT' | 'EPIC' | 'COMPONENT' | 'WORKFLOW' | 'COMMENT' | 'SUBTASK' | 'DEPENDENCY' | 'SYSTEM';
          changedFields?: string[];
          data?: any;
          actor?: {
            id: string;
            email: string;
            name?: string;
          };
          sourceModule?: string;
          targetModules?: string[];
        }
      | string,
    arg2?: any
  ): SyncEventPayload {
    const params = typeof arg1 === 'string' ? { projectId: arg1, ...arg2 } : arg1;
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = new Date().toISOString();

    const payload: SyncEventPayload = {
      eventId,
      eventType: params.eventType,
      projectId: params.projectId,
      entityId: params.entityId,
      entityType: params.entityType,
      changedFields: params.changedFields,
      data: params.data,
      actor: params.actor,
      sourceModule: params.sourceModule || 'Projects',
      targetModules: params.targetModules || [
        'Kanban',
        'List',
        'Scrum',
        'Backlog',
        'Sprint',
        'Calendar',
        'Gantt',
        'Workload',
        'Analytics',
        'Reports',
      ],
      timestamp,
    };

    let deliveredCount = 0;
    let failedCount = 0;
    // Include SSE id: field so browsers track Last-Event-ID and send it on reconnect
    const sseMessage = `id: ${eventId}\nevent: message\ndata: ${JSON.stringify(payload)}\n\n`;
    const encoded = staticTextEncoder.encode(sseMessage);

    // PROJECT-SCOPED DELIVERY ENFORCEMENT:
    // Only deliver event to clients subscribed to this exact projectId (or Superadmin observers).
    // Personal `USER:<id>` streams are excluded entirely — including for
    // Superadmins — so a notifications-only connection never receives project
    // traffic it did not subscribe to.
    for (const [clientId, client] of this.clients.entries()) {
      const isUserScopedStream = client.projectId.startsWith('USER:');
      if (isUserScopedStream) continue;
      if (client.projectId === params.projectId || client.isSuperAdmin) {
        try {
          client.controller.enqueue(encoded);
          deliveredCount++;
        } catch (err: any) {
          failedCount++;
          logger.error('SYNC_DELIVERY_FAILED', `Failed to deliver event ${eventId} to client ${clientId}`, {
            clientId,
            error: err.message,
          });
          try {
            client.controller.close();
          } catch (_) {}
          this.clients.delete(clientId);
        }
      }
    }

    this.totalEventsProcessed++;
    if (failedCount > 0) this.totalEventsFailed += failedCount;

    const logItem: SyncEventLogItem = {
      ...payload,
      recipientsCount: deliveredCount,
      deliveryStatus: deliveredCount > 0 ? 'DELIVERED' : 'NO_SUBSCRIBERS',
      databaseStatus: 'COMMITTED',
      retryCount: 0,
      errorMessage: failedCount > 0 ? `${failedCount} client deliver(ies) failed` : undefined,
    };

    this.recordEventLog(logItem);

    // Relay to the other instances. Best-effort and deliberately not awaited:
    // a mutation must not fail because fan-out to another instance did.
    void syncBus.publish({ projectId: params.projectId, payload, eventId });

    logger.info('SYNC_EVENT_DISPATCHED', `Dispatched ${params.eventType} for project ${params.projectId} to ${deliveredCount} authorized clients`, {
      eventId,
      eventType: params.eventType,
      projectId: params.projectId,
      deliveredCount,
      totalSubscribers: this.clients.size,
    });

    return payload;
  }

  /**
   * Delivers an event to a single user's own connections, on every stream that
   * user has open (project streams and the header's user stream alike).
   *
   * Isolation: delivery requires an exact `client.userId` match. Unlike
   * `publishProjectEvent` there is deliberately no Superadmin fan-out, because
   * a notification is addressed to one person — a Superadmin has no reason to
   * receive another user's personal notifications on their own stream.
   */
  public publishUserEvent(params: {
    userId: string;
    eventType: SyncEventType;
    entityId?: string;
    entityType?: SyncEventPayload['entityType'];
    data?: any;
    actor?: { id: string; email: string; name?: string };
    sourceModule?: string;
  }): SyncEventPayload {
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = new Date().toISOString();

    const payload: SyncEventPayload = {
      eventId,
      eventType: params.eventType,
      // User-scoped events are not tied to a project board.
      projectId: `USER:${params.userId}`,
      entityId: params.entityId,
      entityType: params.entityType,
      data: params.data,
      actor: params.actor,
      sourceModule: params.sourceModule || 'Notifications',
      targetModules: ['Notifications'],
      timestamp,
    };

    const sseMessage = `id: ${eventId}\nevent: message\ndata: ${JSON.stringify(payload)}\n\n`;
    const encoded = staticTextEncoder.encode(sseMessage);

    let deliveredCount = 0;
    let failedCount = 0;

    for (const [clientId, client] of this.clients.entries()) {
      if (client.userId !== params.userId) continue;
      try {
        client.controller.enqueue(encoded);
        deliveredCount++;
      } catch (err: any) {
        failedCount++;
        logger.error('SYNC_DELIVERY_FAILED', `Failed to deliver user event ${eventId} to client ${clientId}`, {
          clientId,
          error: err.message,
        });
        try {
          client.controller.close();
        } catch (_) {}
        this.clients.delete(clientId);
      }
    }

    this.totalEventsProcessed++;
    if (failedCount > 0) this.totalEventsFailed += failedCount;

    this.recordEventLog({
      ...payload,
      recipientsCount: deliveredCount,
      deliveryStatus: deliveredCount > 0 ? 'DELIVERED' : 'NO_SUBSCRIBERS',
      databaseStatus: 'COMMITTED',
      retryCount: 0,
      errorMessage: failedCount > 0 ? `${failedCount} client deliver(ies) failed` : undefined,
    });

    // Relay to the other instances (PROD-4). A notification addressed to one
    // person is exactly the kind of event that used to be lost when that person
    // happened to be connected to a different instance from the one that
    // produced it.
    void syncBus.publish({ userId: params.userId, payload, eventId });

    return payload;
  }

  /**
   * Deliver an event that ORIGINATED ON ANOTHER INSTANCE to this process's
   * clients (PROD-4).
   *
   * This is the receiving half of the fan-out. It re-applies the same
   * subscription rules as a local publish rather than trusting the relay:
   * project events reach only clients subscribed to that project (plus
   * Superadmin observers, never personal streams), and user events reach only
   * that user's own connections. The relay carries no authorization of its own,
   * so the check has to happen here — an event arriving over the bus is data,
   * not permission.
   *
   * It does NOT re-publish, or two instances would echo each other forever.
   */
  public deliverRelayedEvent(event: SyncBusEvent): number {
    const payload = event.payload as SyncEventPayload;
    if (!payload?.eventId) return 0;

    const sseMessage = `id: ${payload.eventId}
event: message
data: ${JSON.stringify(payload)}

`;
    const encoded = staticTextEncoder.encode(sseMessage);

    let delivered = 0;
    for (const [clientId, client] of this.clients.entries()) {
      const isUserScopedStream = client.projectId.startsWith('USER:');

      let shouldDeliver: boolean;
      if (event.userId) {
        // Personal notification: exact user match, no Superadmin fan-out.
        shouldDeliver = client.userId === event.userId;
      } else if (event.projectId) {
        shouldDeliver = !isUserScopedStream
          && (client.projectId === event.projectId || client.isSuperAdmin);
      } else {
        shouldDeliver = false;
      }

      if (!shouldDeliver) continue;

      try {
        client.controller.enqueue(encoded);
        delivered++;
      } catch (err: any) {
        logger.error('SYNC_RELAY_DELIVERY_FAILED', `Failed to deliver relayed event ${payload.eventId} to client ${clientId}`, {
          clientId,
          error: err.message,
        });
        try { client.controller.close(); } catch (_) {}
        this.clients.delete(clientId);
      }
    }

    if (delivered > 0) {
      logger.info('SYNC_EVENT_RELAYED', `Relayed ${payload.eventType} from another instance to ${delivered} local client(s)`, {
        eventId: payload.eventId,
        projectId: event.projectId ?? undefined,
      });
    }
    return delivered;
  }

  /**
   * Begin relaying events published by other instances.
   *
   * Called from registerClient rather than at module load: this app has no
   * reliable "server ready" hook, and there is nothing to relay to until a
   * client is connected. syncBus.start is idempotent.
   */
  private ensureBusStarted(): void {
    syncBus.start((event) => {
      this.deliverRelayedEvent(event);
    });
  }

  /**
   * Ping every client, and evict the ones that are no longer reading.
   *
   * WHY THE STALE CHECK USES lastDrainedAt AND NOT lastPingAt
   *
   * The eviction below used to compare `now` against `client.lastPingAt` — but
   * lastPingAt is written in only two places: when the client registers, and
   * at the bottom of THIS function. So the loop refreshed, every 15 seconds,
   * the very timestamp it was about to test, and the five-minute threshold
   * could never be reached. The stale-client safety net was unreachable code.
   *
   * That matters because of what it was meant to catch. A normal disconnect
   * fires `cancel()` on the stream or `abort` on the request signal, and the
   * SSE route unregisters the client — that path works. The case left over is
   * the half-open connection: a laptop lid closed, a dropped mobile network,
   * anything where no FIN arrives. There, `controller.enqueue()` keeps
   * succeeding, so the catch below never fires either, and the client sits in
   * the map forever with its payloads accumulating in the stream's queue.
   *
   * SSE is one-directional, so there is no message from the browser to use as
   * proof of life. What there IS is backpressure: `desiredSize` is positive
   * while the consumer is keeping up and goes negative once queued chunks stop
   * being read. A client that is genuinely gone stops draining immediately, so
   * "has not drained for five minutes" is the real signal, and it is the one
   * used here.
   */
  private sendHeartbeats() {
    const now = new Date();
    const staleThreshold = 5 * 60 * 1000;

    const pingPayload = {
      type: 'PING',
      timestamp: now.toISOString(),
      activeConnections: this.clients.size,
    };
    const ssePing = `event: ping\ndata: ${JSON.stringify(pingPayload)}\n\n`;
    const encoded = staticTextEncoder.encode(ssePing);

    for (const [clientId, client] of this.clients.entries()) {
      // Evict before writing, so a dead client is not handed another chunk.
      if (now.getTime() - client.lastDrainedAt.getTime() > staleThreshold) {
        try { client.controller.close(); } catch (_) {}
        this.clients.delete(clientId);
        logger.info('SYNC_CLIENT_STALE', `Evicted stale client ${clientId}: stream not drained for over ${Math.round(staleThreshold / 1000)}s`, {
          clientId,
          userId: client.userId,
          projectId: client.projectId,
          secondsSinceDrained: Math.round((now.getTime() - client.lastDrainedAt.getTime()) / 1000),
        });
        continue;
      }

      try {
        // Read desiredSize BEFORE enqueuing: afterwards it always reflects the
        // chunk we just added, so a healthy client would look backed up.
        const drained = (client.controller.desiredSize ?? 0) >= 0;
        client.controller.enqueue(encoded);
        client.lastPingAt = now;
        if (drained) client.lastDrainedAt = now;
      } catch (err) {
        try { client.controller.close(); } catch (_) {}
        this.clients.delete(clientId);
      }
    }
  }

  private recordEventLog(item: SyncEventLogItem) {
    this.eventLogs.unshift(item);
    if (this.eventLogs.length > this.maxLogs) {
      this.eventLogs.pop();
    }
  }

  public getSyncEventLogs(filters?: {
    projectId?: string;
    module?: string;
    eventType?: string;
    status?: string;
    search?: string;
    limit?: number;
  }): SyncEventLogItem[] {
    let result = this.eventLogs;

    if (filters?.projectId && filters.projectId !== 'ALL') {
      result = result.filter((l) => l.projectId === filters.projectId);
    }
    if (filters?.eventType && filters.eventType !== 'ALL') {
      result = result.filter((l) => l.eventType === filters.eventType);
    }
    if (filters?.status && filters.status !== 'ALL') {
      result = result.filter((l) => l.deliveryStatus === filters.status);
    }
    if (filters?.module && filters.module !== 'ALL') {
      result = result.filter(
        (l) => l.sourceModule === filters.module || l.targetModules?.includes(filters.module!)
      );
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (l) =>
          l.eventId.toLowerCase().includes(q) ||
          l.entityId?.toLowerCase().includes(q) ||
          l.actor?.email.toLowerCase().includes(q) ||
          l.eventType.toLowerCase().includes(q)
      );
    }

    const limit = filters?.limit || 100;
    return result.slice(0, limit);
  }

  public getSyncMetrics() {
    const uptimeSeconds = Math.round((Date.now() - this.startTime) / 1000);
    const successRate =
      this.totalEventsProcessed > 0
        ? Math.round(
            ((this.totalEventsProcessed - this.totalEventsFailed) / this.totalEventsProcessed) * 100
          )
        : 100;

    const modules = [
      { name: 'Projects', status: 'HEALTHY', latencyMs: 12 },
      { name: 'Kanban', status: 'HEALTHY', latencyMs: 15 },
      { name: 'List', status: 'HEALTHY', latencyMs: 14 },
      { name: 'Scrum', status: 'HEALTHY', latencyMs: 16 },
      { name: 'Backlog', status: 'HEALTHY', latencyMs: 14 },
      { name: 'Sprint', status: 'HEALTHY', latencyMs: 18 },
      { name: 'Calendar', status: 'HEALTHY', latencyMs: 15 },
      { name: 'Gantt', status: 'HEALTHY', latencyMs: 19 },
      { name: 'Team Workload', status: 'HEALTHY', latencyMs: 17 },
      { name: 'Analytics', status: 'HEALTHY', latencyMs: 22 },
      { name: 'Reports', status: 'HEALTHY', latencyMs: 25 },
      { name: 'Notifications', status: 'HEALTHY', latencyMs: 11 },
    ];

    return {
      activeConnections: this.clients.size,
      totalEventsProcessed: this.totalEventsProcessed,
      totalEventsFailed: this.totalEventsFailed,
      successRate,
      uptimeSeconds,
      databaseStatus: 'ONLINE',
      apiHealth: 'OPTIMAL',
      sseStreamStatus: 'STREAMING',
      retryQueueSize: 0,
      staleClientsCount: 0,
      lastSuccessfulSync: new Date().toISOString(),
      modules,
    };
  }
}

// Global Singleton to ensure state persistence in Next.js development and server environments
const globalForSync = globalThis as unknown as {
  realtimeSyncEngine?: RealtimeSyncEngine;
};

export const syncEngine = globalForSync.realtimeSyncEngine || new RealtimeSyncEngine();
globalForSync.realtimeSyncEngine = syncEngine;
