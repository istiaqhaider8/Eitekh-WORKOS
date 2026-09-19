/**
 * PROD-2 — the shared backing store for rate limiting.
 *
 * WHY THIS FILE EXISTS
 *
 * Both rate limiters in this codebase used to be a `new Map()` in module
 * scope: one in `src/lib/rate-limit.ts` for login/account throttling, one
 * inside `src/middleware.ts` for the general API limit. A process-local Map is
 * not a rate limit as soon as there is more than one process:
 *
 *   - N instances behind a load balancer give an attacker N x the ceiling,
 *     because each instance counts only the requests that happen to land on it.
 *   - Every deploy resets every counter, so a brute-force window reopens on
 *     each rolling restart.
 *
 * Neither failure is visible from the code or the tests. That is what made it
 * a blocker rather than a nit: the limiter looks correct and reports correct
 * numbers, for the single process it can see.
 *
 * WHY POSTGRES AND NOT REDIS
 *
 * The roadmap named Redis. This uses Postgres instead, deliberately:
 *
 *   - What the acceptance criteria actually require is a store that is *shared*
 *     between instances and increments *atomically*. Postgres is both.
 *   - No Redis exists in this deployment and no managed Redis has been chosen
 *     yet, so a Redis limiter could only be written, not run. An unverified
 *     security control is worse than a verified one with a slower store.
 *   - Postgres is already a hard dependency after PROD-1, so this adds no new
 *     infrastructure, no new failure domain, and no new secret to rotate.
 *
 * The cost is one extra round-trip per API request (measured at ~1-2 ms
 * locally). If that becomes material, `RateLimitStore` below is the seam:
 * implement `hit`/`reset` against Redis and change `resolveStore()`. Nothing
 * else in the codebase knows which store it is talking to.
 *
 * WHY THE INCREMENT IS ONE STATEMENT
 *
 * The obvious implementation — SELECT the row, decide, UPDATE it — races. Two
 * concurrent requests both read count=99, both decide they are under a limit of
 * 100, and both write 100. Under exactly the load a rate limiter exists to
 * handle, it undercounts. So the window read, the window reset and the
 * increment are a single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`,
 * which takes a row lock for the duration and returns the post-increment
 * value. Concurrent hits on one key serialise; there is no interleaving to get
 * wrong.
 */

import { prisma } from "./prisma";
import { logger } from "./logger";

export interface RateLimitHit {
  /** Requests recorded in the current window, including this one. */
  count: number;
  /** When the current window lapses. */
  resetAt: Date;
}

export interface RateLimitSpec {
  key: string;
  windowSeconds: number;
}

export interface RateLimitStore {
  /** Identifies the store in logs and in the boot-time production check. */
  readonly name: string;
  /** True when the store is visible to every instance. */
  readonly shared: boolean;
  /**
   * Record one hit against `key` and return the resulting window state.
   * Must be atomic: callers rely on never seeing a stale count.
   */
  hit(key: string, windowSeconds: number): Promise<RateLimitHit>;
  /**
   * Record one hit against each of several keys, atomically and in one
   * round-trip. Used where a request counts against more than one ceiling —
   * the middleware charges both a per-user and a per-IP bucket.
   */
  hitMany(specs: RateLimitSpec[]): Promise<RateLimitHit[]>;
  /** Discharge a key's window (used after a successful login). */
  reset(key: string): Promise<void>;
  /** Reclaim lapsed rows. Never affects a decision; only frees space. */
  sweep(): Promise<number>;
}

/**
 * The shared store. One statement per hit.
 *
 * `resetAt <= (now() AT TIME ZONE 'UTC')` is evaluated inside the UPDATE rather than in JS so that
 * the window boundary is decided by the database clock. With several app
 * instances, their clocks differ; the database's is the only one all of them
 * agree on, and a limiter whose window depends on which instance you reached
 * is not much better than a per-instance Map.
 */
class PostgresRateLimitStore implements RateLimitStore {
  readonly name = "postgres";
  readonly shared = true;

  async hit(key: string, windowSeconds: number): Promise<RateLimitHit> {
    const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      INSERT INTO "RateLimitCounter" ("key", "count", "resetAt")
      VALUES (${key}, 1, (now() AT TIME ZONE 'UTC') + ${`${windowSeconds} seconds`}::interval)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitCounter"."resetAt" <= (now() AT TIME ZONE 'UTC') THEN 1
          ELSE "RateLimitCounter"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "RateLimitCounter"."resetAt" <= (now() AT TIME ZONE 'UTC')
            THEN (now() AT TIME ZONE 'UTC') + ${`${windowSeconds} seconds`}::interval
          ELSE "RateLimitCounter"."resetAt"
        END
      RETURNING "count", "resetAt"
    `;

    const row = rows[0];
    if (!row) {
      // RETURNING on an upsert always yields a row. If it ever does not, treat
      // it as a store failure rather than inventing a count — callers fail
      // closed, which is the safe direction for a security control.
      throw new Error("rate-limit store returned no row");
    }
    return { count: Number(row.count), resetAt: new Date(row.resetAt) };
  }

  /**
   * The multi-key form. Still one statement, so still atomic.
   *
   * Keys are sorted before they reach the database. That is not cosmetic: two
   * concurrent statements that take row locks on the same keys in opposite
   * orders can deadlock, and Postgres resolves a deadlock by aborting one of
   * them — which in this code path would deny a legitimate request. Sorting
   * gives every caller the same lock order, so the cycle cannot form.
   */
  async hitMany(specs: RateLimitSpec[]): Promise<RateLimitHit[]> {
    if (specs.length === 0) return [];
    if (specs.length === 1) {
      return [await this.hit(specs[0].key, specs[0].windowSeconds)];
    }

    const ordered = [...specs].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const keys = ordered.map((s) => s.key);
    const windows = ordered.map((s) => s.windowSeconds);

    const rows = await prisma.$queryRaw<Array<{ key: string; count: number; resetAt: Date }>>`
      INSERT INTO "RateLimitCounter" ("key", "count", "resetAt")
      SELECT t.k, 1, (now() AT TIME ZONE 'UTC') + make_interval(secs => t.w)
        FROM unnest(${keys}::text[], ${windows}::int[]) AS t(k, w)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitCounter"."resetAt" <= (now() AT TIME ZONE 'UTC') THEN 1
          ELSE "RateLimitCounter"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "RateLimitCounter"."resetAt" <= (now() AT TIME ZONE 'UTC') THEN excluded."resetAt"
          ELSE "RateLimitCounter"."resetAt"
        END
      RETURNING "key", "count", "resetAt"
    `;

    // RETURNING order is not guaranteed to match the input, so map by key and
    // rebuild in the caller's original order.
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return specs.map((spec) => {
      const row = byKey.get(spec.key);
      if (!row) throw new Error(`rate-limit store returned no row for ${spec.key}`);
      return { count: Number(row.count), resetAt: new Date(row.resetAt) };
    });
  }

  async reset(key: string): Promise<void> {
    await prisma.rateLimitCounter.deleteMany({ where: { key } });
  }

  async sweep(): Promise<number> {
    const { count } = await prisma.rateLimitCounter.deleteMany({
      where: { resetAt: { lt: new Date() } },
    });
    return count;
  }
}

/**
 * Development-only fallback, and the thing this whole change exists to remove.
 *
 * It is kept for two narrow reasons: unit tests should not need a database to
 * exercise the window arithmetic, and a developer running `next dev` without
 * Postgres should get a working app rather than a 503 on every request. It is
 * refused in production by `assertProductionRateLimitStore()` below, so it
 * cannot become the thing that ships.
 */
class MemoryRateLimitStore implements RateLimitStore {
  readonly name = "memory";
  readonly shared = false;
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, windowSeconds: number): Promise<RateLimitHit> {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowSeconds * 1000 };
      this.entries.set(key, fresh);
      return { count: 1, resetAt: new Date(fresh.resetAt) };
    }
    entry.count += 1;
    return { count: entry.count, resetAt: new Date(entry.resetAt) };
  }

  async hitMany(specs: RateLimitSpec[]): Promise<RateLimitHit[]> {
    const out: RateLimitHit[] = [];
    for (const spec of specs) {
      out.push(await this.hit(spec.key, spec.windowSeconds));
    }
    return out;
  }

  async reset(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async sweep(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.resetAt <= now) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

/**
 * `RATE_LIMIT_STORE=memory` is the only way to get the in-process store, and
 * it is rejected in production. Defaulting to Postgres rather than to memory
 * is deliberate: the safe configuration should be the one you get by doing
 * nothing, and the unsafe one should require you to ask for it by name.
 */
function resolveStore(): RateLimitStore {
  if ((process.env.RATE_LIMIT_STORE || "").toLowerCase() === "memory") {
    return new MemoryRateLimitStore();
  }
  return new PostgresRateLimitStore();
}

let cached: RateLimitStore | null = null;

export function getRateLimitStore(): RateLimitStore {
  if (!cached) cached = resolveStore();
  return cached;
}

/** Test seam. Not used by application code. */
export function __setRateLimitStoreForTests(store: RateLimitStore | null): void {
  cached = store;
}

/**
 * Called from the startup config check. A non-shared store in production is
 * the exact defect PROD-2 fixes, so the process refuses to start rather than
 * serving traffic with a limiter that silently degrades as it scales.
 */
export function assertProductionRateLimitStore(): string[] {
  const store = getRateLimitStore();
  if (store.shared) return [];
  return [
    `RATE_LIMIT_STORE=${store.name} is a per-process store. With more than one ` +
      "instance each process counts only its own traffic, so the effective limit " +
      "is N x the configured value and every deploy resets all counters. Unset " +
      "RATE_LIMIT_STORE to use the shared Postgres store.",
  ];
}

/**
 * Opportunistic cleanup.
 *
 * Lapsed rows are harmless to a decision — `resetAt` in the past restarts the
 * window — so this is purely about not growing the table forever. It runs on
 * roughly 1 request in 500 rather than on a timer, because a `setInterval` in
 * module scope is the pattern that made the old limiters instance-bound in the
 * first place, and because on serverless the timer may never fire.
 *
 * Failures are swallowed: a sweep that does not happen costs disk, while a
 * sweep that throws into a request path costs the request.
 */
const SWEEP_PROBABILITY = 1 / 500;

export function maybeSweepRateLimits(): void {
  if (Math.random() >= SWEEP_PROBABILITY) return;
  void getRateLimitStore()
    .sweep()
    .then((removed) => {
      if (removed > 0) logger.info("RATE_LIMIT_SWEEP", `removed ${removed} lapsed rows`);
    })
    .catch(() => {});
}
