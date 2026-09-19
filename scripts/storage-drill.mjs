/**
 * B3 — prove the configured object store actually works.
 *
 * WHY THIS EXISTS
 *
 * The filesystem backend was verified end to end. The S3 backend was not: it
 * type-checked, its configuration had unit tests, and no byte had ever moved
 * through `PutObjectCommand`. That is precisely the gap where presigning
 * fails — a wrong region, a clock skew, path-style versus virtual-host
 * addressing, a bucket policy — and every one of them surfaces as the same
 * opaque `SignatureDoesNotMatch` with no indication which.
 *
 * Unit tests cannot find any of that, because the thing being tested is an
 * agreement with a server. So this drives the REAL backend against a REAL
 * endpoint, in the shape the application uses it.
 *
 * WHAT IT ASSERTS
 *
 *   1. bytes round-trip EXACTLY, including high bytes a text path would mangle
 *   2. a presigned URL can actually be redeemed over HTTP by something that
 *      holds no credentials — which is the whole point of handing one to a
 *      browser
 *   3. the URL carries the filename and content type the user should see
 *   4. `exists` tells the truth before and after
 *   5. delete is idempotent, so a retry converges
 *   6. a traversal key is refused BEFORE it reaches the backend
 *   7. an overwrite replaces rather than appends
 *
 * WHAT IT NEEDS
 *
 * Whatever STORAGE_DRIVER is configured. Against MinIO that is a single
 * binary and no cloud account, which is what keeps this runnable:
 *
 *   minio.exe server ./data --address :9000
 *   STORAGE_DRIVER=s3 S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=... \
 *     S3_REGION=us-east-1 S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
 *     node scripts/storage-drill.mjs
 *
 * Usage: node scripts/storage-drill.mjs [--create-bucket]
 */

import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const argv = process.argv.slice(2);
const CREATE_BUCKET = argv.includes("--create-bucket");

const { resolveStorage } = await import(
  pathToFileURL(join(process.cwd(), "src", "lib", "storage", "factory.ts")).href
);
const { assertSafeKey } = await import(
  pathToFileURL(join(process.cwd(), "src", "lib", "storage", "index.ts")).href
);

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "  -- " + detail : ""));
  if (ok) pass += 1;
  else fail += 1;
}

const { backend, errors, warnings } = resolveStorage(process.env);
for (const w of warnings) console.log(`[storage-drill] warning: ${w}`);
if (!backend) {
  console.error("\n[storage-drill] no backend configured:\n  " + errors.join("\n  ") + "\n");
  process.exit(2);
}
console.log(`[storage-drill] backend: ${backend.name}`);
console.log(`[storage-drill] shared across instances: ${backend.isSharedAcrossInstances}\n`);

/**
 * MinIO starts with no buckets, and creating one is not the application's job
 * — it is the operator's. This flag exists so the drill can set itself up in
 * a scratch environment without pretending the app would do that.
 */
if (CREATE_BUCKET && process.env.S3_BUCKET) {
  const { S3Client, CreateBucketCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
    console.log(`[storage-drill] created bucket ${process.env.S3_BUCKET}\n`);
  } catch (err) {
    const name = err?.name || "";
    if (/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(name)) {
      console.log(`[storage-drill] bucket ${process.env.S3_BUCKET} already exists\n`);
    } else {
      console.error(`[storage-drill] could not create the bucket: ${err?.message || err}\n`);
      process.exit(2);
    }
  }
}

const runId = crypto.randomBytes(6).toString("hex");
const key = `attachments/dr/storage-drill-${runId}`;

/**
 * Deliberately binary, and deliberately containing the bytes a text path
 * mangles: a null, a 0xFF, and a lone high byte that is not valid UTF-8. A
 * backend that round-trips "hello" can still corrupt a PDF.
 */
const payload = Buffer.concat([
  Buffer.from("PDF-ish header\n"),
  Buffer.from([0x00, 0xff, 0x80, 0x7f, 0xfe, 0x01]),
  crypto.randomBytes(4096),
]);
const digest = (b) => crypto.createHash("sha256").update(b).digest("hex");
const expected = digest(payload);

try {
  // ------------------------------------------------------------------ 1
  const putResult = await backend.put(key, payload, "application/pdf");
  check("put reports the size it wrote", putResult.size === payload.byteLength,
    `${putResult.size} bytes`);

  check("exists() is true after a put", await backend.exists(key));

  // ------------------------------------------------------------------ 2
  const target = await backend.read(key, {
    fileName: "quarterly report.pdf",
    contentType: "application/pdf",
  });
  console.log(`[storage-drill] read target: ${target.kind}`);

  let roundTripped;
  if (target.kind === "redirect") {
    /**
     * Fetched with NO credentials, on purpose. That is what a browser does
     * with the redirect, and it is the only way to know the signature is
     * genuinely valid rather than merely well-formed.
     */
    const res = await fetch(target.url);
    check("the presigned URL can be redeemed without credentials", res.ok, `HTTP ${res.status}`);
    if (!res.ok) throw new Error(`presigned GET returned ${res.status}`);
    roundTripped = Buffer.from(await res.arrayBuffer());

    check(
      "the signed URL expires (it is not a permanent public link)",
      /[?&]X-Amz-Expires=\d+/.test(target.url) && target.expiresInSeconds > 0,
      `expires in ${target.expiresInSeconds}s`
    );
    check(
      "the download carries the user's filename, not the opaque key",
      /quarterly/i.test(res.headers.get("content-disposition") || ""),
      res.headers.get("content-disposition") || "(none)"
    );
    check(
      "the download carries the declared content type",
      (res.headers.get("content-type") || "").includes("pdf"),
      res.headers.get("content-type") || "(none)"
    );
  } else {
    const chunks = [];
    const reader = target.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    roundTripped = Buffer.concat(chunks);
    check("stream reported the right size", target.size === payload.byteLength);
  }

  check(
    "bytes round-trip EXACTLY, including nulls and high bytes",
    digest(roundTripped) === expected,
    `${roundTripped.byteLength} bytes back, sha256 ${digest(roundTripped).slice(0, 12)}…`
  );

  // ------------------------------------------------------------------ 7
  const replacement = Buffer.from("REPLACED");
  await backend.put(key, replacement, "text/plain");
  const after = await backend.read(key);
  let afterBytes;
  if (after.kind === "redirect") {
    afterBytes = Buffer.from(await (await fetch(after.url)).arrayBuffer());
  } else {
    const chunks = [];
    const reader = after.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    afterBytes = Buffer.concat(chunks);
  }
  check(
    "an overwrite REPLACES rather than appends",
    afterBytes.equals(replacement),
    `${afterBytes.byteLength} bytes`
  );

  // ------------------------------------------------------------------ 5
  await backend.delete(key);
  check("exists() is false after delete", (await backend.exists(key)) === false);
  await backend.delete(key);
  check("deleting twice is not an error (a retry converges)", true);

  // ------------------------------------------------------------------ 6
  let refused = false;
  try {
    assertSafeKey("../../etc/passwd");
  } catch {
    refused = true;
  }
  check("a traversal key is refused before it reaches the backend", refused);

  let backendRefused = false;
  try {
    await backend.put("../escaped", Buffer.from("x"), "text/plain");
  } catch {
    backendRefused = true;
  }
  check("and the backend refuses it too, independently", backendRefused);
} catch (err) {
  console.error(`\n[storage-drill] error: ${err?.message || err}`);
  fail += 1;
} finally {
  try {
    await backend.delete(key);
  } catch {
    /* best effort */
  }
}

/**
 * Release every socket pool before exiting.
 *
 * Without this, `process.exit()` races a live handle and Node aborts on
 * Windows with a libuv assertion — printed AFTER the work has already
 * succeeded and the exit code has already been set to 0. Noise that looks
 * like a crash but isn't is the most misleading output a drill can produce.
 *
 * There are TWO pools, which is why the first attempt at this did not work.
 * Closing the S3 client was not enough: redeeming a presigned URL uses
 * `fetch`, whose keep-alive connections belong to Node's global undici
 * dispatcher, not to the SDK. That is the one still holding a handle.
 *
 * The dispatcher is reachable only through a well-known symbol, so this is
 * guarded — a Node version that moves it should make the drill print an
 * assertion again, not fail.
 */
await backend.close?.();
await closeGlobalFetchPool();

async function closeGlobalFetchPool() {
  try {
    const dispatcher = globalThis[Symbol.for("undici.globalDispatcher.1")];
    if (dispatcher && typeof dispatcher.close === "function") await dispatcher.close();
  } catch {
    /* best effort: this is tidiness, not correctness */
  }
}

console.log(`\n[storage-drill] ${pass} passed, ${fail} failed`);
/**
 * exitCode rather than exit().
 *
 * process.exit() tears the process down immediately, racing any socket that
 * has not finished closing — which on Windows surfaces as a libuv assertion
 * printed after the run has already succeeded. Closing the pools first helped
 * but did not remove the race; it appeared on two runs out of three.
 *
 * Setting the code and letting Node exit when the loop drains has no race at
 * all, and if something ever DOES hold the loop open, a script that hangs is
 * a better signal than one that aborts with a message resembling a crash.
 */
process.exitCode = fail === 0 ? 0 : 1;
