import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertOrgAccess, assertProjectAccess } from "@/lib/tenant";

function validateWebhookUrl(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

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
    return NextResponse.json(webhook);
  } catch (error: any) {
    const status = error.message?.includes("Forbidden") ? 403 : error.message?.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
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

    const { targetUrl, secret, events, isActive } = await request.json();

    if (targetUrl !== undefined && !validateWebhookUrl(targetUrl)) {
      return NextResponse.json({ error: "Invalid target URL. Must be a valid HTTP/HTTPS URL" }, { status: 400 });
    }

    const updateData: any = {};
    if (targetUrl !== undefined) updateData.targetUrl = targetUrl;
    if (secret !== undefined) updateData.secret = secret;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    if (events !== undefined) {
      updateData.events = Array.isArray(events) ? JSON.stringify(events) : events;
    }

    const webhook = await prisma.webhook.update({
      where: { id },
      data: updateData
    });

    return NextResponse.json(webhook);
  } catch (error: any) {
    const status = error.message?.includes("Forbidden") ? 403 : error.message?.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
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
    const status = error.message?.includes("Forbidden") ? 403 : error.message?.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
  }
}
