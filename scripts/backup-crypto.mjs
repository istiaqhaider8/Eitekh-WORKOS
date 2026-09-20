/**
 * A1 / Phase 5 — the backup envelope, defined once.
 *
 * WHY THIS FILE EXISTS
 *
 * `db-backup.mjs` encrypted and `db-restore.mjs` decrypted, each with its own
 * copy of the byte layout: the offsets, the order of IV and tag, the
 * reserve-header-then-backfill trick. Two independent implementations of one
 * format, and nothing compared them.
 *
 * That is a bad place for duplication. A mismatch does not fail a build, fail
 * a test or fail at backup time — every nightly dump would keep succeeding.
 * It fails once, during a restore, which is the moment you have no second
 * option and no time to debug a byte layout. An encrypted backup that cannot
 * be decrypted is strictly worse than no backup, because you believed in it.
 *
 * So the format lives here, both scripts call it, and
 * `scripts/__tests__/backup-crypto.test.mjs` round-trips it in CI.
 *
 * THE FORMAT
 *
 *   [ 0 .. 12 )  IV          12 bytes, random per file
 *   [ 12 .. 28 ) auth tag    16 bytes, GCM
 *   [ 28 ..   )  ciphertext  AES-256-GCM
 *
 * The tag is only known once the whole stream has been read, so the header is
 * reserved up front and written in a second pass. The alternative — appending
 * the tag — would mean a decrypting reader has to seek to the end of a
 * possibly multi-gigabyte file before it can begin, which is worse.
 *
 * Streamed throughout: a dump that has to fit in memory is a dump that stops
 * working at exactly the size where backups start to matter.
 *
 * THE KEY IS NOT THE FIELD ENCRYPTION KEY. A backup an attacker who took the
 * application key can also read has not moved the risk anywhere.
 */

import { createReadStream, createWriteStream, rmSync, existsSync } from "node:fs";
import { open } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import crypto from "node:crypto";

/** IV + tag. Both scripts used to spell this 28 out by hand, in four places. */
export const HEADER_BYTES = 28;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * A key is 32 bytes written as 64 hex characters.
 *
 * Validated rather than coerced: `Buffer.from("oops", "hex")` returns an empty
 * buffer instead of throwing, so a typo'd key would otherwise reach
 * createCipheriv as a zero-length buffer and produce a confusing error at the
 * wrong altitude — or, worse, a caller might treat the failure as "encryption
 * unavailable" and write plaintext.
 */
export function assertKey(keyHex, what = "BACKUP_ENCRYPTION_KEY") {
  if (typeof keyHex !== "string" || !/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error(`${what} must be 64 hex characters (32 bytes).`);
  }
  return Buffer.from(keyHex, "hex");
}

/**
 * Encrypt `plaintextPath` to `encPath`.
 *
 * Does NOT delete the plaintext — the caller decides that, because only the
 * caller knows whether the plaintext is a file it created or one the operator
 * handed it.
 */
export async function encryptFile(plaintextPath, encPath, keyHex) {
  const key = assertKey(keyHex);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const out = createWriteStream(encPath);
  out.write(Buffer.alloc(HEADER_BYTES)); // reserved; backfilled below
  await pipeline(createReadStream(plaintextPath), cipher, out);

  const tag = cipher.getAuthTag();
  const handle = await open(encPath, "r+");
  try {
    await handle.write(Buffer.concat([iv, tag]), 0, HEADER_BYTES, 0);
  } finally {
    await handle.close();
  }
  return encPath;
}

/**
 * Decrypt `encPath` to `plaintextPath`.
 *
 * Throws on a wrong key or a tampered file, and removes the partial output
 * first. GCM only reports authentication failure at the END of the stream, so
 * by the time we know, a plausible-looking but unauthenticated plaintext is
 * already on disk. Handing that to `pg_restore` is the one outcome worth
 * ruling out completely.
 */
export async function decryptFile(encPath, plaintextPath, keyHex) {
  const key = assertKey(keyHex);

  const header = Buffer.alloc(HEADER_BYTES);
  const h = await open(encPath, "r");
  try {
    const { bytesRead } = await h.read(header, 0, HEADER_BYTES, 0);
    if (bytesRead < HEADER_BYTES) {
      throw new Error("This file is too short to be an encrypted dump — it has no envelope header.");
    }
  } finally {
    await h.close();
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, header.subarray(0, IV_BYTES));
  decipher.setAuthTag(header.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));

  try {
    await pipeline(
      createReadStream(encPath, { start: HEADER_BYTES }),
      decipher,
      createWriteStream(plaintextPath),
    );
  } catch (err) {
    try {
      if (existsSync(plaintextPath)) rmSync(plaintextPath);
    } catch {
      // Best effort. The throw below is what matters.
    }
    throw new Error(
      "Decryption FAILED — wrong key, or the dump was corrupted or tampered with. " +
        `(${err.message})`,
    );
  }
  return plaintextPath;
}
