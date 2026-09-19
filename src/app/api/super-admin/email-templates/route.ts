import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getEmailTemplates, DEFAULT_TEMPLATES } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { superAdminEmailTemplateResetSchema, parseBody } from "@/lib/validation";
import { handleApiError } from "@/lib/api-error";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const templates = await getEmailTemplates();
    return NextResponse.json({ templates });
  } catch (error: any) {
    return handleApiError(error, "super-admin/email-templates");
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Unauthorized: Super Admin required" }, { status: 403 });
    }

    const parsed = parseBody(superAdminEmailTemplateResetSchema, await req.json().catch(() => ({})));
    if (!parsed.success) return parsed.error;

    if (parsed.data.resetAll) {
      await prisma.emailTemplate.deleteMany();
      for (const t of DEFAULT_TEMPLATES) {
        await prisma.emailTemplate.create({ data: t });
      }
      const templates = await getEmailTemplates();
      return NextResponse.json({ templates, message: "All email templates reset to defaults" });
    }

    return NextResponse.json({ error: "Invalid operation" }, { status: 400 });
  } catch (error: any) {
    return handleApiError(error, "super-admin/email-templates");
  }
}
