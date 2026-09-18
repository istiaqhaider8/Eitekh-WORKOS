import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { otpVerifySchema, parseJsonBody } from "@/lib/validation";
import { verifyOtp } from "@/lib/otp";
import { createSession, COOKIE_NAME, SESSION_COOKIE_MAX_AGE } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import crypto from "crypto";

export async function POST(req: Request) {
  try {
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "anonymous";
    const rl = await checkRateLimit(`verify-otp:${ipAddress}`, { limit: 10, windowSeconds: 60 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many verification attempts. Please try again in ${rl.resetInSeconds} seconds.` },
        { status: 429, headers: { "Retry-After": String(rl.resetInSeconds) } }
      );
    }

    const parsed = await parseJsonBody(req, otpVerifySchema);
    if (!parsed.success) return parsed.error;
    const { email, code, purpose } = parsed.data;

    const result = await verifyOtp(email, code, purpose);
    if (!result.valid) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    if (purpose === "REGISTRATION") {
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
      if (!user) {
        return NextResponse.json({ error: "User not found." }, { status: 404 });
      }

      // Activate the account
      await prisma.user.update({
        where: { id: user.id },
        data: {
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
          verificationToken: null,
        },
      });

      // Auto-provision organization and workspace for new registrations
      const orgName = user.company || `${user.firstName}'s Team`;
      const orgSlug = orgName.toLowerCase().replace(/[^a-z0-9]/g, "-") + "-" + Math.random().toString(36).substring(2, 6);

      const org = await prisma.organization.create({
        data: {
          name: orgName,
          slug: orgSlug,
          members: { create: [{ userId: user.id, role: "OWNER" }] },
        },
      });

      const workspace = await prisma.workspace.create({
        data: {
          orgId: org.id,
          name: "Main Workspace",
          slug: "main",
          members: { create: [{ userId: user.id, role: "WORKSPACE_ADMIN" }] },
        },
      });

      const project = await prisma.project.create({
        data: {
          workspaceId: workspace.id,
          name: "My First Project",
          key: "PRJ",
          description: "Initial project setup",
          ownerId: user.id,
          template: "SCRUM",
          members: { create: [{ userId: user.id, role: "PROJECT_ADMIN" }] },
        },
      });

      const workflow = await prisma.workflow.create({
        data: { projectId: project.id, name: "Default Workflow", isDefault: true },
      });

      await prisma.workflowStatus.createMany({
        data: [
          { workflowId: workflow.id, name: "To Do", category: "TO_DO", color: "#3b82f6", position: 1 },
          { workflowId: workflow.id, name: "In Progress", category: "IN_PROGRESS", color: "#f59e0b", position: 2 },
          { workflowId: workflow.id, name: "Done", category: "DONE", color: "#10b981", position: 3 },
        ],
      });

      const userAgent = req.headers.get("user-agent") || undefined;
      const verifyIpAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || undefined;
      const { jwtToken } = await createSession(user.id, userAgent, verifyIpAddress);

      const response = NextResponse.json({
        success: true,
        verified: true,
        purpose: "REGISTRATION",
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      });

      response.cookies.set(COOKIE_NAME, jwtToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production" || process.env.FORCE_HTTPS === "true",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_COOKIE_MAX_AGE,
      });

      return response;
    }

    if (purpose === "PASSWORD_RESET") {
      // Generate a short-lived reset token so the user can set a new password
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const resetTokenExp = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      const normalizedEmail = email.toLowerCase().trim();
      await prisma.user.update({
        where: { email: normalizedEmail },
        data: { resetToken: tokenHash, resetTokenExp },
      });

      return NextResponse.json({
        success: true,
        verified: true,
        purpose: "PASSWORD_RESET",
        resetToken: rawToken,
      });
    }

    return NextResponse.json({ error: "Invalid purpose." }, { status: 400 });
  } catch (error: any) {
    console.error("OTP verification error:", error);
    return NextResponse.json({ error: error.message || "Verification failed" }, { status: 500 });
  }
}
