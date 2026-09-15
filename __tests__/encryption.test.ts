import { encryptField, decryptField, isEncrypted, maskSecret } from "@/lib/encryption";

describe("field-level encryption", () => {
  const plaintext = "my-super-secret-webhook-key";

  it("produces an encrypted envelope string", () => {
    const encrypted = encryptField(plaintext);
    expect(encrypted.startsWith("enc:v1:")).toBe(true);
  });

  it("round-trips correctly", () => {
    const encrypted = encryptField(plaintext);
    expect(decryptField(encrypted)).toBe(plaintext);
  });

  it("produces different ciphertexts each time (random IV)", () => {
    const a = encryptField(plaintext);
    const b = encryptField(plaintext);
    expect(a).not.toBe(b);
    // Both decrypt to the same plaintext
    expect(decryptField(a)).toBe(plaintext);
    expect(decryptField(b)).toBe(plaintext);
  });

  it("is idempotent — does not double-encrypt", () => {
    const once = encryptField(plaintext);
    const twice = encryptField(once);
    expect(twice).toBe(once);
  });

  it("decryptField passes through unencrypted legacy values", () => {
    expect(decryptField("legacy-plain-secret")).toBe("legacy-plain-secret");
  });

  it("encryptField handles empty string", () => {
    // Empty string is returned as-is (falsy guard)
    expect(encryptField("")).toBe("");
  });

  it("decryptField handles empty string", () => {
    expect(decryptField("")).toBe("");
  });
});

describe("isEncrypted", () => {
  it("returns true for encrypted values", () => {
    expect(isEncrypted(encryptField("test"))).toBe(true);
  });

  it("returns false for plain values", () => {
    expect(isEncrypted("plain-text")).toBe(false);
  });
});

describe("maskSecret", () => {
  it("masks most of the secret", () => {
    const masked = maskSecret("my-webhook-secret");
    expect(masked.startsWith("****")).toBe(true);
    expect(masked).not.toContain("webhook");
  });

  it("shows last 4 chars of plain secrets", () => {
    expect(maskSecret("abcdefghij")).toBe("****ghij");
  });

  it("masks encrypted values as ****", () => {
    const encrypted = encryptField("some-secret");
    expect(maskSecret(encrypted)).toBe("****");
  });

  it("handles empty string", () => {
    expect(maskSecret("")).toBe("");
  });
});
