import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const attachment = await prisma.attachment.findUnique({
      where: { id },
      include: {
        issue: { select: { id: true, projectId: true } },
      },
    });

    if (!attachment) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    try {
      await assertProjectAccess(attachment.issue.projectId);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    await prisma.attachment.delete({
      where: { id },
    });

    await prisma.activityLog.create({
      data: {
        issueId: attachment.issue.id,
        actorId: user.id,
        actionType: "DELETED_ATTACHMENT",
        oldValue: attachment.fileName,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
