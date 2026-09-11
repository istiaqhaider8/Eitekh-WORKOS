import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const component = await prisma.component.findUnique({
      where: { id },
      include: {
        issues: {
          include: { status: true, assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } }
        }
      },
    });

    if (!component) return NextResponse.json({ error: "Component not found" }, { status: 404 });

    await assertProjectAccess(component.projectId);

    return NextResponse.json(component);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const { name, description, ownerId } = body;

    const component = await prisma.component.findUnique({ where: { id } });
    if (!component) return NextResponse.json({ error: "Component not found" }, { status: 404 });

    await assertProjectAccess(component.projectId);

    const updatedComponent = await prisma.component.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(ownerId !== undefined && { ownerId }),
      },
    });

    return NextResponse.json(updatedComponent);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const component = await prisma.component.findUnique({ where: { id } });
    if (!component) return NextResponse.json({ error: "Component not found" }, { status: 404 });

    await assertProjectAccess(component.projectId);

    // Unlink issues first
    await prisma.issue.updateMany({
      where: { componentId: id },
      data: { componentId: null },
    });

    await prisma.component.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
