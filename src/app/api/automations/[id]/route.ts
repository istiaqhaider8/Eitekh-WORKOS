import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { automationUpdateSchema, parseBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import { applyVersionedUpdate, versionConflictResponse } from "@/lib/optimistic-lock";

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
    return handleApiError(error, "automations/[id]");
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

    const parsed = parseBody(automationUpdateSchema, await request.json());
    if (!parsed.success) return parsed.error;
    const { name, triggerConfig, conditionRules, actionConfig, isActive, version } = parsed.data;

    /**
     * M4 — a lost edit here changes what the system DOES, not just what it
     * says. Two admins tuning the same rule, and the older tab's Save quietly
     * restores a trigger someone had just turned off.
     */
    await applyVersionedUpdate(prisma.automationRule, {
      id,
      expectedVersion: version,
      data: { name, triggerConfig, conditionRules, actionConfig, isActive },
      entity: "automation rule",
    });
    const rule = await prisma.automationRule.findUniqueOrThrow({ where: { id } });

    return NextResponse.json(rule);
  } catch (error: any) {
    if (error?.code === "VERSION_CONFLICT") {
      const current = await prisma.automationRule.findUnique({ where: { id } });
      return versionConflictResponse(error.message, "rule", current);
    }
    return handleApiError(error, "automations/[id]");
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
    return handleApiError(error, "automations/[id]");
  }
}
