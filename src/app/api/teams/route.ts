import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { teamCreateSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { PROJECT_ADMIN_PERMISSIONS } from "@/lib/project-permissions";

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
    // assertProjectPermission / assertProjectAccess throw; without this mapping
    // a denied request surfaced as 500 and the client could not tell a refusal
    // from a server fault.
    const msg = error?.message || "Internal Server Error";
    const status = msg.includes("Unauthorized")
      ? 401
      : msg.includes("Forbidden") || msg.includes("permission") || msg.includes("access")
      ? 403
      : msg.includes("not found")
      ? 404
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = await parseJsonBody(req, teamCreateSchema);
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

      // Managing project teams is restricted to Super Admin, Organization
      // Admin, Project Admin and Project Manager, via `teams:manage`.
      //
      // This previously admitted ANY project member — so a MEMBER or a VIEWER
      // who happened to be assigned to the project could create teams. Being a
      // member is not a permission.
      const { assertProjectPermission } = await import("@/lib/tenant");
      await assertProjectPermission(projectId, PROJECT_ADMIN_PERMISSIONS.manageTeams);

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

    // Same restriction for a workspace-level team: Super Admin, Organization
    // Admin, or a role holding `teams:manage`. Workspace membership alone is
    // not sufficient.
    if (!user.isSuperAdmin) {
      const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, orgId: true },
      });
      if (!ws) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const orgMember = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId: ws.orgId, userId: user.id } },
        select: { role: true },
      });
      if (!orgMember) {
        return NextResponse.json({ error: "Forbidden: not a member of this organization" }, { status: 403 });
      }
      const isOrgAdmin = orgMember.role === "OWNER" || orgMember.role === "ADMIN";
      if (!isOrgAdmin) {
        const { pbacEngine } = await import("@/lib/pbac-engine");
        const allowed = await pbacEngine.hasPermission(
          ws.orgId,
          user.id,
          PROJECT_ADMIN_PERMISSIONS.manageTeams
        );
        if (!allowed) {
          return NextResponse.json(
            { error: "Forbidden: you do not have permission to manage teams" },
            { status: 403 }
          );
        }
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
    // A `teams:manage` refusal from assertProjectPermission must surface as 403.
    // This branch returned 400 for every throw, so an authorization failure was
    // indistinguishable from a malformed body.
    const msg = error?.message || "Internal Server Error";
    const status = msg.includes("Unauthorized")
      ? 401
      : msg.includes("Forbidden") || msg.includes("permission") || msg.includes("access")
      ? 403
      : msg.includes("not found")
      ? 404
      : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
