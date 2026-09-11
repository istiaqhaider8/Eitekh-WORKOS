import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId");
  const projectId = searchParams.get("projectId");

  if (!orgId && !projectId) {
    return NextResponse.json({ error: "Missing orgId or projectId" }, { status: 400 });
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
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
