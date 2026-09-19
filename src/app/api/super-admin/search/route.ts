import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() || "";

    if (!query) {
      return NextResponse.json({
        organizations: [],
        users: [],
        workspaces: [],
        projects: [],
        issues: [],
        auditLogs: [],
      });
    }

    const [
      organizations,
      users,
      workspaces,
      projects,
      issues,
      auditLogs,
    ] = await Promise.all([
      prisma.organization.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { slug: { contains: query, mode: "insensitive" } },
            { domain: { contains: query, mode: "insensitive" } },
          ],
        },
        take: 5,
      }),
      prisma.user.findMany({
        where: {
          OR: [
            { email: { contains: query, mode: "insensitive" } },
            { firstName: { contains: query, mode: "insensitive" } },
            { lastName: { contains: query, mode: "insensitive" } },
            { company: { contains: query, mode: "insensitive" } },
          ],
        },
        select: { id: true, email: true, firstName: true, lastName: true, isSuperAdmin: true, status: true },
        take: 5,
      }),
      prisma.workspace.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { slug: { contains: query, mode: "insensitive" } },
          ],
        },
        include: { organization: { select: { name: true } } },
        take: 5,
      }),
      prisma.project.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { key: { contains: query, mode: "insensitive" } },
          ],
        },
        include: { workspace: { select: { name: true } } },
        take: 5,
      }),
      prisma.issue.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { issueKey: { contains: query, mode: "insensitive" } },
          ],
        },
        include: { project: { select: { key: true, name: true } } },
        take: 5,
      }),
      prisma.platformAuditLog.findMany({
        where: {
          OR: [
            { action: { contains: query, mode: "insensitive" } },
            { targetResource: { contains: query, mode: "insensitive" } },
            { details: { contains: query, mode: "insensitive" } },
          ],
        },
        take: 5,
      }),
    ]);

    return NextResponse.json({
      organizations,
      users,
      workspaces,
      projects,
      issues,
      auditLogs,
    });
  } catch (error: any) {
    return handleApiError(error, "super-admin/search");
  }
}