/**
 * A1 — the connection-string cleaner, which is the only thing standing between
 * `DATABASE_URL` and a backup that cannot run.
 *
 * The bug this covers was invisible for a reason worth keeping in a test: the
 * node `pg` driver ignores unknown query parameters and libpq refuses them, so
 * the same string worked everywhere except the two commands that matter.
 *
 * Run: node --test scripts/__tests__/pg-url.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { toLibpqUrl } from "../pg-url.mjs";

test("strips Prisma's schema parameter, which libpq rejects outright", () => {
  const { url, dropped } = toLibpqUrl(
    "postgresql://u:p@localhost:5432/app?schema=public"
  );
  assert.equal(url, "postgresql://u:p@localhost:5432/app");
  assert.deepEqual(dropped, ["schema"]);
});

test("strips the pool parameters a real DATABASE_URL carries alongside it", () => {
  const { url, dropped } = toLibpqUrl(
    "postgresql://u:p@127.0.0.1:54329/app?schema=public&connection_limit=25&pool_timeout=20"
  );
  assert.equal(url, "postgresql://u:p@127.0.0.1:54329/app");
  assert.deepEqual(dropped.sort(), ["connection_limit", "pool_timeout", "schema"]);
});

test("keeps sslmode — dropping it would downgrade the connection silently", () => {
  const { url, dropped } = toLibpqUrl(
    "postgresql://u:p@db.example:5432/app?sslmode=require&schema=public"
  );
  assert.match(url, /sslmode=require/);
  assert.deepEqual(dropped, ["schema"]);
});

test("keeps every libpq parameter in a URL that uses several", () => {
  const input =
    "postgresql://u:p@db.example:5432/app" +
    "?sslmode=verify-full&sslrootcert=%2Fetc%2Fca.pem&connect_timeout=10&application_name=backup";
  const { url, dropped } = toLibpqUrl(input);
  assert.deepEqual(dropped, []);
  assert.equal(url, input);
});

test("leaves a URL with no query string exactly as it was", () => {
  const input = "postgresql://postgres:postgres@localhost:5432/postgres";
  const { url, dropped } = toLibpqUrl(input);
  assert.equal(url, input);
  assert.deepEqual(dropped, []);
});

test("leaves no trailing '?' when the query string emptied out", () => {
  const { url } = toLibpqUrl("postgresql://u:p@localhost:5432/app?schema=public");
  assert.ok(!url.endsWith("?"), `trailing ? left on ${url}`);
});

test("passes through libpq's key=value form untouched", () => {
  // Not a URI, and already something libpq accepts. Parsing it as a URL would
  // either throw or mangle it.
  const input = "host=localhost port=5432 dbname=app user=u";
  const { url, dropped } = toLibpqUrl(input);
  assert.equal(url, input);
  assert.deepEqual(dropped, []);
});

test("leaves a non-postgres URL alone rather than guessing", () => {
  const input = "mysql://u:p@localhost:3306/app?charset=utf8";
  const { url, dropped } = toLibpqUrl(input);
  assert.equal(url, input);
  assert.deepEqual(dropped, []);
});

test("preserves the password when it contains URL-escaped characters", () => {
  // The cleaner rebuilds the URL, so the credential has to survive the round
  // trip. Getting this wrong would produce an authentication failure that
  // looks nothing like its cause.
  const { url } = toLibpqUrl(
    "postgresql://user:p%40ss%3Aword@localhost:5432/app?schema=public"
  );
  const parsed = new URL(url);
  assert.equal(decodeURIComponent(parsed.password), "p@ss:word");
});

test("the database name still comes off the end after cleaning", () => {
  // db-backup.mjs derives the dump filename this way, and db-restore.mjs's
  // production guard matches on it.
  const { url } = toLibpqUrl("postgresql://u:p@localhost:5432/eitekh_ci?schema=public");
  assert.equal(url.split("/").pop().split("?")[0], "eitekh_ci");
});
