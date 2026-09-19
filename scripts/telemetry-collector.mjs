/**
 * PROD-7 — a local telemetry collector, for verification.
 *
 * WHY THIS EXISTS
 *
 * The acceptance criterion is "throw a deliberate error; confirm it arrives
 * scrubbed and alerts fire". Confirming that needs a destination. Pointing a
 * verification run at a third-party service would send this application's data
 * off the machine, which is not a decision to make on someone's behalf — and
 * it would need credentials nobody has provided.
 *
 * So this is a destination that stays on the machine: a tiny HTTP server that
 * accepts the same JSON POST a real collector would, prints what it received,
 * and writes it to a file so the assertions can be made against real captured
 * traffic rather than against intent.
 *
 * It is a TEST TOOL. It is not a collector to run in production — there is no
 * retention, no auth, no durability.
 *
 * Usage:
 *   node scripts/telemetry-collector.mjs [--port 4318] [--out events.jsonl]
 *
 * Then point the app at it:
 *   TELEMETRY_ENDPOINT=http://127.0.0.1:4318/ingest
 *   ALERT_WEBHOOK_URL=http://127.0.0.1:4318/alerts
 */

import { createServer } from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT = Number(argOf("--port", 4318));
const OUT = argOf("--out", "telemetry-events.jsonl");
const QUIET = argv.includes("--quiet");

// Start from empty, so a run's assertions cannot accidentally pass on events
// left behind by a previous one.
writeFileSync(OUT, "");

let events = 0;
let alerts = 0;

const server = createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const kind = req.url?.includes("alert") ? "alert" : "event";
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = { unparseable: body.slice(0, 500) };
    }

    appendFileSync(OUT, JSON.stringify({ kind, receivedAt: new Date().toISOString(), payload: parsed }) + "\n");

    if (kind === "alert") {
      alerts += 1;
      if (!QUIET) console.log(`[collector] ALERT  ${parsed?.text ?? JSON.stringify(parsed).slice(0, 160)}`);
    } else {
      events += 1;
      if (!QUIET) {
        const p = parsed ?? {};
        console.log(`[collector] event  ${p.severity ?? "?"} ${p.action ?? "?"}: ${String(p.message ?? "").slice(0, 120)}`);
      }
    }

    res.writeHead(204).end();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[collector] listening on http://127.0.0.1:${PORT} — writing ${OUT}`);
  console.log("[collector]   events: POST /ingest      alerts: POST /alerts");
});

const summarise = () => {
  console.log(`\n[collector] received ${events} event(s) and ${alerts} alert(s); see ${OUT}`);
  process.exit(0);
};
process.on("SIGINT", summarise);
process.on("SIGTERM", summarise);
