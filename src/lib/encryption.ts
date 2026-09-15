/**
 * Field-level AES-256-GCM encryption for sensitive DB columns.
 *
 * Set FIELD_ENCRYPTION_KEY in the environment to a 64-char hex string
 * (32 random bytes). Generate with: openssl rand -hex 32
 *
 * Encrypted format: "enc:v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>"
 * Plain values (no prefix) are returned as-is so existing data keeps working.
 */

import crypto from "crypto";

const ENCRYPTION_PREFIX = "enc:v1:";
const KEY_HEX_LENGTH = 64; // 32 bytes as hex

function getKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY || "";
  if (!raw || raw.length !== KEY_HEX_LENGTH) {
    // Fall back to a deterministic dev-only key derived from JWT_SECRET so the
    // app still starts locally without explicit config; warn loudly.
    const jwtSecret = process.env.JWT_SECRET || "dev-only-insecure-jwt-secret-change-in-production";
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "FIELD_ENCRYPTION_KEY must be a 64-char hex string in production. " +
          "Generate with: openssl rand -hex 32"
      );
    }
    return crypto.createHash("sha256").update(jwtSecret).digest();
  }
  return Buffer.from(raw, "hex");
}

/**
 * Encrypt a plaintext string. Returns the encrypted envelope string.
 * Idempotent: already-encrypted strings are returned unchanged.
 */
export function encryptField(plaintext: string): string {
  if (!plaintext || plaintext.startsWith(ENCRYPTION_PREFIX)) return plaintext;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt an encrypted envelope string. Returns the plaintext.
 * Plain (unencrypted) strings are returned as-is for backward compatibility.
 */
export function decryptField(value: string): string {
  if (!value || !value.startsWith(ENCRYPTION_PREFIX)) return value;
  const key = getKey();
  const rest = value.slice(ENCRYPTION_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted field format");
  const [ivHex, tagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Returns true if a stored value is in the encrypted envelope format. */
export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith(ENCRYPTION_PREFIX);
}

/** Mask a secret for API responses — show only last 4 chars. */
export function maskSecret(value: string): string {
  if (!value) return "";
  const plain = isEncrypted(value) ? "***" : value;
  if (plain.length <= 4) return "****";
  return "****" + plain.slice(-4);
}
