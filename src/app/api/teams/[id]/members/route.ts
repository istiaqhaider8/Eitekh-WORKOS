import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { teamMemberSchema, memberUserIdSchema, parseBody } from "@/lib/validation";

async function checkTeamAdmin(teamId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (user.isSuperAdmin) return;
  const teamMember = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: user.id } }
  });
  if (teamMember?.role === "LEAD") return;
  
  const team = await prisma.team.findUnique({ where: { id: teamId }, include: { workspace: true } });
  if (!team) throw new Error("Not found");

  if (team.projectId) {
    const pm = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: team.projectId, userId: user.id } }
    });
    if (pm && pm.role === "PROJECT_ADMIN") return;
  }
  
  const wsMember = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: team.workspaceId, userId: user.id } }
  });
  if (wsMember && wsMember.role === "WORKSPACE_ADMIN") return;
  
  const orgMember = await prisma.organizationMember.findUnique({
    where: { orgId_userId: { orgId: team.workspace.orgId, userId: user.id } }
  });
  if (orgMember && (orgMember.role === "OWNER" || orgMember.role === "ADMIN")) return;
  
  throw new Error("Forbidden");
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    const members = await prisma.teamMember.findMany({
      where: { teamId: id },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } }
      }
    });
    return NextResponse.json(members);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await checkTeamAdmin(id);
    const parsed = parseBody(teamMemberSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    const team = await prisma.team.findUnique({ where: { id } });
    if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

    if (team.projectId) {
      const isProjectMember = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: team.projectId, userId: body.userId } }
      });
      if (!isProjectMember) {
        return NextResponse.json({
          error: "Only assigned members of this project can be added to this team"
        }, { status: 400 });
      }
    }

    const member = await prisma.teamMember.create({
      data: {
        teamId: id,
        userId: body.userId,
        role: body.role,
      },
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
    });
    return NextResponse.json(member, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await checkTeamAdmin(id);
    const parsed = parseBody(memberUserIdSchema, await req.json());
    if (!parsed.success) return parsed.error;
    await prisma.teamMember.delete({
      where: { teamId_userId: { teamId: id, userId: parsed.data.userId } }
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
