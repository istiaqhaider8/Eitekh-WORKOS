import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyEmailSchema, parseBody, parseJsonBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";

export async function POST(req: Request) {
  try {
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "anonymous";
    const rl = await checkRateLimit(`verify-email:${ipAddress}`, { limit: 20, windowSeconds: 60 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many verification requests. Please try again in ${rl.resetInSeconds} seconds.` },
        { status: 429 }
      );
    }

    const parsed = await parseJsonBody(req, verifyEmailSchema);
    if (!parsed.success) return parsed.error;
    const { token } = parsed.data;

    const user = await prisma.user.findFirst({
      where: { verificationToken: token },
    });

    if (!user) {
      return NextResponse.json({ error: "Invalid or expired verification token" }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        verificationToken: null,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Email address verified successfully!",
    });
  } catch (error: any) {
    console.error("Email verification error:", error);
    return handleApiError(error, "auth/verify-email");
  }
}
