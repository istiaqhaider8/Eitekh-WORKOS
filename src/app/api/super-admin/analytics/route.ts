import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { handleApiError } from "@/lib/api-error";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const [issues, statuses, users, orgs, sprints, projects] = await Promise.all([
      prisma.issue.findMany({
        take: 300,
        orderBy: { createdAt: "desc" },
        include: {
          status: true,
          assignee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatarUrl: true,
            },
          },
          project: {
            select: {
              id: true,
              name: true,
              key: true,
              workspace: {
                select: {
                  id: true,
                  name: true,
                  organization: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.workflowStatus.findMany({
        orderBy: { position: "asc" },
      }),
      prisma.user.findMany({
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          company: true,
          status: true,
        },
      }),
      prisma.organization.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          _count: {
            select: { members: true },
          },
        },
      }),
      prisma.sprint.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.project.findMany({
        select: {
          id: true,
          name: true,
          key: true,
          status: true,
          workspace: {
            select: {
              id: true,
              name: true,
              organization: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          _count: {
            select: {
              issues: true,
            },
          },
        },
        orderBy: { name: "asc" },
      }),
    ]);

    return NextResponse.json({
      issues,
      statuses,
      users,
      orgs,
      sprints,
      projects,
    });
  } catch (error: any) {
    console.error("Super admin analytics error:", error);
    return handleApiError(error, "super-admin/analytics");
  }
}
