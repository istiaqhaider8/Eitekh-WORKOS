import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEmailTemplates, DEFAULT_TEMPLATES, renderTemplate } from "@/lib/email";
import { superAdminEmailTemplateUpdateSchema, superAdminEmailTemplatePreviewSchema, parseBody } from "@/lib/validation";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const { key } = await params;
    await getEmailTemplates(); // ensure seeded
    const template = await prisma.emailTemplate.findUnique({
      where: { key },
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ template });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Unauthorized: Super Admin required" }, { status: 403 });
    }

    const { key } = await params;
    const parsed = parseBody(superAdminEmailTemplateUpdateSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { subject, bodyHtml, resetToDefault } = parsed.data;

    await getEmailTemplates(); // ensure seeded

    if (resetToDefault) {
      const defaultTpl = DEFAULT_TEMPLATES.find((t) => t.key === key);
      if (!defaultTpl) {
        return NextResponse.json({ error: "Default template not found" }, { status: 404 });
      }
      const updated = await prisma.emailTemplate.update({
        where: { key },
        data: {
          subject: defaultTpl.subject,
          bodyHtml: defaultTpl.bodyHtml,
        },
      });
      return NextResponse.json({ template: updated, message: "Template reset to default" });
    }

    if (!subject || !bodyHtml) {
      return NextResponse.json({ error: "Subject and bodyHtml are required" }, { status: 400 });
    }

    // Snapshot current version before overwriting
    const current = await prisma.emailTemplate.findUnique({ where: { key } });
    if (current) {
      await prisma.emailTemplateVersion.create({
        data: {
          templateKey: key,
          version: current.version,
          subject: current.subject,
          bodyHtml: current.bodyHtml,
          savedBy: user.id,
        },
      }).catch(() => {});
    }

    const updated = await prisma.emailTemplate.update({
      where: { key },
      data: {
        subject,
        bodyHtml,
        version: { increment: 1 },
      },
    });

    // Audit log template update
    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "EMAIL_TEMPLATE_UPDATED",
        targetResource: `EmailTemplate:${key}`,
        details: JSON.stringify({ subject, version: updated.version }),
      },
    }).catch(() => {});

    return NextResponse.json({ template: updated, message: "Email template updated successfully" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Unauthorized: Super Admin required" }, { status: 403 });
    }

    const { key } = await params;
    const parsed = parseBody(superAdminEmailTemplatePreviewSchema, await req.json().catch(() => ({})));
    if (!parsed.success) return parsed.error;
    const { sampleVariables } = parsed.data;

    await getEmailTemplates();
    const template = await prisma.emailTemplate.findUnique({
      where: { key },
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Generate preview with sample data
    const defaultSampleVars: Record<string, string> = {
      userName: "Alex Morgan",
      userEmail: "alex@acme.com",
      organizationName: "Acme Innovations",
      projectKey: "CP",
      projectName: "Customer Portal",
      issueKey: "CP-42",
      issueTitle: "Implement SSO and OAuth2 Provider Integration",
      priority: "CRITICAL",
      issueType: "FEATURE",
      assignerName: "Sarah Chen",
      authorName: "Marcus Vance",
      commentContent: "Could you take a look at the middleware changes on this PR?",
      resetUrl: "http://localhost:3000/reset-password?token=sample123",
      expiresIn: "60 minutes",
      sprintName: "Sprint 3: Enterprise Auth",
      sprintGoal: "Complete OAuth2 and SAML Single Sign-On flow",
      startDate: "Sep 15, 2026",
      endDate: "Sep 30, 2026",
      actionUrl: "http://localhost:3000/projects/sample-id",
    };

    const vars = { ...defaultSampleVars, ...sampleVariables };
    const renderedSubject = renderTemplate(template.subject, vars);
    const renderedHtml = renderTemplate(template.bodyHtml, vars);

    return NextResponse.json({
      renderedSubject,
      renderedHtml,
      variables: vars,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
