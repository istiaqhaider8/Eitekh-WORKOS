import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";
import { getBaseUrl } from "@/lib/config";
import crypto from "crypto";

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "anonymous";
    const rl = checkRateLimit(`invite:${user.id}`, { limit: 20, windowSeconds: 60 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many invitations. Please try again in ${rl.resetInSeconds} seconds.` },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { email, orgId, workspaceId, projectId, role } = body;

    if (!email || !orgId) {
      return NextResponse.json({ error: "Email and organization are required." }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Verify the inviter is a member of the org
    const orgMembership = await prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId: user.id } },
    });
    if (!orgMembership) {
      return NextResponse.json({ error: "You are not a member of this organization." }, { status: 403 });
    }

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      return NextResponse.json({ error: "Organization not found." }, { status: 404 });
    }

    // Check for existing pending invitation
    const existingInvite = await prisma.invitation.findFirst({
      where: { email: normalizedEmail, orgId, status: "PENDING", expiresAt: { gt: new Date() } },
    });
    if (existingInvite) {
      return NextResponse.json({ error: "An active invitation already exists for this email." }, { status: 409 });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.invitation.create({
      data: {
        email: normalizedEmail,
        tokenHash,
        invitedBy: user.id,
        orgId,
        workspaceId: workspaceId || null,
        projectId: projectId || null,
        role: role || "MEMBER",
        expiresAt,
      },
    });

    const inviteUrl = `${getBaseUrl()}/accept-invitation?token=${rawToken}`;

    const emailResult = await sendEmail({
      to: normalizedEmail,
      templateKey: "INVITATION",
      variables: {
        inviterName: user.fullName || `${user.firstName} ${user.lastName}`.trim(),
        organizationName: org.name,
        roleName: role || "Member",
        actionUrl: inviteUrl,
      },
    });

    if (emailResult.status !== "SENT") {
      return NextResponse.json({ error: "Failed to send invitation email." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Invitation sent to ${normalizedEmail}.`,
    });
  } catch (error: any) {
    console.error("Send invitation error:", error);
    return NextResponse.json({ error: error.message || "Failed to send invitation" }, { status: 500 });
  }
}
