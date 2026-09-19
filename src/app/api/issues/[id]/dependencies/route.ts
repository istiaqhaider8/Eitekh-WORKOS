import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";
import { dependencyCreateSchema, dependencyDeleteSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const issue = await prisma.issue.findUnique({
      where: { id },
      include: {
        outgoingDeps: {
          include: { targetIssue: { select: { id: true, issueKey: true, title: true, status: true } } },
        },
        incomingDeps: {
          include: { sourceIssue: { select: { id: true, issueKey: true, title: true, status: true } } },
        },
      },
    });

    if (!issue) return NextResponse.json({ error: "Issue not found" }, { status: 404 });

    await assertProjectAccess(issue.projectId);

    return NextResponse.json({
      outgoing: issue.outgoingDeps,
      incoming: issue.incomingDeps,
    });
  } catch (error: any) {
    return handleApiError(error, "issues/[id]/dependencies");
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: sourceIssueId } = await params;
    const parsed = await parseJsonBody(req, dependencyCreateSchema);
    if (!parsed.success) return parsed.error;
    const { targetIssueId, type } = parsed.data;

    if (sourceIssueId === targetIssueId) {
      return NextResponse.json({ error: "Cannot create self-referencing dependency" }, { status: 400 });
    }

    const sourceIssue = await prisma.issue.findUnique({ where: { id: sourceIssueId } });
    const targetIssue = await prisma.issue.findUnique({ where: { id: targetIssueId } });

    if (!sourceIssue || !targetIssue) {
      return NextResponse.json({ error: "Source or target issue not found" }, { status: 404 });
    }

    await assertProjectAccess(sourceIssue.projectId);
    await assertProjectAccess(targetIssue.projectId);

    const existing = await prisma.issueDependency.findFirst({
      where: { sourceIssueId, targetIssueId, type },
    });
    
    if (existing) {
      return NextResponse.json(existing, { status: 200 });
    }

    const depsToCreate = [{ sourceIssueId, targetIssueId, type }];

    if (type === "BLOCKS") {
      depsToCreate.push({ sourceIssueId: targetIssueId, targetIssueId: sourceIssueId, type: "BLOCKED_BY" });
    } else if (type === "BLOCKED_BY") {
      depsToCreate.push({ sourceIssueId: targetIssueId, targetIssueId: sourceIssueId, type: "BLOCKS" });
    }

    const createdDeps = await prisma.$transaction(
      depsToCreate.map((dep) => prisma.issueDependency.create({ data: dep }))
    );

    await prisma.activityLog.create({
      data: {
        issueId: sourceIssueId,
        actorId: user.id,
        actionType: "CREATED_DEPENDENCY",
        newValue: targetIssueId,
      }
    });

    return NextResponse.json(createdDeps[0], { status: 201 });
  } catch (error: any) {
    return handleApiError(error, "issues/[id]/dependencies");
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const parsed = await parseJsonBody(req, dependencyDeleteSchema);
    if (!parsed.success) return parsed.error;
    const { dependencyId } = parsed.data;

    const dependency = await prisma.issueDependency.findUnique({
      where: { id: dependencyId },
    });

    if (!dependency) {
      return NextResponse.json({ error: "Dependency not found" }, { status: 404 });
    }

    if (dependency.sourceIssueId !== id && dependency.targetIssueId !== id) {
       return NextResponse.json({ error: "Dependency does not belong to this issue" }, { status: 400 });
    }

    const sourceIssue = await prisma.issue.findUnique({ where: { id: dependency.sourceIssueId } });
    if (sourceIssue) {
       await assertProjectAccess(sourceIssue.projectId);
    }

    const tx = [prisma.issueDependency.delete({ where: { id: dependency.id } })];

    if (dependency.type === "BLOCKS") {
      const inverse = await prisma.issueDependency.findFirst({
        where: { sourceIssueId: dependency.targetIssueId, targetIssueId: dependency.sourceIssueId, type: "BLOCKED_BY" },
      });
      if (inverse) tx.push(prisma.issueDependency.delete({ where: { id: inverse.id } }));
    } else if (dependency.type === "BLOCKED_BY") {
      const inverse = await prisma.issueDependency.findFirst({
        where: { sourceIssueId: dependency.targetIssueId, targetIssueId: dependency.sourceIssueId, type: "BLOCKS" },
      });
      if (inverse) tx.push(prisma.issueDependency.delete({ where: { id: inverse.id } }));
    }

    await prisma.$transaction(tx);
    
    await prisma.activityLog.create({
      data: {
        issueId: id,
        actorId: user.id,
        actionType: "REMOVED_DEPENDENCY",
        oldValue: dependency.targetIssueId,
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleApiError(error, "issues/[id]/dependencies");
  }
}
