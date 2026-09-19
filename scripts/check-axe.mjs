#!/usr/bin/env node
/**
 * D3 — run axe against the real pages, in a real browser.
 *
 * WHY THIS AND NOT ONLY THE STATIC CHECK
 *
 * scripts/check-a11y.mjs scans JSX for controls with no accessible name. That
 * catches the most common failure and needs no infrastructure, but it is
 * blind to everything that depends on a rendered page:
 *
 *   - colour contrast, which needs computed styles, in BOTH themes
 *   - focus order and whether a modal traps focus
 *   - whether an aria-label is actually reachable, or hidden behind
 *     aria-hidden on an ancestor
 *   - duplicate ids, which break every label association on the page at once
 *
 * So this drives a browser. It uses playwright-core against the system Chrome
 * rather than downloading a bundled browser: the driver is ~2 MB, and a check
 * that costs a 150 MB download per CI run is a check that gets disabled.
 *
 * WHAT IT ASSERTS
 *
 * Violations at the `serious` and `critical` levels fail the build, compared
 * against a baseline so that pre-existing debt does not block work while it is
 * paid down. `moderate` and `minor` are reported and do not fail — not because
 * they do not matter, but because failing on all four at once means the
 * baseline never gets smaller.
 *
 * Both themes are checked. Contrast is the one category where a dark theme can
 * be broken while the light one is fine, and this app has both.
 *
 * Usage:
 *   node scripts/check-axe.mjs                 (expects a server on :3178)
 *   node scripts/check-axe.mjs --update        (re-baseline)
 *   node scripts/check-axe.mjs --url http://localhost:3000
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { AxeBuilder } from "@axe-core/playwright";

const BASELINE_FILE = "axe-baseline.json";

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const BASE = argOf("--url", process.env.AXE_BASE_URL || "http://localhost:3178");
const TOKEN = process.env.AXE_SESSION_TOKEN;
const PROJECT_ID = process.env.AXE_PROJECT_ID;
const updating = argv.includes("--update");

/** Pages worth checking, and what has to be true before they render. */
const PAGES = [
  { name: "login", path: "/login", auth: false },
  { name: "register", path: "/register", auth: false },
  { name: "forgot-password", path: "/forgot-password", auth: false },
  { name: "home", path: "/", auth: true },
  { name: "settings/profile", path: "/settings/profile", auth: true },
  { name: "settings/organization", path: "/settings/organization", auth: true },
  { name: "settings/security", path: "/settings/security", auth: true },
  { name: "project", path: () => (PROJECT_ID ? `/projects/${PROJECT_ID}` : null), auth: true },
];

const THEMES = ["light", "dark"];

/** Chrome, wherever this machine keeps it. */
function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || null;
}

const exe = chromePath();
const launchOptions = exe ? { executablePath: exe } : { channel: "chrome" };

const browser = await chromium.launch({ ...launchOptions, headless: true }).catch((err) => {
  console.error(
    "\nCould not launch Chrome.\n\n" +
      "This check drives the system browser rather than downloading one. Set\n" +
      "CHROME_PATH, or install Chrome/Chromium. In CI, ubuntu-latest already\n" +
      "has it at /usr/bin/google-chrome.\n\n" +
      String(err.message).split("\n")[0] +
      "\n"
  );
  process.exit(2);
});

const results = {};
let hardFailures = 0;

try {
  for (const theme of THEMES) {
    const context = await browser.newContext({
      colorScheme: theme === "dark" ? "dark" : "light",
      viewport: { width: 1440, height: 900 },
    });

    if (TOKEN) {
      await context.addCookies([
        {
          name: "eitekh_session_token",
          value: TOKEN,
          url: BASE,
        },
      ]);
    }

    for (const spec of PAGES) {
      const path = typeof spec.path === "function" ? spec.path() : spec.path;
      if (!path) continue;
      if (spec.auth && !TOKEN) continue;

      const key = `${spec.name} [${theme}]`;
      const page = await context.newPage();

      try {
        const res = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (!res || res.status() >= 400) {
          console.log(`SKIP  ${key.padEnd(34)} (status ${res ? res.status() : "none"})`);
          await page.close();
          continue;
        }

        // The app hydrates and then fetches; axe on a skeleton measures the
        // skeleton. Wait for the network to settle, but do not fail the whole
        // run if a background poll keeps it busy.
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

        // Force the theme, since the app may persist its own preference.
        await page.evaluate((t) => {
          document.documentElement.classList.toggle("dark", t === "dark");
          document.documentElement.setAttribute("data-theme", t);
        }, theme);
        await page.waitForTimeout(300);

        const axe = new AxeBuilder({ page }).withTags([
          "wcag2a",
          "wcag2aa",
          "wcag21a",
          "wcag21aa",
        ]);
        const out = await axe.analyze();

        const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
        const detail = [];
        for (const v of out.violations) {
          counts[v.impact ?? "minor"] = (counts[v.impact ?? "minor"] ?? 0) + v.nodes.length;
          detail.push({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.length,
            help: v.help,
            // The selectors, so the baseline tells you WHERE as well as how many.
            // A count alone is a number to argue about; a selector is a fix.
            targets: v.nodes.slice(0, 12).map((n) => ({
              target: String(n.target[0]).slice(0, 160),
              summary: String(n.failureSummary || "")
                .split(/\r?\n/)
                .slice(1, 3)
                .join(" | ")
                .slice(0, 200),
            })),
          });
        }

        results[key] = { counts, detail };

        const hard = counts.critical + counts.serious;
        console.log(
          `${hard > 0 ? "FAIL " : "ok   "} ${key.padEnd(34)} ` +
            `critical ${counts.critical}  serious ${counts.serious}  ` +
            `moderate ${counts.moderate}  minor ${counts.minor}`
        );
      } catch (err) {
        console.log(`ERROR ${key.padEnd(34)} ${String(err.message).split("\n")[0].slice(0, 70)}`);
      } finally {
        await page.close();
      }
    }

    await context.close();
  }
} finally {
  await browser.close();
}

if (Object.keys(results).length === 0) {
  console.error(
    "\nNo pages were analysed.\n\n" +
      "Is the server running at " + BASE + "? For the authenticated pages, set\n" +
      "AXE_SESSION_TOKEN and AXE_PROJECT_ID — scripts/run-axe.mjs does both.\n"
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
const flat = {};
for (const [key, r] of Object.entries(results)) {
  flat[key] = r.counts.critical + r.counts.serious;
}

if (updating) {
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify(
      {
        $comment:
          "D3 — axe baseline: critical + serious violations per page and theme. " +
          "May go DOWN freely; going up fails the build. Regenerate with: " +
          "node scripts/check-axe.mjs --update",
        pages: flat,
        detail: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.detail])),
      },
      null,
      2
    ) + "\n"
  );
  const total = Object.values(flat).reduce((a, b) => a + b, 0);
  console.log(`\nWrote ${BASELINE_FILE}: ${total} critical+serious across ${Object.keys(flat).length} page/theme combinations.`);
  process.exit(0);
}

if (!existsSync(BASELINE_FILE)) {
  console.error(`\nNo ${BASELINE_FILE}. Create it with:\n\n  node scripts/check-axe.mjs --update\n`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
const worse = [];
for (const [key, count] of Object.entries(flat)) {
  const was = baseline.pages[key] ?? 0;
  if (count > was) worse.push({ key, was, now: count });
}

const total = Object.values(flat).reduce((a, b) => a + b, 0);
const baseTotal = Object.values(baseline.pages ?? {}).reduce((a, b) => a + b, 0);
console.log(`\naxe: ${total} critical+serious (baseline ${baseTotal})`);

if (worse.length) {
  console.error(`\n${worse.length} page(s) got worse:\n`);
  for (const w of worse) {
    console.error(`  ${w.key}  ${w.was} -> ${w.now}`);
    for (const d of results[w.key].detail.filter((d) => d.impact === "critical" || d.impact === "serious")) {
      console.error(`      ${d.id} (${d.nodes}): ${d.help}`);
    }
  }
  process.exit(1);
}

if (total < baseTotal) {
  console.log(`\nDown ${baseTotal - total}. Re-baseline to lock it in:\n  node scripts/check-axe.mjs --update\n`);
}

console.log("\nNo page regressed.\n");
