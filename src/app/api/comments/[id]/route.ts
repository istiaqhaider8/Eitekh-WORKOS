import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";
import { logAuditEvent } from "@/lib/audit-logger";
import { commentUpdateSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import { applyVersionedUpdate, versionConflictResponse } from "@/lib/optimistic-lock";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const parsed = await parseJsonBody(req, commentUpdateSchema);
    if (!parsed.success) return parsed.error;
    const { content, version } = parsed.data;

    const comment = await prisma.comment.findUnique({
      where: { id },
      include: {
        issue: {
          select: {
            id: true,
            issueKey: true,
            projectId: true,
            project: { select: { workspace: { select: { orgId: true } } } },
          },
        },
      },
    });

    if (!comment) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

    await assertProjectAccess(comment.issue.projectId);

    if (comment.userId !== user.id) {
      return NextResponse.json({ error: "Only the author can edit this comment" }, { status: 403 });
    }

    /**
     * M4 — a comment is prose, and a lost edit loses somebody's writing.
     *
     * Only the author can edit, so the two writers here are usually the same
     * person in two tabs, or a tab left open since yesterday. That is not a
     * rarer case than two people — it is a more common one, and the outcome
     * was the same: the older tab's Save silently replaced the newer text.
     */
    await applyVersionedUpdate(prisma.comment, {
      id,
      expectedVersion: version,
      data: { content },
      entity: "comment",
    });
    const updatedComment = await prisma.comment.findUniqueOrThrow({ where: { id } });

    await logAuditEvent({
      actorId: user.id,
      actorName: user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      actorEmail: user.email,
      action: "COMMENT_UPDATED",
      category: "ISSUE",
      severity: "INFO",
      status: "SUCCESS",
      targetResource: `issue:${comment.issue.issueKey}:comment:${id}`,
      orgId: comment.issue.project?.workspace?.orgId || undefined,
      previousState: { content: comment.content },
      newState: { content },
      details: {
        commentId: id,
        issueId: comment.issue.id,
        issueKey: comment.issue.issueKey,
      },
      req,
    });

    return NextResponse.json(updatedComment);
  } catch (error: any) {
    if (error?.code === "VERSION_CONFLICT") {
      const { id } = await params;
      const current = await prisma.comment.findUnique({ where: { id } });
      return versionConflictResponse(error.message, "comment", current);
    }
    return handleApiError(error, "comments/[id]");
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const comment = await prisma.comment.findUnique({
      where: { id },
      include: {
        issue: {
          select: {
            id: true,
            issueKey: true,
            projectId: true,
            project: { select: { workspace: { select: { orgId: true } } } },
          },
        },
      },
    });

    if (!comment) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

    const { role } = await assertProjectAccess(comment.issue.projectId);

    if (comment.userId !== user.id && role !== "PROJECT_ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Not authorized to delete this comment" }, { status: 403 });
    }

    await prisma.comment.delete({ where: { id } });

    await logAuditEvent({
      actorId: user.id,
      actorName: user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      actorEmail: user.email,
      action: "COMMENT_DELETED",
      category: "ISSUE",
      severity: "NOTICE",
      status: "SUCCESS",
      targetResource: `issue:${comment.issue.issueKey}:comment:${id}`,
      orgId: comment.issue.project?.workspace?.orgId || undefined,
      previousState: { content: comment.content },
      details: {
        commentId: id,
        issueId: comment.issue.id,
        issueKey: comment.issue.issueKey,
      },
      req,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error, "comments/[id]");
  }
}

