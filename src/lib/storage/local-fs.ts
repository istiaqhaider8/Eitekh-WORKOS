/**
 * B3 — a filesystem backend, for development and for a shared volume.
 *
 * WHAT THIS IS FOR
 *
 * Running, testing and migrating without a cloud account. The tests that prove
 * the migration off base64 works have to run in CI and on a laptop, and a test
 * that needs credentials is a test that gets skipped.
 *
 * WHAT IT IS NOT FOR
 *
 * A multi-instance deployment on local disks. Instance A writes a file that
 * instance B cannot see, so an attachment uploaded through one is a 404
 * through the other — intermittently, depending on which instance the load
 * balancer picked, which is the worst way for a bug to present.
 *
 * Multi-instance operation is a PROVEN property of this application, so this
 * backend declares `isSharedAcrossInstances = false` and the boot guard
 * refuses it in production unless the operator states that the directory is a
 * shared volume (`STORAGE_FS_SHARED=1`). An NFS or EFS mount is a legitimate
 * answer; two containers with two empty disks is not.
 */

import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import {
  assertSafeKey,
  type PutResult,
  type ReadTarget,
  type StorageBackend,
  type StorageKey,
} from "./index";

export class LocalFsBackend implements StorageBackend {
  readonly name: string;
  readonly isSharedAcrossInstances: boolean;

  private readonly root: string;

  constructor(root: string, opts: { shared?: boolean } = {}) {
    this.root = resolve(root);
    this.isSharedAcrossInstances = opts.shared === true;
    this.name = `local-fs(${this.root}${opts.shared ? ", shared" : ""})`;
  }

  /**
   * Resolve a key to a path, and prove the result is still inside the root.
   *
   * `assertSafeKey` already rejects traversal, so this is the second of two
   * independent checks. That is deliberate: the cost of being wrong here is
   * arbitrary file read or write, and the cost of checking twice is one string
   * comparison.
   */
  private pathFor(key: StorageKey): string {
    assertSafeKey(key);
    const full = resolve(join(this.root, key));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error("Resolved storage path escaped the storage root");
    }
    return full;
  }

  async put(key: StorageKey, body: Buffer | Uint8Array, _contentType: string): Promise<PutResult> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    await writeFile(path, buf);
    return { key, size: buf.byteLength };
  }

  /**
   * Streams, because this backend cannot sign a URL.
   *
   * The bytes go through the application, which is the cost of not having an
   * object store. It is bounded work per request rather than the whole file in
   * memory, which is already better than reading a base64 column.
   */
  async read(key: StorageKey): Promise<ReadTarget> {
    const path = this.pathFor(key);
    const info = await stat(path);
    const nodeStream = createReadStream(path);
    return {
      kind: "stream",
      body: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
      size: info.size,
    };
  }

  /** Reading the whole object, for the migration and for tests. */
  async readAll(key: StorageKey): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: StorageKey): Promise<void> {
    // `force` so deleting something already gone is not an error: a delete
    // that has to be retried should converge, not fail the second time.
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: StorageKey): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
}
