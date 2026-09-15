import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import crypto from "crypto";

// GET: Validate invitation token and return invitation details
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "Missing invitation token." }, { status: 400 });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const invitation = await prisma.invitation.findUnique({
      where: { tokenHash },
      include: { organization: { select: { name: true } } },
    });

    if (!invitation) {
      return NextResponse.json({ error: "Invalid invitation link." }, { status: 404 });
    }

    if (invitation.status !== "PENDING") {
      return NextResponse.json({ error: "This invitation has already been used." }, { status: 410 });
    }

    if (invitation.expiresAt <= new Date()) {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: "EXPIRED" },
      });
      return NextResponse.json({ error: "This invitation has expired." }, { status: 410 });
    }

    return NextResponse.json({
      valid: true,
      email: invitation.email,
      organizationName: invitation.organization.name,
      role: invitation.role,
    });
  } catch (error: any) {
    console.error("Invitation validation error:", error);
    return NextResponse.json({ error: "Failed to validate invitation." }, { status: 500 });
  }
}

// POST: Accept invitation — create/activate account with password
export async function POST(req: Request) {
  try {
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "anonymous";
    const rl = checkRateLimit(`invite-accept:${ipAddress}`, { limit: 10, windowSeconds: 60 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many attempts. Please try again in ${rl.resetInSeconds} seconds.` },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { token, firstName, lastName, password } = body;

    if (!token || !firstName || !lastName || !password) {
      return NextResponse.json({ error: "All fields are required." }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const invitation = await prisma.invitation.findUnique({
      where: { tokenHash },
      include: { organization: true },
    });

    if (!invitation || invitation.status !== "PENDING") {
      return NextResponse.json({ error: "Invalid or already used invitation." }, { status: 400 });
    }

    if (invitation.expiresAt <= new Date()) {
      await prisma.invitation.update({ where: { id: invitation.id }, data: { status: "EXPIRED" } });
      return NextResponse.json({ error: "Invitation has expired." }, { status: 410 });
    }

    const passwordHash = await hashPassword(password);
    const email = invitation.email.toLowerCase().trim();

    let user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      // Existing user (possibly PENDING_VERIFY from a previous attempt) — activate
      await prisma.user.update({
        where: { id: user.id },
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          passwordHash,
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          passwordHash,
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });
    }

    // Add to organization
    const existingOrgMember = await prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId: invitation.orgId, userId: user.id } },
    });
    if (!existingOrgMember) {
      await prisma.organizationMember.create({
        data: { orgId: invitation.orgId, userId: user.id, role: invitation.role },
      });
    }

    // Add to workspace if specified
    if (invitation.workspaceId) {
      const existingWsMember = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } },
      });
      if (!existingWsMember) {
        await prisma.workspaceMember.create({
          data: { workspaceId: invitation.workspaceId, userId: user.id, role: "MEMBER" },
        });
      }
    }

    // Add to project if specified
    if (invitation.projectId) {
      const existingProjMember = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: invitation.projectId, userId: user.id } },
      });
      if (!existingProjMember) {
        await prisma.projectMember.create({
          data: { projectId: invitation.projectId, userId: user.id, role: "PROJECT_MEMBER" },
        });
      }
    }

    // Mark invitation as accepted
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      message: "Account activated. You can now sign in.",
    });
  } catch (error: any) {
    console.error("Invitation acceptance error:", error);
    return NextResponse.json({ error: error.message || "Failed to accept invitation" }, { status: 500 });
  }
}
