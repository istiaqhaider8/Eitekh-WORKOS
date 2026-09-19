/**
 * Start the local verification Postgres.
 *
 * This exists because there is no Docker or system Postgres on this machine,
 * and PROD-1 onwards cannot be *verified* without a real server — only
 * prepared. It runs an embedded PostgreSQL 18 against a persistent data
 * directory, so the database survives restarts of this script.
 *
 * It is a DEVELOPMENT AND VERIFICATION tool, not a deployment. Production uses
 * a managed Postgres named by DATABASE_URL; see PROD-20.
 *
 * Usage:
 *   node scripts/dev-postgres.mjs          # start and stay in the foreground
 *   node scripts/dev-postgres.mjs --stop   # stop whatever is listening
 *
 * The process must stay alive for the server to stay up: embedded-postgres
 * shuts the server down when its parent exits.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * embedded-postgres is installed with --no-save, so ANY later `npm install`
 * prunes it and kills the running server. That happened twice while building
 * Phase A, each time as a confusing "Can't reach database server" in the
 * middle of unrelated work.
 *
 * It is deliberately not a devDependency: it downloads a full PostgreSQL
 * distribution, and imposing that on everyone who runs `npm ci` is a poor
 * trade for a local convenience. Reinstalling on demand is the cheaper fix.
 */
if (!existsSync("node_modules/embedded-postgres/package.json")) {
  console.log("[dev-postgres] embedded-postgres is missing (a prior npm install pruned it) — reinstalling");
  const r = spawnSync("npm", ["install", "--no-save", "embedded-postgres"], { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error("[dev-postgres] reinstall failed. Run: npm install --no-save embedded-postgres");
    process.exit(1);
  }
}

const EmbeddedPostgresModule = await import("embedded-postgres");
const EmbeddedPostgres = EmbeddedPostgresModule.default?.default ?? EmbeddedPostgresModule.default ?? EmbeddedPostgresModule;

const DATA_DIR = process.env.DEV_PGDATA || "C:/Users/ASUS/AppData/Local/Temp/pgdata";
const PORT = Number(process.env.DEV_PGPORT || 54329);

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: "postgres",
  port: PORT,
  // Never re-initialise: the data directory holds the migrated PBAC model and
  // the development dataset. Wiping it would be silent data loss.
  persistent: true,
});

if (process.argv.includes("--stop")) {
  await pg.stop().catch(() => {});
  console.log(`[dev-postgres] stopped (port ${PORT})`);
  process.exit(0);
}

await pg.start();
console.log(`[dev-postgres] listening on 127.0.0.1:${PORT}, data dir ${DATA_DIR}`);
console.log("[dev-postgres] leave this process running; stopping it stops the server.");

const shutdown = async () => {
  await pg.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Keep the event loop alive.
setInterval(() => {}, 1 << 30);
