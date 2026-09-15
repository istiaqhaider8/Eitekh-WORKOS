import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { logAuditEvent } from "@/lib/audit-logger";
import { commentSchema, parseBody } from "@/lib/validation";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: issueId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      include: { project: { select: { key: true, name: true, workspace: { select: { orgId: true } } } } },
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    let access: any;
    try {
      access = await assertProjectPermission(issue.projectId, "issues:comment");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const parsed = parseBody(commentSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { content } = parsed.data;

    const comment = await prisma.comment.create({
      data: {
        issueId,
        userId: user.id,
        content,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });

    // Record activity
    await prisma.activityLog.create({
      data: {
        issueId,
        actorId: user.id,
        actionType: "COMMENTED",
        newValue: content.trim().substring(0, 100),
      },
    });

    // Detect @mentions (e.g. @sarah or @marcus) and notify mentioned users
    const mentions = content.match(/@([a-zA-Z0-9_.-]+)/g);
    if (mentions && issue) {
      for (const mention of mentions) {
        const username = mention.slice(1).toLowerCase();
        let mentionedUser = await prisma.user.findFirst({
          where: { email: { equals: username } },
        });
        
        if (!mentionedUser) {
          mentionedUser = await prisma.user.findFirst({
            where: {
              OR: [
                { firstName: { equals: username } },
                { lastName: { equals: username } },
              ],
            },
          });
        }
        if (mentionedUser && mentionedUser.id !== user.id) {
          const { notificationEngine } = await import("@/lib/notifications");
          await notificationEngine.dispatch({
            recipientUserIds: [mentionedUser.id],
            type: "MENTION",
            title: "You were mentioned in a comment",
            message: `${user.fullName || user.firstName} mentioned you on ${issue.issueKey}: "${content.substring(0, 80)}"`,
            linkUrl: `/projects/${issue.projectId}?issue=${issue.id}`,
            projectId: issue.projectId,
            issueId: issue.id,
            actorId: user.id,
            actorName: user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
            actorEmail: user.email,
            emailTemplateKey: "MENTION",
            emailVariables: {
              userName: `${mentionedUser.firstName} ${mentionedUser.lastName}`.trim() || mentionedUser.email,
              authorName: user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
              projectKey: issue.project?.key || "PROJECT",
              issueKey: issue.issueKey,
              issueTitle: issue.title,
              commentContent: content,
              actionUrl: `http://localhost:3000/projects/${issue.projectId}?issue=${issue.id}`,
            },
            sendEmailAsync: true,
          });
        }
      }
    }

    // Platform Audit Logging
    await logAuditEvent({
      actorId: user.id,
      actorName: user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      actorEmail: user.email,
      action: "COMMENT_ADDED",
      category: "ISSUE",
      severity: "INFO",
      status: "SUCCESS",
      targetResource: `issue:${issue.issueKey}:comment:${comment.id}`,
      orgId: issue.project?.workspace?.orgId || undefined,
      details: {
        issueId: issue.id,
        issueKey: issue.issueKey,
        commentId: comment.id,
        contentSnippet: content.trim().substring(0, 100),
      },
      req,
    });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
