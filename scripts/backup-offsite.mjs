/**
 * A1 / Phase 5 — copy a backup off the host, and prove it arrived.
 *
 * WHY
 *
 * Every version of the backup documentation in this repository has ended with
 * "copy this off-host", and nothing did it. A backup on the same disk as the
 * database does not survive the failure it exists for: disk loss, host loss,
 * ransomware that walks the filesystem, or a cloud account action that takes
 * the instance and its volumes together. `BACKUP_RETAIN` prunes locally and
 * that is all it does.
 *
 * An instruction in a document that nobody has automated is a plan, and a plan
 * that has never run is a guess.
 *
 * WHAT THIS REFUSES TO DO
 *
 * It will not reuse the application's attachment bucket by default, and says
 * so loudly if you point it there. Backups and user uploads in one bucket
 * under one key means a single compromised application credential loses the
 * data AND the copy you would recover from — and ransomware is the case where
 * that matters, because it goes looking. Separate bucket, separate
 * credentials, and ideally object-lock or versioning on the backup bucket so
 * that a key which can write cannot also erase history.
 *
 * WHAT IT VERIFIES
 *
 * That the object is THERE and the right size, by reading its metadata back
 * afterwards. An upload that returns 200 having written nothing is a real
 * failure mode — a truncated stream, a proxy that buffered and gave up, a
 * bucket policy that silently discards. Without a read-back, the first time
 * you learn is during a restore.
 *
 * It does not verify that the bytes are correct end to end; for that, restore
 * it. `scripts/db-restore.mjs --verify` is the check that means something, and
 * this script prints the command.
 *
 * Usage:
 *   node scripts/backup-offsite.mjs --file backups/<dump>.enc
 *   node scripts/backup-offsite.mjs --file <dump> --prune 14
 *   node scripts/backup-offsite.mjs --list
 *
 * Environment (deliberately NOT the S3_* variables the app uses):
 *   BACKUP_S3_BUCKET             required
 *   BACKUP_S3_REGION             required
 *   BACKUP_S3_ACCESS_KEY_ID      required
 *   BACKUP_S3_SECRET_ACCESS_KEY  required
 *   BACKUP_S3_ENDPOINT           for MinIO, R2, B2 and anything not AWS
 *   BACKUP_S3_PREFIX             key prefix, default "db/"
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

function die(message, code = 1) {
  console.error(`\n[offsite] ${message}\n`);
  process.exitCode = code;
  return null;
}

/**
 * The SDK is a dependency of the application, not of this script.
 *
 * Required lazily and with a real message, because the host that runs backups
 * is frequently not the host that runs `npm install` for the app, and
 * "Cannot find module '@aws-sdk/client-s3'" tells an operator nothing about
 * what to do next.
 */
function loadSdk() {
  try {
    return require("@aws-sdk/client-s3");
  } catch {
    return die(
      "@aws-sdk/client-s3 is not installed on this host.\n" +
        "  npm install @aws-sdk/client-s3\n" +
        "It is a dependency of the application; a backup host that only runs these\n" +
        "scripts may not have it.",
      2,
    );
  }
}

function config() {
  const bucket = process.env.BACKUP_S3_BUCKET?.trim();
  const region = process.env.BACKUP_S3_REGION?.trim();
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY?.trim();
  const endpoint = process.env.BACKUP_S3_ENDPOINT?.trim() || undefined;
  const prefix = (process.env.BACKUP_S3_PREFIX ?? "db/").replace(/^\/+/, "");

  const missing = [
    !bucket && "BACKUP_S3_BUCKET",
    !region && "BACKUP_S3_REGION",
    !accessKeyId && "BACKUP_S3_ACCESS_KEY_ID",
    !secretAccessKey && "BACKUP_S3_SECRET_ACCESS_KEY",
  ].filter(Boolean);

  if (missing.length) {
    return die(
      `Missing: ${missing.join(", ")}.\n\n` +
        "These are deliberately separate from the application's S3_* variables. Backups\n" +
        "and user uploads under one credential means one compromised application key\n" +
        "loses both the data and the copy you would recover from.",
      2,
    );
  }

  /**
   * Refuse the application's own bucket unless forced.
   *
   * This is the shortcut everyone takes, because the credentials are already
   * to hand. It is also the one that makes the offsite copy worthless in the
   * scenario it exists for.
   */
  if (
    process.env.S3_BUCKET &&
    process.env.S3_BUCKET.trim() === bucket &&
    !argv.includes("--same-bucket-i-understand")
  ) {
    return die(
      `BACKUP_S3_BUCKET is the same bucket as the application's S3_BUCKET ("${bucket}").\n\n` +
        "One compromised application credential would then reach the data AND the\n" +
        "backups. Use a separate bucket with its own credentials, ideally with object\n" +
        "lock or versioning so a key that can write cannot erase history.\n\n" +
        "If this is genuinely intended, pass --same-bucket-i-understand.",
      2,
    );
  }

  return { bucket, region, accessKeyId, secretAccessKey, endpoint, prefix };
}

function makeClient(S3Client, cfg) {
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    // Path style for everything that is not AWS: MinIO, Ceph and most
    // on-premise gateways do not do virtual-host addressing, and the failure
    // is a DNS error that looks nothing like a configuration problem.
    forcePathStyle: Boolean(cfg.endpoint),
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

async function upload(cfg, sdk) {
  const { S3Client, PutObjectCommand, HeadObjectCommand } = sdk;

  const file = resolve(argOf("--file", ""));
  if (!file || !existsSync(file)) {
    return die("--file is required and must exist.", 2);
  }

  const st = statSync(file);
  if (st.size === 0) {
    // A zero-byte dump is a failed dump. Uploading it would replace a good
    // remote copy with a worthless one on the next prune.
    return die("That file is empty. Refusing to upload a zero-byte backup.", 2);
  }

  const name = basename(file);
  const key = `${cfg.prefix}${name}`;

  if (!name.endsWith(".enc")) {
    console.warn(
      "[offsite] WARNING: this dump is NOT encrypted (no .enc suffix). It contains every\n" +
        "[offsite] tenant's data in the clear and is about to leave this host. Set\n" +
        "[offsite] BACKUP_ENCRYPTION_KEY when taking it unless the destination's\n" +
        "[offsite] encryption at rest is genuinely sufficient for your obligations.",
    );
  }

  const client = makeClient(S3Client, cfg);
  console.log(`[offsite] uploading ${name} (${(st.size / 1024 / 1024).toFixed(2)} MB) -> s3://${cfg.bucket}/${key}`);

  const started = Date.now();
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: createReadStream(file),
        ContentLength: st.size,
        ContentType: "application/octet-stream",
      }),
    );
  } catch (err) {
    // Never print the credentials; the SDK does not, but a naive dump of the
    // error object elsewhere would.
    return die(`Upload failed: ${err.name}: ${err.message}`, 1);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  /**
   * Read it back. This is the point of the script.
   *
   * A PUT that returns without throwing is not evidence the object exists at
   * the right size — a truncated stream, a buffering proxy that gave up, or a
   * bucket policy that quietly discards all produce a clean-looking success.
   * Without this check the first time anyone finds out is during a restore.
   */
  let head;
  try {
    head = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
  } catch (err) {
    return die(
      `The upload reported success, but the object could not be read back: ${err.name}.\n` +
        "Treat this backup as NOT stored.",
      1,
    );
  }

  if (Number(head.ContentLength) !== st.size) {
    return die(
      `Size mismatch: local ${st.size} bytes, remote ${head.ContentLength} bytes.\n` +
        "The copy is incomplete. Treat this backup as NOT stored.",
      1,
    );
  }

  console.log(`[offsite] verified: ${head.ContentLength} bytes at s3://${cfg.bucket}/${key} (${seconds}s)`);
  console.log(
    "\n[offsite] Stored is not the same as restorable. The only check that means\n" +
      "[offsite] anything is a restore:\n" +
      "[offsite]   node scripts/db-restore.mjs --file <downloaded> --url <scratch-db> --verify <source>\n",
  );

  const prune = argOf("--prune", null);
  if (prune) await pruneRemote(cfg, sdk, Number(prune));

  console.log(JSON.stringify({ bucket: cfg.bucket, key, bytes: Number(head.ContentLength), seconds: Number(seconds) }));
  return true;
}

async function listRemote(cfg, sdk) {
  const { S3Client, ListObjectsV2Command } = sdk;
  const client = makeClient(S3Client, cfg);
  const out = [];
  let token;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: cfg.prefix, ContinuationToken: token }),
    );
    for (const o of page.Contents ?? []) out.push(o);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out.sort((a, b) => b.LastModified - a.LastModified);
}

async function pruneRemote(cfg, sdk, keep) {
  const { S3Client, DeleteObjectCommand } = sdk;
  if (!Number.isInteger(keep) || keep < 1) {
    return die("--prune needs a whole number of backups to keep, at least 1.", 2);
  }
  const objects = await listRemote(cfg, sdk);
  const doomed = objects.slice(keep);
  if (doomed.length === 0) {
    console.log(`[offsite] ${objects.length} remote backup(s); nothing to prune (keeping ${keep}).`);
    return;
  }
  const client = makeClient(S3Client, cfg);
  for (const o of doomed) {
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: o.Key }));
    console.log(`[offsite] pruned ${o.Key}`);
  }
  console.log(`[offsite] ${keep} remote backup(s) retained.`);
}

async function main() {
  const sdk = loadSdk();
  if (!sdk) return;
  const cfg = config();
  if (!cfg) return;

  if (argv.includes("--list")) {
    const objects = await listRemote(cfg, sdk);
    if (objects.length === 0) {
      console.log(`[offsite] no backups under s3://${cfg.bucket}/${cfg.prefix}`);
      console.log(
        "[offsite] An empty list here is a finding, not a formality: it means nothing\n" +
          "[offsite] has been copied off this host.",
      );
      return;
    }
    for (const o of objects) {
      console.log(
        `${o.LastModified.toISOString()}  ${String(o.Size).padStart(12)}  ${o.Key}`,
      );
    }
    console.log(`\n[offsite] ${objects.length} remote backup(s). Newest: ${objects[0].LastModified.toISOString()}`);
    return;
  }

  await upload(cfg, sdk);
}

main().catch((err) => {
  console.error(`\n[offsite] ${err.name}: ${err.message}\n`);
  process.exitCode = 1;
});
// process.exitCode, never process.exit(): the latter races the closing
// sockets of the S3 client and trips a libuv assertion on Windows.
