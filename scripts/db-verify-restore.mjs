/**
 * A1 — prove a restore actually restored.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE RESTORE ITSELF
 *
 * `pg_restore` exiting 0 means it finished, not that the data is there. A
 * restore can complete having skipped rows it could not insert, or having run
 * against the wrong database, or from a dump that was truncated while being
 * copied off-host. The usual way teams discover this is during the incident
 * the backup existed for.
 *
 * So this compares two databases table by table: row counts, and a per-table
 * checksum over the primary keys. It needs no client binaries, which matters
 * because the machine this was written on has none — and because it means the
 * check can run anywhere, including from inside the app.
 *
 * Usage:
 *   node scripts/db-verify-restore.mjs <source-url> <restored-url> [--quiet]
 *
 * Exit code 0 means every table matched. Anything else means do not trust the
 * backup.
 */

import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { Client } = require_("pg");

const [sourceUrl, targetUrl] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const QUIET = process.argv.includes("--quiet");

if (!sourceUrl || !targetUrl) {
  console.error(
    "usage: node scripts/db-verify-restore.mjs <source-url> <restored-url>\n" +
      "Compares row counts and primary-key checksums across every table."
  );
  process.exit(2);
}

if (sourceUrl === targetUrl) {
  // Comparing a database with itself always passes and proves nothing.
  console.error("Refusing to compare a database with itself.");
  process.exit(2);
}

async function connect(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}

/** Every user table, in a stable order. */
async function tables(client) {
  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
      ORDER BY tablename`
  );
  return rows.map((r) => r.tablename);
}

/** The primary key column(s) of a table, so the checksum is order-independent. */
async function primaryKey(client, table) {
  const { rows } = await client.query(
    `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary
      ORDER BY a.attname`,
    [`"${table}"`]
  );
  return rows.map((r) => r.attname);
}

/**
 * Sum of per-row hashes. Order-independent by construction, so it does not
 * matter that a restore may write rows in a different physical order — which
 * it will.
 */
async function checksum(client, table, pk) {
  if (pk.length === 0) return null;
  const expr = pk.map((c) => `COALESCE("${c}"::text, '')`).join(" || '|' || ");
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(('x' || substr(md5(${expr}), 1, 8))::bit(32)::bigint), 0)::text AS sum
       FROM "${table}"`
  );
  return rows[0].sum;
}

async function snapshot(url, label) {
  const client = await connect(url);
  try {
    const out = new Map();
    for (const t of await tables(client)) {
      const { rows } = await client.query(`SELECT count(*)::bigint AS n FROM "${t}"`);
      const pk = await primaryKey(client, t);
      out.set(t, { rows: Number(rows[0].n), pk, checksum: await checksum(client, t, pk) });
    }
    if (!QUIET) console.log(`[verify] ${label}: ${out.size} tables read`);
    return out;
  } finally {
    await client.end();
  }
}

const source = await snapshot(sourceUrl, "source  ");
const target = await snapshot(targetUrl, "restored");

const problems = [];
let matched = 0;
let sourceRows = 0;

for (const [table, s] of source) {
  sourceRows += s.rows;
  const t = target.get(table);

  if (!t) {
    problems.push(`${table}: MISSING from the restored database`);
    continue;
  }
  if (s.rows !== t.rows) {
    problems.push(`${table}: ${s.rows} rows in source, ${t.rows} restored (${t.rows - s.rows})`);
    continue;
  }
  if (s.checksum !== null && s.checksum !== t.checksum) {
    // Same count, different contents — the failure a row count alone misses,
    // and the one most likely to go unnoticed.
    problems.push(`${table}: ${s.rows} rows both sides but the key checksums differ`);
    continue;
  }
  matched += 1;
}

for (const table of target.keys()) {
  if (!source.has(table)) problems.push(`${table}: present in the restore but not in the source`);
}

console.log(
  `\n[verify] ${matched}/${source.size} tables match, ${sourceRows.toLocaleString()} source rows checked`
);

if (problems.length) {
  console.error(`\n[verify] ${problems.length} PROBLEM(S) — do not trust this backup:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// An empty source would match an empty target and prove nothing.
if (sourceRows === 0) {
  console.error("\n[verify] The source database is empty. This comparison proves nothing.");
  process.exit(1);
}

console.log("[verify] restore verified");
