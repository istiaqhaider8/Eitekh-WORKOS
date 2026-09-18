import { csvSafeCell } from "./sanitize";

/**
 * CSV helpers for bulk import/export.
 *
 * The import route previously used a line-splitting parser that broke on any
 * quoted field containing a newline, silently truncating the row. This parser
 * walks the whole document character by character so quoted commas, quoted
 * newlines and escaped quotes ("") are handled correctly.
 */

/** Parses a whole CSV document into rows of raw string cells. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  // Normalise line endings so CRLF files from Excel behave identically.
  const text = input.replace(/\r\n?/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  // Trailing cell/row (file not ending in a newline).
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // Drop rows that are entirely empty — trailing blank lines are common and
  // must not be reported as invalid records.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Splits a parsed CSV into a normalised header list and data rows.
 *
 * Headers are lowercased and trimmed so "Due Date", "due date" and "DUE DATE"
 * all resolve to the same column, and a UTF-8 BOM (which Excel writes) is
 * stripped from the first header rather than corrupting it.
 */
export function readCsvTable(input: string): { headers: string[]; rows: string[][] } {
  const all = parseCsv(input);
  if (all.length === 0) return { headers: [], rows: [] };
  const headers = all[0].map((h, idx) => {
    const cleaned = idx === 0 ? h.replace(/^﻿/, "") : h;
    return cleaned.trim().toLowerCase();
  });
  return { headers, rows: all.slice(1) };
}

/** Reads a cell by header name, returning "" when the column is absent. */
export function cell(headers: string[], row: string[], name: string): string {
  const i = headers.indexOf(name);
  if (i === -1) return "";
  return (row[i] ?? "").trim();
}

/** Builds a CSV document, guarding every cell against formula injection. */
export function buildCsv(headers: readonly string[], rows: (string | number | null | undefined)[][]): string {
  const line = (cells: readonly (string | number | null | undefined)[]) =>
    cells.map((c) => `"${csvSafeCell(c)}"`).join(",");
  return [line(headers), ...rows.map(line)].join("\n");
}

/**
 * A downloadable template: the header row, one example row, and a commented
 * reference block listing the values this project will actually accept.
 *
 * The allowed values are passed in by the caller from live data, so a template
 * can never drift from what the importer validates against.
 */
export function buildTemplate(opts: {
  headers: readonly string[];
  exampleRows: (string | number | null | undefined)[][];
  notes: string[];
}): string {
  const csv = buildCsv(opts.headers, opts.exampleRows);
  // '#' lines are stripped by the importer, so the reference block travels
  // with the file without becoming data.
  const notes = opts.notes.map((n) => `# ${n}`).join("\n");
  return `${notes}\n${csv}\n`;
}

/** Removes comment lines so a template can be filled in and uploaded as-is. */
export function stripCsvComments(input: string): string {
  return input
    .split(/\r\n?|\n/)
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
}
