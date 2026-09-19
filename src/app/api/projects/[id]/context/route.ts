import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/tenant";
import { getProjectContext } from "@/lib/project-context";
import { handleApiError } from "@/lib/api-error";

/**
 * GET /api/projects/[id]/context
 *
 * The project metadata the issue modal needs to render, in one request.
 *
 * This replaces a nine-request fan-out (sprints, custom-fields, members,
 * availability, workflows, types, priorities, teams, epics). Those endpoints
 * remain for their other consumers; this one exists because the modal needs all
 * nine at once and each was separately paying for cookie parse, JWT verify,
 * session lookup and the project access check.
 *
 * The gate is deliberately the same one every constituent endpoint applies --
 * authenticated plus `assertProjectAccess` -- so no request that would have
 * been refused before is served here. None of the nine required a distinct PBAC
 * permission.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;

    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { project } = await assertProjectAccess(projectId);

    const context = await getProjectContext(projectId, project);
    return NextResponse.json(context);
  } catch (error: any) {
    const message = error?.message || "Failed to fetch project context";
    return handleApiError(error, "projects/[id]/context");
  }
}
