import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { parseJsonBody, activatePhaseUpdateSchema } from "@/lib/validation";

/**
 * Update a phase: owner, dates, status.
 *
 * TENANT SCOPING
 *
 * The phase is loaded by `id` AND `projectId` together, from the path. A
 * phase id on its own is a leaf resource, and leaf resources reachable by
 * their own id on a path that names no tenant are exactly where both
 * previously-found isolation vulnerabilities lived. Here the path names the
 * project, and the query requires the phase to belong to it — so a phase id
 * from another tenant is a 404, not someone else's row.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string }> }
) {
  try {
    const { id: projectId, phaseId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_phases");

    const parsed = await parseJsonBody(req, activatePhaseUpdateSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    const phase = await prisma.activatePhase.findFirst({
      where: { id: phaseId, projectId },
      select: { id: true, version: true, status: true },
    });
    if (!phase) return NextResponse.json({ error: "Phase not found" }, { status: 404 });

    /**
     * Optimistic locking, matching the M4 convention.
     *
     * Opt-in: a request without `version` behaves as before. With one, a stale
     * value is refused rather than silently overwriting an edit the caller
     * never saw — which matters here because a gate sign-off and a phase edit
     * can land at the same moment.
     */
    if (body.version !== undefined && body.version !== phase.version) {
      return NextResponse.json(
        {
          error: "This phase was changed by someone else. Reload and try again.",
          currentVersion: phase.version,
        },
        { status: 409 }
      );
    }

    const data: Record<string, unknown> = { version: { increment: 1 } };
    if (body.name !== undefined) data.name = body.name;
    if (body.status !== undefined) {
      data.status = body.status;
      // Completing a phase stamps the time; reopening clears it, so the field
      // never claims a completion that was undone.
      data.completedAt = body.status === "COMPLETED" ? new Date() : null;
    }
    if (body.ownerId !== undefined) data.ownerId = body.ownerId;
    if (body.startDate !== undefined) data.startDate = body.startDate ? new Date(body.startDate) : null;
    if (body.targetDate !== undefined) data.targetDate = body.targetDate ? new Date(body.targetDate) : null;

    /**
     * An owner must be a member of THIS project.
     *
     * Without this a phase could name any user in the system as its owner,
     * which is a cross-tenant reference dressed up as an assignment — the same
     * shape as the assignee bug the bulk importer had to guard against.
     */
    if (body.ownerId) {
      const member = await prisma.projectMember.findFirst({
        where: { projectId, userId: body.ownerId },
        select: { id: true },
      });
      if (!member) {
        return NextResponse.json(
          { error: "The owner must be a member of this project." },
          { status: 400 }
        );
      }
    }

    if (body.startDate !== undefined || body.targetDate !== undefined) {
      const existing = await prisma.activatePhase.findUnique({
        where: { id: phaseId },
        select: { startDate: true, targetDate: true },
      });
      const start = body.startDate !== undefined
        ? (body.startDate ? new Date(body.startDate) : null)
        : existing?.startDate ?? null;
      const target = body.targetDate !== undefined
        ? (body.targetDate ? new Date(body.targetDate) : null)
        : existing?.targetDate ?? null;
      // Same rule as A2 on issues: only constrain what the request CHANGES,
      // so an inherited inconsistency cannot block unrelated edits forever.
      if (start && target && target < start) {
        return NextResponse.json(
          { error: "Target date cannot be earlier than the start date." },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.activatePhase.update({
      where: { id: phaseId },
      data,
      select: {
        id: true,
        key: true,
        name: true,
        status: true,
        ownerId: true,
        startDate: true,
        targetDate: true,
        completedAt: true,
        version: true,
      },
    });

    // Keep the profile's cursor in step with the phase actually in progress.
    if (body.status === "IN_PROGRESS") {
      await prisma.activateProfile.updateMany({
        where: { projectId },
        data: { currentPhaseKey: updated.key },
      });
    }

    return NextResponse.json({ phase: updated });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/phases/[phaseId]");
  }
}
