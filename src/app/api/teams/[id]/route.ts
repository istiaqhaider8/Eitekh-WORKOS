import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { teamUpdateSchema, parseBody, parseJsonBody } from "@/lib/validation";

async function checkTeamAccess(teamId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (user.isSuperAdmin) return { user, role: "SUPER_ADMIN" };
  const team = await prisma.team.findUnique({ where: { id: teamId }, include: { workspace: true } });
  if (!team) throw new Error("Not found");
  
  if (team.projectId) {
    const pm = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: team.projectId, userId: user.id } }
    });
    if (pm && pm.role === "PROJECT_ADMIN") return { user, role: "PROJECT_ADMIN" };
  }

  const wsMember = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: team.workspaceId, userId: user.id } }
  });
  
  const teamMember = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: user.id } }
  });

  if (teamMember) return { user, role: teamMember.role };
  if (wsMember && wsMember.role === "WORKSPACE_ADMIN") return { user, role: "WORKSPACE_ADMIN" };
  
  const orgMember = await prisma.organizationMember.findUnique({
    where: { orgId_userId: { orgId: team.workspace.orgId, userId: user.id } }
  });
  if (orgMember && (orgMember.role === "OWNER" || orgMember.role === "ADMIN")) return { user, role: "WORKSPACE_ADMIN" };
  
  throw new Error("Forbidden");
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await checkTeamAccess(id);
    const team = await prisma.team.findUnique({
      where: { id },
      include: {
        members: {
          include: { user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } } }
        }
      },
    });
    return NextResponse.json(team);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: error.message === "Unauthorized" ? 401 : 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { role } = await checkTeamAccess(id);
    if (!["LEAD", "WORKSPACE_ADMIN", "SUPER_ADMIN", "PROJECT_ADMIN"].includes(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const team = await prisma.team.findUnique({ where: { id } });
    if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
    
    const parsed = await parseJsonBody(req, teamUpdateSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;
    const updateData: any = {};

    if (body.name !== undefined) {
      updateData.name = body.name;
    }

    if (body.description !== undefined) {
      updateData.description = body.description || null;
    }

    if (body.leadId !== undefined) {
      if (body.leadId && team.projectId) {
        const isMember = await prisma.projectMember.findUnique({
          where: { projectId_userId: { projectId: team.projectId, userId: body.leadId } }
        });
        if (!isMember) {
          return NextResponse.json({ error: "Team Lead must be an assigned member of this project" }, { status: 400 });
        }
      }
      updateData.leadId = body.leadId || null;

      // Ensure the lead is in the team roster with LEAD role
      if (body.leadId) {
        await prisma.teamMember.upsert({
          where: { teamId_userId: { teamId: id, userId: body.leadId } },
          create: { teamId: id, userId: body.leadId, role: "LEAD" },
          update: { role: "LEAD" },
        });
      }
    }

    const updated = await prisma.team.update({
      where: { id },
      data: updateData,
      include: {
        members: {
          include: {
            user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } }
          }
        }
      }
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { role } = await checkTeamAccess(id);
    if (!["LEAD", "WORKSPACE_ADMIN", "SUPER_ADMIN", "PROJECT_ADMIN"].includes(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Safely unlink team from issues and projects to avoid foreign key errors
    await prisma.issue.updateMany({
      where: { teamId: id },
      data: { teamId: null }
    });

    await prisma.project.updateMany({
      where: { teamId: id },
      data: { teamId: null }
    });

    await prisma.team.delete({ where: { id } });
    return NextResponse.json({ success: true, message: "Team deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 400 });
  }
}
