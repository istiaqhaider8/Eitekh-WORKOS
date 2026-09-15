import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const { key } = await params;

    const [current, versions] = await Promise.all([
      prisma.emailTemplate.findUnique({
        where: { key },
        select: { key: true, name: true, version: true, subject: true, updatedAt: true },
      }),
      prisma.emailTemplateVersion.findMany({
        where: { templateKey: key },
        orderBy: { version: "desc" },
        take: 50,
      }),
    ]);

    if (!current) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ current, versions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
