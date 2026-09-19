import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { pbacEngine } from "@/lib/pbac-engine";
import { superAdminOrgCreateSchema, superAdminOrgUpdateSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const organizations = await prisma.organization.findMany({
      include: {
        _count: {
          select: {
            members: true,
            workspaces: true,
          },
        },
        workspaces: {
          select: {
            id: true,
            name: true,
            slug: true,
            isArchived: true,
            _count: {
              select: {
                projects: true,
                members: true,
              },
            },
            projects: {
              select: {
                id: true,
                key: true,
                name: true,
                status: true,
                template: true,
                _count: {
                  select: {
                    issues: true,
                    members: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ organizations });
  } catch (error: any) {
    return handleApiError(error, "super-admin/orgs");
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const parsed = await parseJsonBody(req, superAdminOrgCreateSchema);
    if (!parsed.success) return parsed.error;
    const { name, slug, domain, timezone, language } = parsed.data;

    const cleanName = name;
    let cleanSlug = (slug || cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-")).trim();
    if (!cleanSlug) cleanSlug = `org-${Date.now()}`;

    // Ensure unique slug
    const existing = await prisma.organization.findUnique({ where: { slug: cleanSlug } });
    if (existing) {
      cleanSlug = `${cleanSlug}-${Math.random().toString(36).substring(2, 6)}`;
    }

    const org = await prisma.organization.create({
      data: {
        name: cleanName,
        slug: cleanSlug,
        domain: domain?.trim() || null,
        timezone: timezone || "UTC",
        language: language || "en",
        status: "ACTIVE",
        members: {
          create: {
            userId: user.id,
            role: "OWNER",
          },
        },
      },
    });

    // Auto-seed default PBAC roles for the new organization
    try {
      await pbacEngine.ensureOrgSeeded(org.id);
    } catch (err) {
      console.warn("PBAC auto-seed non-fatal warning:", err);
    }

    // Write to Platform Audit Log
    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "TENANT_CREATED",
        targetResource: `Organization:${org.id}`,
        orgId: org.id,
        details: JSON.stringify({
          name: org.name,
          slug: org.slug,
          domain: org.domain,
          createdBy: user.email,
        }),
      },
    });

    return NextResponse.json({ organization: org, message: `Organization ${org.name} created successfully` }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "super-admin/orgs");
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const parsed2 = await parseJsonBody(req, superAdminOrgUpdateSchema);
    if (!parsed2.success) return parsed2.error;
    const { orgId, name, slug, domain, status, timezone, language, dateFormat, workingDays, workingHours } = parsed2.data;

    const existingOrg = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!existingOrg) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (slug !== undefined) updateData.slug = slug.trim();
    if (domain !== undefined) updateData.domain = domain ? domain.trim() : null;
    if (status !== undefined) updateData.status = status;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (language !== undefined) updateData.language = language;
    if (dateFormat !== undefined) updateData.dateFormat = dateFormat;
    if (workingDays !== undefined) updateData.workingDays = workingDays;
    if (workingHours !== undefined) updateData.workingHours = workingHours;

    const updatedOrg = await prisma.organization.update({
      where: { id: orgId },
      data: updateData,
    });

    // Write to Platform Audit Log
    const action = status && status !== existingOrg.status ? `TENANT_${status}` : "TENANT_UPDATED";
    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action,
        targetResource: `Organization:${orgId}`,
        orgId,
        details: JSON.stringify({
          previous: { name: existingOrg.name, slug: existingOrg.slug, status: existingOrg.status, domain: existingOrg.domain },
          updated: updateData,
        }),
      },
    });

    return NextResponse.json({ organization: updatedOrg, message: `Organization ${updatedOrg.name} updated successfully` });
  } catch (error: any) {
    return handleApiError(error, "super-admin/orgs");
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    let orgId = searchParams.get("orgId");

    if (!orgId) {
      try {
        const body = await req.json();
        orgId = body.orgId;
      } catch (e) {}
    }

    if (!orgId) {
      return NextResponse.json({ error: "orgId is required" }, { status: 400 });
    }

    const existingOrg = await prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        _count: {
          select: { members: true, workspaces: true },
        },
      },
    });

    if (!existingOrg) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    // Cascade delete related records cleanly
    // 1. Find all workspaces under this organization
    const workspaces = await prisma.workspace.findMany({
      where: { orgId },
      select: { id: true },
    });
    const workspaceIds = workspaces.map((w) => w.id);

    // 2. Find all projects under these workspaces
    const projects = await prisma.project.findMany({
      where: { workspaceId: { in: workspaceIds } },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);

    // 3. Delete issues & related data under these projects
    if (projectIds.length > 0) {
      await prisma.issue.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.sprint.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.epic.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.component.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.workflow.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }

    // 4. Delete teams and workspace members
    if (workspaceIds.length > 0) {
      await prisma.team.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }

    // 5. Delete organization members & webhooks
    await prisma.organizationMember.deleteMany({ where: { orgId } });
    await prisma.webhook.deleteMany({ where: { orgId } });

    // 6. Delete organization itself
    await prisma.organization.delete({ where: { id: orgId } });

    // 7. Write to Platform Audit Log
    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "TENANT_DELETED",
        targetResource: `Organization:${orgId}`,
        details: JSON.stringify({
          deletedOrgName: existingOrg.name,
          deletedOrgSlug: existingOrg.slug,
          deletedBy: user.email,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: `Organization ${existingOrg.name} has been deleted permanently`,
    });
  } catch (error: any) {
    return handleApiError(error, "super-admin/orgs");
  }
}
