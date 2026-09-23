/**
 * Start the production build against the local database.
 *
 * WHY THIS EXISTS
 *
 * Running the standalone server by hand needs eight environment variables set
 * correctly, and getting one wrong fails in a way that looks like something
 * else. TRUSTED_PROXY_HOPS unset refuses to boot; BASE_URL pointing at
 * localhost refuses to boot unless ALLOW_LOCAL_BASE_URL is set; forgetting
 * STORAGE_DRIVER refuses to boot. Each refusal is correct and each one costs
 * a few minutes to diagnose.
 *
 * MAIL IS OFF BY DEFAULT, AND THAT IS DELIBERATE
 *
 * Unsetting SMTP_HOST and SMTP_PASS does NOT stop this application sending
 * email — credentials live in the `systemEmailConfig` TABLE and the
 * environment is only a fallback, and Next loads `.env` automatically, so a
 * shell `unset` achieves nothing. A real password-reset code was delivered to
 * a real address from this machine while exactly that was believed.
 *
 * So EMAIL_DISABLED=1 is the default here. With it on, one-time codes are
 * printed to this server's own console instead, which is the only way the
 * registration and password-reset flows can be completed without a mail
 * server at all.
 *
 * Usage:
 *   node scripts/start-local.mjs              # no mail leaves this machine
 *   node scripts/start-local.mjs --mail       # REAL email to REAL addresses
 *   node scripts/start-local.mjs --port 3100 --db eitekh_volume
 */

import { spawn } from "node:child_process";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const WITH_MAIL = argv.includes("--mail");
const PORT = argOf("--port", "3000");
const DB_NAME = argOf("--db", null);

const ROOT = resolve(process.cwd());
const STANDALONE = join(ROOT, ".next", "standalone");

if (!existsSync(join(STANDALONE, "server.js"))) {
  console.error("\n[start-local] No standalone build found. Run: npm run build\n");
  process.exitCode = 1;
} else {
  /**
   * Copy the static assets next to the standalone server, every start.
   *
   * `next build` deliberately leaves `.next/static` out of the standalone
   * output, and this script used to PRINT that as advice and start anyway.
   * So a plain `npm run build` — which replaces `.next/standalone` — produced
   * a server that boots cleanly, answers 200 on every page, passes an API
   * test suite, and serves the application with no CSS at all. The failure
   * looks like a styling bug rather than a missing directory, and nothing in
   * the log mentions it: the 404s are for asset URLs, in the browser.
   *
   * `run-integration-tests.mjs` has always done this copy. Two scripts, one
   * doing the step and one describing it, is how the step gets skipped.
   * Doing it here costs a directory copy per start and removes the failure.
   */
  cpSync(join(ROOT, ".next", "static"), join(STANDALONE, ".next", "static"), {
    recursive: true,
  });
  if (existsSync(join(ROOT, "public"))) {
    cpSync(join(ROOT, "public"), join(STANDALONE, "public"), { recursive: true });
  }

  /**
   * Read .env directly rather than relying on Next to load it.
   *
   * Next does load it, but this script needs DATABASE_URL itself in order to
   * point at a different database when --db is given, and reading it here
   * keeps the value that is actually used visible in one place.
   */
  const envText = existsSync(join(ROOT, ".env")) ? readFileSync(join(ROOT, ".env"), "utf8") : "";
  const fromEnvFile = (key) => {
    const m = envText.match(new RegExp(`^${key}="?([^"\\n]+)`, "m"));
    return m ? m[1] : undefined;
  };

  let databaseUrl = process.env.DATABASE_URL || fromEnvFile("DATABASE_URL") || "";
  if (DB_NAME) {
    databaseUrl = databaseUrl.replace(/\?.*$/, "").replace(/\/[^/]*$/, `/${DB_NAME}`);
  }

  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT,
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: databaseUrl,
    JWT_SECRET: process.env.JWT_SECRET || fromEnvFile("JWT_SECRET"),
    FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY || fromEnvFile("FIELD_ENCRYPTION_KEY"),
    BASE_URL: `http://127.0.0.1:${PORT}`,
    // The boot guard rejects a localhost BASE_URL, because every link in
    // outgoing mail would be unreachable for its recipient. This is the
    // explicit opt-out for a local run; it must never be set in a deployment.
    ALLOW_LOCAL_BASE_URL: "1",
    /**
     * 0 = nothing in front of this server. Unset, the server refuses to start:
     * X-Forwarded-For is caller-written, so without knowing how many proxies
     * to trust, the per-IP rate limit in front of login can be bypassed by
     * rotating the header.
     *
     * OVERRIDABLE, AND LOAD TESTING NEEDS IT TO BE.
     *
     * At 0, `clientIpFromForwarded` ignores the header entirely and returns
     * one constant for every request. That is correct for a directly exposed
     * server — but it means a load generator's per-worker `x-forwarded-for`
     * addresses all collapse into a single apparent client, and the per-IP
     * backstop (600 reads/min) starts refusing traffic that the per-user
     * ceiling would have allowed.
     *
     * This was not theoretical: hardcoding 0 here turned a soak from 98.3%
     * into 91.7%, with ~8% of requests returning 429, and the failure looked
     * like an application capacity problem. It was this line. Pass
     * TRUSTED_PROXY_HOPS=1 when driving load with synthetic addresses.
     */
    TRUSTED_PROXY_HOPS: process.env.TRUSTED_PROXY_HOPS ?? "0",
    STORAGE_DRIVER: "local-fs",
    STORAGE_FS_ROOT: process.env.STORAGE_FS_ROOT || join(ROOT, "storage"),
    STORAGE_FS_SHARED: "1",
  };

  if (WITH_MAIL) {
    delete env.EMAIL_DISABLED;
    console.log(
      "\n[start-local] MAIL IS ENABLED. This server will send REAL email to REAL\n" +
        "[start-local] addresses using the SMTP credentials in systemEmailConfig.\n" +
        "[start-local] Anything the application emails — password resets, OTP codes,\n" +
        "[start-local] invitations, notifications — will actually be delivered.\n",
    );
  } else {
    env.EMAIL_DISABLED = "1";
    console.log(
      "\n[start-local] Mail is DISABLED; nothing will leave this machine.\n" +
        "[start-local] One-time codes are printed to this console instead — look for\n" +
        "[start-local] lines beginning with [otp].\n" +
        "[start-local] Pass --mail to send real email.\n",
    );
  }

  const dbLabel = (() => {
    try {
      const u = new URL(databaseUrl);
      return `${u.pathname.slice(1)} on ${u.hostname}:${u.port}`;
    } catch {
      return "(unparseable DATABASE_URL)";
    }
  })();

  console.log(`[start-local] http://127.0.0.1:${PORT}   database: ${dbLabel}\n`);

  const child = spawn(process.execPath, ["server.js"], {
    cwd: STANDALONE,
    env,
    stdio: "inherit",
  });

  // Forward Ctrl-C so the server shuts down cleanly rather than being orphaned.
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => child.kill(sig));
  }
  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}
