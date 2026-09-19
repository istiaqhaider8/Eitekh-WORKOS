/**
 * PROD-7 — alert rule behaviour.
 *
 * A documented threshold is not an alert; something has to evaluate it. These
 * cover the properties that decide whether the alerts are useful or ignored:
 * they must fire on a change rather than on a cumulative total, they must not
 * repeat until someone mutes them, and a delivery failure must not become an
 * incident of its own.
 */

import {
  ALERT_RULES,
  evaluateAlerts,
  dispatchAlerts,
  __resetAlertStateForTests,
} from "../alerts";
import { counters } from "../telemetry";

beforeEach(() => {
  // Absorb everything counted so far, so each test measures its own delta...
  __resetAlertStateForTests();
  evaluateAlerts();
  // ...then clear the cooldowns that baseline call just consumed, while
  // keeping the baseline itself.
  __resetAlertStateForTests({ keepBaseline: true });
});

describe("the five documented alerts exist as code", () => {
  it("covers exactly the rules DEPLOYMENT.md specifies", () => {
    expect(ALERT_RULES.map((r) => r.id).sort()).toEqual([
      "auth-failure-spike",
      "database-unreachable",
      "error-rate",
      "realtime-degraded",
      "shared-store-unavailable",
    ]);
  });

  it("every rule names at least one counter and a human-readable detail", () => {
    for (const r of ALERT_RULES) {
      expect(r.keys.length).toBeGreaterThan(0);
      expect(r.detail(1, r.threshold)).toMatch(/\w/);
      expect(["warning", "critical"]).toContain(r.severity);
    }
  });

  it("the store-unavailable and database rules fire on ANY occurrence", () => {
    // These are not threshold questions: the limiter fails closed, so a single
    // occurrence is already user-visible.
    const zeroThreshold = ALERT_RULES.filter((r) => r.threshold === 0).map((r) => r.id);
    expect(zeroThreshold).toContain("shared-store-unavailable");
    expect(zeroThreshold).toContain("database-unreachable");
  });
});

describe("rules fire on a change, not on a running total", () => {
  it("fires once the delta crosses the threshold", () => {
    for (let i = 0; i < 12; i += 1) counters.increment("events.error");
    const fired = evaluateAlerts();
    expect(fired.map((f) => f.id)).toContain("error-rate");
  });

  it("does not fire again on the next window with no new errors", () => {
    for (let i = 0; i < 12; i += 1) counters.increment("events.error");
    evaluateAlerts();
    // A counter that only ever rises would otherwise stay fired forever.
    const second = evaluateAlerts(Date.now() + 60 * 60_000);
    expect(second.map((f) => f.id)).not.toContain("error-rate");
  });

  it("stays quiet below the threshold", () => {
    counters.increment("events.error", 3);
    expect(evaluateAlerts().map((f) => f.id)).not.toContain("error-rate");
  });

  it("fires the shared-store rule on a single occurrence", () => {
    counters.increment("action.RATE_LIMIT_UNAVAILABLE");
    expect(evaluateAlerts().map((f) => f.id)).toContain("shared-store-unavailable");
  });

  it("fires the real-time rule when fan-out degrades", () => {
    // The failure nobody would otherwise notice: fan-out falls back to polling
    // and everything still appears to work.
    counters.increment("action.SYNC_BUS_LISTEN_FAILED");
    expect(evaluateAlerts().map((f) => f.id)).toContain("realtime-degraded");
  });
});

describe("cooldown", () => {
  it("suppresses a repeat inside the window", () => {
    for (let i = 0; i < 12; i += 1) counters.increment("events.error");
    expect(evaluateAlerts().map((f) => f.id)).toContain("error-rate");

    for (let i = 0; i < 12; i += 1) counters.increment("events.error");
    // An alert that repeats every cycle is an alert people mute, and a muted
    // alert is worse than none.
    expect(evaluateAlerts().map((f) => f.id)).not.toContain("error-rate");
  });

  it("allows it again after the cooldown has passed", () => {
    for (let i = 0; i < 12; i += 1) counters.increment("events.error");
    evaluateAlerts();
    for (let i = 0; i < 12; i += 1) counters.increment("events.error");
    const later = evaluateAlerts(Date.now() + 16 * 60_000);
    expect(later.map((f) => f.id)).toContain("error-rate");
  });
});

describe("dispatch", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.ALERT_WEBHOOK_URL;
  });

  it("posts each firing to the configured webhook", async () => {
    const calls: string[] = [];
    global.fetch = (async (url: string, init: any) => {
      calls.push(String(init?.body ?? ""));
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    process.env.ALERT_WEBHOOK_URL = "http://alerts.invalid/hook";

    await dispatchAlerts([
      {
        id: "error-rate",
        severity: "critical",
        title: "Server error rate",
        detail: "12 errors",
        value: 12,
        threshold: 10,
        firedAt: new Date().toISOString(),
      },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("error-rate");
    expect(calls[0]).toContain("CRITICAL");
  });

  it("does not throw when the webhook is unreachable", async () => {
    global.fetch = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    process.env.ALERT_WEBHOOK_URL = "http://alerts.invalid/hook";

    // An alert that cannot be delivered must not become an incident itself.
    await expect(
      dispatchAlerts([
        {
          id: "x",
          severity: "warning",
          title: "t",
          detail: "d",
          value: 1,
          threshold: 0,
          firedAt: new Date().toISOString(),
        },
      ])
    ).resolves.toBeUndefined();
  });

  it("does nothing at all when there is nothing to report", async () => {
    let called = false;
    global.fetch = (async () => {
      called = true;
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    process.env.ALERT_WEBHOOK_URL = "http://alerts.invalid/hook";

    await dispatchAlerts([]);
    expect(called).toBe(false);
  });
});

/**
 * The failure the tests above could not see.
 *
 * Every test here passes a counter key in by hand, so they prove the
 * evaluation ARITHMETIC. What none of them can prove is that the key a rule
 * watches is one the application ever increments.
 *
 * It was not. `auth-failure-spike` watched `action.LOGIN_FAILED`,
 * `action.AUTH_FAILED` and `action.RATE_LIMIT_EXCEEDED`; the login route emits
 * `AUTH_LOGIN_FAILED`, and nothing emitted the other two at all. So the one
 * rule guarding against credential stuffing could never fire — it read as
 * configured, it evaluated on every cycle, and its value was always zero.
 *
 * Found by inducing 30 failed logins against a running server and watching
 * nothing happen. This reads the source tree so a unit run finds it next time:
 * a renamed action now breaks a test instead of silently disarming an alert.
 */
describe("every rule watches a counter something actually emits", () => {
  const { readdirSync, readFileSync, statSync } = require("node:fs");
  const { join } = require("node:path");

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (entry === "node_modules" || entry === "__tests__") continue;
        sourceFiles(p, out);
      } else if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && entry !== "alerts.ts") {
        out.push(p);
      }
    }
    return out;
  }

  // Counter names are built as `action.${event.action}` and
  // `events.${severity}` in telemetry.ts.
  const EMITTED_SEVERITIES = new Set(["info", "warning", "error", "security", "audit"]);
  const corpus = sourceFiles(join(process.cwd(), "src"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  it.each(ALERT_RULES.map((r) => [r.id, r] as const))("%s", (_id, rule) => {
    for (const key of rule.keys) {
      const [namespace, ...rest] = key.split(".");
      const name = rest.join(".");

      if (namespace === "events") {
        expect(EMITTED_SEVERITIES.has(name)).toBe(true);
      } else if (namespace === "action") {
        const emitted = corpus.includes(`"${name}"`) || corpus.includes(`'${name}'`);
        if (!emitted) {
          throw new Error(
            `Rule "${rule.id}" watches "${key}", but nothing in src/ emits the action ` +
              `"${name}". The rule would evaluate to zero forever — present, evaluated, ` +
              `and structurally incapable of firing.`
          );
        }
      } else if (namespace === "health") {
        expect(corpus.includes(key)).toBe(true);
      } else {
        throw new Error(`Rule "${rule.id}" uses an unknown counter namespace "${namespace}".`);
      }
    }
  });
});
