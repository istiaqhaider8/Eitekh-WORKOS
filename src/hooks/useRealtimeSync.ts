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
        if (wasConnectedRef.current && retryCountRef.current > 0) {
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
          if (payload.eventType === 'CONNECTED') {
            setStatus('connected');
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
          connect();
        }, nextRetry);
      };
    } catch (err) {
      if (isMountedRef.current) {
        setStatus('error');
      }
    }
  }, [projectId, enabled]);

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
