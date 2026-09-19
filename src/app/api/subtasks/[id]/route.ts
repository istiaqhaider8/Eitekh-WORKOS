import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { logAuditEvent } from "@/lib/audit-logger";
import { subtaskUpdateSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import { applyVersionedUpdate, versionConflictResponse } from "@/lib/optimistic-lock";
import { assertIssueRelationsBelongToProject } from "@/lib/issue-relations";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const subtask = await prisma.subtask.findUnique({
      where: { id },
      include: {
        assignee: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
        parentIssue: {
          select: {
            id: true,
            issueKey: true,
            projectId: true,
          },
        },
      },
    });

    if (!subtask) {
      return NextResponse.json({ error: "Subtask not found" }, { status: 404 });
    }

    await assertProjectAccess(subtask.parentIssue.projectId);

    return NextResponse.json({ subtask });
  } catch (error: any) {
    return handleApiError(error, "subtasks/[id]");
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const existingSubtask = await prisma.subtask.findUnique({
      where: { id },
      include: {
        parentIssue: {
          select: {
            id: true,
            issueKey: true,
            projectId: true,
            project: { select: { workspace: { select: { orgId: true } } } },
          },
        },
      },
    });
    if (!existingSubtask) {
      return NextResponse.json({ error: "Subtask not found" }, { status: 404 });
    }

    let access: any;
    try {
      access = await assertProjectPermission(existingSubtask.parentIssue.projectId, "tasks:edit");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const parsed = await parseJsonBody(req, subtaskUpdateSchema);
    if (!parsed.success) return parsed.error;
    const { title, assigneeId, priority, estimateHours, dueDate, isCompleted, status, version } = parsed.data;

    // H2 — the sibling of the hole in POST /issues/[id]/subtasks. `undefined`
    // means the field is not being changed and `null` means unassign; neither
    // needs checking, and the validator skips both. Only a real id does.
    await assertIssueRelationsBelongToProject(existingSubtask.parentIssue.projectId, { assigneeId });

    const updateData: any = {};
    if (title !== undefined) updateData.title = title.trim();
    if (assigneeId !== undefined) updateData.assigneeId = assigneeId || null;
    if (priority !== undefined) updateData.priority = priority;
    if (estimateHours !== undefined) updateData.estimateHours = estimateHours !== null ? Number(estimateHours) : null;
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;
    if (isCompleted !== undefined) {
      updateData.isCompleted = isCompleted;
      updateData.status = isCompleted ? "DONE" : (status || "TO_DO");
    } else if (status !== undefined) {
      updateData.status = status;
      updateData.isCompleted = status === "DONE";
    }

    /**
     * M4 — a subtask is edited from the issue detail view and the board at
     * the same time, which is one person with two tabs as often as it is two
     * people. Ticking "done" in one and renaming in the other lost whichever
     * saved first.
     */
    await applyVersionedUpdate(prisma.subtask, {
      id,
      expectedVersion: version,
      data: updateData,
      entity: "subtask",
    });

    const subtask = await prisma.subtask.findUniqueOrThrow({
      where: { id },
      include: {
        assignee: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
    });

    await logAuditEvent({
      actorId: user.id,
      actorName: user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      actorEmail: user.email,
      action: "SUBTASK_UPDATED",
      category: "ISSUE",
      severity: "INFO",
      status: "SUCCESS",
      targetResource: `issue:${existingSubtask.parentIssue.issueKey}:subtask:${id}`,
      orgId: existingSubtask.parentIssue.project?.workspace?.orgId || undefined,
      previousState: {
        title: existingSubtask.title,
        status: existingSubtask.status,
        assigneeId: existingSubtask.assigneeId,
      },
      newState: updateData,
      details: {
        subtaskId: id,
        parentIssueId: existingSubtask.parentIssue.id,
        parentIssueKey: existingSubtask.parentIssue.issueKey,
        changes: updateData,
      },
      req,
    });

    return NextResponse.json({ subtask });
  } catch (error: any) {
    if (error?.code === "VERSION_CONFLICT") {
      const { id } = await params;
      const current = await prisma.subtask.findUnique({ where: { id } });
      return versionConflictResponse(error.message, "subtask", current);
    }
    return handleApiError(error, "subtasks/[id]");
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const existingSubtask = await prisma.subtask.findUnique({
      where: { id },
      include: {
        parentIssue: {
          select: {
            id: true,
            issueKey: true,
            projectId: true,
            project: { select: { workspace: { select: { orgId: true } } } },
          },
        },
      },
    });
    if (!existingSubtask) {
      return NextResponse.json({ error: "Subtask not found" }, { status: 404 });
    }

    let access: any;
    try {
      access = await assertProjectPermission(existingSubtask.parentIssue.projectId, "tasks:delete");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    await prisma.subtask.delete({ where: { id } });

    await logAuditEvent({
      actorId: user.id,
      actorName: user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      actorEmail: user.email,
      action: "SUBTASK_DELETED",
      category: "ISSUE",
      severity: "NOTICE",
      status: "SUCCESS",
      targetResource: `issue:${existingSubtask.parentIssue.issueKey}:subtask:${id}`,
      orgId: existingSubtask.parentIssue.project?.workspace?.orgId || undefined,
      previousState: {
        title: existingSubtask.title,
        status: existingSubtask.status,
      },
      details: {
        subtaskId: id,
        parentIssueId: existingSubtask.parentIssue.id,
        parentIssueKey: existingSubtask.parentIssue.issueKey,
        title: existingSubtask.title,
      },
      req,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error, "subtasks/[id]");
  }
}

