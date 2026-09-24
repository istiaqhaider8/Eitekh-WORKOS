import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const attachment = await prisma.attachment.findUnique({
      where: { id },
      include: {
        issue: { select: { id: true, projectId: true } },
        ticket: { select: { id: true, projectId: true } },
      },
    });

    if (!attachment) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    const projectId = attachment.issue?.projectId || attachment.ticket?.projectId;
    if (!projectId) {
      return NextResponse.json({ error: "Attachment has no associated project" }, { status: 404 });
    }

    try {
      await assertProjectAccess(projectId);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    await prisma.attachment.delete({
      where: { id },
    });

    if (attachment.issue) {
      await prisma.activityLog.create({
        data: {
          issueId: attachment.issue.id,
          actorId: user.id,
          actionType: "DELETED_ATTACHMENT",
          oldValue: attachment.fileName,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error, "attachments/[id]");
  }
}
