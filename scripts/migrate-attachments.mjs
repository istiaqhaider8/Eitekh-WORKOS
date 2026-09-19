/**
 * B3 — move attachment bytes out of the database and into the object store.
 *
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION
 *
 * A SQL migration runs inside a deployment, holds a transaction, and either
 * finishes or rolls back. This moves bytes to a different system entirely: it
 * can take hours, it touches a network, it will fail partway at least once,
 * and it must be safe to run again afterwards. None of that belongs in
 * `migrate deploy`.
 *
 * So migration 0012 adds a nullable column and this fills it, on its own
 * schedule, while every row stays servable throughout — the content route
 * reads from the store when `storageKey` is set and from `fileUrl` when it is
 * not.
 *
 * SAFETY, AND THE ORDER THAT MAKES IT SAFE
 *
 * For each attachment:
 *
 *   1. decode the base64 from `fileUrl`
 *   2. PUT it into the store
 *   3. read it BACK and compare a hash of the bytes
 *   4. only then set `storageKey`
 *
 * The database is not touched until the bytes are provably readable from their
 * new home. A crash at any point leaves a row that still serves from
 * `fileUrl`, and the worst case is an orphaned object — which costs storage,
 * not data.
 *
 * `fileUrl` is deliberately NOT cleared. Dropping the old copy is a separate,
 * later decision, taken once the store has been backed up in its own right.
 * One irreversible step at a time.
 *
 * Usage:
 *   node scripts/migrate-attachments.mjs [--db <url>] [--limit N] [--dry-run]
 *
 * Reads STORAGE_DRIVER and friends from the environment, exactly as the
 * application does.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import crypto from "node:crypto";

const require_ = createRequire(import.meta.url);
const { PrismaClient } = require_("@prisma/client");

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};
const DRY_RUN = argv.includes("--dry-run");
const LIMIT = Number(argOf("--limit", "0")) || 0;

function envDatabaseUrl() {
  try {
    return readFileSync(".env", "utf8").match(/^DATABASE_URL="?([^"\n]+)/m)?.[1];
  } catch {
    return undefined;
  }
}
const DB = argOf("--db", process.env.DATABASE_URL || envDatabaseUrl());
if (!DB) {
  console.error("\n[attachments] no database URL. Pass --db or set DATABASE_URL.\n");
  process.exit(2);
}

/**
 * The APPLICATION's storage configuration, imported rather than reimplemented.
 *
 * Same reasoning as rotate-drill.mjs importing the encryption module: a
 * migration that writes keys the application would not read is a migration
 * that produces unreachable files. Needs Node's native type stripping
 * (>= 22.18; see engines in package.json).
 */
const { resolveStorage } = await import(
  pathToFileURL(join(process.cwd(), "src", "lib", "storage", "factory.ts")).href
);
const { attachmentKey, decodeDataUri } = await import(
  pathToFileURL(join(process.cwd(), "src", "lib", "storage", "index.ts")).href
);

const { backend, errors } = resolveStorage(process.env);
for (const e of errors) console.error(`[attachments] ${e}`);
if (!backend) {
  console.error(
    "\n[attachments] No storage backend is configured, so there is nowhere to move\n" +
      "[attachments] the bytes to. Set STORAGE_DRIVER and its settings.\n"
  );
  process.exit(2);
}

const prisma = new PrismaClient({ datasources: { db: { url: DB } } });

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

let moved = 0;
let skippedExternal = 0;
let skippedUnknown = 0;
let failed = 0;
let bytesMoved = 0;

async function main() {
  console.log(`[attachments] store: ${backend.name}`);
  if (DRY_RUN) console.log("[attachments] DRY RUN — nothing will be written\n");

  const pending = await prisma.attachment.findMany({
    where: { storageKey: null },
    select: { id: true, fileName: true, mimeType: true, fileUrl: true, fileSize: true },
    orderBy: { createdAt: "asc" },
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  const total = await prisma.attachment.count();
  console.log(
    `[attachments] ${pending.length} of ${total} attachment(s) not yet in the store\n`
  );

  for (const row of pending) {
    // Already somewhere else on the internet: nothing to move, and rewriting
    // it would be taking custody of a file we do not own.
    if (/^https?:\/\//i.test(row.fileUrl || "")) {
      skippedExternal += 1;
      continue;
    }

    const decoded = decodeDataUri(row.fileUrl);
    if (!decoded) {
      skippedUnknown += 1;
      console.warn(
        `[attachments] ${row.id}: fileUrl is neither a data: URI nor an http(s) URL; left alone`
      );
      continue;
    }

    const key = attachmentKey(row.id);
    const expected = sha256(decoded.bytes);

    if (DRY_RUN) {
      console.log(
        `[attachments] would move ${row.id} (${decoded.bytes.byteLength} bytes) -> ${key}`
      );
      moved += 1;
      bytesMoved += decoded.bytes.byteLength;
      continue;
    }

    try {
      await backend.put(key, decoded.bytes, row.mimeType || decoded.mime);

      /**
       * Read it back before recording the move.
       *
       * A PUT that returns without error is not proof the object is there and
       * intact — and this is the one moment where being wrong loses a file,
       * because after `storageKey` is set the route stops looking at
       * `fileUrl`.
       */
      const target = await backend.read(key);
      let roundTripped;
      if (target.kind === "stream") {
        const chunks = [];
        const reader = target.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
        }
        roundTripped = Buffer.concat(chunks);
      } else {
        const res = await fetch(target.url);
        if (!res.ok) throw new Error(`signed URL read returned ${res.status}`);
        roundTripped = Buffer.from(await res.arrayBuffer());
      }

      if (sha256(roundTripped) !== expected) {
        throw new Error(
          `content mismatch after write: ${decoded.bytes.byteLength} bytes in, ` +
            `${roundTripped.byteLength} bytes back`
        );
      }

      // Only now. `fileUrl` is left in place deliberately.
      await prisma.attachment.update({ where: { id: row.id }, data: { storageKey: key } });

      moved += 1;
      bytesMoved += decoded.bytes.byteLength;
      if (moved % 25 === 0) console.log(`[attachments] ${moved} moved...`);
    } catch (err) {
      failed += 1;
      console.error(`[attachments] ${row.id}: FAILED — ${err?.message || err}`);
      // Keep going. One unreadable row must not stop the rest, and the row is
      // still servable from fileUrl.
    }
  }
}

try {
  await main();
} catch (err) {
  console.error("\n[attachments] fatal:", err?.message || err);
  failed += 1;
} finally {
  await prisma.$disconnect();
  // Same reason as the drill: an open S3 socket pool plus process.exit()
  // aborts Node on Windows, after the migration has already succeeded.
  await backend.close?.();
}

const mb = (bytesMoved / 1048576).toFixed(2);
console.log(
  `\n[attachments] ${moved} moved (${mb} MB), ${skippedExternal} already external, ` +
    `${skippedUnknown} unrecognised, ${failed} failed`
);
if (!DRY_RUN && moved > 0) {
  console.log(
    "[attachments] fileUrl was NOT cleared. Verify the store has its own backup,\n" +
      "[attachments] then drop the column in a separate migration."
  );
}
process.exit(failed === 0 ? 0 : 1);
