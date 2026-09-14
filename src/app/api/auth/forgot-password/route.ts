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

    if (user && user.status !== "SUSPENDED") {
      // The raw token is emailed to the user; only its SHA-256 hash is stored,
      // so a database or backup read cannot yield a usable reset link.
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const resetTokenExp = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken: tokenHash,
          resetTokenExp,
        },
      });

      // Construct reset URL
      const host = req.headers.get("host") || "localhost:3000";
      const protocol = req.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
      const resetUrl = `${protocol}://${host}/reset-password?token=${rawToken}`;

      // Dispatch the reset link by email only. It is never returned in the
      // HTTP response: doing so is an unauthenticated account-takeover primitive.
      await sendEmail({
        to: user.email,
        templateKey: "PASSWORD_RESET",
        variables: {
          userName: `${user.firstName} ${user.lastName}`.trim() || user.email,
          resetUrl,
          expiresIn: "1 hour",
        },
      });
    }

    // Always return the same response regardless of whether the account exists
    // (prevents user enumeration).
    return NextResponse.json({
      success: true,
      message: "If an account with that email exists, we've sent instructions to reset your password.",
    });
  } catch (error: any) {
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
