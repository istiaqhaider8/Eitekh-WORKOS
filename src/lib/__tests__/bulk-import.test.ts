/**
 * Tests for the bulk-import date parser (src/lib/bulk-import.ts).
 *
 * The template format is DD/MM/YYYY. These tests exist mainly to pin the
 * day/month order: the parser is the only thing standing between a
 * "10/1/2026" cell and a task dated three quarters away from what the user
 * meant, and nothing about a wrong-but-valid date shows up as an error later.
 */

import { parseDateCell } from "../bulk-import";

const iso = (value: string) => {
  const r = parseDateCell(value);
  if (!r.ok) throw new Error(`expected "${value}" to parse, got: ${r.error}`);
  return r.date ? r.date.toISOString().slice(0, 10) : null;
};

describe("parseDateCell — DD/MM/YYYY", () => {
  it("reads the first component as the day", () => {
    expect(iso("01/10/2026")).toBe("2026-10-01");
    expect(iso("15/10/2026")).toBe("2026-10-15");
    expect(iso("31/12/2026")).toBe("2026-12-31");
  });

  it("rejects a US-style date rather than guessing", () => {
    // 10/15/2026 is 15 October written month-first. Day-first makes 15 the
    // month, which does not exist, so it is refused. Accepting it by detecting
    // the impossible month would mean 10/11/2026 still read as 11 October
    // while 10/15/2026 read as 15 October -- the same spreadsheet parsed two
    // different ways, silently. A clean rejection is safer than that.
    const r = parseDateCell("10/15/2026");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch("month must be 1-12");
  });

  it("accepts the separators a spreadsheet writes", () => {
    // Excel rewrites a typed date on save, commonly with slashes and without
    // the leading zero, so a correctly filled template must still import.
    expect(iso("01/10/2026")).toBe("2026-10-01");
    expect(iso("01.10.2026")).toBe("2026-10-01");
    expect(iso("1-2-2026")).toBe("2026-02-01");
    expect(iso("10/1/2026")).toBe("2026-01-10");
  });

  it("still accepts YYYY-MM-DD, which earlier templates specified", () => {
    // Unambiguous against DD/MM/YYYY because the leading component is 4 digits.
    expect(iso("2026-10-01")).toBe("2026-10-01");
    expect(iso("2026-10-1")).toBe("2026-10-01");
  });

  it("treats an empty cell as no date rather than an error", () => {
    const r = parseDateCell("");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.date).toBeNull();
  });

  it("parses at UTC midnight, so the date cannot shift by timezone", () => {
    const r = parseDateCell("01-10-2026");
    expect(r.ok).toBe(true);
    if (r.ok && r.date) {
      expect(r.date.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    }
  });
});

describe("parseDateCell — rejections", () => {
  const rejects = (value: string) => {
    const r = parseDateCell(value);
    expect(r.ok).toBe(false);
    if (!r.ok) return r.error;
    return "";
  };

  it("rejects a day that does not exist in that month", () => {
    // Date.UTC would roll this into March; the parser compares the result back.
    expect(rejects("31-02-2026")).toMatch(/not a real date/);
    expect(rejects("30-02-2026")).toMatch(/not a real date/);
  });

  it("rejects an out-of-range day or month", () => {
    expect(rejects("00-10-2026")).toMatch(/day must be 1-31/);
    expect(rejects("32-10-2026")).toMatch(/day must be 1-31/);
    expect(rejects("10-13-2026")).toMatch(/month must be 1-12/);
    expect(rejects("10-00-2026")).toMatch(/month must be 1-12/);
  });

  it("rejects a two-digit year, which would be ambiguous", () => {
    expect(rejects("1-2-26")).toMatch("must be DD/MM/YYYY");
  });

  it("rejects free text and datetimes", () => {
    expect(rejects("hello")).toMatch("must be DD/MM/YYYY");
    expect(rejects("2026-10-01T00:00:00Z")).toMatch("must be DD/MM/YYYY");
  });

  it("names the expected format in the error, so the message is actionable", () => {
    expect(rejects("hello")).toContain("DD/MM/YYYY");
  });
});
