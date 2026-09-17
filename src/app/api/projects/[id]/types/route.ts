import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { issueTypeCreateSchema, issueTypeUpdateSchema, parseBody } from "@/lib/validation";

const DEFAULT_ISSUE_TYPES = [
  { name: "Task", value: "TASK", color: "#0ea5e9", icon: "CheckSquare", description: "Standard actionable work item" },
  { name: "Bug", value: "BUG", color: "#f43f5e", icon: "AlertCircle", description: "Defect, error or problem in functionality" },
  { name: "Story", value: "STORY", color: "#10b981", icon: "Bookmark", description: "User requirement or scenario" },
  { name: "Epic", value: "EPIC", color: "#a855f7", icon: "Layers", description: "Large body of work encompassing multiple tasks" },
];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);

    // Look for custom issue types configured for this project
    const cf = await prisma.customField.findFirst({
      where: {
        scopeType: "PROJECT",
        scopeId: projectId,
        name: "PROJECT_ISSUE_TYPES",
      },
    });

    let customList: Array<{ name: string; value: string; color: string; icon?: string; description?: string }> = [];
    if (cf?.optionsJson) {
      try {
        const parsed = JSON.parse(cf.optionsJson);
        if (Array.isArray(parsed)) {
          customList = parsed;
        }
      } catch (e) {
        console.error("Failed to parse project issue types JSON:", e);
      }
    }

    const customValues = new Set(customList.map((ct) => ct.value.toUpperCase()));
    const finalDefaults = DEFAULT_ISSUE_TYPES.filter((dt) => !customValues.has(dt.value.toUpperCase()));
    const merged = [
      ...DEFAULT_ISSUE_TYPES.map((dt) => {
        const customOverride = customList.find((c) => c.value.toUpperCase() === dt.value.toUpperCase());
        return customOverride || dt;
      }),
      ...customList.filter((c) => !DEFAULT_ISSUE_TYPES.some((d) => d.value.toUpperCase() === c.value.toUpperCase())),
    ];

    return NextResponse.json({
      defaults: DEFAULT_ISSUE_TYPES,
      custom: customList,
      types: merged,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch issue types" },
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

    const parsed = parseBody(issueTypeCreateSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { name, color, icon, description, value: customVal } = parsed.data;

    const trimmedName = name.trim();
    const val = (customVal && typeof customVal === "string" ? customVal.trim() : trimmedName)
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_");

    const newTypeObj = {
      name: trimmedName,
      value: val,
      color: color || "#6366f1",
      icon: icon || "Tag",
      description: description?.trim() || "Custom work item type",
    };

    let cf = await prisma.customField.findFirst({
      where: {
        scopeType: "PROJECT",
        scopeId: projectId,
        name: "PROJECT_ISSUE_TYPES",
      },
    });

    let currentList: any[] = [];
    if (cf?.optionsJson) {
      try {
        currentList = JSON.parse(cf.optionsJson);
      } catch {}
    }

    const existingIdx = currentList.findIndex(
      (t) => t.value === val || t.name.toLowerCase() === trimmedName.toLowerCase()
    );

    if (existingIdx >= 0) {
      currentList[existingIdx] = { ...currentList[existingIdx], ...newTypeObj };
    } else {
      currentList.push(newTypeObj);
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
          name: "PROJECT_ISSUE_TYPES",
          fieldType: "DROPDOWN",
          optionsJson: JSON.stringify(currentList),
        },
      });
    }

    return NextResponse.json(
      {
        success: true,
        created: newTypeObj,
        types: currentList,
      },
      { status: 201 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create issue type" },
      { status: error.message?.includes("Unauthorized") ? 401 : 500 }
    );
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectPermission(projectId, "projects:edit");

    const parsed = parseBody(issueTypeUpdateSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { originalValue, name, color, icon, description, newValue } = parsed.data;

    const trimmedName = name?.trim() || originalValue;
    const finalVal = (newValue || trimmedName).toUpperCase().replace(/[^A-Z0-9_]/g, "_");

    let cf = await prisma.customField.findFirst({
      where: {
        scopeType: "PROJECT",
        scopeId: projectId,
        name: "PROJECT_ISSUE_TYPES",
      },
    });

    let currentList: any[] = [];
    if (cf?.optionsJson) {
      try {
        currentList = JSON.parse(cf.optionsJson);
      } catch {}
    }

    const defaultMatch = DEFAULT_ISSUE_TYPES.find((d) => d.value.toUpperCase() === originalValue.toUpperCase());
    const existingIndex = currentList.findIndex((t) => t.value.toUpperCase() === originalValue.toUpperCase());

    const updatedObj = {
      name: trimmedName,
      value: finalVal,
      color: color || (existingIndex >= 0 ? currentList[existingIndex].color : defaultMatch?.color || "#6366f1"),
      icon: icon || (existingIndex >= 0 ? currentList[existingIndex].icon : defaultMatch?.icon || "Tag"),
      description:
        description !== undefined
          ? description.trim()
          : existingIndex >= 0
          ? currentList[existingIndex].description
          : defaultMatch?.description || "",
    };

    if (existingIndex >= 0) {
      currentList[existingIndex] = updatedObj;
    } else {
      currentList.push(updatedObj);
    }

    if (cf) {
      await prisma.customField.update({
        where: { id: cf.id },
        data: { optionsJson: JSON.stringify(currentList) },
      });
    } else {
      await prisma.customField.create({
        data: {
          scopeType: "PROJECT",
          scopeId: projectId,
          name: "PROJECT_ISSUE_TYPES",
          fieldType: "DROPDOWN",
          optionsJson: JSON.stringify(currentList),
        },
      });
    }

    // If the value changed, update any existing issues in the project
    if (originalValue.toUpperCase() !== finalVal) {
      await prisma.issue.updateMany({
        where: {
          projectId,
          issueType: originalValue.toUpperCase(),
        },
        data: {
          issueType: finalVal,
        },
      });
    }

    return NextResponse.json({
      success: true,
      updated: updatedObj,
      types: currentList,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update issue type" },
      { status: error.message?.includes("Unauthorized") ? 401 : 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectPermission(projectId, "projects:edit");

    const { searchParams } = new URL(req.url);
    const valueToDelete = searchParams.get("value")?.toUpperCase();

    if (!valueToDelete) {
      return NextResponse.json({ error: "Type value parameter is required" }, { status: 400 });
    }

    let cf = await prisma.customField.findFirst({
      where: {
        scopeType: "PROJECT",
        scopeId: projectId,
        name: "PROJECT_ISSUE_TYPES",
      },
    });

    let currentList: any[] = [];
    if (cf?.optionsJson) {
      try {
        currentList = JSON.parse(cf.optionsJson);
      } catch {}
    }

    // Remove from custom list
    currentList = currentList.filter((t) => t.value.toUpperCase() !== valueToDelete);

    if (cf) {
      await prisma.customField.update({
        where: { id: cf.id },
        data: { optionsJson: JSON.stringify(currentList) },
      });
    }

    // Migrate any issues having this deleted issueType back to 'TASK'
    const migrated = await prisma.issue.updateMany({
      where: {
        projectId,
        issueType: valueToDelete,
      },
      data: {
        issueType: "TASK",
      },
    });

    return NextResponse.json({
      success: true,
      deleted: valueToDelete,
      migratedCount: migrated.count,
      types: currentList,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete issue type" },
      { status: error.message?.includes("Unauthorized") ? 401 : 500 }
    );
  }
}
