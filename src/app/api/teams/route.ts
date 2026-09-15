import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { teamCreateSchema, parseBody } from "@/lib/validation";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");
    const projectId = searchParams.get("projectId");

    if (!projectId && !workspaceId && !user.isSuperAdmin) {
      return NextResponse.json({ error: "projectId or workspaceId parameter is required" }, { status: 400 });
    }

    const where: any = {};
    if (projectId) {
      const { assertProjectAccess } = await import("@/lib/tenant");
      await assertProjectAccess(projectId);
      where.projectId = projectId;
    } else if (workspaceId) {
      where.workspaceId = workspaceId;
      if (!user.isSuperAdmin) {
        where.workspace = {
          members: { some: { userId: user.id } }
        };
      }
    }

    const teams = await prisma.team.findMany({
      where,
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                avatarUrl: true,
                jobTitle: true
              }
            }
          }
        },
        _count: {
          select: {
            members: true,
            projects: true,
            issues: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    return NextResponse.json(teams);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(teamCreateSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { projectId, name, description, leadId } = parsed.data;
    let workspaceId = parsed.data.workspaceId;

    // If projectId is provided, ensure team is project-wise
    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, workspaceId: true }
      });
      if (!project) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }
      workspaceId = project.workspaceId;

      // Ensure user has access to project
      if (!user.isSuperAdmin) {
        const pm = await prisma.projectMember.findUnique({
          where: { projectId_userId: { projectId, userId: user.id } }
        });
        const wsMember = await prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: user.id } }
        });
        if (!pm && (!wsMember || wsMember.role === "VIEWER")) {
          return NextResponse.json({ error: "Forbidden: You do not have permission to create teams in this project" }, { status: 403 });
        }
      }

      // If leadId is specified, ensure lead is an assigned member of this project
      const actualLeadId = leadId || user.id;
      const leadProjectMember = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: actualLeadId } }
      });
      if (!leadProjectMember && !user.isSuperAdmin) {
        return NextResponse.json({ error: "Team Lead must be an assigned member of this project" }, { status: 400 });
      }

      const team = await prisma.team.create({
        data: {
          workspaceId,
          projectId,
          name: name.trim(),
          description: description?.trim() || null,
          leadId: actualLeadId,
          members: {
            create: {
              userId: actualLeadId,
              role: "LEAD",
            }
          }
        },
        include: {
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                  avatarUrl: true
                }
              }
            }
          }
        }
      });

      return NextResponse.json(team, { status: 201 });
    }

    // Fallback for workspace-level team if no projectId
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId or projectId is required" }, { status: 400 });
    }

    const wsMember = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } }
    });
    
    if (!user.isSuperAdmin && (!wsMember || wsMember.role === "VIEWER")) {
      const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }});
      if (!ws) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const orgMember = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId: ws.orgId, userId: user.id } }
      });
      if (!orgMember || (orgMember.role !== "OWNER" && orgMember.role !== "ADMIN")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const actualLeadId = leadId || user.id;

    const team = await prisma.team.create({
      data: {
        workspaceId,
        name: name.trim(),
        description: description?.trim() || null,
        leadId: actualLeadId,
        members: {
          create: {
            userId: actualLeadId,
            role: "LEAD",
          }
        }
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                avatarUrl: true
              }
            }
          }
        }
      }
    });
    
    return NextResponse.json(team, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 400 });
  }
}
