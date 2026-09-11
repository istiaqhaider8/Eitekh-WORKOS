import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: issueId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { projectId: true },
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    try {
      await assertProjectAccess(issue.projectId);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const attachments = await prisma.attachment.findMany({
      where: { issueId },
      include: {
        uploader: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ attachments });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: issueId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { id: true, projectId: true, issueKey: true },
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    try {
      await assertProjectAccess(issue.projectId);
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { fileName, fileSize, mimeType, fileUrl } = body;

    if (!fileName || !fileUrl) {
      return NextResponse.json({ error: "fileName and fileUrl are required" }, { status: 400 });
    }

    const attachment = await prisma.attachment.create({
      data: {
        issueId,
        uploaderId: user.id,
        fileName: fileName.trim(),
        fileSize: fileSize ? Number(fileSize) : 0,
        mimeType: mimeType || "application/octet-stream",
        fileUrl: fileUrl,
      },
      include: {
        uploader: {
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

    await prisma.activityLog.create({
      data: {
        issueId,
        actorId: user.id,
        actionType: "UPLOADED_ATTACHMENT",
        newValue: fileName.trim(),
      },
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
