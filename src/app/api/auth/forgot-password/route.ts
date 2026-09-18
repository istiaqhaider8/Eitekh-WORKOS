import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAndSendOtp } from "@/lib/otp";
import { checkRateLimit } from "@/lib/rate-limit";
import { forgotPasswordSchema, parseBody, parseJsonBody } from "@/lib/validation";

export async function POST(req: Request) {
  try {
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "anonymous";
    const rl = await checkRateLimit(`forgot-pass:${ipAddress}`, { limit: 5, windowSeconds: 60 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Please try again in ${rl.resetInSeconds} seconds.` },
        { status: 429 }
      );
    }

    const parsed = await parseJsonBody(req, forgotPasswordSchema);
    if (!parsed.success) return parsed.error;
    const normalizedEmail = parsed.data.email;

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (user && user.status !== "SUSPENDED") {
      await createAndSendOtp(normalizedEmail, "PASSWORD_RESET");
    }

    // Always return the same response to prevent user enumeration
    return NextResponse.json({
      success: true,
      message: "If an account with that email exists, we've sent a verification code.",
      email: normalizedEmail,
    });
  } catch (error: any) {
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
