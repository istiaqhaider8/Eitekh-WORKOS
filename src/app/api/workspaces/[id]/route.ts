import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

async function assertWorkspaceAccess(workspaceId: string, allowedRoles: string[] = ["WORKSPACE_ADMIN", "MEMBER", "VIEWER"]) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  
  if (user.isSuperAdmin) return { user, role: "SUPER_ADMIN" };

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
  });
  
  if (!member) {
    // Check if user is org OWNER/ADMIN
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new Error("Not found");
    const orgMember = await prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId: workspace.orgId, userId: user.id } }
    });
    if (orgMember && (orgMember.role === "OWNER" || orgMember.role === "ADMIN")) {
      return { user, role: "WORKSPACE_ADMIN" };
    }
    throw new Error("Forbidden");
  }
  
  if (!allowedRoles.includes(member.role)) throw new Error("Forbidden");
  return { user, role: member.role };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertWorkspaceAccess(id);
    const workspace = await prisma.workspace.findUnique({
      where: { id },
      include: {
        _count: {
          select: { members: true, projects: true },
        },
      },
    });
    if (!workspace) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(workspace);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === "Unauthorized" ? 401 : 403 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertWorkspaceAccess(id, ["WORKSPACE_ADMIN"]);
    const body = await req.json();
    const updated = await prisma.workspace.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description,
        isArchived: body.isArchived,
      },
    });
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === "Unauthorized" ? 401 : 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertWorkspaceAccess(id, ["WORKSPACE_ADMIN"]);
    const updated = await prisma.workspace.update({
      where: { id },
      data: { isArchived: true },
    });
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
