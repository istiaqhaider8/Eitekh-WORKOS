import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

// GET /api/super-admin/users
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const roleFilter = searchParams.get("role") || "all";
    const statusFilter = searchParams.get("status") || "all";
    const orgId = searchParams.get("orgId") || "all";

    const where: any = {};
    if (search) {
      const s = search.toLowerCase();
      where.OR = [
        { email: { contains: s } },
        { firstName: { contains: s } },
        { lastName: { contains: s } },
        { jobTitle: { contains: s } },
        { company: { contains: s } },
      ];
    }

    if (statusFilter !== "all") {
      where.status = statusFilter;
    }

    if (roleFilter === "admin") {
      where.isSuperAdmin = true;
    } else if (roleFilter === "user") {
      where.isSuperAdmin = false;
    }

    if (orgId !== "all") {
      where.orgMemberships = {
        some: { orgId },
      };
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        company: true,
        jobTitle: true,
        timezone: true,
        language: true,
        status: true,
        mfaEnabled: true,
        isSuperAdmin: true,
        isSupportAdmin: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
        orgMemberships: {
          select: {
            id: true,
            orgId: true,
            role: true,
            organization: {
              select: { id: true, name: true, slug: true },
            },
          },
        },
        workspaceMemberships: {
          select: {
            id: true,
            role: true,
            workspace: {
              select: { id: true, name: true, slug: true },
            },
          },
        },
        _count: {
          select: {
            sessions: true,
            assignedIssues: true,
            comments: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ users, total: users.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/super-admin/users - Create User with Initial Password & Tenant Binding
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const body = await req.json();
    const {
      email,
      firstName,
      lastName,
      jobTitle,
      company,
      timezone,
      language,
      orgId,
      role,
      isSuperAdmin,
      password,
      status,
    } = body;

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email address is required" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (existingUser) {
      return NextResponse.json({ error: "A user with this email address already exists" }, { status: 409 });
    }

    // Generate or use provided password
    const userPassword = password && password.trim().length >= 6
      ? password.trim()
      : (Math.random().toString(36).slice(-8) + "Zen1!");

    const passwordHash = await hashPassword(userPassword);

    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        firstName: firstName?.trim() || "Team",
        lastName: lastName?.trim() || "Member",
        jobTitle: jobTitle?.trim() || null,
        company: company?.trim() || null,
        timezone: timezone || "UTC",
        language: language || "en",
        status: status || "ACTIVE",
        isSuperAdmin: Boolean(isSuperAdmin),
        emailVerifiedAt: new Date(),
      },
    });

    // Attach to organization if provided
    let targetOrg = null;
    if (orgId) {
      targetOrg = await prisma.organization.findUnique({ where: { id: orgId } });
      if (targetOrg) {
        await prisma.organizationMember.create({
          data: {
            orgId,
            userId: newUser.id,
            role: role || "MEMBER",
          },
        });
      }
    }

    // Audit log
    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "USER_CREATED",
        targetResource: "User:" + newUser.id,
        details: JSON.stringify({
          email: newUser.email,
          name: newUser.firstName + " " + newUser.lastName,
          isSuperAdmin: newUser.isSuperAdmin,
          orgId,
        }),
      },
    });

    // Send Welcome Email
    await sendEmail({
      to: newUser.email,
      templateKey: "WELCOME",
      variables: {
        userName: newUser.firstName + " " + newUser.lastName,
        userEmail: newUser.email,
        organizationName: targetOrg?.name || "Eitekh WorkOS Enterprise",
        actionUrl: (process.env.NEXTAUTH_URL || "http://localhost:3000") + "/login",
      },
    }).catch(() => {});

    return NextResponse.json({
      user: newUser,
      tempPassword: userPassword,
      message: "User " + normalizedEmail + " created successfully",
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

// PATCH /api/super-admin/users - Update User Details, Set Password, or Toggle Status
export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const body = await req.json();
    const {
      userId,
      firstName,
      lastName,
      email,
      jobTitle,
      company,
      timezone,
      language,
      status,
      isSuperAdmin,
      password,
      resetMfa,
      revokeSessions,
      orgId,
      role,
    } = body;

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Prevent demoting the last super admin
    if (isSuperAdmin === false && targetUser.isSuperAdmin) {
      const superAdminCount = await prisma.user.count({ where: { isSuperAdmin: true } });
      if (superAdminCount <= 1) {
        return NextResponse.json({ error: "Cannot revoke super admin from the sole system super administrator." }, { status: 400 });
      }
    }

    const updateData: any = {};
    if (firstName !== undefined) updateData.firstName = firstName.trim();
    if (lastName !== undefined) updateData.lastName = lastName.trim();
    if (email !== undefined && email.includes("@")) updateData.email = email.trim().toLowerCase();
    if (jobTitle !== undefined) updateData.jobTitle = jobTitle?.trim() || null;
    if (company !== undefined) updateData.company = company?.trim() || null;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (language !== undefined) updateData.language = language;
    if (status !== undefined) updateData.status = status;
    if (typeof isSuperAdmin === "boolean") updateData.isSuperAdmin = isSuperAdmin;

    // Handle Password Set / Reset
    let passwordUpdated = false;
    if (password && password.trim().length >= 6) {
      updateData.passwordHash = await hashPassword(password.trim());
      passwordUpdated = true;
    }

    // Handle MFA Reset
    if (resetMfa) {
      updateData.mfaEnabled = false;
      updateData.mfaSecret = null;
      updateData.recoveryCodes = null;
    }

    // Revoke active sessions if requested or on password reset
    if (revokeSessions || passwordUpdated) {
      await prisma.session.deleteMany({ where: { userId } });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    // Handle Org Membership Update if provided
    if (orgId && role) {
      await prisma.organizationMember.upsert({
        where: { orgId_userId: { orgId, userId } },
        update: { role },
        create: { orgId, userId, role },
      });
    }

    // Audit log
    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: passwordUpdated ? "USER_PASSWORD_RESET" : status ? ("USER_" + status) : "USER_UPDATED",
        targetResource: "User:" + userId,
        details: JSON.stringify({
          updatedFields: Object.keys(updateData),
          passwordUpdated,
          resetMfa: Boolean(resetMfa),
          revokeSessions: Boolean(revokeSessions || passwordUpdated),
        }),
      },
    });

    return NextResponse.json({
      success: true,
      user: updatedUser,
      passwordUpdated,
      message: passwordUpdated ? "User password updated successfully" : "User updated successfully",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/super-admin/users - Delete User Account
export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    let userId = searchParams.get("userId");

    if (!userId) {
      try {
        const body = await req.json();
        userId = body.userId;
      } catch (e) {}
    }

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    if (userId === user.id) {
      return NextResponse.json({ error: "You cannot delete your own active administrator account" }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (targetUser.isSuperAdmin) {
      const superAdminCount = await prisma.user.count({ where: { isSuperAdmin: true } });
      if (superAdminCount <= 1) {
        return NextResponse.json({ error: "Cannot delete the sole super administrator in the platform" }, { status: 400 });
      }
    }

    // Delete user sessions, memberships, and user record
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.organizationMember.deleteMany({ where: { userId } });
    await prisma.workspaceMember.deleteMany({ where: { userId } });
    await prisma.projectMember.deleteMany({ where: { userId } });
    await prisma.teamMember.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });

    // Audit log
    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "USER_DELETED",
        targetResource: "User:" + userId,
        details: JSON.stringify({
          deletedEmail: targetUser.email,
          deletedName: targetUser.firstName + " " + targetUser.lastName,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: "User " + targetUser.email + " has been deleted permanently",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}