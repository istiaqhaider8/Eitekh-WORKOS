import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

// Password strength validation helper
function isStrongPassword(password: string): { valid: boolean; reason?: string } {
  if (password.length < 8) return { valid: false, reason: "Password must be at least 8 characters long" };
  if (!/[A-Z]/.test(password)) return { valid: false, reason: "Password must contain at least one uppercase letter" };
  if (!/[a-z]/.test(password)) return { valid: false, reason: "Password must contain at least one lowercase letter" };
  if (!/[0-9]/.test(password)) return { valid: false, reason: "Password must contain at least one number" };
  if (!/[^A-Za-z0-9]/.test(password)) return { valid: false, reason: "Password must contain at least one special character (!@#$%^&*...)" };
  return { valid: true };
}

export async function POST(req: Request) {
  try {
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "anonymous";
    const rl = checkRateLimit(`reset-pass:${ipAddress}`, { limit: 15, windowSeconds: 60 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Please try again in ${rl.resetInSeconds} seconds.` },
        { status: 429 }
      );
    }

    const { token, newPassword } = await req.json();

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Reset token is required" }, { status: 400 });
    }

    if (!newPassword || typeof newPassword !== "string") {
      return NextResponse.json({ error: "New password is required" }, { status: 400 });
    }

    const strength = isStrongPassword(newPassword);
    if (!strength.valid) {
      return NextResponse.json({ error: strength.reason }, { status: 400 });
    }

    // Find user with matching unexpired token
    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExp: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Invalid or expired password reset link. Please request a new one." },
        { status: 400 }
      );
    }

    const newPasswordHash = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        resetToken: null,
        resetTokenExp: null,
      },
    });

    // Invalidate existing sessions for security
    await prisma.session.deleteMany({
      where: { userId: user.id },
    });

    return NextResponse.json({
      success: true,
      message: "Password reset successfully. You can now log in with your new password.",
    });
  } catch (error: any) {
    console.error("Reset password error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
