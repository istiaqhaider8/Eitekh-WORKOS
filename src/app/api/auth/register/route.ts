import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, createSession, COOKIE_NAME } from "@/lib/auth";
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

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    // Create user and auto-provision initial Organization and Workspace
    const user = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        passwordHash,
        company,
        jobTitle,
        status: "ACTIVE",
        emailVerifiedAt: new Date(), // Mock verification for instant onboarding
      },
    });

    const orgName = company || `${firstName}'s Team`;
    const orgSlug = orgName.toLowerCase().replace(/[^a-z0-9]/g, "-") + "-" + Math.random().toString(36).substring(2, 6);

    const org = await prisma.organization.create({
      data: {
        name: orgName,
        slug: orgSlug,
        members: {
          create: [{ userId: user.id, role: "OWNER" }],
        },
      },
    });

    const workspace = await prisma.workspace.create({
      data: {
        orgId: org.id,
        name: "Main Workspace",
        slug: "main",
        members: {
          create: [{ userId: user.id, role: "WORKSPACE_ADMIN" }],
        },
      },
    });

    const project = await prisma.project.create({
      data: {
        workspaceId: workspace.id,
        name: "My First Project",
        key: "PRJ",
        description: "Initial project setup",
        ownerId: user.id,
        template: "SCRUM",
        members: {
          create: [{ userId: user.id, role: "PROJECT_ADMIN" }],
        },
      },
    });

    // Create default workflow for the project
    const workflow = await prisma.workflow.create({
      data: {
        projectId: project.id,
        name: "Default Workflow",
        isDefault: true,
      },
    });

    await prisma.workflowStatus.createMany({
      data: [
        { workflowId: workflow.id, name: "To Do", category: "TO_DO", color: "#3b82f6", position: 1 },
        { workflowId: workflow.id, name: "In Progress", category: "IN_PROGRESS", color: "#f59e0b", position: 2 },
        { workflowId: workflow.id, name: "Done", category: "DONE", color: "#10b981", position: 3 },
      ],
    });

    const { jwtToken } = await createSession(user.id);

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
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
    console.error("Registration error:", error);
    return NextResponse.json({ error: error.message || "Registration failed" }, { status: 500 });
  }
}
