#!/usr/bin/env node
/**
 * D3 — fail the build on interactive controls with no accessible name.
 *
 * WHAT THIS IS AND IS NOT
 *
 * It is a STATIC check over JSX source. It catches the mechanical failures
 * that make up most real-world accessibility defects and that are unambiguous
 * from the source alone:
 *
 *   - a button whose only content is an icon, with no aria-label and no title
 *   - an input, select or textarea with no label, aria-label or aria-labelledby
 *
 * A screen reader announces the first as "button", with no indication of what
 * it does, and the second as "edit text", with no indication of what it is
 * for. On a page of 40 icon buttons that is not a degraded experience; it is
 * an unusable one.
 *
 * It is NOT an axe run. It cannot judge colour contrast, focus order, whether
 * a modal traps focus, or whether an aria-label says something useful. Those
 * need a browser and a real DOM, and D3 is not finished until that exists —
 * see DEPLOYMENT.md. What this does is stop the count growing while that is
 * arranged, which is the same reason the bundle budget exists.
 *
 * Run:  node scripts/check-a11y.mjs
 *       node scripts/check-a11y.mjs --update   (re-baseline)
 * Exit: 0 at or below baseline, 1 above it.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BASELINE_FILE = "a11y-baseline.json";
const ROOTS = ["src/components", "src/app"];

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry.endsWith(".tsx")) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

/**
 * Split a file into JSX element strings for the tags we care about.
 *
 * Deliberately crude — a real parse would be better, and would also mean a
 * parser dependency and a much larger script for a check whose whole value is
 * that it is cheap enough to run on every build. False negatives are
 * acceptable here; the baseline only has to move in one direction.
 */
function elementsOf(src, tag) {
  const out = [];
  const open = new RegExp(`<${tag}(\\s|>)`, "g");
  let m;
  while ((m = open.exec(src)) !== null) {
    // Walk to the end of the opening tag, respecting nested braces so that
    // className={cn(...)} does not terminate it early.
    let i = m.index + tag.length + 1;
    let depth = 0;
    let quote = null;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    const openTag = src.slice(m.index, i + 1);
    const line = src.slice(0, m.index).split("\n").length;

    // For buttons we also need the children, to know whether there is text.
    let children = "";
    if (!openTag.endsWith("/>")) {
      const close = src.indexOf(`</${tag}>`, i);
      if (close !== -1) children = src.slice(i + 1, close);
    }
    out.push({ openTag, children, line });
  }
  return out;
}

const NAMED = /\baria-label\s*=|\baria-labelledby\s*=|\btitle\s*=/;

/** Text a screen reader would announce, ignoring JSX elements and whitespace. */
function hasTextContent(children) {
  const withoutElements = children.replace(/<[^>]*>/g, "");
  // {" "} and {variable} both count as potential text; a lone icon does not.
  const stripped = withoutElements.replace(/\{[^}]*\}/g, (m) =>
    /^\{\s*["'`]/.test(m) || /\w/.test(m) ? "x" : ""
  );
  return /\S/.test(stripped);
}

const findings = [];

for (const file of ROOTS.flatMap(walk)) {
  const src = readFileSync(file, "utf8");

  /**
   * `Btn` is scanned alongside `button` because it IS one.
   *
   * The Activate screens moved their twelve hand-styled buttons onto a shared
   * `Btn` wrapper. Scanning only the lowercase tag would have quietly taken
   * all twelve out of this check — the count would have improved by losing
   * coverage, which is the one way a ratchet can lie.
   */
  for (const tag of ["button", "Btn"]) {
    for (const el of elementsOf(src, tag)) {
      if (NAMED.test(el.openTag)) continue;
      if (hasTextContent(el.children)) continue;
      /**
       * A wrapper that spreads its caller's props is not the thing to name.
       * Its accessible name arrives as children from each call site, and
       * those call sites are what the loop above now checks. Naming the
       * wrapper itself would give every button in the app the same label.
       */
      if (/\{\s*\.\.\.\w+\s*\}/.test(el.openTag)) continue;
      findings.push({ file, line: el.line, kind: "button-no-name" });
    }
  }

  /**
   * A div or span with onClick and no way to reach it from a keyboard.
   *
   * Found the hard way: every card on the Kanban board was a plain
   * `<div onClick>`, so opening an issue — the primary interaction of the
   * product — was impossible without a mouse. Tab skipped the entire board.
   *
   * axe does not report this. Its `interactive-element-affordance` style rules
   * are not in the wcag2a/aa tag set, and a div with no role looks like
   * ordinary layout to a static scan of the accessibility tree.
   *
   * A click handler needs BOTH: something that puts it in the tab order
   * (tabIndex, or a native control) and something that responds to a key.
   */
  for (const tag of ["div", "span", "li", "tr", "td"]) {
    for (const el of elementsOf(src, tag)) {
      if (!/\bonClick\s*=/.test(el.openTag)) continue;
      // A keyboard user can reach and operate it.
      if (/\bonKeyDown\s*=|\bonKeyUp\s*=|\bonKeyPress\s*=/.test(el.openTag)) continue;
      /**
       * A handler that ONLY stops propagation is not an interaction.
       *
       * `onClick={(e) => e.stopPropagation()}` is the standard way to keep a
       * click inside a row of controls from also firing the row's own
       * handler. It adds no behaviour, so there is nothing a keyboard user
       * could be missing, and demanding a key handler for it would mean
       * writing one that does nothing to satisfy a check.
       *
       * Matched narrowly, on the whole body: anything that stops propagation
       * AND does something else is still a real interaction and still
       * reported. This was found when a wrapper started being flagged
       * because an unrelated edit moved its real <button> past the 400-
       * character look-ahead below — the wrapper had not changed, and
       * neither had its accessibility.
       */
      if (/\bonClick\s*=\s*\{\s*\(\s*\w*\s*\)\s*=>\s*\w+\.stopPropagation\(\)\s*\}/.test(el.openTag))
        continue;
      // Or it delegates: a wrapper whose only child is a real control is a
      // common and harmless pattern.
      if (/<(button|a|input|select|textarea)\b/.test(el.children.slice(0, 400))) continue;
      findings.push({ file, line: el.line, kind: `${tag}-click-no-keyboard` });
    }
  }

  for (const tag of ["input", "select", "textarea"]) {
    for (const el of elementsOf(src, tag)) {
      if (NAMED.test(el.openTag)) continue;
      // An id paired with a <label htmlFor> elsewhere in the same file is a
      // legitimate association.
      const id = el.openTag.match(/\bid\s*=\s*["'{]([^"'}\s]+)/);
      if (id && src.includes(`htmlFor="${id[1]}"`)) continue;
      // type=hidden is not interactive.
      if (/type\s*=\s*["']hidden["']/.test(el.openTag)) continue;
      findings.push({ file, line: el.line, kind: `${tag}-no-label` });
    }
  }
}

const byFile = {};
for (const f of findings) byFile[f.file] = (byFile[f.file] ?? 0) + 1;

const total = findings.length;
const updating = process.argv.includes("--update");

if (updating) {
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify(
      {
        $comment:
          "D3 — accessibility baseline. Counts of interactive controls with no " +
          "accessible name, per file. This may go DOWN freely; going up fails " +
          "the build. Regenerate with: node scripts/check-a11y.mjs --update",
        total,
        files: Object.fromEntries(Object.entries(byFile).sort()),
      },
      null,
      2
    ) + "\n"
  );
  console.log(`Wrote ${BASELINE_FILE}: ${total} finding(s) across ${Object.keys(byFile).length} file(s).`);
  process.exit(0);
}

if (!existsSync(BASELINE_FILE)) {
  console.error(`\nNo ${BASELINE_FILE}. Create it with:\n\n  node scripts/check-a11y.mjs --update\n`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
const worse = [];
const better = [];

for (const [file, count] of Object.entries(byFile)) {
  const was = baseline.files[file] ?? 0;
  if (count > was) worse.push({ file, was, now: count });
}
for (const [file, was] of Object.entries(baseline.files ?? {})) {
  const now = byFile[file] ?? 0;
  if (now < was) better.push({ file, was, now });
}

console.log(
  `a11y: ${total} finding(s) — unnamed controls and click handlers with no keyboard path ` +
    `(baseline ${baseline.total})`
);

if (better.length) {
  console.log(`\nImproved in ${better.length} file(s):`);
  for (const b of better.slice(0, 10)) console.log(`  ${b.file}  ${b.was} -> ${b.now}`);
  if (total < baseline.total) {
    console.log(
      `\nDown ${baseline.total - total} overall. Re-baseline so the gain is locked in:\n` +
        "  node scripts/check-a11y.mjs --update\n"
    );
  }
}

if (worse.length) {
  console.error(`\n${worse.length} file(s) got worse:\n`);
  for (const w of worse) console.error(`  ${w.file}  ${w.was} -> ${w.now}`);
  console.error(
    "\nA button whose only content is an icon is announced as just \"button\".\n" +
      "An input with no label is announced as \"edit text\". Give it a name:\n\n" +
      '  <button aria-label="Close dialog">     <X />\n' +
      '  <input aria-label="Search issues" />\n' +
      '  <label htmlFor="x">Name</label>        <input id="x" />\n\n' +
      "Retrofitting accessibility costs far more than adding it, which is why\n" +
      "this only lets the number go down.\n"
  );
  process.exit(1);
}

console.log("\nNo file regressed.\n");
