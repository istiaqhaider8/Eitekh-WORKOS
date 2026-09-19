import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PRIORITIES, resolveProjectPriorities } from "@/lib/project-context";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { priorityCreateSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";


export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);

    return NextResponse.json(await resolveProjectPriorities(projectId));
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/priorities");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectPermission(projectId, "projects:edit");

    const parsed = await parseJsonBody(req, priorityCreateSchema);
    if (!parsed.success) return parsed.error;
    const { name, color } = parsed.data;

    const trimmedName = name.trim();
    const value = trimmedName.toUpperCase().replace(/\s+/g, "_");
    const priorityColor = color || "#8b5cf6";

    const newPriorityObj = {
      name: trimmedName,
      value,
      color: priorityColor,
    };

    let cf = await prisma.customField.findFirst({
      where: {
        scopeType: "PROJECT",
        scopeId: projectId,
        name: "PROJECT_PRIORITIES",
      },
    });

    let currentList: any[] = [];
    if (cf?.optionsJson) {
      try {
        currentList = JSON.parse(cf.optionsJson);
      } catch {}
    }

    // Check if priority already exists
    const exists = currentList.some(
      (p) => p.value === value || p.name.toLowerCase() === trimmedName.toLowerCase()
    );

    if (!exists) {
      currentList.push(newPriorityObj);
    }

    if (cf) {
      cf = await prisma.customField.update({
        where: { id: cf.id },
        data: {
          optionsJson: JSON.stringify(currentList),
        },
      });
    } else {
      cf = await prisma.customField.create({
        data: {
          scopeType: "PROJECT",
          scopeId: projectId,
          name: "PROJECT_PRIORITIES",
          fieldType: "DROPDOWN",
          optionsJson: JSON.stringify(currentList),
        },
      });
    }

    const existingValues = new Set(DEFAULT_PRIORITIES.map((p) => p.value.toUpperCase()));
    const finalCustom = currentList.filter((cp) => !existingValues.has(cp.value?.toUpperCase() || cp.name.toUpperCase()));

    return NextResponse.json({
      success: true,
      created: newPriorityObj,
      priorities: [...DEFAULT_PRIORITIES, ...finalCustom],
    }, { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/priorities");
  }
}
