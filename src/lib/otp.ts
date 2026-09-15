import crypto from "crypto";
import { prisma } from "./prisma";
import { sendEmail } from "./email";

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

function generateOtp(): string {
  const bytes = crypto.randomBytes(4);
  const num = bytes.readUInt32BE(0) % 1_000_000;
  return num.toString().padStart(OTP_LENGTH, "0");
}

function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

export async function createAndSendOtp(
  email: string,
  purpose: "REGISTRATION" | "PASSWORD_RESET"
): Promise<{ success: boolean; error?: string }> {
  const normalizedEmail = email.toLowerCase().trim();

  await prisma.otpCode.updateMany({
    where: { email: normalizedEmail, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });

  const otp = generateOtp();
  const codeHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await prisma.otpCode.create({
    data: {
      email: normalizedEmail,
      codeHash,
      purpose,
      expiresAt,
      maxAttempts: OTP_MAX_ATTEMPTS,
    },
  });

  const templateKey = purpose === "REGISTRATION" ? "REGISTRATION_OTP" : "PASSWORD_RESET_OTP";
  const subject =
    purpose === "REGISTRATION"
      ? `${otp} — Eitekh WorkOS Verification Code`
      : `${otp} — Eitekh WorkOS Password Reset Code`;

  const result = await sendEmail({
    to: normalizedEmail,
    templateKey,
    variables: {
      otpCode: otp,
      expiresIn: `${OTP_EXPIRY_MINUTES} minutes`,
    },
    customSubject: subject,
  });

  if (result.status !== "SENT") {
    return { success: false, error: "Failed to send verification email. Please try again." };
  }

  return { success: true };
}

export async function verifyOtp(
  email: string,
  code: string,
  purpose: "REGISTRATION" | "PASSWORD_RESET"
): Promise<{ valid: boolean; error?: string }> {
  const normalizedEmail = email.toLowerCase().trim();

  const otpRecord = await prisma.otpCode.findFirst({
    where: {
      email: normalizedEmail,
      purpose,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!otpRecord) {
    return { valid: false, error: "No active verification code found. Please request a new one." };
  }

  if (otpRecord.attempts >= otpRecord.maxAttempts) {
    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { usedAt: new Date() },
    });
    return { valid: false, error: "Too many incorrect attempts. Please request a new code." };
  }

  const codeHash = hashOtp(code);
  if (codeHash !== otpRecord.codeHash) {
    await prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { attempts: otpRecord.attempts + 1 },
    });
    const remaining = otpRecord.maxAttempts - otpRecord.attempts - 1;
    return {
      valid: false,
      error: remaining > 0
        ? `Invalid code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
        : "Too many incorrect attempts. Please request a new code.",
    };
  }

  await prisma.otpCode.update({
    where: { id: otpRecord.id },
    data: { usedAt: new Date() },
  });

  return { valid: true };
}
