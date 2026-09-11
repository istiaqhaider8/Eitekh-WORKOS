import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ user: null });
  }

  // Fetch full tenant hierarchy details for the user
  const orgs = await prisma.organizationMember.findMany({
    where: { userId: user.id },
    include: {
      organization: {
        include: {
          workspaces: {
            include: {
              projects: {
                include: {
                  members: {
                    select: { userId: true, role: true }
                  }
                }
              },
              teams: true,
            },
          },
        },
      },
    },
  });

  const primaryOrgId = orgs[0]?.organization?.id;
  let capabilities: string[] = [];
  if (user.isSuperAdmin) {
    const { ALL_PBAC_PERMISSION_KEYS } = await import("@/lib/pbac-engine");
    capabilities = [...ALL_PBAC_PERMISSION_KEYS];
  } else if (primaryOrgId) {
    try {
      const { pbacEngine } = await import("@/lib/pbac-engine");
      const caps = await pbacEngine.getUserCapabilities(primaryOrgId, user.id);
      capabilities = Array.from(caps);
    } catch (e) {
      console.error("Error resolving user capabilities:", e);
    }
  }

  return NextResponse.json({
    user: {
      ...user,
      capabilities,
      organizations: orgs.map((m) => {
        const isOrgAdmin = user.isSuperAdmin || m.role === "OWNER" || m.role === "ADMIN";
        return {
          ...m.organization,
          role: m.role,
          workspaces: m.organization.workspaces.map((ws) => ({
            ...ws,
            projects: isOrgAdmin
              ? ws.projects
              : ws.projects.filter((p) => p.members.some((pm) => pm.userId === user.id)),
          })),
        };
      }),
    },
  });
}
