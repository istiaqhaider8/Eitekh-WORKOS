import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { mfaToggleSchema, parseBody } from "@/lib/validation";

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = parseBody(mfaToggleSchema, await request.json());
    if (!parsed.success) return parsed.error;
    const { enabled } = parsed.data;

    if (enabled) {
      // Generate 8 random recovery codes
      const rawCodes = Array.from({ length: 8 }, () => crypto.randomBytes(4).toString("hex"));
      const recoveryCodes = JSON.stringify(rawCodes); // Storing raw as instructed or hashed. Just JSON array.

      await prisma.user.update({
        where: { id: user.id },
        data: {
          mfaEnabled: true,
          recoveryCodes,
        },
      });

      return NextResponse.json({ mfaEnabled: true, recoveryCodes: rawCodes }, { status: 200 });
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          mfaEnabled: false,
          recoveryCodes: null,
          mfaSecret: null, // optionally clear secret
        },
      });

      return NextResponse.json({ mfaEnabled: false }, { status: 200 });
    }
  } catch (error) {
    console.error("MFA toggle error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
