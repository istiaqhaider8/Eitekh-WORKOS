import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { parseJsonBody, activateEnableSchema } from "@/lib/validation";
import { enableActivate, disableActivate, ACTIVATE_METHODOLOGY_VERSION } from "@/lib/activate";
import { logAuditEvent } from "@/lib/audit-logger";
import { templateUsableBy } from "@/lib/activate-templates";

/**
 * SAP Activate profile for a project.
 *
 * GET is readable by anyone with project access AND `activate:view`. It
 * answers "is this project running Activate, and where is it" — deliberately
 * returning `enabled: false` rather than 404 for a project that is not, so a
 * client can render the enable affordance without a failed request being the
 * normal path.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Project access first, so a caller outside the tenant is refused before
    // the permission check can tell them the project exists.
    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:view");

    const profile = await prisma.activateProfile.findUnique({
      where: { projectId },
      select: {
        id: true,
        enabled: true,
        methodologyVersion: true,
        currentPhaseKey: true,
        version: true,
        updatedAt: true,
      },
    });

    if (!profile || !profile.enabled) {
      return NextResponse.json({
        enabled: false,
        methodologyVersion: ACTIVATE_METHODOLOGY_VERSION,
        phases: [],
        workstreams: [],
      });
    }

    const [phases, workstreams] = await Promise.all([
      prisma.activatePhase.findMany({
        where: { projectId },
        orderBy: { position: "asc" },
        select: {
          id: true,
          key: true,
          name: true,
          position: true,
          status: true,
          ownerId: true,
          startDate: true,
          targetDate: true,
          completedAt: true,
          version: true,
          gates: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              name: true,
              isMandatory: true,
              status: true,
              criteria: {
                orderBy: { position: "asc" },
                select: { id: true, criterion: true, status: true, evidenceRef: true },
              },
            },
          },
          _count: { select: { deliverables: true } },
        },
      }),
      prisma.activateWorkstream.findMany({
        where: { projectId },
        orderBy: { position: "asc" },
        select: { id: true, key: true, name: true, ownerId: true, status: true, position: true },
      }),
    ]);

    return NextResponse.json({
      enabled: true,
      methodologyVersion: profile.methodologyVersion,
      currentPhaseKey: profile.currentPhaseKey,
      version: profile.version,
      phases,
      workstreams,
    });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate");
  }
}

/**
 * Enable or disable Activate on a project.
 *
 * Enabling seeds the six phases, their gates and criteria, and the default
 * workstreams. Disabling only clears the flag — phases, gates and sign-off
 * history are decisions that were genuinely taken, and a flag flip is not a
 * reason to erase them.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Access before permission, so a caller outside the tenant is refused
    // before a permission error can confirm the project exists. The returned
    // context carries the organization, which the template guard below needs.
    const access = await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:manage_phases");

    const parsed = await parseJsonBody(req, activateEnableSchema);
    if (!parsed.success) return parsed.error;
    const { enabled, templateId, seedPlan } = parsed.data;

    if (enabled) {
      /**
       * A named template must belong to this organization or be built-in.
       *
       * `templateId` arrives in the BODY, and the path guard above authorised
       * the project, not the template — the same shape as every other foreign
       * id in this feature. Without this check a caller could seed their
       * project from another tenant's methodology, which is both a leak of
       * that tenant's phase and gate wording and a plan nobody agreed to.
       *
       * A 400 rather than a 404: the caller is authorised here, and an id that
       * belongs to someone else answers identically to one that never existed.
       */
      if (templateId) {
        const orgId = access.project.workspace.orgId;
        const usable = await templateUsableBy(templateId, orgId);
        if (!usable) {
          return NextResponse.json(
            { error: "That methodology template is not available to this project." },
            { status: 400 }
          );
        }
      }
      // The plan is seeded unless the caller says otherwise; see the schema.
      await enableActivate(projectId, templateId ?? undefined, seedPlan === false ? undefined : user.id);
    } else {
      await disableActivate(projectId);
    }

    // Enabling a methodology changes how a project is governed, so it belongs
    // in the audit ledger alongside permission changes.
    await logAuditEvent({
      actor: {
        id: user.id,
        name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
        email: user.email,
      },
      action: enabled ? "ACTIVATE_ENABLED" : "ACTIVATE_DISABLED",
      category: "PROJECT",
      severity: "INFO",
      status: "SUCCESS",
      targetResource: `Project:${projectId}`,
      details: { projectId, methodologyVersion: ACTIVATE_METHODOLOGY_VERSION },
    }).catch((e) => console.error("Failed to audit Activate toggle:", e));

    const profile = await prisma.activateProfile.findUnique({
      where: { projectId },
      select: { enabled: true, currentPhaseKey: true, methodologyVersion: true, version: true },
    });

    return NextResponse.json({ success: true, profile }, { status: enabled ? 201 : 200 });
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate");
  }
}
