/**
 * Phase 3 — prove the reverse proxy path, including the thing code cannot fix.
 *
 * WHY THIS EXISTS
 *
 * The rate limiter derives the client address from `X-Forwarded-For`, and that
 * header is written by the CALLER. Reading it left-to-right let anyone pick
 * their own rate-limit bucket by rotating the value — demonstrated against a
 * running server, and fixed by counting hops from the right.
 *
 * But that fix has a residual the application cannot close: with one trusted
 * hop, a request that SKIPPED the proxy carries a chain indistinguishable from
 * a genuine one, because Next middleware has no access to the socket address
 * to compare against. The control is therefore a deployment one — the app port
 * must not be reachable except through the proxy — and DEPLOYMENT.md states it
 * as a requirement.
 *
 * A requirement nobody tests is a hope. This runs a real TLS-terminating proxy
 * in front of a real server and checks both halves: that the correct address
 * arrives through it, and that a caller cannot override it.
 *
 * WHY A NODE PROXY RATHER THAN NGINX
 *
 * Neither nginx nor caddy is installed here, and requiring one would make this
 * a drill nobody runs. What is being tested is the APPLICATION's behaviour
 * behind a proxy, not nginx's correctness — so the proxy only has to do what
 * nginx's `proxy_add_x_forwarded_for` does: append the peer address to any
 * chain the client supplied. That is twelve lines, and it is faithful to the
 * one behaviour under test.
 *
 * Usage:
 *   node scripts/proxy-drill.mjs --app http://127.0.0.1:3000 \
 *     --cert <path> --key <path> [--port 8443]
 */

import https from "node:https";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const APP = argOf("--app", "http://127.0.0.1:3000");
const PORT = Number(argOf("--port", "8443"));
const CERT = argOf("--cert");
const KEY = argOf("--key");

if (!CERT || !KEY) {
  console.error(
    "\n[proxy-drill] --cert and --key are required.\n" +
      "  openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem \\\n" +
      '    -days 1 -nodes -subj "//CN=localhost" -addext "subjectAltName=IP:127.0.0.1"\n'
  );
  process.exit(2);
}

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  -- " + detail : ""));
  if (ok) pass += 1;
  else fail += 1;
}

/**
 * The address this proxy claims to see. Fixed, so an assertion can name it.
 * A real proxy would use the socket's remote address.
 */
const PROXY_SEES = "198.51.100.42";

/**
 * A TLS terminator that behaves like nginx's `proxy_add_x_forwarded_for`:
 * APPEND to whatever chain arrived, never replace it.
 *
 * Appending is what makes the vulnerability possible in the first place, and
 * replacing would make this drill prove something the real deployment does
 * not do.
 */
const server = https.createServer(
  { cert: readFileSync(CERT), key: readFileSync(KEY) },
  async (req, res) => {
    const upstream = new URL(req.url, APP);
    const inbound = req.headers["x-forwarded-for"];
    const chain = inbound ? `${inbound}, ${PROXY_SEES}` : PROXY_SEES;

    const headers = { ...req.headers };
    delete headers.host;
    delete headers["content-length"];
    headers["x-forwarded-for"] = chain;
    headers["x-forwarded-proto"] = "https";
    headers["x-real-ip"] = PROXY_SEES;

    let body;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = Buffer.concat(chunks);
    }

    try {
      const upstreamRes = await fetch(upstream, {
        method: req.method,
        headers,
        body,
        redirect: "manual",
      });
      const buf = Buffer.from(await upstreamRes.arrayBuffer());
      res.writeHead(upstreamRes.status, Object.fromEntries(upstreamRes.headers));
      res.end(buf);
    } catch (err) {
      res.writeHead(502);
      res.end(String(err?.message || err));
    }
  }
);

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
console.log(`[proxy-drill] TLS proxy on https://127.0.0.1:${PORT} -> ${APP}`);
console.log(`[proxy-drill] the proxy reports every client as ${PROXY_SEES}\n`);

/** The certificate is self-signed; that is not what is under test. */
const agent = new https.Agent({ rejectUnauthorized: false });
const viaProxy = (path, init = {}) =>
  fetch(`https://127.0.0.1:${PORT}${path}`, { ...init, dispatcher: undefined, agent });

/**
 * Node's global fetch does not accept an `agent`, so TLS verification is
 * disabled for this process instead. Scoped to the drill, and the certificate
 * is one it generated itself.
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

try {
  // ------------------------------------------------------------------ 1
  const health = await fetch(`https://127.0.0.1:${PORT}/api/health`);
  check("the app is reachable through TLS termination", health.status === 200, `HTTP ${health.status}`);

  // ------------------------------------------------------------------ 2
  /**
   * The security property, stated as a test.
   *
   * Two requests that differ ONLY in the chain the caller supplied must be
   * charged to the same bucket, because the proxy appends the real address
   * and the app counts from the right. If the caller could move the bucket,
   * login throttling would be bypassable by rotating a header.
   */
  const remainingFor = async (claimed) => {
    const res = await fetch(`https://127.0.0.1:${PORT}/api/health`, {
      headers: claimed ? { "X-Forwarded-For": claimed } : {},
    });
    return Number(res.headers.get("x-ratelimit-remaining"));
  };

  const a1 = await remainingFor("203.0.113.1");
  const a2 = await remainingFor("203.0.113.2");
  const a3 = await remainingFor("45.9.148.99");

  check(
    "a caller CANNOT change its rate-limit bucket by rewriting X-Forwarded-For",
    Number.isFinite(a1) && a2 === a1 - 1 && a3 === a2 - 1,
    `remaining went ${a1} -> ${a2} -> ${a3} across three different claimed IPs`
  );

  // ------------------------------------------------------------------ 3
  const noClaim = await remainingFor(null);
  check(
    "and a caller sending no header at all shares that same bucket",
    noClaim === a3 - 1,
    `remaining ${noClaim}`
  );

  // ------------------------------------------------------------------ 4
  const headers = await fetch(`https://127.0.0.1:${PORT}/login`);
  const hsts = headers.headers.get("strict-transport-security");
  const csp = headers.headers.get("content-security-policy");
  check("HSTS survives the proxy", Boolean(hsts && /max-age=\d+/.test(hsts)), hsts || "(missing)");
  check("CSP survives the proxy", Boolean(csp && csp.includes("frame-ancestors")), csp ? "present" : "(missing)");
  check(
    "X-Frame-Options survives the proxy",
    headers.headers.get("x-frame-options") === "DENY",
    headers.headers.get("x-frame-options") || "(missing)"
  );

  // ------------------------------------------------------------------ 5
  /**
   * CSRF still applies through the proxy.
   *
   * The middleware refuses a mutating request whose `Origin` is not the
   * application's own. Worth asserting here specifically because a proxy
   * rewrites `Host`, and a deployment that gets that wrong can make every
   * request look same-origin — turning the check off without removing it.
   *
   * A first version of this called it "a failed login mints no cookie". That
   * passed, but for the wrong reason: the request never reached credential
   * validation, so the assertion was trivially true. A test that passes
   * before it reaches the thing it names is not testing that thing.
   */
  const foreignOrigin = await fetch(`https://127.0.0.1:${PORT}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
    body: JSON.stringify({ email: "nobody@example.com", password: "not-a-real-password" }),
  });
  check(
    "a mutating request from a foreign Origin is refused through the proxy",
    foreignOrigin.status === 403,
    `HTTP ${foreignOrigin.status}`
  );
  check(
    "and it mints no session cookie",
    !(foreignOrigin.headers.get("set-cookie") || "").includes("eitekh_session_token="),
    "no session cookie in the response"
  );

  // ------------------------------------------------------------------ 6
  /**
   * The residual the application cannot close.
   *
   * With one trusted hop, a request that reached the app DIRECTLY carries a
   * chain indistinguishable from one a proxy appended. The only control is
   * that the app port is unreachable except through the proxy, which
   * DEPLOYMENT.md states as a requirement rather than advice.
   *
   * A requirement nobody checks is a hope, so this checks it: the app must be
   * bound to loopback, not to every interface.
   */
  const lanAddress = Object.values(await import("node:os").then((os) => os.networkInterfaces()))
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;

  if (!lanAddress) {
    console.log("SKIP  the app port is not reachable off-host  -- no non-loopback interface found");
  } else {
    let reachable = false;
    try {
      const res = await fetch(`http://${lanAddress}:3000/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      reachable = res.status > 0;
    } catch {
      reachable = false;
    }
    check(
      "the app port is NOT reachable off-host (only the proxy should reach it)",
      !reachable,
      reachable
        ? `http://${lanAddress}:3000 answered — bind to 127.0.0.1, see DEPLOYMENT.md`
        : `http://${lanAddress}:3000 refused, as it must`
    );
  }
} catch (err) {
  console.error(`\n[proxy-drill] error: ${err?.message || err}`);
  fail += 1;
} finally {
  server.close();
}

console.log(`\n[proxy-drill] ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
