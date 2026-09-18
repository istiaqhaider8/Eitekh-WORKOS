import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { superAdminFeatureCreateSchema, superAdminFeatureUpdateSchema, parseBody, parseJsonBody } from "@/lib/validation";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const flags = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
    return NextResponse.json({ flags });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const parsed = await parseJsonBody(req, superAdminFeatureCreateSchema);
    if (!parsed.success) return parsed.error;
    const { key, description, isGlobalEnabled } = parsed.data;

    const cleanKey = key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");

    const existingFlag = await prisma.featureFlag.findUnique({ where: { key: cleanKey } });
    if (existingFlag) {
      return NextResponse.json({ error: `Feature flag '${cleanKey}' already exists` }, { status: 409 });
    }

    const flag = await prisma.featureFlag.create({
      data: {
        key: cleanKey,
        description: description?.trim() || null,
        isGlobalEnabled: Boolean(isGlobalEnabled),
      },
    });

    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "FEATURE_FLAG_CREATED",
        targetResource: `FeatureFlag:${cleanKey}`,
        details: JSON.stringify({
          key: flag.key,
          description: flag.description,
          isGlobalEnabled: flag.isGlobalEnabled,
          createdBy: user.email,
        }),
      },
    });

    return NextResponse.json({ flag, message: `Feature flag ${flag.key} created successfully` }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const parsed = await parseJsonBody(req, superAdminFeatureUpdateSchema);
    if (!parsed.success) return parsed.error;
    const { key, isGlobalEnabled, description } = parsed.data;

    const existing = await prisma.featureFlag.findUnique({ where: { key } });
    if (!existing) {
      return NextResponse.json({ error: "Feature flag not found" }, { status: 404 });
    }

    const updateData: any = {};
    if (typeof isGlobalEnabled === "boolean") updateData.isGlobalEnabled = isGlobalEnabled;
    if (description !== undefined) updateData.description = description ? description.trim() : null;

    const updatedFlag = await prisma.featureFlag.update({
      where: { key },
      data: updateData,
    });

    let action = "FEATURE_FLAG_UPDATED";
    if (typeof isGlobalEnabled === "boolean" && isGlobalEnabled !== existing.isGlobalEnabled) {
      action = isGlobalEnabled ? "FEATURE_ENABLED" : "FEATURE_DISABLED";
    }

    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action,
        targetResource: `FeatureFlag:${key}`,
        details: JSON.stringify({
          previous: { isGlobalEnabled: existing.isGlobalEnabled, description: existing.description },
          updated: updateData,
        }),
      },
    });

    return NextResponse.json({ flag: updatedFlag, message: `Feature flag ${key} updated successfully` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    let key = searchParams.get("key");

    if (!key) {
      try {
        const body = await req.json();
        key = body.key;
      } catch (e) {}
    }

    if (!key) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    const existing = await prisma.featureFlag.findUnique({ where: { key } });
    if (!existing) {
      return NextResponse.json({ error: "Feature flag not found" }, { status: 404 });
    }

    await prisma.featureFlag.delete({ where: { key } });

    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "FEATURE_FLAG_DELETED",
        targetResource: `FeatureFlag:${key}`,
        details: JSON.stringify({
          deletedKey: key,
          description: existing.description,
          deletedBy: user.email,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: `Feature flag ${key} deleted permanently`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
