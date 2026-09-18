/**
 * PROD-3 / B13 — one-time migration of `.data/pbac-store.json` into Postgres.
 *
 * The PBAC authorization model used to live in a JSON file on one instance's
 * disk. This moves it into the `PbacRole` / `PbacUserRoleAssignment` /
 * `PbacAuditRecord` / `PbacOrgState` tables.
 *
 * Properties this script is built around:
 *
 *   - It is IDEMPOTENT. Roles and audit records upsert by primary key, and
 *     assignments use skipDuplicates, so running it twice changes nothing.
 *   - It does NOT delete the source file. A migration that removes its own
 *     input cannot be re-run or checked afterwards. Rename the file by hand
 *     once you are satisfied; the engine no longer reads it either way.
 *   - It REPORTS what it skipped rather than dropping it quietly. Assignments
 *     can reference roles that no longer exist; those rows would violate the
 *     foreign key, and silently discarding them is how a migration appears to
 *     succeed while losing grants.
 *
 * Usage:  node scripts/migrate-pbac-store.mjs [--dry-run]
 */

import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require_ = createRequire(import.meta.url);
const { PrismaClient } = require_("@prisma/client");

const DRY_RUN = process.argv.includes("--dry-run");
const STORE_PATH = path.join(process.cwd(), ".data", "pbac-store.json");

const prisma = new PrismaClient();

function iso(value, fallback) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : fallback;
}

async function main() {
  if (!existsSync(STORE_PATH)) {
    console.log(`No store file at ${STORE_PATH} — nothing to migrate.`);
    return;
  }

  const raw = JSON.parse(readFileSync(STORE_PATH, "utf8"));
  const roles = Array.isArray(raw.roles) ? raw.roles : [];
  const assignmentsByUser = raw.userRoleAssignments ?? {};
  const auditLogs = Array.isArray(raw.auditLogs) ? raw.auditLogs : [];
  const initializedOrgs = Array.isArray(raw.initializedOrgs) ? raw.initializedOrgs : [];

  console.log(`Source: ${STORE_PATH}`);
  console.log(
    `  ${roles.length} roles, ${Object.keys(assignmentsByUser).length} users with ` +
      `assignments, ${auditLogs.length} audit records, ${initializedOrgs.length} seeded orgs`
  );
  if (DRY_RUN) console.log("  (dry run — nothing will be written)\n");

  // A role without an id or orgId cannot be addressed or scoped; it is not
  // migratable and is reported rather than guessed at.
  const usableRoles = [];
  const unusableRoles = [];
  for (const r of roles) {
    if (r?.id && r?.orgId) usableRoles.push(r);
    else unusableRoles.push(r);
  }

  const roleIds = new Set(usableRoles.map((r) => r.id));
  const orgByRoleId = new Map(usableRoles.map((r) => [r.id, r.orgId]));

  // Flatten assignments and drop the ones whose role no longer exists: those
  // grants are already inert (the engine resolves permissions through roles),
  // and inserting them would violate the foreign key.
  const pairs = [];
  const orphanedPairs = [];
  for (const [userId, ids] of Object.entries(assignmentsByUser)) {
    if (!Array.isArray(ids)) continue;
    for (const roleId of ids) {
      if (roleIds.has(roleId)) {
        pairs.push({ userId, roleId, orgId: orgByRoleId.get(roleId) });
      } else {
        orphanedPairs.push({ userId, roleId });
      }
    }
  }

  const usableAudit = auditLogs.filter((a) => a?.id && a?.orgId);

  console.log("Plan:");
  console.log(`  roles to write ............ ${usableRoles.length}`);
  console.log(`  assignments to write ...... ${pairs.length}`);
  console.log(`  audit records to write .... ${usableAudit.length}`);
  console.log(`  orgs to mark seeded ....... ${initializedOrgs.length}`);
  if (unusableRoles.length) console.log(`  SKIPPED roles (no id/orgId) . ${unusableRoles.length}`);
  if (orphanedPairs.length) {
    console.log(`  SKIPPED assignments (role no longer exists) . ${orphanedPairs.length}`);
    const sample = orphanedPairs.slice(0, 5).map((p) => `${p.userId}->${p.roleId}`);
    console.log(`    e.g. ${sample.join(", ")}`);
  }
  if (auditLogs.length !== usableAudit.length) {
    console.log(`  SKIPPED audit records (no id/orgId) . ${auditLogs.length - usableAudit.length}`);
  }

  if (DRY_RUN) {
    await prisma.$disconnect();
    return;
  }

  console.log("\nWriting...");

  for (const r of usableRoles) {
    const data = {
      orgId: r.orgId,
      name: r.name ?? r.slug ?? r.id,
      slug: r.slug ?? r.id,
      description: r.description ?? "",
      scope: r.scope ?? "ORG",
      projectId: r.projectId ?? null,
      projectName: r.projectName ?? null,
      status: r.status ?? "ACTIVE",
      isSystem: Boolean(r.isSystem),
      permissions: Array.isArray(r.permissions) ? r.permissions : [],
      createdBy: r.createdBy ?? null,
      updatedAt: iso(r.updatedAt, new Date()),
    };
    await prisma.pbacRole.upsert({
      where: { id: r.id },
      create: { id: r.id, ...data, createdAt: iso(r.createdAt, new Date()) },
      update: data,
    });
  }
  console.log(`  roles written: ${usableRoles.length}`);

  if (pairs.length) {
    const res = await prisma.pbacUserRoleAssignment.createMany({
      data: pairs,
      skipDuplicates: true,
    });
    console.log(`  assignments written: ${res.count} (of ${pairs.length}; the rest already existed)`);
  }

  let auditWritten = 0;
  for (const a of usableAudit) {
    await prisma.pbacAuditRecord.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        orgId: a.orgId,
        actorId: a.actorId ?? "unknown",
        actorName: a.actorName ?? "",
        actorEmail: a.actorEmail ?? "",
        action: a.action ?? "UNKNOWN",
        entityType: a.entityType ?? "SYSTEM",
        entityId: a.entityId ?? "",
        entityName: a.entityName ?? null,
        previousState: a.previousState ?? null,
        newState: a.newState ?? null,
        status: a.status ?? "SUCCESS",
        errorDetails: a.errorDetails ?? null,
        createdAt: iso(a.createdAt, new Date()),
      },
      update: {},
    });
    auditWritten += 1;
  }
  console.log(`  audit records written: ${auditWritten}`);

  // Every org that owns a role is seeded, plus any explicitly recorded as
  // initialized. Marking seeded prevents the engine re-seeding system roles
  // over the migrated ones.
  const seededOrgs = new Set([...initializedOrgs, ...usableRoles.map((r) => r.orgId)]);
  for (const orgId of seededOrgs) {
    await prisma.pbacOrgState.upsert({
      where: { orgId },
      create: { orgId, seeded: true, version: 1, updatedAt: new Date() },
      update: { seeded: true },
    });
  }
  console.log(`  orgs marked seeded: ${seededOrgs.size}`);

  // Read back, so the summary is what the database holds rather than what the
  // script believes it wrote.
  const [roleCount, assignCount, auditCount, stateCount] = await Promise.all([
    prisma.pbacRole.count(),
    prisma.pbacUserRoleAssignment.count(),
    prisma.pbacAuditRecord.count(),
    prisma.pbacOrgState.count(),
  ]);
  console.log("\nIn the database now:");
  console.log(`  PbacRole ................ ${roleCount}`);
  console.log(`  PbacUserRoleAssignment .. ${assignCount}`);
  console.log(`  PbacAuditRecord ......... ${auditCount}`);
  console.log(`  PbacOrgState ............ ${stateCount}`);
  console.log(
    `\nThe source file was left in place at ${STORE_PATH}.\n` +
      "The engine no longer reads it. Rename or delete it once you are satisfied."
  );
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
