import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { workflowCreateSchema, parseBody } from "@/lib/validation";

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

    const workflows = await prisma.workflow.findMany({
      where: { projectId },
      include: {
        statuses: {
          orderBy: { position: "asc" }
        },
        transitions: true
      },
      orderBy: { createdAt: "desc" }
    });

    return NextResponse.json(workflows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message?.includes("Unauthorized") ? 401 : 403 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(workflowCreateSchema, await request.json());
    if (!parsed.success) return parsed.error;
    const { projectId, name } = parsed.data;

    await assertProjectPermission(projectId, "settings:workflows");

    const workflow = await prisma.workflow.create({
      data: {
        projectId,
        name,
        isDefault: false
      }
    });

    return NextResponse.json(workflow, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: error.message?.includes("Unauthorized") ? 401 : 403 });
  }
}
