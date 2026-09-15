import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { profileUpdateSchema, parseBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = parseBody(profileUpdateSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { firstName, lastName, jobTitle, company, timezone, language } = parsed.data;

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName,
        lastName,
        jobTitle,
        company,
        timezone,
        language,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        jobTitle: true,
        company: true,
        timezone: true,
        language: true,
        isSuperAdmin: true,
        isSupportAdmin: true,
        status: true,
        mfaEnabled: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ user: updatedUser }, { status: 200 });
  } catch (error) {
    console.error("Profile update error:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}
