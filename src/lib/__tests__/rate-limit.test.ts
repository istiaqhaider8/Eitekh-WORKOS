/**
 * PROD-2 — rate limiter behaviour.
 *
 * These are unit tests over the decision logic, using a fake store. They do
 * not prove the thing PROD-2 is actually about — that the store is shared
 * between instances — because no single-process test can. That claim is
 * verified separately against two concurrently running servers and one
 * database; see the PROD-2 section of PRODUCTION-READINESS.md.
 *
 * What they do cover is the part that is easy to get wrong and invisible when
 * wrong: the window boundary, the off-by-one at the ceiling, and above all the
 * fail-closed behaviour, since a limiter that fails open under load is
 * indistinguishable from a working one until someone attacks it.
 */

import { checkRateLimit, resetRateLimit } from "../rate-limit";
import {
  __setRateLimitStoreForTests,
  type RateLimitStore,
  type RateLimitHit,
  type RateLimitSpec,
} from "../rate-limit-store";

/**
 * A store with the same contract as the Postgres one: `hit` returns the count
 * *including* the current request, and resets the window once `resetAt` has
 * passed.
 */
class FakeStore implements RateLimitStore {
  readonly name = "fake";
  readonly shared = true;
  readonly entries = new Map<string, { count: number; resetAt: number }>();
  now = 1_000_000;
  resets: string[] = [];

  async hit(key: string, windowSeconds: number): Promise<RateLimitHit> {
    const existing = this.entries.get(key);
    if (!existing || existing.resetAt <= this.now) {
      const fresh = { count: 1, resetAt: this.now + windowSeconds * 1000 };
      this.entries.set(key, fresh);
      return { count: 1, resetAt: new Date(fresh.resetAt) };
    }
    existing.count += 1;
    return { count: existing.count, resetAt: new Date(existing.resetAt) };
  }

  async hitMany(specs: RateLimitSpec[]): Promise<RateLimitHit[]> {
    const out: RateLimitHit[] = [];
    for (const s of specs) out.push(await this.hit(s.key, s.windowSeconds));
    return out;
  }

  async reset(key: string): Promise<void> {
    this.resets.push(key);
    this.entries.delete(key);
  }

  async sweep(): Promise<number> {
    return 0;
  }
}

class BrokenStore implements RateLimitStore {
  readonly name = "broken";
  readonly shared = true;
  async hit(): Promise<RateLimitHit> {
    throw new Error("store unreachable");
  }
  async hitMany(): Promise<RateLimitHit[]> {
    throw new Error("store unreachable");
  }
  async reset(): Promise<void> {
    throw new Error("store unreachable");
  }
  async sweep(): Promise<number> {
    throw new Error("store unreachable");
  }
}

describe("checkRateLimit", () => {
  let store: FakeStore;

  beforeEach(() => {
    store = new FakeStore();
    __setRateLimitStoreForTests(store);
  });

  afterAll(() => {
    __setRateLimitStoreForTests(null);
  });

  it("allows exactly `limit` requests and denies the next", async () => {
    const opts = { limit: 3, windowSeconds: 60 };
    const verdicts: boolean[] = [];
    for (let i = 0; i < 4; i += 1) {
      verdicts.push((await checkRateLimit("k", opts)).allowed);
    }
    expect(verdicts).toEqual([true, true, true, false]);
  });

  it("reports remaining budget counting down to zero", async () => {
    const opts = { limit: 3, windowSeconds: 60 };
    expect((await checkRateLimit("k", opts)).remaining).toBe(2);
    expect((await checkRateLimit("k", opts)).remaining).toBe(1);
    expect((await checkRateLimit("k", opts)).remaining).toBe(0);
  });

  it("keeps separate budgets per identifier", async () => {
    const opts = { limit: 1, windowSeconds: 60 };
    expect((await checkRateLimit("a", opts)).allowed).toBe(true);
    expect((await checkRateLimit("a", opts)).allowed).toBe(false);
    // A different subject must be unaffected. This is the B11 property: two
    // users must not consume each other's budget.
    expect((await checkRateLimit("b", opts)).allowed).toBe(true);
  });

  it("starts a fresh window once the old one lapses", async () => {
    const opts = { limit: 1, windowSeconds: 60 };
    expect((await checkRateLimit("k", opts)).allowed).toBe(true);
    expect((await checkRateLimit("k", opts)).allowed).toBe(false);
    store.now += 61_000;
    expect((await checkRateLimit("k", opts)).allowed).toBe(true);
  });

  it("keeps denying while the window is still open, without extending it", async () => {
    const opts = { limit: 1, windowSeconds: 60 };
    await checkRateLimit("k", opts);
    const first = await checkRateLimit("k", opts);
    const second = await checkRateLimit("k", opts);
    expect(first.allowed).toBe(false);
    expect(second.allowed).toBe(false);
    // The window must not slide forward on refused requests, or a client that
    // keeps hammering would never be let back in.
    expect(store.entries.get("k")!.resetAt).toBe(1_000_000 + 60_000);
  });

  it("DENIES when the store is unreachable", async () => {
    // The single most important assertion in this file. A limiter that fails
    // open removes the brute-force ceiling on login and password reset at the
    // exact moment operators are busy with a database incident.
    __setRateLimitStoreForTests(new BrokenStore());
    const verdict = await checkRateLimit("k", { limit: 100, windowSeconds: 60 });
    expect(verdict.allowed).toBe(false);
    expect(verdict.remaining).toBe(0);
  });
});

describe("resetRateLimit", () => {
  it("discharges the key so a successful login does not count against the ceiling", async () => {
    const store = new FakeStore();
    __setRateLimitStoreForTests(store);
    const opts = { limit: 1, windowSeconds: 60 };
    await checkRateLimit("acct", opts);
    expect((await checkRateLimit("acct", opts)).allowed).toBe(false);

    await resetRateLimit("acct");
    expect(store.resets).toContain("acct");
    expect((await checkRateLimit("acct", opts)).allowed).toBe(true);
    __setRateLimitStoreForTests(null);
  });

  it("does not throw when the store is unreachable", async () => {
    // The caller has already authenticated successfully. Refusing a valid
    // login because a counter could not be cleared would turn a cleanup
    // problem into an outage.
    __setRateLimitStoreForTests(new BrokenStore());
    await expect(resetRateLimit("acct")).resolves.toBeUndefined();
    __setRateLimitStoreForTests(null);
  });
});

/**
 * A structural guard, not a behavioural one.
 *
 * The original defect was invisible to code review and to every test: a
 * `new Map()` in module scope reads perfectly and reports correct numbers for
 * the one process that can see it. Nothing failed until the service was
 * scaled, at which point the limit silently became N x its configured value.
 *
 * So this asserts the shape of the code rather than its output. It is the only
 * kind of test that would have caught the original bug.
 */
describe("no limiter is backed by process-local state", () => {
  /**
   * Comments are stripped before matching. Both files explain at length what
   * was removed and why, and those explanations mention `new Map()` and
   * `setInterval` by name — which a naive source grep reads as the very thing
   * it is meant to forbid. Matching code only keeps the guard honest and lets
   * the history stay written down.
   */
  const read = (p: string) => {
    const src: string = require("fs").readFileSync(require("path").join(__dirname, p), "utf8");
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  };

  it("middleware holds no in-process counter and no sweep timer", () => {
    const src = read("../../middleware.ts");
    expect(src).not.toMatch(/rateLimitStore\s*=\s*new Map/);
    expect(src).not.toMatch(/setInterval/);
    expect(src).toMatch(/getRateLimitStore\(\)/);
  });

  it("rate-limit.ts delegates to the shared store", () => {
    const src = read("../rate-limit.ts");
    expect(src).not.toMatch(/new Map\(/);
    expect(src).not.toMatch(/setInterval/);
    expect(src).toMatch(/getRateLimitStore\(\)/);
  });

  it("the default store is the shared one, and the memory store is opt-in", () => {
    const src = read("../rate-limit-store.ts");
    // Defaulting to Postgres and requiring RATE_LIMIT_STORE=memory to opt out
    // means the safe configuration is the one you get by doing nothing.
    expect(src).toMatch(/return new PostgresRateLimitStore\(\)/);
    expect(src).toMatch(/RATE_LIMIT_STORE/);
  });

  it("middleware runs on the Node runtime, which the shared store requires", () => {
    // Prisma cannot run on the edge runtime. If this export were dropped the
    // limiter would lose its store, so it is worth pinning.
    expect(read("../../middleware.ts")).toMatch(/export const runtime = "nodejs"/);
  });
});
