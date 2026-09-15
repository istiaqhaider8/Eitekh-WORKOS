import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";
import { watcherSchema, parseBody } from "@/lib/validation";

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
    });

    if (!issue) return NextResponse.json({ error: "Issue not found" }, { status: 404 });

    await assertProjectAccess(issue.projectId);

    const watchers = await prisma.watcher.findMany({
      where: { issueId: id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, email: true } }
      }
    });

    return NextResponse.json(watchers);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: issueId } = await params;
    const parsed = parseBody(watcherSchema, await req.json().catch(() => ({})));
    if (!parsed.success) return parsed.error;
    const targetUserId = parsed.data.userId || user.id;

    const issue = await prisma.issue.findUnique({ where: { id: issueId } });
    if (!issue) return NextResponse.json({ error: "Issue not found" }, { status: 404 });

    await assertProjectAccess(issue.projectId);

    const existing = await prisma.watcher.findUnique({
      where: { issueId_userId: { issueId, userId: targetUserId } }
    });

    if (existing) {
      return NextResponse.json(existing, { status: 200 });
    }

    const watcher = await prisma.watcher.create({
      data: {
        issueId,
        userId: targetUserId,
      },
    });

    await prisma.activityLog.create({
      data: {
        issueId,
        actorId: user.id,
        actionType: "ADDED_WATCHER",
        newValue: targetUserId,
      }
    });

    return NextResponse.json(watcher, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: issueId } = await params;
    const parsed = parseBody(watcherSchema, await req.json().catch(() => ({})));
    if (!parsed.success) return parsed.error;
    const targetUserId = parsed.data.userId || user.id;

    const issue = await prisma.issue.findUnique({ where: { id: issueId } });
    if (!issue) return NextResponse.json({ error: "Issue not found" }, { status: 404 });

    await assertProjectAccess(issue.projectId);

    const watcher = await prisma.watcher.findUnique({
      where: { issueId_userId: { issueId, userId: targetUserId } }
    });

    if (!watcher) {
      return NextResponse.json({ error: "Watcher not found" }, { status: 404 });
    }

    await prisma.watcher.delete({
      where: { id: watcher.id }
    });

    await prisma.activityLog.create({
      data: {
        issueId,
        actorId: user.id,
        actionType: "REMOVED_WATCHER",
        oldValue: targetUserId,
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
