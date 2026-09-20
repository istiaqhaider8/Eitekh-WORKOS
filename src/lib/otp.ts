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

  /**
   * When the code cannot be delivered, put it where a LOCAL operator can see
   * it — and only a local operator.
   *
   * Two separate mechanisms make OTP flows impossible to complete off a real
   * mail server, and between them they block registration and password reset
   * entirely on a development machine:
   *
   *   - with no SMTP configured, `sendEmail` returns MOCKED, and the check
   *     below treats anything other than SENT as a failure;
   *   - with EMAIL_DISABLED set, nothing is dispatched at all, and because no
   *     EmailLog row is written either, the code exists ONLY as a one-way
   *     hash in OtpCode. Nobody — including the person running the server —
   *     can recover it.
   *
   * So the flow was unusable locally, and the fix for the second problem made
   * the first one worse. Printing the code to the server's own stdout is the
   * only thing that makes the flow completable without a mail server.
   *
   * THE GUARD MATTERS MORE THAN THE FEATURE. A one-time code in a log file is
   * a credential in a log file: it defeats the point of sending it out of
   * band, and log aggregation would spread it further. So this requires an
   * explicit, deliberate signal that this is not a real deployment —
   * ALLOW_LOCAL_BASE_URL, which instrumentation.ts already describes as
   * something that "must never be set in a real deployment" — or a
   * non-production NODE_ENV. A production server with neither never reaches
   * this branch.
   */
  const isLocalRun =
    process.env.NODE_ENV !== "production" || process.env.ALLOW_LOCAL_BASE_URL === "1";

  if (result.status !== "SENT") {
    if (isLocalRun) {
      console.warn(
        `\n[otp] Email was not delivered (${result.status ?? result.reason ?? "unknown"}), so the code is printed here.\n` +
          `[otp] ${purpose} code for ${normalizedEmail}: ${otp}\n` +
          `[otp] Valid for ${OTP_EXPIRY_MINUTES} minutes. This only happens on a local run.\n`
      );
      // The code IS available, so reporting failure would be a lie that
      // stops the caller dead. The row is written; the operator can read it.
      return { success: true };
    }
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
    const updated = await prisma.otpCode.updateMany({
      where: { id: otpRecord.id, attempts: { lt: otpRecord.maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (updated.count === 0) {
      return { valid: false, error: "Too many incorrect attempts. Please request a new code." };
    }
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
