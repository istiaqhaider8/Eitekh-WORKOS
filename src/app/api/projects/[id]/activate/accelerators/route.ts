import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError, ConflictError } from "@/lib/api-error";
import { parseJsonBody, activateAcceleratorApplySchema } from "@/lib/validation";
import { ACCELERATORS, findAccelerator } from "@/lib/activate-accelerators";
import { isActivateEnabled } from "@/lib/activate";
import { allocateIssueKey, defaultStatusIdFor } from "@/lib/issue-keys";
import { allowedIssueTypeValues } from "@/lib/project-context";

/**
 * The accelerator catalogue, and applying one to a project.
 *
 * NOTHING HERE NAMES AN ACCELERATOR.
 *
 * The catalogue is `src/data/activate-accelerators.json`. This route filters
 * it, joins it to what the project has already applied, and creates an issue
 * from whichever one is asked for — all generically. There is no switch on a
 * key and no per-accelerator branch, which is the property that makes adding
 * one an edit to a data file rather than a change to software.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:view");

    const { searchParams } = new URL(req.url);
    const phaseKey = searchParams.get("phaseKey");

    /**
     * Which accelerators this project has already applied.
     *
     * Scoped through the phase, because `ActivateDeliverableLink` has no
     * projectId of its own — the same join every other deliverable query uses.
     * One query for the whole catalogue rather than one per accelerator.
     */
    const applied = await prisma.activateDeliverableLink.findMany({
      where: { phase: { projectId }, acceleratorKey: { not: null } },
      select: {
        acceleratorKey: true,
        issue: { select: { id: true, issueKey: true, title: true } },
      },
    });
    const appliedByKey = new Map(applied.map((a) => [a.acceleratorKey as string, a.issue]));

    const catalogue = (phaseKey ? ACCELERATORS.filter((a) => a.phaseKey === phaseKey) : ACCELERATORS)
      .map((a) => ({ ...a, applied: appliedByKey.get(a.key) ?? null }));

    return NextResponse.json({ accelerators: catalogue });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/accelerators");
  }
}

/**
 * Apply an accelerator: create the issue it describes and link it as a
 * deliverable of its phase, stamped with the accelerator's key.
 *
 * The stamp is what makes this answerable later — "has this project done the
 * fit-to-standard workshops" becomes a lookup rather than a guess based on
 * issue titles, which people rename.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_deliverables");

    const parsed = await parseJsonBody(req, activateAcceleratorApplySchema);
    if (!parsed.success) return parsed.error;

    const accelerator = findAccelerator(parsed.data.key);
    // A 400, not a 404: the key came from the body, and the caller is
    // authorised for this project — "that accelerator does not exist" is the
    // useful answer and confirms nothing about anyone else's data.
    if (!accelerator) {
      return NextResponse.json({ error: "No such accelerator." }, { status: 400 });
    }

    if (!(await isActivateEnabled(projectId))) {
      throw new ConflictError("Activate is not enabled for this project.", "ACTIVATE_DISABLED");
    }

    const [phase, workstream] = await Promise.all([
      prisma.activatePhase.findUnique({
        where: { projectId_key: { projectId, key: accelerator.phaseKey } },
        select: { id: true },
      }),
      prisma.activateWorkstream.findUnique({
        where: { projectId_key: { projectId, key: accelerator.workstreamKey } },
        select: { id: true },
      }),
    ]);

    if (!phase) {
      throw new ConflictError(
        `This project has no ${accelerator.phaseKey} phase to attach that to.`,
        "PHASE_MISSING"
      );
    }

    /**
     * One issue per accelerator per project.
     *
     * Applying twice would produce two identical issues and make "is this
     * done" ambiguous, which is the one question the stamp exists to answer.
     */
    const existing = await prisma.activateDeliverableLink.findFirst({
      where: { phase: { projectId }, acceleratorKey: accelerator.key },
      select: { id: true, issue: { select: { issueKey: true } } },
    });
    if (existing) {
      throw new ConflictError(
        `Already applied as ${existing.issue.issueKey}.`,
        "ACCELERATOR_APPLIED"
      );
    }

    /**
     * The issue type must be one THIS project accepts.
     *
     * The catalogue does not name a type at all, precisely because it cannot
     * know what a project has configured — the per-project allowlist is the
     * authority, as it is for the issues route. TASK is the near-universal
     * default; if a project has removed it, say so rather than writing a row
     * its own board would refuse.
     */
    const allowedTypes = await allowedIssueTypeValues(projectId);
    const issueType = allowedTypes.has("TASK")
      ? "TASK"
      : [...allowedTypes][0];
    if (!issueType) {
      throw new ConflictError(
        "This project has no issue types configured.",
        "NO_ISSUE_TYPES"
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const { keyNumber, issueKey, project } = await allocateIssueKey(tx, projectId);
      const statusId = defaultStatusIdFor(project);

      const issue = await tx.issue.create({
        data: {
          projectId,
          keyNumber,
          issueKey,
          title: accelerator.title,
          description: accelerator.description,
          issueType,
          priority: "MEDIUM",
          statusId,
          reporterId: user.id,
        },
        select: { id: true, issueKey: true, title: true },
      });

      const link = await tx.activateDeliverableLink.create({
        data: {
          issueId: issue.id,
          phaseId: phase.id,
          workstreamId: workstream?.id ?? null,
          isMandatory: accelerator.isMandatory,
          acceleratorKey: accelerator.key,
        },
        select: { id: true },
      });

      return { issue, linkId: link.id };
    });

    return NextResponse.json(
      { accelerator: accelerator.key, issue: created.issue, linkId: created.linkId },
      { status: 201 }
    );
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/accelerators");
  }
}
