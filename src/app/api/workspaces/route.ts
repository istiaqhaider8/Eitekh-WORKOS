import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertOrgAccess } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth";
import { workspaceCreateSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get("orgId");

    const where: any = { isArchived: false };
    if (orgId) {
      await assertOrgAccess(orgId);
      where.orgId = orgId;
    }

    if (!user.isSuperAdmin) {
      where.members = { some: { userId: user.id } };
    }

    const workspaces = await prisma.workspace.findMany({
      where,
      include: {
        _count: { select: { projects: true, members: true } }
      },
      orderBy: { name: "asc" }
    });

    return NextResponse.json(workspaces);
  } catch (error: any) {
    return handleApiError(error, "workspaces");
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = await parseJsonBody(req, workspaceCreateSchema);
    if (!parsed.success) return parsed.error;
    const { orgId, name, description } = parsed.data;
    
    await assertOrgAccess(orgId, ["OWNER", "ADMIN"]);
    
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    
    const workspace = await prisma.workspace.create({
      data: {
        orgId,
        name,
        slug,
        description,
        members: {
          create: {
            userId: user.id,
            role: "WORKSPACE_ADMIN",
          }
        }
      },
    });
    
    return NextResponse.json(workspace, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "workspaces", 400);
  }
}
