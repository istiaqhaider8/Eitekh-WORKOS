import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";
import { recurringTaskCreateSchema, parseBody } from "@/lib/validation";

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

    const parsed = parseBody(recurringTaskCreateSchema, await request.json());
    if (!parsed.success) return parsed.error;
    const { projectId, scheduleCron, templateData, isActive } = parsed.data;

    await assertProjectAccess(projectId);

    const task = await prisma.recurringTask.create({
      data: {
        projectId,
        scheduleCron,
        templateData,
        isActive
      }
    });

    return NextResponse.json(task, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: error.message?.includes("Unauthorized") ? 401 : 403 });
  }
}
