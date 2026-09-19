import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertOrgAccess } from "@/lib/tenant";
import { pbacEngine, PBAC_PERMISSION_CATEGORIES, ALL_PBAC_PERMISSION_KEYS } from "@/lib/pbac-engine";
import { orgRoleCreateSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: orgId } = await params;
    await assertOrgAccess(orgId, ["OWNER", "ADMIN", "MEMBER"]);

    const roles = await pbacEngine.getRoles(orgId);
    const usersResult = await pbacEngine.getUsersWithRoles(orgId, { limit: "all" });

    return NextResponse.json({
      categories: PBAC_PERMISSION_CATEGORIES,
      allKeys: ALL_PBAC_PERMISSION_KEYS,
      roles,
      members: usersResult.users,
      totalRecords: usersResult.totalRecords,
    });
  } catch (error: any) {
    console.error("Fetch roles error:", error);
    return handleApiError(error, "orgs/[id]/roles");
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: orgId } = await params;
    await assertOrgAccess(orgId, ["OWNER", "ADMIN"]);

    const parsed = await parseJsonBody(req, orgRoleCreateSchema);
    if (!parsed.success) return parsed.error;
    const { name, description, scope, permissions } = parsed.data;

    const actor = {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim() || user.email,
      email: user.email,
    };

    const role = await pbacEngine.saveRole(
      orgId,
      {
        name,
        description,
        scope,
        permissions,
      },
      actor
    );

    return NextResponse.json({ role }, { status: 201 });
  } catch (error: any) {
    console.error("Create role error:", error);
    return handleApiError(error, "orgs/[id]/roles");
  }
}

