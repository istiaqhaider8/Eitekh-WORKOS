import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertOrgAccess } from "@/lib/tenant";
import { orgUpdateSchema, parseBody } from "@/lib/validation";

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
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: error.message?.includes("Unauthorized") ? 401 : 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertOrgAccess(id, ["OWNER", "ADMIN"]);
    const parsed = parseBody(orgUpdateSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const updated = await prisma.organization.update({
      where: { id },
      data: {
        name: parsed.data.name,
        domain: parsed.data.domain,
        timezone: parsed.data.timezone,
        language: parsed.data.language,
        dateFormat: parsed.data.dateFormat,
        workingDays: parsed.data.workingDays,
        workingHours: parsed.data.workingHours,
      },
    });
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: error.message?.includes("Unauthorized") ? 401 : 500 });
  }
}
