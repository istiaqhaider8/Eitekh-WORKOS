import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { superAdminProjectCreateSchema, superAdminProjectUpdateSchema, parseBody } from "@/lib/validation";

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");
    const orgId = searchParams.get("orgId");

    const where: any = {};
    if (workspaceId && workspaceId !== "all") {
      where.workspaceId = workspaceId;
    } else if (orgId && orgId !== "all") {
      where.workspace = { orgId };
    }

    const projects = await prisma.project.findMany({
      where,
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            orgId: true,
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
        _count: {
          select: {
            members: true,
            issues: true,
            sprints: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ projects });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const parsed = parseBody(superAdminProjectCreateSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const {
      workspaceId,
      name,
      key,
      description,
      template,
      status,
      priority,
      startDate,
      targetDate,
    } = parsed.data;

    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { organization: true },
    });

    if (!ws) {
      return NextResponse.json({ error: "Target workspace not found" }, { status: 404 });
    }

    const cleanKey = key.trim().toUpperCase();

    // Verify key unique in workspace
    const existingKey = await prisma.project.findFirst({
      where: { workspaceId, key: cleanKey },
    });
    if (existingKey) {
      return NextResponse.json({ error: `Project key '${cleanKey}' is already used in this workspace` }, { status: 400 });
    }

    const project = await prisma.project.create({
      data: {
        workspaceId,
        name: name.trim(),
        key: cleanKey,
        description: description?.trim() || null,
        template,
        status,
        priority,
        ownerId: user.id,
        startDate: startDate ? new Date(startDate) : null,
        targetDate: targetDate ? new Date(targetDate) : null,
        members: {
          create: {
            userId: user.id,
            role: "PROJECT_ADMIN",
          },
        },
        workflows: {
          create: {
            name: "Default Workflow",
            isDefault: true,
            statuses: {
              create:
                template === "KANBAN"
                  ? [
                      { name: "To Do", category: "TO_DO", position: 0 },
                      { name: "In Progress", category: "IN_PROGRESS", position: 1 },
                      { name: "Done", category: "DONE", position: 2 },
                    ]
                  : [
                      { name: "Backlog", category: "BACKLOG", position: 0 },
                      { name: "To Do", category: "TO_DO", position: 1 },
                      { name: "In Progress", category: "IN_PROGRESS", position: 2 },
                      { name: "In Review", category: "REVIEW", position: 3 },
                      { name: "Done", category: "DONE", position: 4 },
                    ],
            },
          },
        },
      },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            organization: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });

    // Write to Platform Audit Log
    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "PROJECT_CREATED",
        targetResource: `Project:${project.id} (${project.key})`,
        orgId: ws.orgId,
        details: JSON.stringify({
          name: project.name,
          key: project.key,
          workspace: ws.name,
          organization: ws.organization.name,
          template: project.template,
          createdBy: user.email,
        }),
      },
    });

    return NextResponse.json({ project, message: `Project ${project.name} (${project.key}) created successfully` }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const parsed2 = parseBody(superAdminProjectUpdateSchema, await req.json());
    if (!parsed2.success) return parsed2.error;
    const {
      projectId,
      name,
      key,
      description,
      template,
      status,
      priority,
      startDate,
      targetDate,
      workspaceId,
    } = parsed2.data;

    const existingProject = await prisma.project.findUnique({
      where: { id: projectId },
      include: { workspace: { include: { organization: true } } },
    });

    if (!existingProject) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (key !== undefined) updateData.key = key.trim().toUpperCase();
    if (description !== undefined) updateData.description = description ? description.trim() : null;
    if (template !== undefined) updateData.template = template;
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (targetDate !== undefined) updateData.targetDate = targetDate ? new Date(targetDate) : null;
    if (workspaceId !== undefined) updateData.workspaceId = workspaceId;

    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: updateData,
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            organization: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });

    // Write to Platform Audit Log
    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "PROJECT_UPDATED",
        targetResource: `Project:${projectId} (${updatedProject.key})`,
        orgId: existingProject.workspace.orgId,
        details: JSON.stringify({
          previous: { name: existingProject.name, key: existingProject.key, status: existingProject.status },
          updated: updateData,
        }),
      },
    });

    return NextResponse.json({ project: updatedProject, message: `Project ${updatedProject.name} updated successfully` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    let projectId = searchParams.get("projectId");

    if (!projectId) {
      try {
        const body = await req.json();
        projectId = body.projectId;
      } catch (e) {}
    }

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const existingProject = await prisma.project.findUnique({
      where: { id: projectId },
      include: { workspace: { include: { organization: true } } },
    });

    if (!existingProject) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Cascade delete project dependencies cleanly
    await prisma.issue.deleteMany({ where: { projectId } });
    await prisma.sprint.deleteMany({ where: { projectId } });
    await prisma.epic.deleteMany({ where: { projectId } });
    await prisma.component.deleteMany({ where: { projectId } });
    await prisma.workflow.deleteMany({ where: { projectId } });
    await prisma.projectMember.deleteMany({ where: { projectId } });
    await prisma.automationRule.deleteMany({ where: { projectId } });
    await prisma.recurringTask.deleteMany({ where: { projectId } });
    await prisma.webhook.deleteMany({ where: { projectId } });

    await prisma.project.delete({ where: { id: projectId } });

    // Platform Audit Log
    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "PROJECT_DELETED",
        targetResource: `Project:${projectId} (${existingProject.key})`,
        orgId: existingProject.workspace.orgId,
        details: JSON.stringify({
          deletedProjectName: existingProject.name,
          deletedKey: existingProject.key,
          workspaceName: existingProject.workspace.name,
          deletedBy: user.email,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: `Project ${existingProject.name} (${existingProject.key}) deleted permanently`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
