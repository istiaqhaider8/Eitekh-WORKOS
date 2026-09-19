'use client';

import { useSyncExternalStore } from 'react';

/**
 * The current time, safe to read during render.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Several components called `Date.now()` in the middle of rendering to show a
 * relative time — "3m ago", "2d left". That is impure, and it fails in two
 * ways that look unrelated:
 *
 *   1. Hydration mismatch. Client components are still rendered on the server
 *      for the initial HTML. The server computes "2m ago", the browser
 *      hydrates a moment later and computes "3m ago", and React reports a
 *      mismatch — or silently keeps the server's text.
 *   2. The value is frozen. Nothing re-renders when time passes, so "Just now"
 *      stays "Just now" until something unrelated happens to re-render the
 *      component. The relative time is decorative rather than true.
 *
 * HOW IT WORKS
 *
 * `useSyncExternalStore` with a server snapshot of 0 means the server and the
 * first client render agree on 0 — no mismatch is possible. React then runs
 * the subscription, the clock starts, the snapshot changes, and React
 * re-renders with a real time. From then on every consumer updates together.
 *
 * Callers must handle 0: it means "the client clock is not available yet",
 * which is the case during SSR and for the single hydrating render. Render
 * something absolute and stable in that branch, such as the formatted date.
 *
 * ONE interval is shared by every consumer, and it is cleared when the last
 * one unmounts — rather than each component owning a timer that has to be
 * cleaned up correctly in its own effect.
 */

const TICK_MS = 30_000;

const listeners = new Set<() => void>();
let snapshot = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (!timer) {
    // Publish a real time immediately. React re-reads the snapshot after
    // subscribing and re-renders if it changed, so no explicit notify is
    // needed for this first value.
    snapshot = Date.now();
    timer = setInterval(() => {
      snapshot = Date.now();
      for (const l of listeners) l();
    }, TICK_MS);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      // Back to the server-equivalent value, so a later remount starts from
      // the same place rather than from a stale timestamp.
      snapshot = 0;
    }
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => 0;

/** Milliseconds since the epoch, or 0 before the client clock is available. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
