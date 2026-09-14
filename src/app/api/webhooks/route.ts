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
    const status = error.message?.includes("Forbidden") ? 403 : error.message?.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: error.message || "Forbidden" }, { status });
  }

  const where: any = {};
  if (orgId) where.orgId = orgId;
  if (projectId) where.projectId = projectId;

  const webhooks = await prisma.webhook.findMany({ where });

  return NextResponse.json(webhooks);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { orgId, projectId, targetUrl, secret, events, isActive } = await request.json();
    if (!orgId || !targetUrl || !secret || !events) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!validateWebhookUrl(targetUrl)) {
      return NextResponse.json({ error: "Invalid target URL. Must be a valid HTTP/HTTPS URL" }, { status: 400 });
    }

    await assertOrgAccess(orgId, ["OWNER", "ADMIN"]);
    if (projectId) {
      await assertProjectAccess(projectId);
    }

    const webhook = await prisma.webhook.create({
      data: {
        orgId,
        projectId: projectId || null,
        targetUrl,
        secret,
        events: Array.isArray(events) ? JSON.stringify(events) : events,
        isActive: isActive !== undefined ? isActive : true
      }
    });

    return NextResponse.json(webhook, { status: 201 });
  } catch (error: any) {
    const status = error.message?.includes("Forbidden") ? 403 : error.message?.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
  }
}
