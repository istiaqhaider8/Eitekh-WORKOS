import { NextResponse } from "next/server";
import { otpRequestSchema, parseJsonBody } from "@/lib/validation";
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

    const parsed = await parseJsonBody(req, otpRequestSchema);
    if (!parsed.success) return parsed.error;
    const { email, purpose } = parsed.data;

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
