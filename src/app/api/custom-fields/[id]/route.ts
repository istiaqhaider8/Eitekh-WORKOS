import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission, assertOrgAccess } from "@/lib/tenant";

async function verifyFieldAccess(field: { scopeType: string; scopeId: string }, requireAdmin = false) {
  if (field.scopeType === "PROJECT") {
    if (requireAdmin) {
      await assertProjectPermission(field.scopeId, "projects:edit");
    } else {
      await assertProjectAccess(field.scopeId);
    }
  } else if (field.scopeType === "ORG") {
    await assertOrgAccess(field.scopeId, requireAdmin ? ["OWNER", "ADMIN"] : ["OWNER", "ADMIN", "MEMBER"]);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const field = await prisma.customField.findUnique({
      where: { id },
      include: { values: true }
    });
    if (!field) return NextResponse.json({ error: "Custom field not found" }, { status: 404 });

    await verifyFieldAccess(field, false);
    return NextResponse.json(field);
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
    const existingField = await prisma.customField.findUnique({ where: { id } });
    if (!existingField) return NextResponse.json({ error: "Custom field not found" }, { status: 404 });

    await verifyFieldAccess(existingField, true);

    const { name, optionsJson, isRequired } = await request.json();

    const field = await prisma.customField.update({
      where: { id },
      data: { name, optionsJson, isRequired }
    });

    return NextResponse.json(field);
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
    const existingField = await prisma.customField.findUnique({ where: { id } });
    if (!existingField) return NextResponse.json({ error: "Custom field not found" }, { status: 404 });

    await verifyFieldAccess(existingField, true);

    await prisma.customField.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = error.message?.includes("Forbidden") ? 403 : error.message?.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
  }
}
