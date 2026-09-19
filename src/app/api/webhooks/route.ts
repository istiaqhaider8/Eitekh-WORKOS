import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertOrgAccess, assertProjectAccess } from "@/lib/tenant";
import { webhookCreateSchema, parseBody } from "@/lib/validation";
import { encryptField, maskSecret } from "@/lib/encryption";
import { handleApiError } from "@/lib/api-error";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId");
  const projectId = searchParams.get("projectId");

  if (!orgId && !projectId) {
    return NextResponse.json({ error: "Missing orgId or projectId" }, { status: 400 });
  }

  try {
    if (projectId) {
      await assertProjectAccess(projectId);
    } else if (orgId) {
      await assertOrgAccess(orgId, ["OWNER", "ADMIN"]);
    }
  } catch (error: any) {
    return handleApiError(error, "webhooks");
  }

  const where: any = {};
  if (orgId) where.orgId = orgId;
  if (projectId) where.projectId = projectId;

  const webhooks = await prisma.webhook.findMany({ where });

  // Mask secrets before returning to client
  const safeWebhooks = webhooks.map((w) => ({ ...w, secret: maskSecret(w.secret) }));
  return NextResponse.json(safeWebhooks);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = parseBody(webhookCreateSchema, await request.json());
    if (!parsed.success) return parsed.error;
    const { orgId, projectId, targetUrl, secret, events, isActive } = parsed.data;

    await assertOrgAccess(orgId, ["OWNER", "ADMIN"]);
    if (projectId) {
      await assertProjectAccess(projectId);
    }

    const webhook = await prisma.webhook.create({
      data: {
        orgId,
        projectId: projectId || null,
        targetUrl,
        secret: encryptField(secret),
        events: Array.isArray(events) ? JSON.stringify(events) : events,
        isActive: isActive !== undefined ? isActive : true
      }
    });

    return NextResponse.json({ ...webhook, secret: maskSecret(webhook.secret) }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "webhooks");
  }
}
