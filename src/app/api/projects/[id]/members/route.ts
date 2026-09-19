import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";
import { hashPassword } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { logAuditEvent } from "@/lib/audit-logger";
import { getBaseUrl } from "@/lib/config";
import { projectMemberSchema, memberUserIdSchema, parseBody, parseJsonBody, DEFAULT_USER_TYPE } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";
import {
  ALLOWED_PROJECT_ROLES,
  DEFAULT_PROJECT_ROLE,
  projectRoleFromPbacSlug,
  projectRoleAuthority,
  ORG_ROLE_AUTHORITY,
} from "@/lib/project-roles";

/**
 * Refuse to grant a role at or above the actor's own level (PROD-6).
 *
 * Holding `projects:manage_members` says you may manage members. It does not
 * say you may create someone with more authority than you have. The PBAC
 * engine draws that distinction in `enforceHierarchy`, but that only runs on
 * the PBAC role-assignment paths — these handlers write ProjectMember.role
 * directly, so the check has to happen here too.
 *
 * Without it a PROJECT_MANAGER (level 30) could set another member to
 * PROJECT_ADMIN (level 40), which is escalation by the codebase's own
 * definition. Found by the PROD-6 authorization suite.
 *
 * A super admin, and an organization OWNER or ADMIN, act at their
 * organization level rather than their project level — an org admin who is not
 * a project member still outranks every project role.
 */
function assertCanGrantProjectRole(
  actor: { isSuperAdmin?: boolean },
  actorProjectRole: string | undefined,
  actorOrgRole: string | undefined,
  targetRole: string
): void {
  if (actor?.isSuperAdmin) return;

  const actorLevel = Math.max(
    projectRoleAuthority(actorProjectRole),
    ORG_ROLE_AUTHORITY[String(actorOrgRole || "").toUpperCase()] ?? 0
  );
  const targetLevel = projectRoleAuthority(targetRole);

  if (targetLevel >= actorLevel) {
    throw new Error(
      `Forbidden: privilege escalation denied — you cannot assign the '${targetRole}' role, ` +
        "which is at or above your own level."
    );
  }
}

// The whitelist lives in lib/project-roles.ts, shared with the UI that builds
// the dropdowns. It blocks privilege escalation via an injected org-scoped PBAC
// role id (e.g. "role_<orgId>_org-admin"), which the engine would accept.
function normalizeProjectRole(role: unknown): string {
  if (role == null || role === "") return DEFAULT_PROJECT_ROLE;
  if (typeof role !== "string") {
    throw new Error(`Invalid project role: ${String(role)}`);
  }
  // A PBAC slug is accepted and folded to its canonical value. The members UI
  // used to submit slugs and every change failed with "Invalid project role".
  const mapped = projectRoleFromPbacSlug(role);
  if (!mapped) {
    throw new Error(
      `Invalid project role: ${role}. Expected one of ${[...ALLOWED_PROJECT_ROLES].join(", ")}`
    );
  }
  return mapped;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await assertProjectAccess(id);
    const members = await prisma.projectMember.findMany({
      where: { projectId: id },
      include: {
        // publicUserRelation rather than an inline select, so this list picks
        // up userType (and anything else added to the shared select) instead of
        // silently omitting it.
        user: publicUserRelation,
      }
    });
    return NextResponse.json(members);
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/members");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { role, project, user: currentUser } = await assertProjectPermission(id, "projects:manage_members");
    
    const parsed = await parseJsonBody(req, projectMemberSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;

    // Same hierarchy rule as PATCH, and checked BEFORE any user is created or
    // invited: adding a member at a role above your own is the same escalation
    // as promoting one, and this path can create an account as a side effect.
    {
      const actorOrgMembership = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId: project.workspace.orgId, userId: currentUser.id } },
        select: { role: true },
      });
      assertCanGrantProjectRole(
        currentUser,
        role,
        actorOrgMembership?.role,
        normalizeProjectRole(body.role)
      );
    }

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
            // EMPLOYEE or CLIENT, chosen on the invite form. Only applied when
            // the account is being created here; an existing user keeps the type
            // already on their account, since it describes the person rather
            // than this project membership.
            userType: body.userType || DEFAULT_USER_TYPE,
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
        const baseUrl = getBaseUrl();
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
    <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; background: #2563eb; color: #ffffff; font-weight: 900; font-size: 22px; border-radius: 12px;">E</div>
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
    
    const safeRole = normalizeProjectRole(body.role);
    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: id, userId: targetUserId } },
      create: {
        projectId: id,
        userId: targetUserId,
        role: safeRole
      },
      update: {
        role: safeRole
      },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } }
      }
    });

    const orgId = project.workspace.orgId;
    try {
      const { pbacEngine } = await import("@/lib/pbac-engine");
      await pbacEngine.syncProjectMemberRole(orgId, targetUserId, safeRole, id);
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
    return handleApiError(error, "projects/[id]/members", 400);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { role, project, user: currentUser } = await assertProjectPermission(id, "projects:manage_members");
    const parsed = await parseJsonBody(req, memberUserIdSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;
    const safeRole = normalizeProjectRole((body as any).role);

    const actorOrgMembership = await prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId: project.workspace.orgId, userId: currentUser.id } },
      select: { role: true },
    });
    assertCanGrantProjectRole(currentUser, role, actorOrgMembership?.role, safeRole);
    const updated = await prisma.projectMember.update({
      where: { projectId_userId: { projectId: id, userId: body.userId } },
      data: { role: safeRole }
    });

    const orgId = project.workspace.orgId;
    try {
      const { pbacEngine } = await import("@/lib/pbac-engine");
      await pbacEngine.syncProjectMemberRole(orgId, body.userId, safeRole, id);
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
        newRole: (body as any).role,
      },
      req,
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    return handleApiError(error, "projects/[id]/members", 400);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { role, project, user: currentUser } = await assertProjectPermission(id, "projects:manage_members");
    const parsed = await parseJsonBody(req, memberUserIdSchema);
    if (!parsed.success) return parsed.error;
    const body = parsed.data;
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId: id, userId: body.userId } }
    });

    // Data Integrity: Unassign any issues in this project previously assigned to this user
    await prisma.issue.updateMany({
      where: { projectId: id, assigneeId: body.userId },
      data: { assigneeId: null },
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
    return handleApiError(error, "projects/[id]/members", 400);
  }
}

