/**
 * M1 — what the SERVER process is holding.
 *
 * WHY THIS HAD TO EXIST BEFORE THE SOAK, NOT AFTER
 *
 * The A2 soak reported a line called `harness rss`, and said so honestly:
 *
 *     (rss is THIS process, not the server — it only shows whether the
 *      harness leaked)
 *
 * So the headline claim a soak exists to make — "memory was flat" — could not
 * be made at all. There was no memory instrumentation anywhere in `src/`. A
 * two-hour run without this produces the same unusable line as a six-minute
 * one, which is two hours spent to learn nothing.
 *
 * WHY REGISTRY SIZES AND NOT JUST BYTES
 *
 * "RSS grew 40 MB" is a symptom with no next step. V8 heaps grow and settle
 * for reasons that have nothing to do with a leak — fragmentation, lazy GC,
 * a compilation cache — so bytes alone produce both false alarms and false
 * comfort. A named count does not: `pbac.capabilityCache` going from 400 to
 * 40,000 over a run is a specific structure, a specific key, and a specific
 * fix.
 *
 * These are the structures that live for the life of the process and are
 * keyed by something unbounded — users, projects, cache keys, counter names.
 * Anything with a fixed number of entries is deliberately not here; a gauge
 * that cannot move is noise on a dashboard.
 *
 * WHY UPTIME IS PART OF IT
 *
 * A soak that restarts in the middle looks perfect. Memory returns to its
 * starting value and the run reports flat. Uptime going BACKWARDS between two
 * samples is the only way to tell that apart from a genuinely flat run, and
 * it invalidates the result rather than qualifying it.
 *
 * SAFETY
 *
 * /api/health is unauthenticated by design. Everything here is a count or a
 * byte total for the process as a whole. No ids, no keys, no tenant data —
 * the same contract the counters already follow.
 */

import { counters } from "./telemetry";
import { pbacEngine } from "./pbac-engine";
import { cacheManager } from "./cache-manager";
import { syncEngine } from "./sync-engine";

export interface ProcessMetrics {
  /** Resident set size: what the OS thinks the process is using. */
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  /** Buffers, and anything else V8 holds outside the JS heap. */
  externalBytes: number;
  arrayBuffersBytes: number;
  /**
   * Seconds since this process started. A soak sampler must treat a DECREASE
   * as a restart and discard the run, not average across it.
   */
  uptimeSeconds: number;
  /** Sizes of the long-lived in-process structures, by name. */
  registries: Record<string, number>;
}

export function collectProcessMetrics(): ProcessMetrics {
  const mem = process.memoryUsage();

  const registries: Record<string, number> = {};

  // Each source is guarded separately. A metrics endpoint that throws because
  // one subsystem is mid-initialisation is worse than one reporting a partial
  // picture, and this is on the liveness path.
  try {
    for (const [name, size] of Object.entries(pbacEngine.getRegistrySizes())) {
      registries[`pbac.${name}`] = size;
    }
  } catch {
    /* leave the pbac gauges out rather than fail the check */
  }

  try {
    registries["systemCache.entries"] = cacheManager.getMetrics().totalEntries;
  } catch {
    /* as above */
  }

  try {
    registries["sync.openConnections"] = syncEngine.getActiveClientsCount();
  } catch {
    /* as above */
  }

  try {
    // Counter NAMES are built from event actions, so this grows if an action
    // string is ever derived from user input. The count is the canary; the
    // values themselves are already reported separately.
    const snapshot = counters.snapshot();
    registries["telemetry.counterKeys"] = Object.keys(snapshot).length - 1; // minus uptimeSeconds
  } catch {
    /* as above */
  }

  return {
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    heapTotalBytes: mem.heapTotal,
    externalBytes: mem.external,
    arrayBuffersBytes: mem.arrayBuffers ?? 0,
    uptimeSeconds: Math.round(process.uptime()),
    registries,
  };
}
