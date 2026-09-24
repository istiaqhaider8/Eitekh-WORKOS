import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { attachmentSchema, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import { logger } from "@/lib/logger";
import { getStorage } from "@/lib/storage/factory";
import { attachmentKey, decodeDataUri } from "@/lib/storage";
import { syncEngine } from "@/lib/sync-engine";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; ticketId: string }> }
) {
  try {
    const { id: projectId, ticketId } = await params;
    let authContext: any;
    try {
      authContext = await assertProjectAccess(projectId);
      await assertProjectPermission(projectId, "tickets:view");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const { user } = authContext;
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, projectId: true, createdById: true },
    });

    if (!ticket || ticket.projectId !== projectId) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    if (user.userType === "CLIENT" && ticket.createdById !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const attachments = await prisma.attachment.findMany({
      where: { ticketId },
      orderBy: { createdAt: "desc" },
      include: {
        uploader: publicUserRelation,
      },
    });

    return NextResponse.json({ attachments });
  } catch (error: any) {
    return handleApiError(error, "tickets/[ticketId]/attachments");
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; ticketId: string }> }
) {
  try {
    const { id: projectId, ticketId } = await params;
    let authContext: any;
    try {
      authContext = await assertProjectAccess(projectId);
      await assertProjectPermission(projectId, "tickets:comment");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
    }

    const { user } = authContext;
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, projectId: true, createdById: true, ticketKey: true },
    });

    if (!ticket || ticket.projectId !== projectId) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    if (user.userType === "CLIENT" && ticket.createdById !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const parsed = await parseJsonBody(req, attachmentSchema);
    if (!parsed.success) return parsed.error;
    const { fileName, fileSize, mimeType, fileUrl } = parsed.data;

    const storage = getStorage();
    const inlineBytes = storage ? decodeDataUri(fileUrl) : null;

    const attachment = await prisma.attachment.create({
      data: {
        ticketId,
        uploaderId: user.id,
        fileName,
        fileSize,
        mimeType,
        fileUrl,
      },
      include: {
        uploader: publicUserRelation,
      },
    });

    if (storage && inlineBytes) {
      const key = attachmentKey(attachment.id);
      try {
        await storage.put(key, inlineBytes.bytes, mimeType || inlineBytes.mime);
        await prisma.attachment.update({
          where: { id: attachment.id },
          data: { storageKey: key },
        });
        attachment.storageKey = key;
      } catch (err: any) {
        logger.error(
          "ATTACHMENT_STORAGE_WRITE_FAILED",
          `Attachment ${attachment.id} stayed in the database: ${err?.message || err}`,
          { attachmentId: attachment.id, backend: storage.name }
        );
      }
    }

    syncEngine.publishProjectEvent({
      projectId,
      eventType: "TICKET_UPDATED",
      entityId: ticketId,
      entityType: "ISSUE",
      data: { id: ticketId, action: "ATTACHMENT_ADDED", attachmentId: attachment.id },
      actor: { id: user.id, email: user.email, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() },
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "tickets/[ticketId]/attachments");
  }
}
