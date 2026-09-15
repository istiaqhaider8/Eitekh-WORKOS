import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission, assertOrgPermission } from "@/lib/tenant";
import { customFieldCreateSchema, parseBody } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const orgId = searchParams.get("orgId");
    const scopeId = projectId || orgId || searchParams.get("scopeId");
    const scopeType = searchParams.get("scopeType") || (projectId ? "PROJECT" : orgId ? "ORG" : "PROJECT");

    if (!scopeId) {
      return NextResponse.json({ error: "Missing projectId, orgId or scopeId" }, { status: 400 });
    }

    if (scopeType === "PROJECT") {
      await assertProjectAccess(scopeId);
    }

    const fields = await prisma.customField.findMany({
      where: { scopeId, scopeType },
      orderBy: { createdAt: "asc" }
    });

    return NextResponse.json({ customFields: fields, fields });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: error.message?.includes("Unauthorized") ? 401 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(customFieldCreateSchema, await request.json());
    if (!parsed.success) return parsed.error;
    const { scopeType, scopeId, name, fieldType, optionsJson, isRequired } = parsed.data;

    if (scopeType === "PROJECT") {
      await assertProjectPermission(scopeId, "settings:custom_fields");
    } else if (scopeType === "ORG") {
      await assertOrgPermission(scopeId, "settings:custom_fields");
    }

    const field = await prisma.customField.create({
      data: {
        scopeType,
        scopeId,
        name,
        fieldType,
        optionsJson: optionsJson || null,
        isRequired
      }
    });

    return NextResponse.json(field, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: error.message?.includes("Unauthorized") ? 401 : 500 });
  }
}
