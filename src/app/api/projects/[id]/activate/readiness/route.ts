import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { handleApiError } from "@/lib/api-error";
import { getReadiness } from "@/lib/activate-readiness";

/**
 * Deploy readiness and the Run picture, for one project.
 *
 * READ ONLY, AND ONLY `activate:view`.
 *
 * This route reports; it never decides. Everything it returns is already
 * visible to anyone who can read the phases, the gates and the deliverables —
 * it just counts them in one place instead of making a client fetch three
 * endpoints and do arithmetic. So it needs the lowest Activate permission, not
 * a higher one: requiring `manage_gates` to LOOK at readiness would mean the
 * people who most need to see whether go-live is realistic — the ones who
 * cannot approve it — are the ones who cannot see it.
 *
 * It returns `enabled: false` with empty collections for a project that is not
 * running Activate, matching the profile endpoint, so a client renders an
 * empty state rather than handling a 404 as a normal outcome.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Project access before permission, so a caller outside the tenant is
    // refused before a permission error can confirm the project exists.
    await assertProjectAccess(projectId);
    await assertProjectPermission(projectId, "activate:view");

    const readiness = await getReadiness(projectId);
    return NextResponse.json(readiness);
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/activate/readiness");
  }
}
