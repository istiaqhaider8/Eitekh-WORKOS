import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertOrgAccess } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { orgId, name, description } = body;
    
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
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
