import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { projectCreateSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { PROJECT_ADMIN_PERMISSIONS } from "@/lib/project-permissions";
import { handleApiError } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");

    const where: any = {};
    if (workspaceId) {
      where.workspaceId = workspaceId;
    }

    if (!user.isSuperAdmin) {
      where.OR = [
        { ownerId: user.id },
        { members: { some: { userId: user.id } } }
      ];
    }

    const projects = await prisma.project.findMany({
      where,
      include: {
        workspace: {
          select: { id: true, name: true, slug: true, orgId: true }
        },
        _count: {
          select: { issues: true, members: true }
        }
      },
      orderBy: { updatedAt: "desc" }
    });

    return NextResponse.json(projects);
  } catch (error: any) {
    return handleApiError(error, "projects");
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = await parseJsonBody(req, projectCreateSchema);
    if (!parsed.success) return parsed.error;
    const { workspaceId, name, key, description, template, teamId } = parsed.data;
    
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, orgId: true },
    });
    if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    // Creating a project is restricted to Super Admin, Organization Admin,
    // Project Admin and Project Manager, expressed as the `projects:create`
    // permission — see `lib/project-permissions.ts`.
    //
    // This previously admitted any workspace member who was not a VIEWER, which
    // meant a plain MEMBER could provision projects. Membership is still
    // required (a non-member of the organization is rejected below), but it is
    // no longer sufficient.
    if (!user.isSuperAdmin) {
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
          PROJECT_ADMIN_PERMISSIONS.newProject
        );
        if (!allowed) {
          const { logger } = await import("@/lib/logger");
          logger.security(
            "PBAC_ACCESS_DENIED",
            `User lacks required permission: ${PROJECT_ADMIN_PERMISSIONS.newProject}`,
            { userId: user.id, email: user.email, workspaceId, orgId: ws.orgId }
          );
          return NextResponse.json(
            { error: "Forbidden: you do not have permission to create projects" },
            { status: 403 }
          );
        }
      }
    }

    // Validate unique key
    const existing = await prisma.project.findFirst({
      where: { workspaceId, key }
    });
    if (existing) return NextResponse.json({ error: "Project key must be unique in workspace" }, { status: 400 });

    const project = await prisma.project.create({
      data: {
        workspaceId,
        name,
        key,
        description,
        template: template || "SCRUM",
        teamId,
        ownerId: user.id,
        members: {
          create: {
            userId: user.id,
            role: "PROJECT_ADMIN"
          }
        },
        workflows: {
          create: {
            name: "Default Workflow",
            isDefault: true,
            statuses: {
              create: template === "KANBAN" 
                ? [
                    { name: "To Do", category: "TO_DO", position: 0 },
                    { name: "In Progress", category: "IN_PROGRESS", position: 1 },
                    { name: "Done", category: "DONE", position: 2 }
                  ]
                : [
                    { name: "Backlog", category: "BACKLOG", position: 0 },
                    { name: "To Do", category: "TO_DO", position: 1 },
                    { name: "In Progress", category: "IN_PROGRESS", position: 2 },
                    { name: "In Review", category: "REVIEW", position: 3 },
                    { name: "Done", category: "DONE", position: 4 }
                  ]
            }
          }
        }
      },
    });

    const { logAuditEvent } = await import('@/lib/audit-logger');
    await logAuditEvent({
      actor: { id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email },
      action: 'PROJECT_CREATED',
      category: 'PROJECT',
      severity: 'NOTICE',
      targetResource: `Project:${project.id} (${project.name})`,
      projectId: project.id,
      details: {
        name: project.name,
        key: project.key,
        workspaceId: project.workspaceId,
        template: project.template,
      },
    });
    
    return NextResponse.json(project, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "projects", 400);
  }
}
