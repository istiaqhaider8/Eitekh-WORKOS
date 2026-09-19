import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { automationCreateSchema, parseBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    await assertProjectAccess(projectId);

    const automations = await prisma.automationRule.findMany({
      where: { projectId }
    });

    return NextResponse.json(automations);
  } catch (error: any) {
    return handleApiError(error, "automations");
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(automationCreateSchema, await request.json());
    if (!parsed.success) return parsed.error;
    const { projectId, name, triggerType, triggerConfig, conditionRules, actionType, actionConfig } = parsed.data;

    await assertProjectPermission(projectId, "settings:automations");

    const rule = await prisma.automationRule.create({
      data: {
        projectId,
        name,
        triggerType,
        triggerConfig: triggerConfig || null,
        conditionRules: conditionRules || null,
        actionType,
        actionConfig: actionConfig || null,
        isActive: true
      }
    });

    return NextResponse.json(rule, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "automations");
  }
}
