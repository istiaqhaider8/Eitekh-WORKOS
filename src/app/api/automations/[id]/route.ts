import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const rule = await prisma.automationRule.findUnique({ where: { id } });
    if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    await assertProjectAccess(rule.projectId);
    return NextResponse.json(rule);
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
    const existingRule = await prisma.automationRule.findUnique({ where: { id } });
    if (!existingRule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    await assertProjectPermission(existingRule.projectId, "projects:edit");

    const { name, triggerConfig, conditionRules, actionConfig, isActive } = await request.json();

    const rule = await prisma.automationRule.update({
      where: { id },
      data: { name, triggerConfig, conditionRules, actionConfig, isActive }
    });

    return NextResponse.json(rule);
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
    const existingRule = await prisma.automationRule.findUnique({ where: { id } });
    if (!existingRule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    await assertProjectPermission(existingRule.projectId, "projects:edit");

    await prisma.automationRule.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = error.message?.includes("Forbidden") ? 403 : error.message?.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
  }
}
