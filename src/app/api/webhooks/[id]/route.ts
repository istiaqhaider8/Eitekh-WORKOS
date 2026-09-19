import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertOrgAccess, assertProjectAccess } from "@/lib/tenant";
import { webhookUpdateSchema, parseBody } from "@/lib/validation";
import { encryptField, maskSecret } from "@/lib/encryption";
import { handleApiError } from "@/lib/api-error";

async function verifyWebhookAccess(webhook: { orgId: string; projectId: string | null }, requireAdmin = true) {
  if (webhook.projectId) {
    await assertProjectAccess(webhook.projectId);
  } else {
    await assertOrgAccess(webhook.orgId, requireAdmin ? ["OWNER", "ADMIN"] : ["OWNER", "ADMIN", "MEMBER"]);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const webhook = await prisma.webhook.findUnique({ where: { id } });
    if (!webhook) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });

    await verifyWebhookAccess(webhook, false);
    return NextResponse.json({ ...webhook, secret: maskSecret(webhook.secret) });
  } catch (error: any) {
    return handleApiError(error, "webhooks/[id]");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const existingWebhook = await prisma.webhook.findUnique({ where: { id } });
    if (!existingWebhook) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });

    await verifyWebhookAccess(existingWebhook, true);

    const parsed = parseBody(webhookUpdateSchema, await request.json());
    if (!parsed.success) return parsed.error;
    const { targetUrl, secret, events, isActive } = parsed.data;

    const updateData: any = {};
    if (targetUrl !== undefined) updateData.targetUrl = targetUrl;
    if (secret !== undefined) updateData.secret = encryptField(secret);
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    if (events !== undefined) {
      updateData.events = Array.isArray(events) ? JSON.stringify(events) : events;
    }

    const webhook = await prisma.webhook.update({
      where: { id },
      data: updateData
    });

    return NextResponse.json({ ...webhook, secret: maskSecret(webhook.secret) });
  } catch (error: any) {
    return handleApiError(error, "webhooks/[id]");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const existingWebhook = await prisma.webhook.findUnique({ where: { id } });
    if (!existingWebhook) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });

    await verifyWebhookAccess(existingWebhook, true);

    await prisma.webhook.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error, "webhooks/[id]");
  }
}
