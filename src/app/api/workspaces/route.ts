import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertOrgAccess } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth";
import { workspaceCreateSchema, parseBody } from "@/lib/validation";

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
    const status = error.message?.includes("Forbidden") ? 403 : error.message?.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(workspaceCreateSchema, await req.json());
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
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 400 });
  }
}
