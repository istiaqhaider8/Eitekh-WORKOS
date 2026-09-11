import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertOrgAccess } from "@/lib/tenant";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertOrgAccess(id, ["OWNER", "ADMIN", "MEMBER"]);
    const org = await prisma.organization.findUnique({
      where: { id },
      include: {
        _count: {
          select: { members: true },
        },
      },
    });
    if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(org);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message.includes("Unauthorized") ? 401 : 403 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertOrgAccess(id, ["OWNER", "ADMIN"]);
    const body = await req.json();
    const updated = await prisma.organization.update({
      where: { id },
      data: {
        name: body.name,
        domain: body.domain,
        timezone: body.timezone,
        language: body.language,
        dateFormat: body.dateFormat,
        workingDays: body.workingDays,
        workingHours: body.workingHours,
      },
    });
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message.includes("Unauthorized") ? 401 : 400 });
  }
}
