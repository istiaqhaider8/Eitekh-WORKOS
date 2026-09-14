import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const task = await prisma.recurringTask.findUnique({ where: { id } });
    if (!task) return NextResponse.json({ error: "Recurring task not found" }, { status: 404 });

    await assertProjectAccess(task.projectId);
    return NextResponse.json(task);
  } catch (error: any) {
    const status = error.message?.includes("Forbidden") ? 403 : error.message?.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const existingTask = await prisma.recurringTask.findUnique({ where: { id } });
    if (!existingTask) return NextResponse.json({ error: "Recurring task not found" }, { status: 404 });

    await assertProjectPermission(existingTask.projectId, "projects:edit");

    const { scheduleCron, templateData, isActive } = await request.json();

    const task = await prisma.recurringTask.update({
      where: { id },
      data: { scheduleCron, templateData, isActive }
    });

    return NextResponse.json(task);
  } catch (error: any) {
    const status = error.message?.includes("Forbidden") ? 403 : error.message?.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const existingTask = await prisma.recurringTask.findUnique({ where: { id } });
    if (!existingTask) return NextResponse.json({ error: "Recurring task not found" }, { status: 404 });

    await assertProjectPermission(existingTask.projectId, "projects:edit");

    await prisma.recurringTask.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = error.message?.includes("Forbidden") ? 403 : error.message?.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
  }
}
