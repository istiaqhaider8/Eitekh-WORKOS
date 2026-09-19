/**
 * The rate limiter's idea of who is calling.
 *
 * The case that matters is the first one: a caller who sends their own
 * `X-Forwarded-For` must not be able to choose their bucket. That was
 * demonstrated against the running server before this existed — rotating the
 * header reset the remaining count every time.
 */

import {
  clientIpFromForwarded,
  parseTrustedProxyHops,
  UNTRUSTED_CLIENT,
} from "../client-ip";

describe("clientIpFromForwarded", () => {
  it("ignores a header the caller forged before the proxy appended the truth", () => {
    // The caller sent "evil"; nginx appended what it actually saw.
    expect(clientIpFromForwarded("evil, 203.0.113.10", 1)).toBe("203.0.113.10");
  });

  it("is not fooled by padding the chain with many fake entries", () => {
    const forged = ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"].join(", ");
    expect(clientIpFromForwarded(`${forged}, 203.0.113.10`, 1)).toBe("203.0.113.10");
  });

  it("reads the right entry behind two proxies", () => {
    // client -> nginx -> app: nginx appends the client, the app's own proxy
    // appends nginx.
    expect(clientIpFromForwarded("203.0.113.10, 10.0.0.5", 2)).toBe("203.0.113.10");
  });

  it("returns a single shared bucket when nothing in front is trusted", () => {
    // Deliberately strict. With no trusted proxy there is no address worth
    // believing, and one bucket is safer than a bucket per header value.
    expect(clientIpFromForwarded("203.0.113.10", 0)).toBe(UNTRUSTED_CLIENT);
    expect(clientIpFromForwarded("203.0.113.10", null)).toBe(UNTRUSTED_CLIENT);
  });

  it("refuses a chain shorter than the configured hops", () => {
    // The request did not arrive through the proxies it should have, so
    // nothing in this chain was written by something we trust.
    expect(clientIpFromForwarded("203.0.113.10", 2)).toBe(UNTRUSTED_CLIENT);
    expect(clientIpFromForwarded("", 1)).toBe(UNTRUSTED_CLIENT);
    expect(clientIpFromForwarded(null, 1)).toBe(UNTRUSTED_CLIENT);
  });

  it("accepts IPv6, which a proxy may legitimately report", () => {
    expect(clientIpFromForwarded("2001:db8::1", 1)).toBe("2001:db8::1");
  });

  it("accepts a private address, since a proxy may sit inside the network", () => {
    expect(clientIpFromForwarded("10.0.0.7", 1)).toBe("10.0.0.7");
  });

  it("rejects a value that is not address-shaped", () => {
    // The result is a database key and appears in logs, so an arbitrary
    // payload must not travel there.
    expect(clientIpFromForwarded("'; DROP TABLE users; --", 1)).toBe(UNTRUSTED_CLIENT);
    expect(clientIpFromForwarded("x".repeat(200), 1)).toBe(UNTRUSTED_CLIENT);
    expect(clientIpFromForwarded("not an ip", 1)).toBe(UNTRUSTED_CLIENT);
  });

  it("handles whitespace and empty entries in the chain", () => {
    expect(clientIpFromForwarded("  evil ,, 203.0.113.10  ", 1)).toBe("203.0.113.10");
  });

  it("gives the same bucket however the caller relabels itself behind the proxy", () => {
    // This is the property the fix exists for, stated directly: two requests
    // that differ ONLY in what the caller claimed must be charged together.
    const a = clientIpFromForwarded("evil, 203.0.113.10", 1);
    const b = clientIpFromForwarded("totally-different, 203.0.113.10", 1);
    const c = clientIpFromForwarded("1.1.1.1, 2.2.2.2, 203.0.113.10", 1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  /**
   * THE RESIDUAL RISK, recorded here because code cannot close it.
   *
   * With one trusted hop, a legitimate request carries a chain of exactly one
   * entry — the address nginx appended. A request that reached the app
   * DIRECTLY, skipping the proxy, can carry a one-entry chain too, and the two
   * are indistinguishable: the app has no access to the socket address in Next
   * middleware, so there is nothing to compare the hop against.
   *
   * The control is therefore a network one: the application port must not be
   * reachable except through the proxy. DEPLOYMENT.md states it as a
   * requirement rather than advice, because getting it wrong restores the
   * bypass while every test here still passes.
   */
  it("documents that a one-hop chain is only as trustworthy as the network", () => {
    // Indistinguishable from a genuine single-proxy request. Not a bug in this
    // function — a constraint on where the port is exposed.
    expect(clientIpFromForwarded("203.0.113.10", 1)).toBe("203.0.113.10");
    expect(clientIpFromForwarded("198.51.100.77", 1)).toBe("198.51.100.77");
  });
});

describe("parseTrustedProxyHops", () => {
  it("treats unset and empty as 'not configured', which is not the same as zero", () => {
    // The boot guard needs to tell "deliberately direct" from "never decided".
    expect(parseTrustedProxyHops(undefined)).toBeNull();
    expect(parseTrustedProxyHops("")).toBeNull();
    expect(parseTrustedProxyHops("   ")).toBeNull();
  });

  it("accepts zero as a deliberate 'nothing in front of me'", () => {
    expect(parseTrustedProxyHops("0")).toBe(0);
  });

  it("accepts a small positive hop count", () => {
    expect(parseTrustedProxyHops("1")).toBe(1);
    expect(parseTrustedProxyHops("3")).toBe(3);
  });

  it("rejects nonsense rather than guessing a permissive default", () => {
    // Falling back to a number here would silently restore the bypass.
    expect(parseTrustedProxyHops("-1")).toBeNull();
    expect(parseTrustedProxyHops("1.5")).toBeNull();
    expect(parseTrustedProxyHops("many")).toBeNull();
    expect(parseTrustedProxyHops("99")).toBeNull();
  });
});
