import { sanitizeUrl, escapeHtml, stripHtml, truncate } from "@/lib/sanitize";

describe("sanitizeUrl", () => {
  it("allows https URLs", () => {
    expect(sanitizeUrl("https://example.com/file.pdf")).toBe("https://example.com/file.pdf");
  });

  it("allows http URLs", () => {
    expect(sanitizeUrl("http://example.com/file.pdf")).toBe("http://example.com/file.pdf");
  });

  it("allows relative paths starting with /", () => {
    expect(sanitizeUrl("/uploads/file.pdf")).toBe("/uploads/file.pdf");
  });

  it("allows safe data: image URLs", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA";
    expect(sanitizeUrl(dataUrl)).toBe(dataUrl);
  });

  it("allows data:application/pdf URLs", () => {
    const dataUrl = "data:application/pdf;base64,JVBER";
    expect(sanitizeUrl(dataUrl)).toBe(dataUrl);
  });

  it("blocks javascript: URLs", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBe("#");
  });

  it("blocks javascript: with uppercase", () => {
    expect(sanitizeUrl("JAVASCRIPT:alert(1)")).toBe("#");
  });

  it("blocks vbscript: URLs", () => {
    expect(sanitizeUrl("vbscript:msgbox(1)")).toBe("#");
  });

  it("blocks data:text/html URLs", () => {
    expect(sanitizeUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
  });

  it("blocks data:text/javascript URLs", () => {
    expect(sanitizeUrl("data:text/javascript,alert(1)")).toBe("#");
  });

  it("returns # for empty string", () => {
    expect(sanitizeUrl("")).toBe("#");
  });

  it("returns # for null", () => {
    expect(sanitizeUrl(null)).toBe("#");
  });

  it("returns # for undefined", () => {
    expect(sanitizeUrl(undefined)).toBe("#");
  });

  it("blocks ftp: URLs", () => {
    expect(sanitizeUrl("ftp://malicious.com/file")).toBe("#");
  });
});

describe("escapeHtml", () => {
  it("escapes <script> tags", () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes & characters", () => {
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
  });

  it("escapes quotes", () => {
    expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("stripHtml", () => {
  it("removes HTML tags", () => {
    expect(stripHtml("<b>hello</b>")).toBe("hello");
  });

  it("handles no tags", () => {
    expect(stripHtml("plain text")).toBe("plain text");
  });
});

describe("truncate", () => {
  it("truncates long strings", () => {
    const result = truncate("a".repeat(200), 100);
    expect(result.length).toBeLessThanOrEqual(104); // 100 + ellipsis
    expect(result.endsWith("…")).toBe(true);
  });

  it("does not truncate short strings", () => {
    expect(truncate("short", 100)).toBe("short");
  });
});
