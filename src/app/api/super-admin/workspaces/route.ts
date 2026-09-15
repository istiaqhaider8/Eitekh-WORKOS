import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { superAdminWorkspaceCreateSchema, superAdminWorkspaceUpdateSchema, parseBody } from "@/lib/validation";

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get("orgId");

    const where: any = {};
    if (orgId && orgId !== "all") {
      where.orgId = orgId;
    }

    const workspaces = await prisma.workspace.findMany({
      where,
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
          },
        },
        _count: {
          select: {
            projects: true,
            members: true,
            teams: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ workspaces });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const parsed = parseBody(superAdminWorkspaceCreateSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { orgId, name, slug, description } = parsed.data;

    const targetOrg = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!targetOrg) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const cleanName = name.trim();
    let cleanSlug = (slug || cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-")).trim();
    if (!cleanSlug) cleanSlug = `ws-${Date.now()}`;

    const newWorkspace = await prisma.workspace.create({
      data: {
        orgId,
        name: cleanName,
        slug: cleanSlug,
        description: description?.trim() || null,
        members: {
          create: {
            userId: user.id,
            role: "WORKSPACE_ADMIN",
          },
        },
      },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    // Write to Platform Audit Log
    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "WORKSPACE_CREATED",
        targetResource: `Workspace:${newWorkspace.id}`,
        orgId,
        details: JSON.stringify({
          name: newWorkspace.name,
          slug: newWorkspace.slug,
          orgName: targetOrg.name,
          createdBy: user.email,
        }),
      },
    });

    return NextResponse.json({ workspace: newWorkspace, message: `Workspace ${newWorkspace.name} created successfully` }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const parsed2 = parseBody(superAdminWorkspaceUpdateSchema, await req.json());
    if (!parsed2.success) return parsed2.error;
    const { workspaceId, name, slug, description, isArchived, orgId } = parsed2.data;

    const existingWs = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { organization: true },
    });

    if (!existingWs) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (slug !== undefined) updateData.slug = slug.trim();
    if (description !== undefined) updateData.description = description ? description.trim() : null;
    if (typeof isArchived === "boolean") updateData.isArchived = isArchived;
    if (orgId !== undefined) updateData.orgId = orgId;

    const updatedWorkspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: updateData,
      include: { organization: { select: { id: true, name: true, slug: true } } },
    });

    // Write to Platform Audit Log
    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: isArchived !== undefined ? (isArchived ? "WORKSPACE_ARCHIVED" : "WORKSPACE_RESTORED") : "WORKSPACE_UPDATED",
        targetResource: `Workspace:${workspaceId}`,
        orgId: updatedWorkspace.orgId,
        details: JSON.stringify({
          previous: { name: existingWs.name, isArchived: existingWs.isArchived },
          updated: updateData,
        }),
      },
    });

    return NextResponse.json({ workspace: updatedWorkspace, message: `Workspace ${updatedWorkspace.name} updated successfully` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    let workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      try {
        const body = await req.json();
        workspaceId = body.workspaceId;
      } catch (e) {}
    }

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const existingWs = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { organization: true },
    });

    if (!existingWs) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    // Cascade delete related records
    // 1. Projects under this workspace
    const projects = await prisma.project.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);

    if (projectIds.length > 0) {
      await prisma.issue.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.sprint.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.epic.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.component.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.workflow.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }

    // 2. Teams and workspace members
    await prisma.team.deleteMany({ where: { workspaceId } });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } });

    // 3. Delete workspace
    await prisma.workspace.delete({ where: { id: workspaceId } });

    // 4. Platform Audit Log
    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "WORKSPACE_DELETED",
        targetResource: `Workspace:${workspaceId}`,
        orgId: existingWs.orgId,
        details: JSON.stringify({
          deletedWorkspaceName: existingWs.name,
          orgName: existingWs.organization.name,
          deletedBy: user.email,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: `Workspace ${existingWs.name} deleted permanently`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
