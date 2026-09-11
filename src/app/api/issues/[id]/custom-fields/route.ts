import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const issue = await prisma.issue.findUnique({
    where: { id },
    select: { projectId: true }
  });
  if (!issue) return NextResponse.json({ error: "Issue not found" }, { status: 404 });

  try {
    await assertProjectAccess(issue.projectId);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
  }

  const values = await prisma.customFieldValue.findMany({
    where: { issueId: id },
    include: { customField: true }
  });

  return NextResponse.json(values);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const issue = await prisma.issue.findUnique({
    where: { id },
    select: { projectId: true }
  });
  if (!issue) return NextResponse.json({ error: "Issue not found" }, { status: 404 });

  try {
    await assertProjectAccess(issue.projectId);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Forbidden" }, { status: 403 });
  }

  try {
    const { values } = await request.json();
    if (!Array.isArray(values)) {
      return NextResponse.json({ error: "Invalid values array" }, { status: 400 });
    }

    const updated = [];
    for (const val of values) {
      const { customFieldId, valueString, valueNumber, valueDate, valueJson } = val;
      
      const record = await prisma.customFieldValue.upsert({
        where: {
          customFieldId_issueId: {
            customFieldId,
            issueId: id
          }
        },
        update: { valueString, valueNumber, valueDate: valueDate ? new Date(valueDate) : null, valueJson },
        create: {
          customFieldId,
          issueId: id,
          valueString,
          valueNumber,
          valueDate: valueDate ? new Date(valueDate) : null,
          valueJson
        }
      });
      updated.push(record);
    }

    return NextResponse.json({ success: true, values: updated });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
