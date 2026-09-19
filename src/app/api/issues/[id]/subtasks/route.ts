import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { logAuditEvent } from "@/lib/audit-logger";
import { subtaskCreateSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import { assertIssueRelationsBelongToProject } from "@/lib/issue-relations";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: parentIssueId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parentIssue = await prisma.issue.findUnique({
      where: { id: parentIssueId },
      select: {
        id: true,
        issueKey: true,
        projectId: true,
        project: { select: { workspace: { select: { orgId: true } } } },
      },
    });
    if (!parentIssue) {
      return NextResponse.json({ error: "Parent issue not found" }, { status: 404 });
    }

    let access: any;
    try {
      access = await assertProjectPermission(parentIssue.projectId, "tasks:create");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const parsed = await parseJsonBody(req, subtaskCreateSchema);
    if (!parsed.success) return parsed.error;
    const { title, assigneeId, estimateHours, dueDate } = parsed.data;

    // H2 — `Subtask.assigneeId` is a foreign key to User with no tenant column
    // of its own, so without this any user id in the installation was accepted.
    // The guard above established that the caller may create subtasks on this
    // issue; it says nothing about who they may assign one to.
    await assertIssueRelationsBelongToProject(parentIssue.projectId, { assigneeId });

    const subtask = await prisma.subtask.create({
      data: {
        parentIssueId,
        title: title.trim(),
        assigneeId: assigneeId || null,
        estimateHours: estimateHours ? Number(estimateHours) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
        status: "TO_DO",
      },
      include: {
        assignee: publicUserRelation,
      },
    });

    await prisma.activityLog.create({
      data: {
        issueId: parentIssueId,
        actorId: user.id,
        actionType: "ADDED_SUBTASK",
        newValue: title.trim(),
      },
    });

    await logAuditEvent({
      actorId: user.id,
      actorName: user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      actorEmail: user.email,
      action: "SUBTASK_CREATED",
      category: "ISSUE",
      severity: "INFO",
      status: "SUCCESS",
      targetResource: `issue:${parentIssue.issueKey}:subtask:${subtask.id}`,
      orgId: parentIssue.project?.workspace?.orgId || undefined,
      newState: {
        id: subtask.id,
        title: subtask.title,
        assigneeId: subtask.assigneeId,
        estimateHours: subtask.estimateHours,
        dueDate: subtask.dueDate,
        status: subtask.status,
      },
      details: {
        parentIssueId,
        parentIssueKey: parentIssue.issueKey,
        subtaskId: subtask.id,
        title: subtask.title,
      },
      req,
    });

    return NextResponse.json({ subtask }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "issues/[id]/subtasks");
  }
}

