/**
 * B3 — which backend this process uses, and whether it is allowed to.
 *
 * The choice is configuration, but it is not a free choice: a backend that is
 * not shared between instances breaks an application that runs more than one,
 * and it breaks it intermittently — an attachment uploaded through instance A
 * is a 404 through instance B, depending on which one the load balancer
 * picked. That is the worst way for a fault to present, so it is refused at
 * boot rather than discovered by a user.
 *
 * `STORAGE_DRIVER` is deliberately explicit rather than inferred from which
 * other variables happen to be set. Inferring means a typo in `S3_BUCKET`
 * silently downgrades a production deployment to local disk.
 */

import { LocalFsBackend } from "./local-fs.ts";
import { S3Backend } from "./s3.ts";
import type { StorageBackend } from "./index.ts";

export type StorageDriver = "s3" | "local-fs";

/**
 * Just the variables this reads.
 *
 * Deliberately not NodeJS.ProcessEnv: that type requires NODE_ENV, so every
 * caller passing a subset — which is what a test does, and what makes these
 * cases readable — would have to cast. A function that only reads strings
 * should ask for strings.
 */
export type StorageEnv = Record<string, string | undefined>;

export interface StorageConfigResult {
  backend: StorageBackend | null;
  /** Fatal problems. In production these stop the server starting. */
  errors: string[];
  /** Worth saying out loud, but not worth refusing to run over. */
  warnings: string[];
}

/**
 * Build the configured backend, reporting what is wrong rather than throwing.
 *
 * Returning the problems lets `instrumentation.ts` present them alongside
 * every other configuration fault in one message, which is how an operator
 * fixes three things in one deploy instead of three.
 */
export function resolveStorage(env: StorageEnv = process.env): StorageConfigResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProduction = env.NODE_ENV === "production";

  const driver = (env.STORAGE_DRIVER || "").trim().toLowerCase();

  if (!driver) {
    // Not an error outside production: a developer running `next dev` should
    // not have to configure object storage to open a page.
    if (isProduction) {
      errors.push(
        "STORAGE_DRIVER is not set. Attachments would fall back to base64 in the database, " +
          "which inflates the database, every backup and the restore time together. " +
          'Set STORAGE_DRIVER="s3" (with S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, ' +
          'S3_SECRET_ACCESS_KEY) or "local-fs" with STORAGE_FS_ROOT.'
      );
    }
    return { backend: null, errors, warnings };
  }

  if (driver === "local-fs") {
    const root = env.STORAGE_FS_ROOT?.trim();
    if (!root) {
      errors.push('STORAGE_DRIVER="local-fs" requires STORAGE_FS_ROOT (a directory path).');
      return { backend: null, errors, warnings };
    }

    /**
     * A local directory is only acceptable in production when the operator
     * states it is shared — an NFS or EFS mount, or a single instance by
     * design. Two containers with two empty disks is the failure this guards.
     */
    const shared = env.STORAGE_FS_SHARED === "1";
    if (isProduction && !shared) {
      errors.push(
        'STORAGE_DRIVER="local-fs" in production without STORAGE_FS_SHARED=1. ' +
          "A local directory is not visible to other instances, so an attachment uploaded " +
          "through one would be a 404 through another — intermittently, depending on which " +
          "instance served the request. Set STORAGE_FS_SHARED=1 only if STORAGE_FS_ROOT is a " +
          "genuinely shared volume, or use an object store."
      );
      return { backend: null, errors, warnings };
    }
    if (isProduction && shared) {
      warnings.push(
        `STORAGE_FS_SHARED=1: trusting ${root} to be visible to every instance. ` +
          "Attachments will be unreachable from any instance where it is not."
      );
    }

    return { backend: new LocalFsBackend(root, { shared }), errors, warnings };
  }

  if (driver === "s3") {
    const bucket = env.S3_BUCKET?.trim();
    const region = env.S3_REGION?.trim();
    const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
    const endpoint = env.S3_ENDPOINT?.trim() || undefined;

    const missing = [
      !bucket && "S3_BUCKET",
      !region && "S3_REGION",
      !accessKeyId && "S3_ACCESS_KEY_ID",
      !secretAccessKey && "S3_SECRET_ACCESS_KEY",
    ].filter(Boolean);

    if (missing.length > 0) {
      errors.push(`STORAGE_DRIVER="s3" is missing: ${missing.join(", ")}.`);
      return { backend: null, errors, warnings };
    }

    const ttlRaw = env.S3_SIGNED_URL_TTL_SECONDS?.trim();
    let ttl: number | undefined;
    if (ttlRaw) {
      const n = Number(ttlRaw);
      // A week is S3's own ceiling for SigV4, and anything near it defeats the
      // purpose of signing at all.
      if (!Number.isInteger(n) || n < 30 || n > 3600) {
        errors.push("S3_SIGNED_URL_TTL_SECONDS must be an integer between 30 and 3600.");
        return { backend: null, errors, warnings };
      }
      ttl = n;
    }

    return {
      backend: new S3Backend({
        bucket: bucket!,
        region: region!,
        endpoint,
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
        signedUrlTtlSeconds: ttl,
      }),
      errors,
      warnings,
    };
  }

  errors.push(`STORAGE_DRIVER="${driver}" is not recognised. Use "s3" or "local-fs".`);
  return { backend: null, errors, warnings };
}

/**
 * The process-wide backend, built once.
 *
 * `null` means attachments still use the legacy base64 column — which is the
 * state every existing deployment is in until it configures one, and why the
 * routes have to handle both.
 */
let cached: StorageBackend | null | undefined;

export function getStorage(): StorageBackend | null {
  if (cached === undefined) cached = resolveStorage().backend;
  return cached;
}

/** Tests build their own backends; this lets them reset the cache. */
export function __resetStorageForTests(): void {
  cached = undefined;
}
