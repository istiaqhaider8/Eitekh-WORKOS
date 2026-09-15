import { NextResponse } from "next/server";
import { createAndSendOtp } from "@/lib/otp";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "anonymous";
    const rl = checkRateLimit(`resend-otp:${ipAddress}`, { limit: 3, windowSeconds: 60 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many requests. Please try again in ${rl.resetInSeconds} seconds.` },
        { status: 429, headers: { "Retry-After": String(rl.resetInSeconds) } }
      );
    }

    const body = await req.json();
    const { email, purpose } = body;

    if (!email || !purpose) {
      return NextResponse.json({ error: "Email and purpose are required." }, { status: 400 });
    }

    if (!["REGISTRATION", "PASSWORD_RESET"].includes(purpose)) {
      return NextResponse.json({ error: "Invalid purpose." }, { status: 400 });
    }

    const result = await createAndSendOtp(email, purpose);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "New verification code sent.",
    });
  } catch (error: any) {
    console.error("Resend OTP error:", error);
    return NextResponse.json({ error: error.message || "Failed to resend code" }, { status: 500 });
  }
}
