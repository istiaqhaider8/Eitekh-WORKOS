import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { DEFAULT_ISSUE_TYPES, resolveProjectIssueTypes } from "@/lib/project-context";
import { issueTypeCreateSchema, issueTypeUpdateSchema, parseBody, parseJsonBody } from "@/lib/validation";


export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);

    return NextResponse.json(await resolveProjectIssueTypes(projectId));
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

    const parsed = await parseJsonBody(req, issueTypeCreateSchema);
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

    const parsed = await parseJsonBody(req, issueTypeUpdateSchema);
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
