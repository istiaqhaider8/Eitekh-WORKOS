/**
 * One production-valid environment, for every harness that starts a server.
 *
 * WHY THIS EXISTS
 *
 * Five times in one session a new guard in `src/instrumentation.ts` broke a
 * test harness, always in the same way:
 *
 *   TRUSTED_PROXY_HOPS   integration runner, soak, axe
 *   JWT_SECRET           integration runner (CI's placeholder, not unset)
 *   FIELD_ENCRYPTION_KEY integration runner (the all-zeros CI key)
 *   BASE_URL             integration runner (a reserved .test domain)
 *   STORAGE_DRIVER       integration runner, axe
 *
 * Every time the guard was RIGHT, and every time the harness had been quietly
 * relying on a developer's `.env` to satisfy it — so it passed locally and
 * failed in CI, where the ambient values are deliberate placeholders.
 *
 * The recurring mistake was the `||` fallback:
 *
 *     FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY || "1".repeat(64)
 *
 * That only fires when a variable is UNSET. CI sets these — to exactly the
 * values the guard exists to refuse. A harness that is correct only when the
 * surrounding environment is already correct is not a harness.
 *
 * So there is now one place that answers the guards, and every harness that
 * starts a production server imports it. Adding a guard to instrumentation.ts
 * means adding its answer HERE, once, instead of discovering three more
 * harnesses one CI run at a time.
 */

import crypto from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Values the boot guard rejects. Kept in step with instrumentation.ts. */
const isPlaceholderJwt = (v) =>
  !v ||
  v.length < 32 ||
  v.includes("dev-only") ||
  v.includes("change-in-production") ||
  v.includes("ci-test");

const isPlaceholderKey = (v) => !v || !/^[0-9a-f]{64}$/i.test(v) || /^0+$/.test(v);

/**
 * Build an environment a production server will actually boot with.
 *
 * `name` distinguishes the harness in log lines and in the storage directory,
 * so two harnesses running at once cannot write over each other's files.
 *
 * Secrets are GENERATED rather than fixed literals, so nothing here can be
 * mistaken for a credential or copied somewhere it would matter. The same
 * object goes to the server and to the test process, so a fixture signing
 * tokens uses the secret the server verifies them with.
 */
export function productionEnvFor(name, overrides = {}) {
  const notes = [];

  const jwtSecret = isPlaceholderJwt(process.env.JWT_SECRET)
    ? `${name}-${crypto.randomBytes(24).toString("hex")}`
    : process.env.JWT_SECRET;
  if (jwtSecret !== process.env.JWT_SECRET) {
    notes.push("JWT_SECRET was a placeholder the production guard rejects; generated one for this run");
  }

  const fieldKey = isPlaceholderKey(process.env.FIELD_ENCRYPTION_KEY)
    ? crypto.randomBytes(32).toString("hex")
    : process.env.FIELD_ENCRYPTION_KEY;
  if (fieldKey !== process.env.FIELD_ENCRYPTION_KEY) {
    notes.push("FIELD_ENCRYPTION_KEY was a placeholder the production guard rejects; generated one for this run");
  }

  const env = {
    ...process.env,
    NODE_ENV: "production",

    JWT_SECRET: jwtSecret,
    FIELD_ENCRYPTION_KEY: fieldKey,

    /**
     * These servers live for minutes on a loopback port and send no email, so
     * they have no public URL to give — which is exactly the case the flag
     * exists for. Set here rather than left to a developer's `.env`, which is
     * how this stayed hidden until CI.
     */
    ALLOW_LOCAL_BASE_URL: "1",
    BASE_URL: process.env.INTEGRATION_PUBLIC_URL || `https://${name}.eitekh.test`,

    SMTP_HOST: process.env.SMTP_HOST || `smtp.${name}.test`,
    SMTP_PASS: process.env.SMTP_PASS || name,

    /**
     * One trusted hop. Harnesses that simulate distinct clients send a single
     * X-Forwarded-For entry, which is what a proxy would have appended; with 0
     * the address is unknowable and every request in a long run shares one
     * backstop bucket, which eventually returns 429s that look like broken
     * guards rather than a spent budget.
     */
    TRUSTED_PROXY_HOPS: "1",

    /** A directory of its own. One instance, one directory, so "shared" is true. */
    STORAGE_DRIVER: "local-fs",
    STORAGE_FS_ROOT: join(tmpdir(), `eitekh-${name}-attachments`),
    STORAGE_FS_SHARED: "1",

    /** POST /api/recurring-tasks/trigger refuses with 503 when this is unset. */
    RECURRING_TASKS_SECRET: `${name}-recurring-secret`,

    ...overrides,
  };

  return { env, notes };
}
