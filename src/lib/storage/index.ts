/**
 * B3 — where uploaded files actually live.
 *
 * WHAT IS WRONG TODAY
 *
 * `Attachment.fileUrl` holds a base64 `data:` URI. Every uploaded file is a
 * string in a Postgres column, which means one upload inflates four things at
 * once:
 *
 *   - the database, by ~4/3 the file size, in a table that is then read,
 *     vacuumed and indexed alongside real rows
 *   - every backup, and therefore every restore, and therefore the RTO
 *   - replication, if there is ever a replica
 *   - server memory, because a base64 column is read whole; there is no
 *     streaming a substring of a Postgres text value
 *
 * On a public host that is also an amplification vector: the cost of an upload
 * to the attacker is one request, and the cost to the operator is paid on
 * every backup from then on.
 *
 * THE SHAPE OF THE FIX
 *
 * A key in a store, not bytes in a row. `Attachment.storageKey` names an
 * object; the bytes are somewhere that is built for bytes. The route that
 * serves content already anticipated this — its own comment says that once
 * objects live in a store, it "becomes a redirect to a signed URL and nothing
 * else changes".
 *
 * WHY AN INTERFACE RATHER THAN CALLING S3 DIRECTLY
 *
 * Three reasons, in order of how much they cost to get wrong:
 *
 *   1. The tests must not need a cloud account, or they stop being run.
 *   2. The backend is a deployment decision — S3, R2, B2, MinIO and a shared
 *      volume are all reasonable answers for different operators, and they
 *      differ only in how a key becomes bytes.
 *   3. A migration off base64 has to read from the OLD place and write to the
 *      new one. That is far easier when "the old place" is just another
 *      implementation of the same three methods.
 *
 * WHAT A BACKEND MUST GUARANTEE
 *
 * Keys are opaque and caller-generated. A backend must never interpret a key
 * as a path it can walk out of — see `assertSafeKey`, which every backend runs
 * before touching anything, because the alternative is that an attachment id
 * becomes a way to read `/etc/passwd`.
 */

/** A stored object's identity. Opaque to callers; never a filesystem path. */
export type StorageKey = string;

export interface PutResult {
  key: StorageKey;
  size: number;
}

/**
 * How a caller should be given the bytes.
 *
 * `redirect` is what a real object store returns: a short-lived signed URL, so
 * the bytes travel from the store to the client and never through the
 * application. `stream` is the fallback for backends that cannot sign — the
 * app proxies, which works and does not scale, and says so.
 */
export type ReadTarget =
  | { kind: "redirect"; url: string; expiresInSeconds: number }
  | { kind: "stream"; body: ReadableStream<Uint8Array>; size: number };

export interface StorageBackend {
  /** A name for logs and the health endpoint. */
  readonly name: string;

  /**
   * True when this backend can be shared by several application instances.
   *
   * A local directory cannot: instance A writes a file that instance B cannot
   * see, so an attachment uploaded through one is a 404 through the other.
   * Multi-instance operation is a proven property of this application, so a
   * backend that quietly breaks it has to be refused at boot rather than
   * discovered by a user.
   */
  readonly isSharedAcrossInstances: boolean;

  put(key: StorageKey, body: Buffer | Uint8Array, contentType: string): Promise<PutResult>;
  read(key: StorageKey, opts?: { fileName?: string; contentType?: string }): Promise<ReadTarget>;
  delete(key: StorageKey): Promise<void>;
  exists(key: StorageKey): Promise<boolean>;
}

/**
 * Keys are generated, never supplied by a user — but this is the check that
 * makes that true rather than assumed.
 *
 * A backend resolves a key against a root. If a key could contain `..`, a
 * separator or an absolute prefix, "read attachment X" becomes "read any file
 * this process can open". The check lives here, once, so no backend can forget
 * it, and it is deliberately an allow-list of characters rather than a search
 * for bad ones.
 */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,199}$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error(`Unsafe storage key: ${JSON.stringify(key.slice(0, 64))}`);
  }
}

/**
 * Build the key for an attachment.
 *
 * Sharded by the first characters of the id, because a directory — or an S3
 * prefix — with a million entries in it is slow to list and awkward to
 * operate. The id is a cuid, so the shard is well distributed.
 *
 * The original filename is NOT part of the key. It is stored in the database
 * where it belongs; putting user text in a key invites encoding bugs and makes
 * `assertSafeKey` fight the product.
 */
export function attachmentKey(attachmentId: string): StorageKey {
  const shard = attachmentId.slice(-4, -2) || "00";
  return `attachments/${shard}/${attachmentId}`;
}

/**
 * Pull the bytes out of a `data:` URI.
 *
 * Both the upload route and the backfill script need this — the route to move
 * a new upload into the store, the script to move an old one — and they must
 * decode identically or a migrated file will not match the original. So it
 * lives here rather than in either of them.
 *
 * Returns null for anything that is not a data URI: an `http(s)://` value is
 * already external and has nothing to decode, and an unrecognised shape is
 * left alone rather than guessed at.
 */
export function decodeDataUri(
  value: string | null | undefined
): { bytes: Buffer; mime: string } | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(value ?? "");
  if (!match) return null;
  const [, mime, isBase64, payload] = match;
  try {
    const bytes = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return { bytes, mime: mime || "application/octet-stream" };
  } catch {
    // A malformed percent-encoding. Treat it as "not a data URI" rather than
    // storing a mangled file.
    return null;
  }
}
