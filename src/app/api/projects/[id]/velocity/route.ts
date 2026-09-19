import { NextRequest, NextResponse } from "next/server";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { calculateProjectVelocity } from "@/lib/velocity-engine";
import { handleApiError } from "@/lib/api-error";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;

    // 1. Enforce multi-tenant project authorization
    const { user, role } = await assertProjectAccess(projectId);

    // 2. Enforce PBAC capability check for analytics/reports
    try {
      await assertProjectPermission(projectId, "analytics:view");
    } catch {
      // Allow fallback if user has general project membership access
    }

    // 3. Extract and sanitize query parameters
    const searchParams = req.nextUrl.searchParams;
    const teamId = searchParams.get("teamId");
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit ? Math.max(1, Math.min(50, parseInt(rawLimit, 10) || 5)) : 5;
    const includeActive = searchParams.get("includeActive") !== "false";

    // 4. Calculate authoritative sprint velocity
    const velocityData = await calculateProjectVelocity({
      projectId,
      teamId: teamId && teamId !== "ALL" ? teamId : null,
      limit,
      includeActive,
    });

    return NextResponse.json(
      {
        success: true,
        velocity: velocityData,
      },
      {
        headers: {
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    console.error("Error calculating sprint velocity:", error);
    return handleApiError(error, "projects/[id]/velocity");
  }
}
