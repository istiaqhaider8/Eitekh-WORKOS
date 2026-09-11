import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const { name, category, color, position, wipLimit } = await request.json();
    
    if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

    const status = await prisma.workflowStatus.create({
      data: {
        workflowId: id,
        name,
        category: category || "TO_DO",
        color: color || "#6b7280",
        position: position || 0,
        wipLimit
      }
    });

    return NextResponse.json(status, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  try {
    const { statusId, name, color, position, wipLimit } = await request.json();
    if (!statusId) return NextResponse.json({ error: "Missing statusId" }, { status: 400 });

    const status = await prisma.workflowStatus.update({
      where: { id: statusId },
      data: { name, color, position, wipLimit }
    });

    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  try {
    const { statusId } = await request.json();
    if (!statusId) return NextResponse.json({ error: "Missing statusId" }, { status: 400 });

    const status = await prisma.workflowStatus.findUnique({
      where: { id: statusId },
      include: { issues: { select: { id: true } } }
    });

    if (!status) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (status.issues.length > 0) return NextResponse.json({ error: "Cannot delete status with assigned issues" }, { status: 400 });

    await prisma.workflowStatus.delete({ where: { id: statusId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
