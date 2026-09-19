import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage/factory";
import { attachmentKey, decodeDataUri } from "@/lib/storage";

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
    return handleApiError(error, "issues/[id]/attachments");
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

    const { attachmentSchema, parseJsonBody } = await import("@/lib/validation");
    const parsed = await parseJsonBody(req, attachmentSchema);
    if (!parsed.success) return parsed.error;
    const { fileName, fileSize, mimeType, fileUrl } = parsed.data;

    /**
     * B3 — put the bytes in the object store rather than in the row.
     *
     * The client still sends a `data:` URI, because changing the upload
     * protocol to multipart is a separate change with its own client work.
     * What changes here is where those bytes come to rest: the store when one
     * is configured, the column when it is not. A deployment with no
     * STORAGE_DRIVER keeps working exactly as before, which is what makes
     * this safe to ship before every environment is configured.
     *
     * The row is created FIRST, without a storageKey, because the key is
     * derived from the attachment id — and then updated once the bytes are
     * confirmed written. A crash between the two leaves a row that still
     * serves from `fileUrl`: the same three-state tolerance the backfill
     * relies on, for the same reason.
     */
    const storage = getStorage();
    const inlineBytes = storage ? decodeDataUri(fileUrl) : null;

    const attachment = await prisma.attachment.create({
      data: {
        issueId,
        uploaderId: user.id,
        fileName,
        fileSize,
        mimeType,
        fileUrl,
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

    /**
     * Write the bytes out, then record where they went.
     *
     * A failure here is logged and swallowed rather than failing the upload:
     * the row exists and still serves from `fileUrl`, so the user's file is
     * not lost — it is merely still in the database, which is the state every
     * attachment was in before this change. The backfill script will collect
     * it on its next run, since it selects exactly `storageKey IS NULL`.
     *
     * Failing the request instead would turn a storage hiccup into a lost
     * upload, which is strictly worse than a delayed migration.
     */
    if (storage && inlineBytes) {
      const key = attachmentKey(attachment.id);
      try {
        await storage.put(key, inlineBytes.bytes, mimeType || inlineBytes.mime);
        await prisma.attachment.update({ where: { id: attachment.id }, data: { storageKey: key } });
        attachment.storageKey = key;
      } catch (err: any) {
        logger.error(
          "ATTACHMENT_STORAGE_WRITE_FAILED",
          `Attachment ${attachment.id} stayed in the database: ${err?.message || err}`,
          { attachmentId: attachment.id, backend: storage.name }
        );
      }
    }

    await prisma.activityLog.create({
      data: {
        issueId,
        actorId: user.id,
        actionType: "UPLOADED_ATTACHMENT",
        newValue: fileName,
      },
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "issues/[id]/attachments");
  }
}
