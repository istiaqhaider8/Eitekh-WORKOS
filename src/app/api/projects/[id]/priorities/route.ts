import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { priorityCreateSchema, parseBody } from "@/lib/validation";

const DEFAULT_PRIORITIES = [
  { name: "Critical", value: "CRITICAL", color: "#f43f5e" },
  { name: "High", value: "HIGH", color: "#f59e0b" },
  { name: "Medium", value: "MEDIUM", color: "#3b82f6" },
  { name: "Low", value: "LOW", color: "#10b981" },
];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);

    // Look for project priorities custom field
    const cf = await prisma.customField.findFirst({
      where: {
        scopeType: "PROJECT",
        scopeId: projectId,
        name: "PROJECT_PRIORITIES",
      },
    });

    let customList: Array<{ name: string; value: string; color: string }> = [];
    if (cf?.optionsJson) {
      try {
        const parsed = JSON.parse(cf.optionsJson);
        if (Array.isArray(parsed)) {
          customList = parsed;
        }
      } catch (e) {
        console.error("Failed to parse project priorities JSON:", e);
      }
    }

    // Merge defaults with custom list without duplicates by value/name
    const existingValues = new Set(DEFAULT_PRIORITIES.map((p) => p.value.toUpperCase()));
    const finalCustom = customList.filter((cp) => !existingValues.has(cp.value?.toUpperCase() || cp.name.toUpperCase()));

    return NextResponse.json({
      defaults: DEFAULT_PRIORITIES,
      custom: finalCustom,
      priorities: [...DEFAULT_PRIORITIES, ...finalCustom],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch priorities" },
      { status: error.message?.includes("Unauthorized") ? 401 : 500 }
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectPermission(projectId, "projects:edit");

    const parsed = parseBody(priorityCreateSchema, await req.json());
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
    return NextResponse.json(
      { error: error.message || "Failed to create priority" },
      { status: error.message?.includes("Unauthorized") ? 401 : 500 }
    );
  }
}
