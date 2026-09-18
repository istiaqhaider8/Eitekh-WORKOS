import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertOrgAccess } from "@/lib/tenant";
import { hashPassword } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/config";
import { orgMemberCreateSchema, orgMemberUpdateSchema, memberUserIdSchema, parseBody, parseJsonBody } from "@/lib/validation";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertOrgAccess(id, ["OWNER", "ADMIN", "MEMBER"]);
    const members = await prisma.organizationMember.findMany({
      where: { orgId: id },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true },
        },
      },
    });
    return NextResponse.json(members);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 403 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertOrgAccess(id, ["OWNER", "ADMIN"]);
    const parsed = await parseJsonBody(req, orgMemberCreateSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    const email = body.email;
    let user = await prisma.user.findUnique({ where: { email } });
    let tempPassword = body.password || (Math.random().toString(36).slice(-8) + "Aa1!");
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const passwordHash = await hashPassword(tempPassword);
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName: body.firstName?.trim() || "Team",
          lastName: body.lastName?.trim() || "Member",
          jobTitle: body.jobTitle?.trim() || null,
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });
    }

    // Check if already a member in this organization
    const existing = await prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId: id, userId: user.id } }
    });
    
    if (existing) {
      return NextResponse.json({ error: `User (${email}) is already a member of this organization` }, { status: 400 });
    }

    const org = await prisma.organization.findUnique({ where: { id } });

    const member = await prisma.organizationMember.create({
      data: {
        orgId: id,
        userId: user.id,
        role: body.role || "MEMBER",
      },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true, jobTitle: true }
        }
      }
    });

    // Sync with PBAC store
    try {
      const { pbacEngine } = await import("@/lib/pbac-engine");
      await pbacEngine.syncOrgMemberRole(id, user.id, body.role || "MEMBER");
    } catch (pbacErr) {
      console.error("Failed to sync org member role with PBAC:", pbacErr);
    }

    // Optionally assign to projects if provided
    if (Array.isArray(body.projectIds) && body.projectIds.length > 0) {
      for (const projectId of body.projectIds) {
        await prisma.projectMember.upsert({
          where: { projectId_userId: { projectId, userId: user.id } },
          update: { role: body.projectRole || "PROJECT_MEMBER" },
          create: {
            projectId,
            userId: user.id,
            role: body.projectRole || "PROJECT_MEMBER",
          }
        }).catch(() => {});
      }
    }

    // Send Welcome Email Notification
    await sendEmail({
      to: user.email,
      templateKey: "WELCOME",
      variables: {
        userName: `${user.firstName} ${user.lastName}`,
        userEmail: user.email,
        organizationName: org?.name || "Eitekh WorkOS Organization",
        actionUrl: `${getBaseUrl()}/login`,
      }
    }).catch((err) => console.error("Failed to send welcome email:", err));

    return NextResponse.json({
      member,
      isNewUser,
      tempPassword: isNewUser ? tempPassword : null,
      message: `User ${email} added successfully as ${member.role}`
    }, { status: 201 });
  } catch (error: any) {
    const status = error.message?.includes("Forbidden") ? 403 : error.message?.includes("Unauthorized") ? 401 : 400;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertOrgAccess(id, ["OWNER", "ADMIN"]);
    const parsed = await parseJsonBody(req, orgMemberUpdateSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;
    const updated = await prisma.organizationMember.update({
      where: { orgId_userId: { orgId: id, userId: body.userId } },
      data: { role: body.role },
    });

    try {
      const { pbacEngine } = await import("@/lib/pbac-engine");
      await pbacEngine.syncOrgMemberRole(id, body.userId, body.role);
    } catch (pbacErr) {
      console.error("Failed to sync org member role with PBAC:", pbacErr);
    }

    return NextResponse.json(updated);
  } catch (error: any) {
    const status = error.message?.includes("Forbidden") ? 403 : error.message?.includes("Unauthorized") ? 401 : 400;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertOrgAccess(id, ["OWNER", "ADMIN"]);
    const parsed = await parseJsonBody(req, memberUserIdSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    const member = await prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId: id, userId: body.userId } }
    });
    
    if (member?.role === "OWNER") {
      const ownersCount = await prisma.organizationMember.count({
        where: { orgId: id, role: "OWNER" },
      });
      if (ownersCount <= 1) {
        return NextResponse.json({ error: "Cannot remove last owner" }, { status: 400 });
      }
    }
    
    await prisma.organizationMember.delete({
      where: { orgId_userId: { orgId: id, userId: body.userId } },
    });

    try {
      const { pbacEngine } = await import("@/lib/pbac-engine");
      pbacEngine.invalidateUserCache(body.userId);
    } catch (e) {}

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = error.message?.includes("Forbidden") ? 403 : error.message?.includes("Unauthorized") ? 401 : 400;
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status });
  }
}
