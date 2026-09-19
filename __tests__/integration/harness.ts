/**
 * PROD-5 / PROD-6 — integration-test harness.
 *
 * WHY THESE TESTS RUN AGAINST A REAL SERVER
 *
 * The existing unit tests are library-level: they exercise functions in
 * isolation. The failure this suite exists to catch — one tenant reading
 * another's data — lives in the seam between the route, the auth layer, the
 * tenant guard and the database. Calling `assertProjectAccess` directly would
 * test the guard while assuming the route calls it, which is precisely the
 * assumption that breaks. So these tests speak HTTP to a running build, the
 * same way an attacker would.
 *
 * WHY A SEPARATE DATABASE
 *
 * The suite creates and deletes organizations, users and issues. It connects to
 * a database named by INTEGRATION_DATABASE_URL, which must NOT be the
 * development database, and the guard below refuses to run if it looks like it
 * is. Destroying developer or customer data to test isolation would be a poor
 * trade.
 */

import { spawn, type ChildProcess } from "child_process";
import { execSync } from "child_process";
import jwt from "jsonwebtoken";

export const BASE_URL = process.env.INTEGRATION_BASE_URL || "http://localhost:3141";

const JWT_ISSUER = "eitekh-workos";
const JWT_AUDIENCE = "eitekh-workos-web";

export interface TestUser {
  id: string;
  email: string;
  token: string;
  sessionId: string;
  label: string;
}

export interface TenantFixture {
  orgId: string;
  workspaceId: string;
  projectId: string;
  projectKey: string;
  issueId: string;
  issueKey: string;
  teamId: string;
  /** An organization member who is NOT a project member — an assignment target. */
  spareUserId: string;
  /** The workflow owning this tenant's statuses. */
  workflowId: string;
  /** The issue's starting status ("To Do"). */
  statusId: string;
  /**
   * A second status ("In Progress") with a transition FROM statusId, and a
   * third ("Done") with NO transition into it.
   *
   * Both are needed to test transition enforcement at all: with one status
   * there is no move to make, and with no forbidden target there is nothing to
   * refuse. The third is the one a bypass would reach.
   */
  statusInProgressId: string;
  statusDoneId: string;
  sprintId: string;
  epicId: string;
  /**
   * Leaf resources, each reachable by its own id on a path that names no
   * tenant. That shape is where both vulnerabilities found so far lived.
   */
  commentId: string;
  subtaskId: string;
  componentId: string;
  customFieldId: string;
  attachmentId: string;
  webhookId: string;
  automationId: string;
  users: Record<string, TestUser>;
}

export interface Fixture {
  orgA: TenantFixture;
  orgB: TenantFixture;
  /** A super admin, used to prove that the guards allow what they should. */
  superAdmin: TestUser;
  /** Signed in, but a member of no organization at all. */
  outsider: TestUser;
}

/** Signs a session token for a fixture user. Mirrors src/lib/session-token.ts. */
export function signToken(userId: string, email: string, sessionId: string, isSuperAdmin = false): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET must be set for integration tests");
  return jwt.sign(
    { userId, email, isSuperAdmin, sessionId },
    secret,
    { expiresIn: "2h", algorithm: "HS256", issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
  );
}

export interface ApiResult {
  status: number;
  body: any;
  text: string;
}

/**
 * Make a request as a given user.
 *
 * `Origin` is always set, because the middleware rejects mutating requests
 * without it as CSRF — a test that forgot it would get a 403 and look like a
 * passing isolation check for entirely the wrong reason.
 */
export async function api(
  user: TestUser | null,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    Origin: BASE_URL,
    "Content-Type": "application/json",
  };
  if (user) headers.Cookie = `eitekh_session_token=${user.token}`;
  // For routes authenticated by something other than a session — the cron
  // endpoints, which take a shared secret in a header.
  Object.assign(headers, init.headers ?? {});

  const res = await fetch(`${BASE_URL}${path}`, {
    method: init.method || "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* HTML or empty */ }
  return { status: res.status, body, text };
}

/**
 * Assert that a cross-tenant request was refused.
 *
 * Deliberately strict about what counts as a refusal:
 *
 *   - 200 is a failure even if the body looks empty, because "empty" is often
 *     an artefact of the assertion rather than of the server.
 *   - 429 is a failure, not a pass. A rate-limited request proves nothing
 *     about isolation, and treating it as a pass is how a suite silently stops
 *     testing anything.
 *   - 500 is a failure. A crash is not an access control.
 *
 * Only 401, 403 and 404 count. 404 is accepted because several routes
 * deliberately answer "not found" rather than "forbidden", which avoids
 * confirming that another tenant's id exists.
 */
export function expectDenied(result: ApiResult, what: string): void {
  const denied = [401, 403, 404].includes(result.status);
  if (!denied) {
    throw new Error(
      `${what}: expected the request to be DENIED (401/403/404) but got ${result.status}. ` +
        `Body: ${result.text.slice(0, 400)}`
    );
  }
}

/** Assert a request succeeded — the control case, proving the test can pass at all. */
export function expectAllowed(result: ApiResult, what: string): void {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(
      `${what}: expected the request to be ALLOWED but got ${result.status}. ` +
        `Body: ${result.text.slice(0, 400)}`
    );
  }
}

/**
 * Assert that a response body does not contain a value belonging to another
 * tenant.
 *
 * A route can return 200 with a filtered list and still be correct; what is
 * never acceptable is the other tenant's identifiers appearing in the payload.
 * This checks the serialized body, so it catches the value wherever it is
 * nested.
 */
export function expectBodyExcludes(result: ApiResult, needle: string, what: string): void {
  if (result.text.includes(needle)) {
    throw new Error(`${what}: the response contained another tenant's identifier ${needle}.`);
  }
}

/**
 * For a request that may legitimately succeed with a FILTERED result.
 *
 * This replaces the `if (result.status === 200) { ...check... }` pattern, which
 * an audit of this suite correctly called out: with no `else`, any other status
 * made the test body empty, so it passed on 400, 429, 500 — or on a route that
 * does not exist. The test looked like coverage and asserted nothing.
 *
 * Here the contract is explicit. A 200 must not contain the other tenant's
 * values; a refusal is also acceptable; anything else fails loudly.
 */
export function expectFilteredOrDenied(
  result: ApiResult,
  needles: string[],
  what: string
): void {
  if (result.status === 200) {
    for (const needle of needles) {
      if (result.text.includes(needle)) {
        throw new Error(
          `${what}: returned 200 containing another tenant's value ${needle}. ` +
            `Body: ${result.text.slice(0, 400)}`
        );
      }
    }
    return;
  }
  if ([401, 403, 404].includes(result.status)) return;

  throw new Error(
    `${what}: expected either a filtered 200 or a refusal (401/403/404), but got ` +
      `${result.status}. A status the test does not understand must not count as a pass. ` +
      `Body: ${result.text.slice(0, 300)}`
  );
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: ChildProcess | null = null;

export async function waitForServer(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.status === 200) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not become ready at ${BASE_URL} within ${timeoutMs}ms`);
}

export function startServer(port: number): ChildProcess {
  server = spawn("npx", ["next", "start", "-p", String(port)], {
    env: { ...process.env },
    stdio: "pipe",
    shell: true,
  });
  return server;
}

export function stopServer(): void {
  if (server) {
    try { server.kill(); } catch { /* already gone */ }
    server = null;
  }
}

/**
 * Refuse to run against anything that looks like the development database.
 *
 * The suite deletes rows. Getting this wrong once would be worse than having no
 * isolation tests at all.
 */
export function assertSafeTestDatabase(url: string | undefined): string {
  if (!url) {
    throw new Error(
      "INTEGRATION_DATABASE_URL is not set. Integration tests create and delete data and " +
        "must never run against the development database."
    );
  }
  const dbName = url.split("/").pop()?.split("?")[0] ?? "";
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run integration tests against database "${dbName}": its name does not ` +
        `contain "test". This suite deletes rows.`
    );
  }
  return url;
}

export function resetTestDatabase(url: string): void {
  // `migrate deploy` rather than `db push`: the tests should run against the
  // same migration history production does, which is what PROD-0 was about.
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
