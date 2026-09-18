/**
 * PROD-3 / B13 — persistence for the PBAC authorization model.
 *
 * WHAT WAS WRONG
 *
 * The engine kept roles, assignments and audit records in in-memory `Map`s and
 * persisted the lot to `.data/pbac-store.json` on the local disk. With more
 * than one instance that is not a caching problem, it is split-brain in the
 * permission system:
 *
 *   - Each instance held its own copy of the authorization model and wrote its
 *     own file. A role created on instance A did not exist on instance B.
 *   - `invalidateUserCache()` evicted only the calling process, so a revoked
 *     permission stayed live everywhere else — indefinitely, not briefly.
 *   - The whole model was rewritten on every mutation, so two instances saving
 *     concurrently silently discarded one another's changes.
 *
 * WHAT REPLACES IT
 *
 * The model lives in Postgres (`PbacRole`, `PbacUserRoleAssignment`,
 * `PbacAuditRecord`, `PbacOrgState`). This module owns every read and write,
 * and the engine keeps its Maps purely as a read-through cache.
 *
 * Writes are PER ENTITY, not whole-model. That is the point of the rewrite
 * rather than an optimisation: a whole-model write from instance A would undo
 * a role instance B created a moment earlier, which is the same class of bug
 * in a new location.
 *
 * HOW INSTANCES STAY CONSISTENT
 *
 * `PbacOrgState.version` is bumped on every mutation to an organization's
 * model. Readers re-check that version at most every `VERSION_POLL_MS` and
 * reload when it has moved, which bounds staleness to that interval rather
 * than leaving it unbounded. The version is also stamped into capability-cache
 * keys, so a bump makes every stale entry unreachable with no sweep required.
 *
 * The honest limitation: this is polling, so a revoked permission can still be
 * honoured on another instance for up to VERSION_POLL_MS. That is a documented
 * bound replacing "forever", and the acceptance criterion asks for exactly
 * that. Push invalidation needs a pub/sub channel; PROD-4 has to introduce one
 * for SSE fan-out, and this should move onto it then.
 */

import { prisma } from "./prisma";
import { logger } from "./logger";

export interface StoredRole {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description: string;
  scope: "PROJECT" | "WORKSPACE" | "ORG";
  projectId?: string | null;
  projectName?: string | null;
  status: "ACTIVE" | "INACTIVE";
  isSystem: boolean;
  permissions: string[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAudit {
  id: string;
  orgId: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  action: string;
  entityType: "ROLE" | "USER_ROLE" | "SYSTEM";
  entityId: string;
  entityName?: string;
  previousState?: unknown;
  newState?: unknown;
  status: "SUCCESS" | "FAILURE";
  errorDetails?: string;
  createdAt: string;
}

/**
 * How long an instance may serve its cached copy before re-checking the
 * version. This is the upper bound on how long a permission change takes to
 * reach another instance.
 *
 * Two seconds is a deliberate trade: the check is a single indexed primary-key
 * read, so the cost is one tiny query per organization per instance per two
 * seconds, and the exposure window for a revoked permission is short enough to
 * be defensible while being long enough that the check is not per-request.
 */
const VERSION_POLL_MS = 2_000;

type RoleRow = {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description: string;
  scope: string;
  projectId: string | null;
  projectName: string | null;
  status: string;
  isSystem: boolean;
  permissions: string[];
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toStoredRole(row: RoleRow): StoredRole {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    scope: row.scope as StoredRole["scope"],
    projectId: row.projectId,
    projectName: row.projectName,
    status: row.status as StoredRole["status"],
    isSystem: row.isSystem,
    permissions: row.permissions,
    createdBy: row.createdBy ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface OrgSnapshot {
  version: number;
  seeded: boolean;
  roles: StoredRole[];
  /** userId -> roleIds held by that user within this organization. */
  assignments: Map<string, Set<string>>;
}

class PbacStore {
  /** orgId -> the last version this process observed, and when it checked. */
  private versionCache = new Map<string, { version: number; checkedAt: number }>();

  /**
   * Read the organization's version, at most once per VERSION_POLL_MS.
   *
   * `force` skips the interval; the engine uses it immediately after its own
   * mutation so it never serves a copy it has just superseded.
   */
  async getVersion(orgId: string, force = false): Promise<number> {
    const cached = this.versionCache.get(orgId);
    if (!force && cached && Date.now() - cached.checkedAt < VERSION_POLL_MS) {
      return cached.version;
    }
    const row = await prisma.pbacOrgState.findUnique({
      where: { orgId },
      select: { version: true },
    });
    const version = row?.version ?? 0;
    this.versionCache.set(orgId, { version, checkedAt: Date.now() });
    return version;
  }

  /**
   * True when another instance has changed this organization's model since the
   * caller loaded it. Cheap enough to call on the read path.
   */
  async isStale(orgId: string, loadedVersion: number): Promise<boolean> {
    return (await this.getVersion(orgId)) !== loadedVersion;
  }

  /**
   * Bump the version so other instances reload.
   *
   * Every mutating method here calls this. It is a single statement so that a
   * concurrent bump cannot be lost: `increment` is applied by the database,
   * not read-modify-written by the process.
   */
  async bumpVersion(orgId: string, tx?: PrismaTx): Promise<number> {
    const client = tx ?? prisma;
    const row = await client.pbacOrgState.upsert({
      where: { orgId },
      create: { orgId, version: 1, seeded: false, updatedAt: new Date() },
      update: { version: { increment: 1 }, updatedAt: new Date() },
      select: { version: true },
    });
    this.versionCache.set(orgId, { version: row.version, checkedAt: Date.now() });
    return row.version;
  }

  /** Load one organization's entire model. */
  async loadOrg(orgId: string): Promise<OrgSnapshot> {
    const [state, roles, assignments] = await Promise.all([
      prisma.pbacOrgState.findUnique({ where: { orgId } }),
      prisma.pbacRole.findMany({ where: { orgId } }),
      prisma.pbacUserRoleAssignment.findMany({
        where: { orgId },
        select: { userId: true, roleId: true },
      }),
    ]);

    const byUser = new Map<string, Set<string>>();
    for (const a of assignments) {
      let set = byUser.get(a.userId);
      if (!set) {
        set = new Set<string>();
        byUser.set(a.userId, set);
      }
      set.add(a.roleId);
    }

    const version = state?.version ?? 0;
    this.versionCache.set(orgId, { version, checkedAt: Date.now() });

    return {
      version,
      seeded: state?.seeded ?? false,
      roles: (roles as RoleRow[]).map(toStoredRole),
      assignments: byUser,
    };
  }

  // -------------------------------------------------------------------------
  // Role writes. Each touches one role and bumps the version, so concurrent
  // edits to different roles in the same organization do not interfere.
  // -------------------------------------------------------------------------

  async upsertRole(role: StoredRole): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.pbacRole.upsert({
        where: { id: role.id },
        create: {
          id: role.id,
          orgId: role.orgId,
          name: role.name,
          slug: role.slug,
          description: role.description ?? "",
          scope: role.scope,
          projectId: role.projectId ?? null,
          projectName: role.projectName ?? null,
          status: role.status,
          isSystem: role.isSystem,
          permissions: role.permissions,
          createdBy: role.createdBy ?? null,
          createdAt: new Date(role.createdAt),
          updatedAt: new Date(role.updatedAt),
        },
        update: {
          name: role.name,
          slug: role.slug,
          description: role.description ?? "",
          scope: role.scope,
          projectId: role.projectId ?? null,
          projectName: role.projectName ?? null,
          status: role.status,
          isSystem: role.isSystem,
          permissions: role.permissions,
          updatedAt: new Date(role.updatedAt),
        },
      });
      await this.bumpVersion(role.orgId, tx);
    });
  }

  async upsertRoles(roles: StoredRole[]): Promise<void> {
    if (roles.length === 0) return;
    const orgId = roles[0].orgId;
    await prisma.$transaction(async (tx) => {
      for (const role of roles) {
        await tx.pbacRole.upsert({
          where: { id: role.id },
          create: {
            id: role.id,
            orgId: role.orgId,
            name: role.name,
            slug: role.slug,
            description: role.description ?? "",
            scope: role.scope,
            projectId: role.projectId ?? null,
            projectName: role.projectName ?? null,
            status: role.status,
            isSystem: role.isSystem,
            permissions: role.permissions,
            createdBy: role.createdBy ?? null,
            createdAt: new Date(role.createdAt),
            updatedAt: new Date(role.updatedAt),
          },
          update: {
            name: role.name,
            slug: role.slug,
            description: role.description ?? "",
            scope: role.scope,
            projectId: role.projectId ?? null,
            projectName: role.projectName ?? null,
            status: role.status,
            isSystem: role.isSystem,
            permissions: role.permissions,
            updatedAt: new Date(role.updatedAt),
          },
        });
      }
      await this.bumpVersion(orgId, tx);
    });
  }

  async deleteRole(orgId: string, roleId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // Assignments cascade from the role, so a deleted role cannot leave
      // dangling grants behind.
      await tx.pbacRole.deleteMany({ where: { id: roleId, orgId } });
      await this.bumpVersion(orgId, tx);
    });
  }

  // -------------------------------------------------------------------------
  // Assignment writes.
  // -------------------------------------------------------------------------

  async addAssignments(orgId: string, pairs: Array<{ userId: string; roleId: string }>): Promise<void> {
    if (pairs.length === 0) return;
    await prisma.$transaction(async (tx) => {
      await tx.pbacUserRoleAssignment.createMany({
        data: pairs.map((p) => ({ userId: p.userId, roleId: p.roleId, orgId })),
        skipDuplicates: true,
      });
      await this.bumpVersion(orgId, tx);
    });
  }

  async removeAssignments(orgId: string, pairs: Array<{ userId: string; roleId: string }>): Promise<void> {
    if (pairs.length === 0) return;
    await prisma.$transaction(async (tx) => {
      for (const p of pairs) {
        await tx.pbacUserRoleAssignment.deleteMany({
          where: { userId: p.userId, roleId: p.roleId },
        });
      }
      await this.bumpVersion(orgId, tx);
    });
  }

  /**
   * Replace one user's assignments within an organization.
   *
   * Scoped to (orgId, userId) rather than to the user globally, so a user who
   * belongs to two organizations does not lose the other one's roles.
   */
  async replaceUserAssignments(orgId: string, userId: string, roleIds: string[]): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.pbacUserRoleAssignment.deleteMany({ where: { orgId, userId } });
      if (roleIds.length > 0) {
        await tx.pbacUserRoleAssignment.createMany({
          data: roleIds.map((roleId) => ({ userId, roleId, orgId })),
          skipDuplicates: true,
        });
      }
      await this.bumpVersion(orgId, tx);
    });
  }

  // -------------------------------------------------------------------------
  // Seeding and audit.
  // -------------------------------------------------------------------------

  async markSeeded(orgId: string): Promise<void> {
    await prisma.pbacOrgState.upsert({
      where: { orgId },
      create: { orgId, seeded: true, version: 1, updatedAt: new Date() },
      update: { seeded: true, updatedAt: new Date() },
    });
  }

  async isSeeded(orgId: string): Promise<boolean> {
    const row = await prisma.pbacOrgState.findUnique({
      where: { orgId },
      select: { seeded: true },
    });
    return row?.seeded ?? false;
  }

  /**
   * Audit records are written straight through and never cached. They are the
   * record of who changed permissions; losing one to a process restart, as the
   * old 2000-entry in-memory ring could, is not acceptable.
   */
  async recordAudit(record: StoredAudit): Promise<void> {
    try {
      await prisma.pbacAuditRecord.create({
        data: {
          id: record.id,
          orgId: record.orgId,
          actorId: record.actorId,
          actorName: record.actorName ?? "",
          actorEmail: record.actorEmail ?? "",
          action: record.action,
          entityType: record.entityType,
          entityId: record.entityId,
          entityName: record.entityName ?? null,
          previousState: (record.previousState ?? null) as never,
          newState: (record.newState ?? null) as never,
          status: record.status,
          errorDetails: record.errorDetails ?? null,
          createdAt: new Date(record.createdAt),
        },
      });
    } catch (e) {
      // An audit failure must not fail the operation being audited, but it
      // must not pass silently either.
      logger.error("PBAC_AUDIT_WRITE_FAILED", "Could not persist a PBAC audit record", e, {
        action: record.action,
        orgId: record.orgId,
      });
    }
  }

  async getAuditRecords(orgId: string, limit = 500): Promise<StoredAudit[]> {
    const rows = await prisma.pbacAuditRecord.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      orgId: r.orgId,
      actorId: r.actorId,
      actorName: r.actorName,
      actorEmail: r.actorEmail,
      action: r.action,
      entityType: r.entityType as StoredAudit["entityType"],
      entityId: r.entityId,
      entityName: r.entityName ?? undefined,
      previousState: r.previousState ?? undefined,
      newState: r.newState ?? undefined,
      status: r.status as StoredAudit["status"],
      errorDetails: r.errorDetails ?? undefined,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export const pbacStore = new PbacStore();
export const PBAC_VERSION_POLL_MS = VERSION_POLL_MS;
