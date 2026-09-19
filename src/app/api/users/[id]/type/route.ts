import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { userTypeSchema } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";

/**
 * PATCH /api/users/[id]/type — set a person's Employee/Client classification.
 *
 * userType belongs to the account, not to any one project membership, so
 * changing it here changes it everywhere that person appears. It is therefore
 * gated on `users:manage` (the user-directory permission) rather than on
 * `projects:manage_members`: a Project Admin can see someone's type in the
 * member list but cannot reclassify them across every project and organization
 * they belong to. Super Admin and Organization Admin hold `users:manage`;
 * Project Admin and Project Manager hold only `users:view`.
 *
 * A caller who is not a super admin may only change someone who shares an
 * organization they administer, so this cannot be used to reach across tenants.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentUser();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: targetUserId } = await params;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = userTypeSchema.safeParse((raw as any)?.userType);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'userType must be "EMPLOYEE" or "CLIENT"' },
        { status: 400 }
      );
    }
    const userType = parsed.data;

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        userType: true,
        isSuperAdmin: true,
        orgMemberships: { select: { orgId: true } },
      },
    });
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (!actor.isSuperAdmin) {
      // Must hold users:manage in an organization shared with the target.
      const actorAdminOrgs = await prisma.organizationMember.findMany({
        where: { userId: actor.id, role: { in: ["OWNER", "ADMIN"] } },
        select: { orgId: true },
      });
      const shared = actorAdminOrgs
        .map((m) => m.orgId)
        .filter((orgId) => target.orgMemberships.some((t) => t.orgId === orgId));

      if (shared.length === 0) {
        // Fall back to the PBAC permission, so a custom role granting
        // users:manage also works — still restricted to a shared organization.
        const { pbacEngine } = await import("@/lib/pbac-engine");
        const candidateOrgs = target.orgMemberships.map((m) => m.orgId);
        let allowed = false;
        for (const orgId of candidateOrgs) {
          const isMember = await prisma.organizationMember.count({
            where: { orgId, userId: actor.id },
          });
          if (!isMember) continue;
          if (await pbacEngine.hasPermission(orgId, actor.id, "users:manage")) {
            allowed = true;
            break;
          }
        }
        if (!allowed) {
          const { logger } = await import("@/lib/logger");
          logger.security(
            "PBAC_ACCESS_DENIED",
            "User lacks required permission: users:manage",
            { userId: actor.id, email: actor.email, targetUserId }
          );
          return NextResponse.json(
            { error: "Forbidden: changing a person's type requires the users:manage permission" },
            { status: 403 }
          );
        }
      }

      // A non-super-admin must not reclassify a platform administrator.
      if (target.isSuperAdmin) {
        return NextResponse.json(
          { error: "Forbidden: cannot change a platform administrator's type" },
          { status: 403 }
        );
      }
    }

    if (target.userType === userType) {
      // Nothing to do. Reported as success so the UI does not show an error for
      // re-selecting the value already set.
      return NextResponse.json({ user: { id: target.id, userType }, unchanged: true });
    }

    const updated = await prisma.user.update({
      where: { id: targetUserId },
      data: { userType },
      select: { id: true, email: true, userType: true },
    });

    // Account-level change, so it belongs in the platform audit trail.
    await prisma.platformAuditLog
      .create({
        data: {
          actorId: actor.id,
          action: "USER_TYPE_CHANGED",
          targetResource: `User:${target.id} (${target.email})`,
          details: JSON.stringify({
            from: target.userType,
            to: userType,
            changedBy: actor.email,
          }),
        },
      })
      .catch((e) => console.error("Failed to log user type change:", e));

    return NextResponse.json({ user: updated });
  } catch (error: any) {
    const msg = error?.message || "Failed to update user type";
    return handleApiError(error, "users/[id]/type");
  }
}
