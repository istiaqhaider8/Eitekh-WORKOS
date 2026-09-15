import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { searchSchema, parseQuery } from "@/lib/validation";

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const parsed = parseQuery(searchSchema, searchParams);
    if (!parsed.success) return parsed.error;
    const { q, type, limit } = parsed.data;

    // Find projects user has access to
    // They have access via projectMemberships, OR via org membership (as admin/owner)
    // For simplicity and security, get all project IDs they explicitly or implicitly have access to
    // In a real app with large number of projects, you might need a more optimized query
    
    // Get user's orgs
    const orgMemberships = await prisma.organizationMember.findMany({
      where: { userId: user.id },
      select: { orgId: true, role: true }
    });

    // STRICT PROJECT-BASED ACCESS CONTROL:
    // Only search projects where the user is an explicitly assigned member or direct project owner
    let allowedProjectIds: string[] = [];

    if (user.isSuperAdmin) {
      const allProjects = await prisma.project.findMany({ select: { id: true } });
      allowedProjectIds = allProjects.map(p => p.id);
    } else {
      const assignedProjects = await prisma.project.findMany({
        where: {
          OR: [
            { members: { some: { userId: user.id } } },
            { ownerId: user.id },
          ],
        },
        select: { id: true }
      });
      allowedProjectIds = assignedProjects.map(p => p.id);
    }

    const results: any = {
      issues: [],
      comments: [],
      projects: [],
    };

    if (type === "all" || type === "issues") {
      results.issues = await prisma.issue.findMany({
        where: {
          projectId: { in: allowedProjectIds },
          OR: [
            { title: { contains: q } },
            { description: { contains: q } },
            { issueKey: { contains: q } },
          ]
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { status: true }
      });
    }

    if (type === "all" || type === "comments") {
      results.comments = await prisma.comment.findMany({
        where: {
          issue: { projectId: { in: allowedProjectIds } },
          content: { contains: q },
        },
        take: limit,
        include: { 
          issue: { select: { id: true, issueKey: true, title: true } },
          user: { select: { id: true, firstName: true, lastName: true } }
        }
      });
    }

    if (type === "all" || type === "projects") {
      results.projects = await prisma.project.findMany({
        where: {
          id: { in: allowedProjectIds },
          OR: [
            { name: { contains: q } },
            { key: { contains: q } },
            { description: { contains: q } },
          ]
        },
        take: limit,
      });
    }

    return NextResponse.json(results);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
