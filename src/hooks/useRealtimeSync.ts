'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export type SyncConnectionStatus = 'connected' | 'reconnecting' | 'offline' | 'error';

export interface SyncEventPayload {
  eventId: string;
  eventType: string;
  projectId: string;
  entityId?: string;
  entityType?: string;
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

interface UseRealtimeSyncOptions {
  projectId?: string;
  onEvent?: (event: SyncEventPayload) => void;
  onReconnect?: () => void;
  enabled?: boolean;
}

export function useRealtimeSync({
  projectId,
  onEvent,
  onReconnect,
  enabled = true,
}: UseRealtimeSyncOptions) {
  const [status, setStatus] = useState<SyncConnectionStatus>('offline');
  const [lastEvent, setLastEvent] = useState<SyncEventPayload | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const wasConnectedRef = useRef(false);
  const isMountedRef = useRef(true);
  const processedEventsRef = useRef<Set<string>>(new Set());

  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const onReconnectRef = useRef(onReconnect);
  useEffect(() => {
    onReconnectRef.current = onReconnect;
  }, [onReconnect]);

  /**
   * The current `connect`, for callbacks that outlive the render that created
   * them. The retry timeout scheduled inside `es.onerror` is the case that
   * matters: it fires up to 15 seconds later, by which time projectId may have
   * changed and the `connect` its closure captured is stale.
   */
  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (!projectId || !enabled || typeof window === 'undefined') return;

    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (isMountedRef.current) {
      setStatus('reconnecting');
    }

    try {
      const es = new EventSource(`/api/sync/events?projectId=${encodeURIComponent(projectId)}`);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!isMountedRef.current) return;
        setStatus('connected');
        if (wasConnectedRef.current) {
          onReconnectRef.current?.();
        }
        wasConnectedRef.current = true;
        retryCountRef.current = 0;
        setLastSyncTime(new Date());
      };

      es.addEventListener('message', (e) => {
        if (!isMountedRef.current) return;
        try {
          const payload: SyncEventPayload = JSON.parse(e.data);
          
          // Deduplicate events to prevent double processing
          if (payload.eventId && processedEventsRef.current.has(payload.eventId)) {
            return;
          }
          if (payload.eventId) {
            processedEventsRef.current.add(payload.eventId);
            if (processedEventsRef.current.size > 1000) {
              const [first] = processedEventsRef.current;
              processedEventsRef.current.delete(first);
            }
          }

          setLastEvent(payload);
          setLastSyncTime(new Date());
          if (payload.eventType === 'CONNECTED' || payload.eventType === 'RECONNECTED') {
            setStatus('connected');
            // Server-detected reconnect: refresh stale data
            if (payload.eventType === 'RECONNECTED' || (payload.data as any)?.refreshRequired) {
              onReconnectRef.current?.();
            }
          }
          if (onEventRef.current) {
            onEventRef.current(payload);
          }
        } catch (err) {
          console.error('Failed to parse SSE sync payload:', err);
        }
      });

      es.addEventListener('ping', () => {
        if (!isMountedRef.current) return;
        setLastSyncTime(new Date());
      });

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        if (!isMountedRef.current) return;

        if (retryCountRef.current >= 8) {
          setStatus('error');
          return;
        }

        setStatus('reconnecting');

        // Exponential backoff reconnect (capped at 15s)
        const nextRetry = Math.min(1000 * Math.pow(1.5, retryCountRef.current), 15000);
        retryCountRef.current += 1;

        if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = setTimeout(() => {
          // Through the ref, NOT the `connect` binding this closure captured.
          //
          // `connect` is a new function on every render whose identity depends
          // on [projectId, enabled]. This handler was attached to an
          // EventSource created by one particular render, so calling `connect`
          // directly would reconnect using THAT render's projectId. With the
          // backoff reaching 15s, a user switching projects while a stream is
          // down had a real window in which the retry reopened the stream for
          // the project they had just left — and, because the effect had
          // already opened a stream for the new one, ended up subscribed to
          // both. The ref always holds the current one.
          connectRef.current();
        }, nextRetry);
      };
    } catch (err) {
      if (isMountedRef.current) {
        setStatus('error');
      }
    }
  }, [projectId, enabled]);

  // Kept in sync in its own effect so the retry closure above always reaches
  // the latest `connect` without that closure having to depend on it.
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    isMountedRef.current = true;
    connect();

    return () => {
      isMountedRef.current = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connect]);

  const forceReconnect = useCallback(() => {
    retryCountRef.current = 0;
    connect();
  }, [connect]);

  return {
    status,
    lastEvent,
    lastSyncTime,
    reconnect: forceReconnect,
  };
}
