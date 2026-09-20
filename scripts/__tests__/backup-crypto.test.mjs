/**
 * A1 / Phase 5 — the backup envelope.
 *
 * WHAT THIS IS GUARDING
 *
 * `db-backup.mjs` writes encrypted dumps and `db-restore.mjs` reads them. They
 * used to carry separate copies of the byte layout, and nothing checked that
 * the two agreed. That kind of duplication is usually harmless; here it is
 * not, because of WHEN the mismatch surfaces. Every nightly backup keeps
 * succeeding. Every monitoring check stays green. The failure appears once, in
 * the middle of a recovery, and an encrypted backup you cannot decrypt is
 * worse than no backup — you planned around it.
 *
 * So the format now lives in one module, and this round-trips it.
 *
 * Run: node --test scripts/__tests__/backup-crypto.test.mjs
 * CI runs `node --test scripts/__tests__/*.test.mjs` on every push.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

import { encryptFile, decryptFile, assertKey, HEADER_BYTES } from "../backup-crypto.mjs";

const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

function workspace() {
  return mkdtempSync(join(tmpdir(), "eitekh-backup-crypto-"));
}

test("a dump survives the round trip byte for byte", async () => {
  const dir = workspace();
  try {
    /**
     * Several megabytes of incompressible random data, not a short string.
     *
     * The envelope is streamed, and a payload that fits in one chunk would
     * exercise none of that — it would pass even if the implementation read
     * the whole file into memory, which is the thing that breaks at exactly
     * the size where backups start to matter.
     */
    const plain = crypto.randomBytes(5 * 1024 * 1024);
    const src = join(dir, "dump");
    const enc = join(dir, "dump.enc");
    const out = join(dir, "dump.restored");
    writeFileSync(src, plain);

    await encryptFile(src, enc, KEY);
    await decryptFile(enc, out, KEY);

    assert.deepEqual(readFileSync(out), plain, "the restored dump differs from the original");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the ciphertext does not contain the plaintext", async () => {
  const dir = workspace();
  try {
    // The point of encrypting at the moment of creation is that the file is
    // unreadable everywhere it subsequently travels. A marker that survives
    // into the output would mean it is not.
    const marker = "tenant-secret-marker-9f2c";
    const src = join(dir, "dump");
    const enc = join(dir, "dump.enc");
    writeFileSync(src, `leading padding ${marker} trailing padding`.repeat(200));

    await encryptFile(src, enc, KEY);

    assert.ok(
      !readFileSync(enc).includes(marker),
      "the plaintext is readable in the encrypted file",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the envelope is a 28-byte header plus the ciphertext", async () => {
  const dir = workspace();
  try {
    const src = join(dir, "dump");
    const enc = join(dir, "dump.enc");
    writeFileSync(src, Buffer.alloc(1024, 7));

    await encryptFile(src, enc, KEY);

    // GCM is a stream cipher, so ciphertext length equals plaintext length.
    // Any other size means the layout moved, which is exactly the change that
    // would silently break the other script if the two were still separate.
    assert.equal(statSync(enc).size, 1024 + HEADER_BYTES);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two encryptions of the same file differ", async () => {
  const dir = workspace();
  try {
    // A reused IV under one key is a catastrophic failure for GCM — it leaks
    // the XOR of the plaintexts and breaks the authentication entirely. Nightly
    // backups of a slow-changing database are precisely the workload that
    // would expose it.
    const src = join(dir, "dump");
    writeFileSync(src, Buffer.alloc(4096, 3));
    const a = join(dir, "a.enc");
    const b = join(dir, "b.enc");

    await encryptFile(src, a, KEY);
    await encryptFile(src, b, KEY);

    assert.notDeepEqual(
      readFileSync(a).subarray(0, 12),
      readFileSync(b).subarray(0, 12),
      "the IV was reused across two encryptions",
    );
    assert.notDeepEqual(readFileSync(a), readFileSync(b));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a wrong key fails loudly and leaves no plaintext behind", async () => {
  const dir = workspace();
  try {
    const src = join(dir, "dump");
    const enc = join(dir, "dump.enc");
    const out = join(dir, "dump.restored");
    writeFileSync(src, Buffer.alloc(64 * 1024, 1));
    await encryptFile(src, enc, KEY);

    await assert.rejects(() => decryptFile(enc, out, OTHER_KEY), /Decryption FAILED/);

    /**
     * The file must be gone, not merely wrong.
     *
     * GCM only reports authentication failure at the END of the stream, so a
     * decrypt with the wrong key writes a full-length file of garbage to disk
     * before anything complains. Leaving that behind is how a corrupt
     * "dump.decrypted" gets fed to pg_restore by someone retrying under
     * pressure.
     */
    assert.equal(
      statSync(out, { throwIfNoEntry: false }),
      undefined,
      "an unauthenticated plaintext was left on disk",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a tampered dump is rejected rather than restored", async () => {
  const dir = workspace();
  try {
    const src = join(dir, "dump");
    const enc = join(dir, "dump.enc");
    const out = join(dir, "dump.restored");
    writeFileSync(src, Buffer.alloc(64 * 1024, 9));
    await encryptFile(src, enc, KEY);

    // Flip one byte of ciphertext. This is the reason for GCM over a mode
    // without authentication: an unauthenticated backup can be altered in
    // transit or at rest and will restore without complaint.
    const buf = readFileSync(enc);
    buf[HEADER_BYTES + 100] ^= 0xff;
    writeFileSync(enc, buf);

    await assert.rejects(() => decryptFile(enc, out, KEY), /Decryption FAILED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a truncated file is reported as such, not as a wrong key", async () => {
  const dir = workspace();
  try {
    // A truncated upload and a wrong key are different problems with different
    // fixes, and telling an operator "wrong key" when the transfer was cut
    // short sends them hunting for a key that was never the issue.
    const enc = join(dir, "short.enc");
    writeFileSync(enc, Buffer.alloc(10));

    await assert.rejects(() => decryptFile(enc, join(dir, "out"), KEY), /too short/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a malformed key is refused before any file is written", () => {
  // Buffer.from("oops", "hex") returns an EMPTY buffer rather than throwing,
  // so an unvalidated typo would reach createCipheriv as a zero-length key.
  assert.throws(() => assertKey("oops"), /64 hex characters/);
  assert.throws(() => assertKey("a".repeat(63)), /64 hex characters/);
  assert.throws(() => assertKey("z".repeat(64)), /64 hex characters/);
  assert.throws(() => assertKey(undefined), /64 hex characters/);
  assert.equal(assertKey(KEY).length, 32);
});
