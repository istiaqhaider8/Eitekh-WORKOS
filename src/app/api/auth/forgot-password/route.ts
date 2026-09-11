import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";
import crypto from "crypto";

export async function POST(req: Request) {
  try {
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "anonymous";
    const rl = checkRateLimit(`forgot-pass:${ipAddress}`, { limit: 15, windowSeconds: 60 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Please try again in ${rl.resetInSeconds} seconds.` },
        { status: 429 }
      );
    }

    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    let generatedResetUrl: string | null = null;

    if (user && user.status !== "SUSPENDED") {
      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetTokenExp = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken,
          resetTokenExp,
        },
      });

      // Construct reset URL
      const host = req.headers.get("host") || "localhost:3000";
      const protocol = req.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
      generatedResetUrl = `${protocol}://${host}/reset-password?token=${resetToken}`;

      // Dispatch password reset email via central email engine (cocofbd@gmail.com)
      await sendEmail({
        to: user.email,
        templateKey: "PASSWORD_RESET",
        variables: {
          userName: `${user.firstName} ${user.lastName}`.trim() || user.email,
          resetUrl: generatedResetUrl,
          expiresIn: "1 hour",
        },
      });
    }

    // Always return success for security (prevents user enumeration)
    return NextResponse.json({
      success: true,
      message: "If an account with that email exists, we've sent instructions to reset your password.",
      ...(process.env.NODE_ENV !== "production" && generatedResetUrl ? { devResetUrl: generatedResetUrl } : {}),
    });
  } catch (error: any) {
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
