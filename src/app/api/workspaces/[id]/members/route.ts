import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { workspaceMemberSchema, memberUserIdSchema, parseBody } from "@/lib/validation";

async function assertWorkspaceAccess(workspaceId: string, allowedRoles: string[] = ["WORKSPACE_ADMIN", "MEMBER", "VIEWER"]) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (user.isSuperAdmin) return { user, role: "SUPER_ADMIN" };
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
  });
  if (!member) {
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
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: id },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true },
        },
      },
    });
    return NextResponse.json(members);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 403 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertWorkspaceAccess(id, ["WORKSPACE_ADMIN"]);
    const parsed = parseBody(workspaceMemberSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    // Check org membership
    const workspace = await prisma.workspace.findUnique({ where: { id } });
    const orgMember = await prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId: workspace!.orgId, userId: body.userId } }
    });
    if (!orgMember) return NextResponse.json({ error: "User is not an organization member" }, { status: 400 });

    const member = await prisma.workspaceMember.create({
      data: {
        workspaceId: id,
        userId: body.userId,
        role: body.role,
      },
    });
    return NextResponse.json(member, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertWorkspaceAccess(id, ["WORKSPACE_ADMIN"]);
    const parsed = parseBody(workspaceMemberSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const body = parsed.data;
    const updated = await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: id, userId: body.userId } },
      data: { role: body.role },
    });
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertWorkspaceAccess(id, ["WORKSPACE_ADMIN"]);
    const parsed = parseBody(memberUserIdSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    await prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: id, userId: body.userId } },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 400 });
  }
}
