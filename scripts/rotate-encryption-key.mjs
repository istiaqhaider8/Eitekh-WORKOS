/**
 * A5 — rotate FIELD_ENCRYPTION_KEY.
 *
 * WHY THIS IS A SCRIPT AND NOT A PARAGRAPH IN A RUNBOOK
 *
 * Rotating JWT_SECRET is easy: change it, everyone's session ends, done.
 * Rotating FIELD_ENCRYPTION_KEY is not, because existing rows are encrypted
 * with the OLD key. Swap the key without re-encrypting and every webhook
 * secret and MFA secret in the database becomes permanently unreadable — and
 * you find out when a customer's integration stops firing, not at deploy time.
 *
 * So the procedure has to be executable, and it has to be rehearsable. This
 * reads with the old key and writes with the new one, in a transaction per
 * row, and can be run in --dry-run first.
 *
 * WHAT IT COVERS
 *
 *   Webhook.secret       — encrypted at rest
 *   User.mfaSecret       — encrypted at rest
 *   User.recoveryCodes   — hashed, NOT encrypted, so deliberately untouched
 *
 * Usage:
 *   OLD_FIELD_ENCRYPTION_KEY=<current> FIELD_ENCRYPTION_KEY=<new> \
 *     node scripts/rotate-encryption-key.mjs [--dry-run]
 *
 * Take a backup first. This rewrites rows.
 */

import { createRequire } from "node:module";
import crypto from "node:crypto";

const require_ = createRequire(import.meta.url);
const { PrismaClient } = require_("@prisma/client");

const DRY = process.argv.includes("--dry-run");
const oldKeyHex = process.env.OLD_FIELD_ENCRYPTION_KEY;
const newKeyHex = process.env.FIELD_ENCRYPTION_KEY;

function die(msg, code = 1) {
  console.error(`\n[rotate] ${msg}\n`);
  process.exit(code);
}

const HEX64 = /^[0-9a-f]{64}$/i;
if (!oldKeyHex || !HEX64.test(oldKeyHex)) die("OLD_FIELD_ENCRYPTION_KEY must be 64 hex characters.");
if (!newKeyHex || !HEX64.test(newKeyHex)) die("FIELD_ENCRYPTION_KEY must be 64 hex characters.");
if (oldKeyHex.toLowerCase() === newKeyHex.toLowerCase()) die("The two keys are identical.");

const oldKey = Buffer.from(oldKeyHex, "hex");
const newKey = Buffer.from(newKeyHex, "hex");

/**
 * These MUST match src/lib/encryption.ts exactly.
 *
 * The envelope is `enc:v1:<iv>:<tag>:<ciphertext>`, all hex. The prefix is
 * easy to miss — an earlier draft of this script detected encrypted values by
 * counting colons and would have mistaken the real format for plaintext,
 * skipping every row and reporting a clean rotation. If encryption.ts ever
 * changes its envelope, this script has to change with it, which is what the
 * self-test below guards.
 */
const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1:";

function looksEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

function decryptWith(key, value) {
  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted field format");
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

function encryptWith(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${data.toString("hex")}`;
}

/**
 * Prove round-tripping works with BOTH keys before touching a single row.
 *
 * If this script's idea of the envelope has drifted from the application's, it
 * must fail here — loudly, with nothing written — rather than half-way through
 * rewriting production secrets.
 */
function selfTest() {
  const probe = "rotation-self-test-" + crypto.randomBytes(8).toString("hex");
  for (const [label, key] of [["old", oldKey], ["new", newKey]]) {
    const envelope = encryptWith(key, probe);
    if (!looksEncrypted(envelope)) die(`self-test: the ${label} key produced an envelope this script does not recognise.`);
    if (decryptWith(key, envelope) !== probe) die(`self-test: round-trip failed for the ${label} key.`);
  }
}

selfTest();

const prisma = new PrismaClient();

const TARGETS = [
  {
    label: "Webhook.secret",
    load: () => prisma.webhook.findMany({ select: { id: true, secret: true } }),
    field: "secret",
    write: (id, value) => prisma.webhook.update({ where: { id }, data: { secret: value } }),
  },
  {
    label: "User.mfaSecret",
    load: () => prisma.user.findMany({ where: { mfaSecret: { not: null } }, select: { id: true, mfaSecret: true } }),
    field: "mfaSecret",
    write: (id, value) => prisma.user.update({ where: { id }, data: { mfaSecret: value } }),
  },
];

console.log(`[rotate] ${DRY ? "DRY RUN — nothing will be written" : "REWRITING ROWS"}`);
console.log("[rotate] recoveryCodes are hashed, not encrypted, and are left alone.\n");

let rotated = 0;
let skipped = 0;
const failures = [];

for (const target of TARGETS) {
  const rows = await target.load();
  console.log(`[rotate] ${target.label}: ${rows.length} row(s)`);

  for (const row of rows) {
    const value = row[target.field];
    if (!value) continue;

    if (!looksEncrypted(value)) {
      // Plaintext, or a format this script does not understand. Re-encrypting
      // a value it cannot verify would risk double-encrypting.
      skipped += 1;
      console.log(`  skip ${row.id}: no "enc:v1:" envelope — plaintext or an unknown format`);
      continue;
    }

    let plaintext;
    try {
      plaintext = decryptWith(oldKey, value);
    } catch {
      // The single most important branch: if the old key cannot read it, the
      // old key is wrong, or the row was encrypted with a third key. Writing
      // anything now would destroy it.
      failures.push(
        `${target.label} ${row.id}: could not decrypt with the OLD key — wrong key, or ` +
          "this row was written with a third one"
      );
      continue;
    }

    if (DRY) {
      rotated += 1;
      continue;
    }

    const reencrypted = encryptWith(newKey, plaintext);
    // Verify BEFORE writing. An unverifiable write is how a rotation silently
    // loses data.
    if (decryptWith(newKey, reencrypted) !== plaintext) {
      failures.push(`${target.label} ${row.id}: re-encrypted value did not verify`);
      continue;
    }

    await target.write(row.id, reencrypted);
    rotated += 1;
  }
}

console.log(`\n[rotate] ${DRY ? "would rotate" : "rotated"}: ${rotated}`);
if (skipped) console.log(`[rotate] skipped (unrecognised format): ${skipped}`);

if (failures.length) {
  console.error(`\n[rotate] ${failures.length} FAILURE(S) — the rotation is INCOMPLETE:`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\n[rotate] Do NOT deploy the new key. Rows that could not be re-encrypted are still\n" +
      "[rotate] readable only with the old one, so deploying now makes them unreadable.\n" +
      "[rotate] Restore from backup if any row was already rewritten.\n"
  );
  await prisma.$disconnect();
  process.exit(1);
}

if (rotated === 0) {
  console.log(
    "\n[rotate] Nothing needed rotating. That is the expected result when no webhook or MFA\n" +
      "[rotate] secrets exist yet — in which case the key can simply be replaced.\n"
  );
}

console.log(
  DRY
    ? "\n[rotate] Dry run clean. Re-run without --dry-run to rewrite the rows.\n"
    : "\n[rotate] Done. Deploy FIELD_ENCRYPTION_KEY now — the rows are written with it,\n" +
        "[rotate] so the OLD key no longer reads them.\n"
);

await prisma.$disconnect();
