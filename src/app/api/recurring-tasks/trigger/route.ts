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

    /**
     * The first workflow status per project, fetched once.
     *
     * This was a findFirst INSIDE the loop, so a run with 200 due tasks issued
     * 200 identical queries whenever those tasks shared projects — the classic
     * N+1. The answer only varies per project, and the number of distinct
     * projects in a batch is normally a small fraction of the number of tasks.
     * The counter increment below genuinely has to stay per-task: it is the
     * atomic allocation of the issue key.
     */
    const projectIds = [...new Set(dueTasks.map((t) => t.projectId))];
    const statuses = await prisma.workflowStatus.findMany({
      where: { workflow: { projectId: { in: projectIds } } },
      orderBy: { position: 'asc' },
      select: { id: true, workflow: { select: { projectId: true } } },
    });
    const defaultStatusByProject = new Map<string, string>();
    for (const s of statuses) {
      // findMany returns them ordered by position, so the first one seen for a
      // project is the same row the old findFirst would have returned.
      if (!defaultStatusByProject.has(s.workflow.projectId)) {
        defaultStatusByProject.set(s.workflow.projectId, s.id);
      }
    }

    for (const task of dueTasks) {
      let templateData: any = {};
      try {
        templateData = JSON.parse(task.templateData);
      } catch (e) {}

      const defaultStatusId = defaultStatusByProject.get(task.projectId);
      if (!defaultStatusId) continue;

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
          statusId: defaultStatusId
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
