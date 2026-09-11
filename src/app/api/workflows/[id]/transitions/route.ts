import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const transitions = await prisma.workflowTransition.findMany({
    where: { workflowId: id }
  });

  return NextResponse.json(transitions);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const { fromStatusId, toStatusId, requiredRole } = await request.json();
    
    if (!fromStatusId || !toStatusId) return NextResponse.json({ error: "Missing status IDs" }, { status: 400 });

    const transition = await prisma.workflowTransition.create({
      data: {
        workflowId: id,
        fromStatusId,
        toStatusId,
        requiredRole
      }
    });

    return NextResponse.json(transition, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  try {
    const { transitionId } = await request.json();
    if (!transitionId) return NextResponse.json({ error: "Missing transitionId" }, { status: 400 });

    await prisma.workflowTransition.delete({ where: { id: transitionId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
