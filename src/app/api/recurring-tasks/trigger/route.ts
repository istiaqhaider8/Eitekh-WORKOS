import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

function getNextCronDate(cron: string, fromDate = new Date()): Date {
  // Simple fallback: add 1 day
  const next = new Date(fromDate);
  next.setDate(next.getDate() + 1);
  return next;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const now = new Date();
    
    const dueTasks = await prisma.recurringTask.findMany({
      where: {
        isActive: true,
        OR: [
          { nextRunAt: { lte: now } },
          { nextRunAt: null }
        ]
      }
    });

    let createdCount = 0;

    for (const task of dueTasks) {
      let templateData: any = {};
      try {
        templateData = JSON.parse(task.templateData);
      } catch (e) {}
      
      const defaultStatus = await prisma.workflowStatus.findFirst({
        where: { workflow: { projectId: task.projectId } },
        orderBy: { position: 'asc' }
      });

      if (!defaultStatus) continue;

      const project = await prisma.project.update({
        where: { id: task.projectId },
        data: { issueCounter: { increment: 1 } }
      });

      const issueKey = `${project.key}-${project.issueCounter}`;

      await prisma.issue.create({
        data: {
          projectId: task.projectId,
          keyNumber: project.issueCounter,
          issueKey,
          title: templateData.title || "Recurring Task",
          description: templateData.description,
          issueType: templateData.issueType || "TASK",
          priority: templateData.priority || "MEDIUM",
          assigneeId: templateData.assigneeId || null,
          reporterId: user.id,
          statusId: defaultStatus.id
        }
      });

      createdCount++;

      const nextRun = getNextCronDate(task.scheduleCron, now);
      await prisma.recurringTask.update({
        where: { id: task.id },
        data: {
          lastRunAt: now,
          nextRunAt: nextRun
        }
      });
    }

    return NextResponse.json({ success: true, triggered: createdCount });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
