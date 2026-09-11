import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    await assertProjectAccess(projectId);

    const tasks = await prisma.recurringTask.findMany({
      where: { projectId }
    });

    return NextResponse.json(tasks);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message?.includes("Unauthorized") ? 401 : 403 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { projectId, scheduleCron, templateData, isActive } = await request.json();
    if (!projectId || !scheduleCron || !templateData) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await assertProjectAccess(projectId);

    const task = await prisma.recurringTask.create({
      data: {
        projectId,
        scheduleCron,
        templateData,
        isActive: isActive !== undefined ? isActive : true
      }
    });

    return NextResponse.json(task, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: error.message?.includes("Unauthorized") ? 401 : 403 });
  }
}
