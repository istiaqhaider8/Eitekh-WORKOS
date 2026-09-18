import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { projectCreateSchema, parseBody, parseJsonBody } from "@/lib/validation";

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
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = await parseJsonBody(req, projectCreateSchema);
    if (!parsed.success) return parsed.error;
    const { workspaceId, name, key, description, template, teamId } = parsed.data;
    
    // Validate workspace access
    const wsMember = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } }
    });
    
    if (!user.isSuperAdmin && (!wsMember || wsMember.role === "VIEWER")) {
      const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
      if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

      const orgMember = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId: ws.orgId, userId: user.id } }
      });
      if (!orgMember || (orgMember.role !== "OWNER" && orgMember.role !== "ADMIN")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 400 });
  }
}
