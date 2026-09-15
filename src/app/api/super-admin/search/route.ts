import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

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
            { name: { contains: query } },
            { slug: { contains: query } },
            { domain: { contains: query } },
          ],
        },
        take: 5,
      }),
      prisma.user.findMany({
        where: {
          OR: [
            { email: { contains: query } },
            { firstName: { contains: query } },
            { lastName: { contains: query } },
            { company: { contains: query } },
          ],
        },
        select: { id: true, email: true, firstName: true, lastName: true, isSuperAdmin: true, status: true },
        take: 5,
      }),
      prisma.workspace.findMany({
        where: {
          OR: [
            { name: { contains: query } },
            { slug: { contains: query } },
          ],
        },
        include: { organization: { select: { name: true } } },
        take: 5,
      }),
      prisma.project.findMany({
        where: {
          OR: [
            { name: { contains: query } },
            { key: { contains: query } },
          ],
        },
        include: { workspace: { select: { name: true } } },
        take: 5,
      }),
      prisma.issue.findMany({
        where: {
          OR: [
            { title: { contains: query } },
            { issueKey: { contains: query } },
          ],
        },
        include: { project: { select: { key: true, name: true } } },
        take: 5,
      }),
      prisma.platformAuditLog.findMany({
        where: {
          OR: [
            { action: { contains: query } },
            { targetResource: { contains: query } },
            { details: { contains: query } },
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
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}