#!/usr/bin/env node
/**
 * C2 — check SPF, DKIM and DMARC for the sending domain.
 *
 * WHY THIS IS A SCRIPT AND NOT A LINE IN A CHECKLIST
 *
 * "SPF/DKIM/DMARC configured" is the kind of item that gets ticked because
 * somebody remembers adding a TXT record once. The failure it guards against
 * is silent and delayed: mail keeps being accepted by the provider and keeps
 * being filed as spam by the recipient, so the app reports success and the
 * user never sees the invitation. Nothing in the application can detect it.
 *
 * The flows affected are the ones a locked-out user cannot work around —
 * password reset, OTP, invitation — and "check your spam folder" is a poor
 * answer to a customer who cannot get in.
 *
 * So the check is executable, runs against real DNS, and is meant to be run
 * again whenever the sending domain or provider changes. It reports what is
 * actually published, not what somebody intended to publish.
 *
 * WHAT IT CANNOT DO
 *
 * It cannot tell you the records are CORRECT for your provider — only that
 * they exist and are well-formed. A DKIM selector that belongs to a provider
 * you no longer use looks identical to one that works. Send a real message and
 * read the Authentication-Results header; there is no substitute.
 *
 * Usage:
 *   node scripts/check-email-dns.mjs --domain eitekh.com [--selector google]
 *   node scripts/check-email-dns.mjs            # uses BASE_URL / EMAIL_FROM
 *
 * Exit: 0 all present, 1 something missing or malformed, 2 nothing to check.
 */

import { Resolver } from "node:dns/promises";

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : d;
};

/** Common DKIM selectors, so a bare run finds a record without being told. */
const COMMON_SELECTORS = [
  "google", "selector1", "selector2", "s1", "s2", "k1", "mail",
  "dkim", "default", "mandrill", "sendgrid", "postmark", "zoho", "resend",
];

function domainFromEnv() {
  const from = process.env.EMAIL_FROM;
  if (from && from.includes("@")) return from.split("@")[1].trim();
  const base = process.env.BASE_URL || process.env.NEXTAUTH_URL;
  if (base) {
    try {
      return new URL(base).hostname;
    } catch { /* not a URL */ }
  }
  return null;
}

const domain = argOf("--domain", domainFromEnv());
const explicitSelector = argOf("--selector", process.env.DKIM_SELECTOR);

if (!domain) {
  console.error(
    "\nNo domain to check.\n\n" +
      "Pass --domain, or set EMAIL_FROM (the domain is taken from the address)\n" +
      "or BASE_URL.\n"
  );
  process.exit(2);
}

if (/localhost|127\.0\.0\.1|\.(test|invalid|example|local)$/i.test(domain)) {
  console.error(
    `\nRefusing to check "${domain}": it is a local or reserved name, not a\n` +
      "sending domain. This check is meaningful only against the real public\n" +
      "domain mail will be sent FROM.\n"
  );
  process.exit(2);
}

const resolver = new Resolver();
resolver.setServers(["1.1.1.1", "8.8.8.8"]);

async function txt(name) {
  try {
    // Each record can arrive as several strings that must be concatenated.
    return (await resolver.resolveTxt(name)).map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

let failures = 0;
const report = (ok, label, detail) => {
  console.log(`${ok ? "PASS " : "FAIL "} ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures += 1;
};

console.log(`\nChecking mail authentication for ${domain}\n${"-".repeat(50)}`);

// ------------------------------------------------------------------- SPF
const spfRecords = (await txt(domain)).filter((r) => r.toLowerCase().startsWith("v=spf1"));

if (spfRecords.length === 0) {
  report(false, "SPF", "no v=spf1 TXT record. Receivers cannot tell which servers may send as you.");
} else if (spfRecords.length > 1) {
  // More than one is not "extra safe": RFC 7208 says a domain with multiple
  // SPF records is a PermError, which is worse than having none.
  report(false, "SPF", `${spfRecords.length} SPF records. More than one is a permanent error; merge them.`);
} else {
  const spf = spfRecords[0];
  const all = spf.match(/([-~?+])all\b/);
  if (!all) {
    report(false, "SPF", `record present but has no "all" mechanism: ${spf}`);
  } else if (all[1] === "+") {
    report(false, "SPF", '"+all" permits the entire internet to send as you, which is the same as no SPF.');
  } else {
    report(true, "SPF", `${all[1]}all${all[1] === "?" ? "  (neutral — consider ~all or -all)" : ""}`);
  }
}

// ------------------------------------------------------------------ DKIM
const selectors = explicitSelector ? [explicitSelector] : COMMON_SELECTORS;
const foundSelectors = [];

for (const sel of selectors) {
  const records = await txt(`${sel}._domainkey.${domain}`);
  const key = records.find((r) => /(^|;)\s*(v=DKIM1|k=rsa|p=)/i.test(r));
  if (key) foundSelectors.push({ selector: sel, hasPublicKey: /p=[A-Za-z0-9+/]/.test(key) });
}

if (foundSelectors.length === 0) {
  report(
    false,
    "DKIM",
    explicitSelector
      ? `no key at ${explicitSelector}._domainkey.${domain}`
      : `no key found at any common selector. Pass --selector <name> if yours is unusual.`
  );
} else {
  const revoked = foundSelectors.filter((s) => !s.hasPublicKey);
  if (revoked.length === foundSelectors.length) {
    // An empty p= is a REVOKED key, and it looks like a present record.
    report(false, "DKIM", `record(s) found but with an empty p= (revoked): ${revoked.map((s) => s.selector).join(", ")}`);
  } else {
    report(true, "DKIM", `selector(s): ${foundSelectors.filter((s) => s.hasPublicKey).map((s) => s.selector).join(", ")}`);
  }
}

// ----------------------------------------------------------------- DMARC
const dmarcRecords = (await txt(`_dmarc.${domain}`)).filter((r) => r.toLowerCase().startsWith("v=dmarc1"));

if (dmarcRecords.length === 0) {
  report(false, "DMARC", "no _dmarc TXT record. Nothing tells receivers what to do when SPF and DKIM fail.");
} else {
  const dmarc = dmarcRecords[0];
  const policy = dmarc.match(/\bp\s*=\s*(none|quarantine|reject)\b/i);
  const rua = /\brua\s*=/.test(dmarc);

  if (!policy) {
    report(false, "DMARC", `record present but has no p= policy: ${dmarc}`);
  } else {
    const p = policy[1].toLowerCase();
    // p=none is a legitimate starting point — it collects reports without
    // affecting delivery — but it enforces nothing, so say so rather than
    // passing it silently.
    report(true, "DMARC", `p=${p}${p === "none" ? "  (monitoring only; nothing is enforced yet)" : ""}`);
    if (!rua) {
      console.log("      note: no rua= address, so you will never see the aggregate reports.");
    }
  }
}

console.log("-".repeat(50));

if (failures > 0) {
  console.error(
    `\n${failures} check(s) failed.\n\n` +
      "Until these are right, password resets, OTP codes and invitations will be\n" +
      "accepted by your provider and filed as spam by recipients — the app will\n" +
      "report success either way.\n\n" +
      "After fixing them, send a real message to a Gmail account and read the\n" +
      "Authentication-Results header. DNS records being present is not the same\n" +
      "as them being right for your provider.\n"
  );
  process.exit(1);
}

console.log(
  "\nAll three are published.\n\n" +
    "This proves the records EXIST and parse. It does not prove they match your\n" +
    "provider — a DKIM selector left over from a provider you no longer use looks\n" +
    "identical to a working one. Send a real message and read the\n" +
    "Authentication-Results header to confirm.\n"
);
