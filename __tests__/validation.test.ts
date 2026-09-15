import { emailSchema, passwordSchema, attachmentSchema } from "@/lib/validation";

describe("emailSchema", () => {
  it("accepts valid emails", () => {
    expect(emailSchema.parse("User@Example.COM")).toBe("user@example.com");
  });

  it("rejects invalid emails", () => {
    expect(() => emailSchema.parse("not-an-email")).toThrow();
  });

  it("rejects empty strings", () => {
    expect(() => emailSchema.parse("")).toThrow();
  });

  it("rejects emails over 254 chars", () => {
    const long = "a".repeat(250) + "@a.com"; // 256 chars total
    expect(() => emailSchema.parse(long)).toThrow();
  });
});

describe("passwordSchema", () => {
  const validPassword = "Secure#Pass1";

  it("accepts a strong password", () => {
    expect(passwordSchema.parse(validPassword)).toBe(validPassword);
  });

  it("rejects passwords shorter than 8 chars", () => {
    expect(() => passwordSchema.parse("Aa1!")).toThrow();
  });

  it("rejects passwords without uppercase", () => {
    expect(() => passwordSchema.parse("secure#pass1")).toThrow();
  });

  it("rejects passwords without lowercase", () => {
    expect(() => passwordSchema.parse("SECURE#PASS1")).toThrow();
  });

  it("rejects passwords without digits", () => {
    expect(() => passwordSchema.parse("Secure#Pass!")).toThrow();
  });

  it("rejects passwords without special chars", () => {
    expect(() => passwordSchema.parse("SecurePass1")).toThrow();
  });
});

describe("attachmentSchema.fileUrl", () => {
  const validBase = {
    fileName: "test.pdf",
    fileSize: 1024,
    mimeType: "application/pdf",
  };

  it("accepts https URLs", () => {
    const result = attachmentSchema.parse({ ...validBase, fileUrl: "https://cdn.example.com/file.pdf" });
    expect(result.fileUrl).toBe("https://cdn.example.com/file.pdf");
  });

  it("accepts data:image URLs", () => {
    const result = attachmentSchema.parse({ ...validBase, fileUrl: "data:image/png;base64,abc" });
    expect(result.fileUrl).toContain("data:image/png");
  });

  it("rejects javascript: URLs", () => {
    expect(() =>
      attachmentSchema.parse({ ...validBase, fileUrl: "javascript:alert(1)" })
    ).toThrow();
  });

  it("rejects data:text/html URLs", () => {
    expect(() =>
      attachmentSchema.parse({ ...validBase, fileUrl: "data:text/html,<script>alert(1)</script>" })
    ).toThrow();
  });
});
