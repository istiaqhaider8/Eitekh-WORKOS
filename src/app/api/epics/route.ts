import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    await assertProjectAccess(projectId);

    const epics = await prisma.epic.findMany({
      where: { projectId },
      include: {
        _count: {
          select: { issues: true },
        },
        issues: {
          select: { status: { select: { category: true } } }
        }
      },
    });

    const epicsWithProgress = epics.map(epic => {
      const totalIssues = epic._count.issues;
      const completedIssues = epic.issues.filter(i => i.status.category === "DONE").length;
      const progress = totalIssues > 0 ? Math.round((completedIssues / totalIssues) * 100) : 0;
      
      const { issues, ...epicData } = epic;
      return {
        ...epicData,
        completedIssues,
        progress
      };
    });

    return NextResponse.json(epicsWithProgress);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { projectId, name, summary, color, ownerId, startDate, targetDate } = body;

    if (!projectId || !name) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await assertProjectPermission(projectId, "epics:create");

    const epic = await prisma.epic.create({
      data: {
        projectId,
        name,
        summary,
        color: color || "#3b82f6",
        ownerId,
        startDate: startDate ? new Date(startDate) : null,
        targetDate: targetDate ? new Date(targetDate) : null,
      },
    });

    return NextResponse.json(epic, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
