import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

    await assertProjectAccess(projectId);

    const components = await prisma.component.findMany({
      where: { projectId },
      include: {
        _count: {
          select: { issues: true },
        },
      },
    });

    return NextResponse.json(components);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { projectId, name, description, ownerId } = body;

    if (!projectId || !name) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await assertProjectAccess(projectId);

    const component = await prisma.component.create({
      data: {
        projectId,
        name,
        description,
        ownerId,
      },
    });

    return NextResponse.json(component, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
