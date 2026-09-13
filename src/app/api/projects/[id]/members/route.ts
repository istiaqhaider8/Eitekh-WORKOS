import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertProjectAccess } from "@/lib/tenant";
import { hashPassword } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { logAuditEvent } from "@/lib/audit-logger";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertProjectAccess(id);
    const members = await prisma.projectMember.findMany({
      where: { projectId: id },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } }
      }
    });
    return NextResponse.json(members);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message.includes("Unauthorized") ? 401 : 403 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { role, project, user: currentUser } = await assertProjectAccess(id);
    if (role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden: Viewers cannot invite or assign project members" }, { status: 403 });
    }
    
    const body = await req.json();
    let targetUserId = body.userId;
    let isNewUserCreated = false;
    let tempPassword = body.password || (Math.random().toString(36).slice(-8) + "Aa1!");

    // If inviting by email directly
    if (!targetUserId && body.email) {
      const email = body.email.trim().toLowerCase();
      if (!email.includes("@")) {
        return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
      }

      let user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        isNewUserCreated = true;
        const passwordHash = await hashPassword(tempPassword);
        user = await prisma.user.create({
          data: {
            email,
            passwordHash,
            firstName: body.firstName?.trim() || "Team",
            lastName: body.lastName?.trim() || "Member",
            status: "ACTIVE",
            emailVerifiedAt: new Date(),
          },
        });
      }
      targetUserId = user.id;

      // Auto-ensure organization membership
      const existingOrgMember = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId: project.workspace.orgId, userId: user.id } }
      });
      if (!existingOrgMember) {
        await prisma.organizationMember.create({
          data: {
            orgId: project.workspace.orgId,
            userId: user.id,
            role: "MEMBER"
          }
        });
      }

      // Send invitation email
      try {
        const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
        await sendEmail({
          to: email,
          templateKey: "WELCOME",
          variables: {
            userName: `${user.firstName} ${user.lastName}`.trim(),
            userEmail: email,
            organizationName: project.workspace.organization?.name || "Eitekh WorkOS",
            actionUrl: `${baseUrl}/projects/${project.id}`,
          },
          customSubject: `You've been invited to ${project.name} on Eitekh WorkOS! 🚀`,
          customHtml: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 20px; background-color: #0f172a; color: #f8fafc; border-radius: 16px;">
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; background: #2563eb; color: #ffffff; font-weight: 900; font-size: 22px; border-radius: 12px;">Z</div>
    <h1 style="color: #ffffff; font-size: 22px; font-weight: 800; margin-top: 12px; margin-bottom: 4px;">Project Invitation</h1>
    <p style="color: #94a3b8; font-size: 13px; margin: 0;">Eitekh WorkOS</p>
  </div>
  <div style="background-color: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid #334155;">
    <p style="color: #f1f5f9; font-size: 14px; margin-top: 0;">Hi <strong>${user.firstName}</strong>,</p>
    <p style="color: #cbd5e1; font-size: 13px; line-height: 1.6;">You have been invited to join the project <strong>${project.name} (${project.key})</strong> in <strong>${project.workspace.organization?.name || 'Organization'}</strong> as a <strong>${body.role || 'PROJECT_MEMBER'}</strong>.</p>
    ${isNewUserCreated ? `
    <div style="background-color: #0f172a; padding: 14px; border-radius: 8px; margin: 16px 0; border: 1px solid #334155;">
      <p style="margin: 0 0 6px 0; font-size: 12px; color: #94a3b8;">Temporary Login Credentials:</p>
      <p style="margin: 0; font-size: 13px; color: #f8fafc; font-family: monospace;">Email: <strong>${email}</strong><br/>Temporary Password: <strong>${tempPassword}</strong></p>
    </div>` : ''}
    <div style="margin: 24px 0; text-align: center;">
      <a href="${baseUrl}/projects/${project.id}" style="background-color: #2563eb; color: #ffffff; padding: 12px 28px; font-size: 13px; font-weight: 600; text-decoration: none; border-radius: 8px; display: inline-block;">Open Project →</a>
    </div>
  </div>
</div>`
        });
      } catch (emailErr) {
        console.error("Failed to send invite email:", emailErr);
      }
    }

    if (!targetUserId) {
      return NextResponse.json({ error: "userId or email is required" }, { status: 400 });
    }

    // Ensure user belongs to the parent organization
    const orgMember = await prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId: project.workspace.orgId, userId: targetUserId } }
    });
    if (!orgMember) {
      return NextResponse.json({ error: "User must be a member of the organization" }, { status: 400 });
    }
    
    // Auto-ensure workspace membership
    const wsMember = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: project.workspaceId, userId: targetUserId } }
    });
    if (!wsMember) {
      await prisma.workspaceMember.create({
        data: { workspaceId: project.workspaceId, userId: targetUserId, role: "MEMBER" }
      });
    }
    
    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: id, userId: targetUserId } },
      create: {
        projectId: id,
        userId: targetUserId,
        role: body.role || "PROJECT_MEMBER"
      },
      update: {
        role: body.role || "PROJECT_MEMBER"
      },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } }
      }
    });

    const orgId = project.workspace.orgId;
    try {
      const { pbacEngine } = await import("@/lib/pbac-engine");
      await pbacEngine.syncProjectMemberRole(orgId, targetUserId, body.role || "PROJECT_MEMBER", id);
    } catch (pbacErr) {
      console.error("Failed to sync project member role with PBAC:", pbacErr);
    }

    await logAuditEvent({
      actorId: currentUser.id,
      actorName: currentUser.fullName || `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() || currentUser.email,
      actorEmail: currentUser.email,
      action: "PROJECT_MEMBER_ADDED",
      category: "PROJECT",
      severity: "INFO",
      status: "SUCCESS",
      targetResource: `project:${project.key}:member:${targetUserId}`,
      orgId: project.workspace?.orgId,
      details: {
        projectId: id,
        projectKey: project.key,
        userId: targetUserId,
        role: body.role || "PROJECT_MEMBER",
        isNewUserCreated,
      },
      req,
    });

    return NextResponse.json({ ...member, isNewUserCreated, tempPassword: isNewUserCreated ? tempPassword : undefined }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { role, project, user: currentUser } = await assertProjectAccess(id);
    if (!["PROJECT_ADMIN", "PROJECT_MANAGER", "SUPER_ADMIN", "OWNER", "ADMIN"].includes(role) && project.ownerId !== currentUser.id && project.members.length > 1) {
      return NextResponse.json({ error: "Forbidden: You need admin permissions to manage project member roles" }, { status: 403 });
    }
    const body = await req.json();
    const updated = await prisma.projectMember.update({
      where: { projectId_userId: { projectId: id, userId: body.userId } },
      data: { role: body.role }
    });

    const orgId = project.workspace.orgId;
    try {
      const { pbacEngine } = await import("@/lib/pbac-engine");
      await pbacEngine.syncProjectMemberRole(orgId, body.userId, body.role, id);
    } catch (pbacErr) {
      console.error("Failed to sync project member role with PBAC:", pbacErr);
    }

    await logAuditEvent({
      actorId: currentUser.id,
      actorName: currentUser.fullName || `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() || currentUser.email,
      actorEmail: currentUser.email,
      action: "PROJECT_MEMBER_ROLE_UPDATED",
      category: "PROJECT",
      severity: "INFO",
      status: "SUCCESS",
      targetResource: `project:${project.key}:member:${body.userId}`,
      orgId: project.workspace?.orgId,
      details: {
        projectId: id,
        projectKey: project.key,
        userId: body.userId,
        newRole: body.role,
      },
      req,
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { role, project, user: currentUser } = await assertProjectAccess(id);
    if (!["PROJECT_ADMIN", "PROJECT_MANAGER", "SUPER_ADMIN", "OWNER", "ADMIN"].includes(role) && project.ownerId !== currentUser.id && project.members.length > 1) {
      return NextResponse.json({ error: "Forbidden: You need admin permissions to manage project members" }, { status: 403 });
    }
    const body = await req.json();
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId: id, userId: body.userId } }
    });

    try {
      const { pbacEngine } = await import("@/lib/pbac-engine");
      pbacEngine.invalidateUserCache(body.userId);
    } catch (e) {}

    await logAuditEvent({
      actorId: currentUser.id,
      actorName: currentUser.fullName || `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() || currentUser.email,
      actorEmail: currentUser.email,
      action: "PROJECT_MEMBER_REMOVED",
      category: "PROJECT",
      severity: "WARNING",
      status: "SUCCESS",
      targetResource: `project:${project.key}:member:${body.userId}`,
      orgId: project.workspace?.orgId,
      details: {
        projectId: id,
        projectKey: project.key,
        userId: body.userId,
      },
      req,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

