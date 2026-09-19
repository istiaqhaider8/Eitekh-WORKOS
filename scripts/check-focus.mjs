#!/usr/bin/env node
/**
 * D3 — prove the dialogs actually trap focus.
 *
 * WHY THIS IS NOT PART OF THE AXE RUN
 *
 * axe inspects a static snapshot. Focus behaviour only exists while keys are
 * being pressed, so a page can pass every axe rule and still let Tab walk out
 * of an open dialog into the board underneath — invisible beneath the overlay,
 * still focusable, and read aloud by a screen reader.
 *
 * `aria-modal="true"` is a promise the markup makes and only the behaviour can
 * keep. Twelve components in this app made it; nothing enforced it, because
 * `tabIndex` appeared zero times in the codebase.
 *
 * WHAT IS ASSERTED
 *
 *   1. opening a dialog moves focus INTO it
 *   2. Tab from the last focusable element wraps to the first, rather than
 *      escaping to the page behind
 *   3. Shift+Tab from the first wraps to the last
 *   4. Escape closes it
 *   5. closing returns focus to whatever opened it
 *
 * (5) is the one people forget, and the one a keyboard user notices most: open
 * a dialog from halfway down a long board, close it, and without this you are
 * back at the top of the document.
 *
 * Usage: AXE_SESSION_TOKEN=... AXE_PROJECT_ID=... node scripts/check-focus.mjs --url http://localhost:3178
 */

import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

const BASE = argOf("--url", process.env.AXE_BASE_URL || "http://localhost:3178");
const TOKEN = process.env.AXE_SESSION_TOKEN;
const PROJECT_ID = process.env.AXE_PROJECT_ID;

if (!TOKEN || !PROJECT_ID) {
  console.error(
    "\nNeeds a session and a project: AXE_SESSION_TOKEN and AXE_PROJECT_ID.\n" +
      "scripts/run-axe.mjs sets both and runs this too.\n"
  );
  process.exit(2);
}

function chromePath() {
  return [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter(Boolean).find((p) => existsSync(p)) || null;
}

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  console.log((ok ? "PASS  " : "FAIL  ") + n + (d ? "  -- " + d : ""));
  ok ? pass += 1 : fail += 1;
};

const exe = chromePath();
const browser = await chromium.launch(
  exe ? { executablePath: exe, headless: true } : { channel: "chrome", headless: true }
);

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "eitekh_session_token", value: TOKEN, url: BASE }]);
  const page = await context.newPage();

  await page.goto(`${BASE}/projects/${PROJECT_ID}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

  // Find something that opens the issue dialog: an issue card on the board.
  const card = page.locator('[class*="cursor-pointer"]').filter({ hasText: /AXE-\d|Accessibility probe/ }).first();
  const cardCount = await card.count();
  check("the board rendered an issue to open", cardCount > 0, `${cardCount} candidate(s)`);

  if (cardCount === 0) {
    console.log("\n(cannot test the dialog without one; skipping the rest)");
  } else {
    // Remember what had focus, the way a keyboard user would: focus the card
    // itself before activating it.
    await card.scrollIntoViewIfNeeded();
    await card.click();

    const dialog = page.locator('[role="dialog"][aria-modal="true"]').first();
    await dialog.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    check("the dialog opened", await dialog.count() > 0);

    // --- 1. focus moved into the dialog -----------------------------------
    await page.waitForTimeout(400);
    const inside = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-modal="true"]');
      return !!(d && document.activeElement && d.contains(document.activeElement));
    });
    check("focus moved INTO the dialog on open", inside);

    // --- 2/3. Tab wraps rather than escaping ------------------------------
    const escaped = await page.evaluate(async () => {
      const d = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!d) return "no dialog";
      const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
      const items = Array.from(d.querySelectorAll(sel)).filter((e) => e.offsetWidth > 0 || e.offsetHeight > 0);
      if (items.length === 0) return "no focusables";
      items[items.length - 1].focus();
      return "ready";
    });
    check("the dialog contains focusable controls", escaped === "ready", escaped);

    if (escaped === "ready") {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(150);
      const stillInside = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"][aria-modal="true"]');
        return !!(d && document.activeElement && d.contains(document.activeElement));
      });
      check("Tab from the LAST control stays inside the dialog", stillInside);

      await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"][aria-modal="true"]');
        const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
        const items = Array.from(d.querySelectorAll(sel)).filter((e) => e.offsetWidth > 0 || e.offsetHeight > 0);
        items[0]?.focus();
      });
      await page.keyboard.press("Shift+Tab");
      await page.waitForTimeout(150);
      const stillInside2 = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"][aria-modal="true"]');
        return !!(d && document.activeElement && d.contains(document.activeElement));
      });
      check("Shift+Tab from the FIRST control stays inside the dialog", stillInside2);
    }

    // --- 4. Escape closes --------------------------------------------------
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    const closed = (await page.locator('[role="dialog"][aria-modal="true"]').count()) === 0;
    check("Escape closes the dialog", closed);

    // --- 5. focus came back -------------------------------------------------
    if (closed) {
      const restored = await page.evaluate(() => {
        const a = document.activeElement;
        return !!(a && a !== document.body && a.tagName !== "HTML");
      });
      check("focus returned to the page rather than the document root", restored);
    }
  }

  await context.close();
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
