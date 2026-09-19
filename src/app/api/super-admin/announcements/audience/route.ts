import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { ENUMERATED_TARGET_VALUES, TARGET_KINDS } from "@/lib/announcement-targeting";
import { handleApiError } from "@/lib/api-error";

/**
 * The options the audience picker offers, and a live count for each.
 *
 * Served from the database rather than hardcoded in the component so the picker
 * cannot offer a project that no longer exists — which the create endpoint
 * would reject anyway, but only after the author had composed the whole thing.
 *
 * Read-only, and restricted to the same admins who can see the announcements
 * list: it enumerates every organization, project, team and user on the
 * platform.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const [orgs, projects, teams, users, typeCounts, orgRoleCounts, projectRoleCounts] =
      await Promise.all([
        prisma.organization.findMany({
          select: { id: true, name: true, _count: { select: { members: true } } },
          orderBy: { name: "asc" },
          take: 200,
        }),
        prisma.project.findMany({
          select: { id: true, name: true, key: true, _count: { select: { members: true } } },
          orderBy: { name: "asc" },
          take: 500,
        }),
        prisma.team.findMany({
          select: { id: true, name: true, _count: { select: { members: true } } },
          orderBy: { name: "asc" },
          take: 500,
        }),
        prisma.user.findMany({
          where: { status: "ACTIVE" },
          select: { id: true, email: true, firstName: true, lastName: true, userType: true },
          orderBy: { email: "asc" },
          take: 500,
        }),
        prisma.user.groupBy({ by: ["userType"], where: { status: "ACTIVE" }, _count: true }),
        prisma.organizationMember.groupBy({ by: ["role"], _count: true }),
        prisma.projectMember.groupBy({ by: ["role"], _count: true }),
      ]);

    const countOf = (rows: Array<{ _count: number }>, key: string, field: string) =>
      (rows as any[]).find((r) => r[field] === key)?._count ?? 0;

    return NextResponse.json({
      kinds: TARGET_KINDS,
      options: {
        ORG: orgs.map((o) => ({ value: o.id, label: o.name, count: o._count.members })),
        PROJECT: projects.map((p) => ({ value: p.id, label: `${p.name} (${p.key})`, count: p._count.members })),
        TEAM: teams.map((t) => ({ value: t.id, label: t.name, count: t._count.members })),
        USER: users.map((u) => ({
          value: u.id,
          label: `${`${u.firstName} ${u.lastName}`.trim() || u.email} — ${u.email}`,
          count: 1,
        })),
        USER_TYPE: (ENUMERATED_TARGET_VALUES.USER_TYPE || []).map((v) => ({
          value: v,
          label: v === "CLIENT" ? "Client" : "Employee",
          count: countOf(typeCounts as any, v, "userType"),
        })),
        ORG_ROLE: (ENUMERATED_TARGET_VALUES.ORG_ROLE || []).map((v) => ({
          value: v,
          label: v,
          count: countOf(orgRoleCounts as any, v, "role"),
        })),
        PROJECT_ROLE: (ENUMERATED_TARGET_VALUES.PROJECT_ROLE || []).map((v) => ({
          value: v,
          label: v.replace(/_/g, " "),
          count: countOf(projectRoleCounts as any, v, "role"),
        })),
      },
    });
  } catch (error: any) {
    return handleApiError(error, "super-admin/announcements/audience");
  }
}
