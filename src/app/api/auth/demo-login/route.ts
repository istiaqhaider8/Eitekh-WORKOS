import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession, COOKIE_NAME } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const { role } = await req.json(); // "admin" | "lead" | "dev"

    let email = "admin@zenith.local";
    if (role === "lead") email = "sarah@acme.com";
    if (role === "dev") email = "marcus@acme.com";
    if (role === "owner") email = "alex@acme.com";

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: "Demo user not found. Please run seed script." }, { status: 404 });
    }

    const userAgent = req.headers.get("user-agent") || undefined;
    const ipAddress = req.headers.get("x-forwarded-for") || undefined;

    const { jwtToken } = await createSession(user.id, userAgent, ipAddress);

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isSuperAdmin: user.isSuperAdmin,
      },
    });

    response.cookies.set(COOKIE_NAME, jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
