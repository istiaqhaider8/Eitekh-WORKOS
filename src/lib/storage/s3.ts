/**
 * B3 — the object-store backend. S3, and everything that speaks S3.
 *
 * WHY THE AWS SDK AND NOT A HAND-ROLLED SIGNER
 *
 * This codebase prefers writing the small thing over taking the large
 * dependency — the load harness exists instead of k6 for exactly that reason.
 * Request signing is where that preference stops. SigV4 presigning is a
 * canonicalisation problem with a dozen ways to be subtly wrong (header
 * ordering, payload hashing, path escaping, clock skew), every one of which
 * fails as "403 SignatureDoesNotMatch" with no indication which. It is also
 * the difference between a URL that expires and one that does not.
 *
 * WHY "S3" MEANS MORE THAN AWS
 *
 * `endpoint` and `forcePathStyle` make this work unchanged against Cloudflare
 * R2, Backblaze B2, MinIO and DigitalOcean Spaces. That matters twice: an
 * operator picks the store that suits them, and the tests can run against a
 * MinIO container instead of needing a cloud account — which is what keeps
 * them running at all.
 *
 * WHY DOWNLOADS ARE A REDIRECT
 *
 * A presigned GET sends the bytes from the store to the client directly. The
 * application never touches them, so an attachment download costs one small
 * response instead of streaming a file through a Node process that is also
 * serving the API. That is the whole point of moving off base64: the old path
 * read the entire file into memory as a string.
 *
 * The URL is short-lived and carries no credential of the caller's, so it must
 * only ever be handed to someone already authorised — the content route checks
 * project access before asking for one.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  assertSafeKey,
  type PutResult,
  type ReadTarget,
  type StorageBackend,
  type StorageKey,
} from "./index.ts";

export interface S3BackendOptions {
  bucket: string;
  region: string;
  /** Set for anything that is not AWS S3 itself: R2, B2, MinIO, Spaces. */
  endpoint?: string;
  /** MinIO and most self-hosted stores need path-style addressing. */
  forcePathStyle?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  /** How long a download URL stays valid. Short by default. */
  signedUrlTtlSeconds?: number;
}

/**
 * Ten minutes.
 *
 * Long enough for a slow connection to finish a large file, short enough that
 * a URL copied out of a browser's network tab is useless by the time it is
 * pasted anywhere. It is not an access control — the access control is the
 * project check before the URL is minted — it bounds the blast radius of one
 * leaking.
 */
const DEFAULT_TTL_SECONDS = 600;

export class S3Backend implements StorageBackend {
  readonly name: string;
  /** Every instance sees the same bucket. That is the point of using one. */
  readonly isSharedAcrossInstances = true;

  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly ttl: number;

  constructor(opts: S3BackendOptions) {
    this.bucket = opts.bucket;
    this.ttl = opts.signedUrlTtlSeconds ?? DEFAULT_TTL_SECONDS;
    this.name = `s3(${opts.endpoint ?? "aws"}/${opts.bucket})`;
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle ?? Boolean(opts.endpoint),
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
    });
  }

  async put(key: StorageKey, body: Buffer | Uint8Array, contentType: string): Promise<PutResult> {
    assertSafeKey(key);
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buf,
        ContentType: contentType,
        /**
         * Objects are reached only through a presigned URL this application
         * mints after an authorization check. Nothing here should ever be
         * publicly readable, and saying so explicitly means a bucket whose
         * default ACL is permissive does not quietly make it so.
         */
        ACL: "private",
      })
    );
    return { key, size: buf.byteLength };
  }

  /**
   * A short-lived signed URL, with the filename and type the browser should
   * use.
   *
   * `ResponseContentDisposition` is what makes a download arrive as
   * "quarterly-report.pdf" rather than as the opaque key. The filename is
   * quoted and stripped of characters that would let it break out of the
   * header — it comes from the user, and it travels in a response header.
   */
  async read(
    key: StorageKey,
    opts: { fileName?: string; contentType?: string } = {}
  ): Promise<ReadTarget> {
    assertSafeKey(key);

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(opts.contentType ? { ResponseContentType: opts.contentType } : {}),
      ...(opts.fileName
        ? { ResponseContentDisposition: `attachment; filename="${sanitiseFileName(opts.fileName)}"` }
        : {}),
    });

    const url = await getSignedUrl(this.client, command, { expiresIn: this.ttl });
    return { kind: "redirect", url, expiresInSeconds: this.ttl };
  }

  async delete(key: StorageKey): Promise<void> {
    assertSafeKey(key);
    // S3 DELETE is idempotent: removing something already gone succeeds, which
    // is what a retry needs.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Close the socket pool, so a script can exit cleanly. */
  async close(): Promise<void> {
    this.client.destroy();
  }

  async exists(key: StorageKey): Promise<boolean> {
    assertSafeKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err: any) {
      // 404 and 403 both mean "not usable by us". Anything else is a real
      // fault and should not be reported as a missing object.
      const status = err?.$metadata?.httpStatusCode;
      if (status === 404 || status === 403 || err?.name === "NotFound") return false;
      throw err;
    }
  }
}

/**
 * Make a user-supplied filename safe to place inside a quoted header value.
 *
 * Quotes, backslashes and control characters (CR and LF especially) would let
 * a filename terminate the parameter or inject a header. Non-ASCII is dropped
 * rather than encoded: RFC 5987's `filename*` is the correct way to carry it,
 * and a half-implementation of that is worse than an ASCII fallback.
 */
export function sanitiseFileName(name: string): string {
  const cleaned = name
    .replace(/[\r\n\t]/g, " ")
    .replace(/["\\]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .trim();
  return cleaned.slice(0, 120) || "download";
}
