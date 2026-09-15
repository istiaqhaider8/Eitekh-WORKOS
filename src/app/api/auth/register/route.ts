import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { createAndSendOtp } from "@/lib/otp";
import { registerSchema, parseBody } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "anonymous";
    const rl = checkRateLimit(`register:${ipAddress}`, { limit: 10, windowSeconds: 60 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many registration attempts. Please try again in ${rl.resetInSeconds} seconds.` },
        { status: 429, headers: { "Retry-After": String(rl.resetInSeconds) } }
      );
    }

    const parsed = parseBody(registerSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { firstName, lastName, email, password, company, jobTitle } = parsed.data;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser && existingUser.status === "ACTIVE" && existingUser.emailVerifiedAt) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    if (existingUser && existingUser.status === "PENDING_VERIFY") {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { firstName, lastName, passwordHash, company, jobTitle },
      });
    } else if (!existingUser) {
      await prisma.user.create({
        data: {
          firstName,
          lastName,
          email,
          passwordHash,
          company,
          jobTitle,
          status: "PENDING_VERIFY",
        },
      });
    }

    const otpResult = await createAndSendOtp(email, "REGISTRATION");
    if (!otpResult.success) {
      return NextResponse.json({ error: otpResult.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      requiresVerification: true,
      email,
      message: "Verification code sent to your email.",
    });
  } catch (error: any) {
    console.error("Registration error:", error);
    return NextResponse.json({ error: error.message || "Registration failed" }, { status: 500 });
  }
}
