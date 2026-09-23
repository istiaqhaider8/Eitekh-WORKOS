import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { assertActivateEnabled } from "@/lib/activate";
import { handleApiError } from "@/lib/api-error";
import { parseJsonBody, activatePhaseUpdateSchema } from "@/lib/validation";
import { assertActivateRefsBelongToProject } from "@/lib/activate-refs";
import { logAuditEvent } from "@/lib/audit-logger";
import {
  validatePhaseCanStart,
  validatePhaseCanComplete,
} from "@/lib/activate-phase-completion";

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
    await assertActivateEnabled(projectId);

    const parsed = await parseJsonBody(req, activatePhaseUpdateSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    const phase = await prisma.activatePhase.findFirst({
      where: { id: phaseId, projectId },
      select: { id: true, key: true, name: true, version: true, status: true },
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

    /**
     * Every foreign key the BODY carries must belong to this project.
     *
     * This was an inline `ProjectMember` lookup when the route was written. It
     * moved into `activate-refs.ts` when the deliverable routes needed the
     * same rule for `phaseId`, `workstreamId` and `issueId` — the third write
     * path to need it, which is the point at which `issue-relations.ts` says
     * to share the rule rather than grow a third opinion. The refusal message
     * is unchanged.
     */
    await assertActivateRefsBelongToProject(projectId, { ownerId: body.ownerId });

    // Validate phase gate rules and progression eligibility
    if (body.status !== undefined && body.status !== phase.status) {
      if (body.status === "IN_PROGRESS") {
        const startCheck = await validatePhaseCanStart(projectId, phase.key);
        if (!startCheck.allowed) {
          return NextResponse.json({ error: startCheck.error }, { status: 400 });
        }
      } else if (body.status === "COMPLETED") {
        const completeCheck = await validatePhaseCanComplete(projectId, phase.key);
        if (!completeCheck.allowed) {
          return NextResponse.json({ error: completeCheck.error }, { status: 400 });
        }
      }
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

    /**
     * A status change is audited; a date or owner edit is not.
     *
     * Completing a phase is a claim that a stage of the project is finished,
     * and "who marked Discover complete, and when" is a question a gate
     * review asks. It had no answer: this route wrote nothing to the audit
     * log, so the only record was the phase's own `status` column, which the
     * next edit overwrites.
     *
     * Only a real transition is recorded. A request that re-sends the status
     * a phase already has is not an event, and logging it would bury the
     * transitions among repeats. Dates and owners are left out deliberately:
     * they are ordinary planning edits, and an audit log that fills with
     * them is one nobody reads.
     */
    if (body.status !== undefined && body.status !== phase.status) {
      await logAuditEvent({
        actor: {
          id: user.id,
          name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
          email: user.email,
        },
        action: "ACTIVATE_PHASE_STATUS_CHANGED",
        category: "PROJECT",
        severity: body.status === "COMPLETED" ? "NOTICE" : "INFO",
        status: "SUCCESS",
        targetResource: `ActivatePhase:${phaseId}`,
        projectId,
        details: { phase: updated.key, name: updated.name, from: phase.status, to: body.status },
      }).catch((e) => console.error("Failed to audit phase status change:", e));
    }

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
