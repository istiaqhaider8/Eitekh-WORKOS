import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEmailConfig } from "@/lib/email";
import { superAdminEmailSettingsUpdateSchema, parseBody } from "@/lib/validation";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || (!user.isSuperAdmin && !user.isSupportAdmin)) {
      return NextResponse.json({ error: "Forbidden: Super Admin access required" }, { status: 403 });
    }

    const config = await getEmailConfig();
    const logs = await prisma.emailLog.findMany({
      take: 25,
      orderBy: { createdAt: "desc" },
    });

    const safeConfig = config
      ? {
          ...config,
          smtpPass: config.smtpPass ? "••••••••" : null,
          hasSmtpPass: Boolean(config.smtpPass),
        }
      : null;

    return NextResponse.json({ config: safeConfig, logs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Unauthorized: Super Admin required" }, { status: 403 });
    }

    const parsed = parseBody(superAdminEmailSettingsUpdateSchema, await req.json());
    if (!parsed.success) return parsed.error;
    const { senderEmail, senderName, smtpHost, smtpPort, smtpUser, smtpPass, isSecure, isEnabled } = parsed.data;

    let config = await prisma.systemEmailConfig.findFirst();
    if (!config) {
      config = await prisma.systemEmailConfig.create({
        data: {
          senderEmail: senderEmail || "cocofbd@gmail.com",
          senderName: senderName || "Eitekh WorkOS",
          smtpHost: smtpHost || "smtp.gmail.com",
          smtpPort: Number(smtpPort) || 587,
          smtpUser: smtpUser || senderEmail || "cocofbd@gmail.com",
          smtpPass: smtpPass && smtpPass !== "••••••••" ? smtpPass : null,
          isSecure: Boolean(isSecure),
          isEnabled: isEnabled !== undefined ? Boolean(isEnabled) : true,
        },
      });
    } else {
      const updateData: any = {};
      if (senderEmail !== undefined) updateData.senderEmail = senderEmail;
      if (senderName !== undefined) updateData.senderName = senderName;
      if (smtpHost !== undefined) updateData.smtpHost = smtpHost;
      if (smtpPort !== undefined) updateData.smtpPort = Number(smtpPort);
      if (smtpUser !== undefined) updateData.smtpUser = smtpUser;
      if (smtpPass !== undefined && smtpPass !== "••••••••") updateData.smtpPass = smtpPass;
      if (isSecure !== undefined) updateData.isSecure = Boolean(isSecure);
      if (isEnabled !== undefined) updateData.isEnabled = Boolean(isEnabled);

      config = await prisma.systemEmailConfig.update({
        where: { id: config.id },
        data: updateData,
      });
    }

    // Log administrative change
    await prisma.platformAuditLog.create({
      data: {
        actorId: user.id,
        action: "EMAIL_CONFIG_UPDATED",
        targetResource: "SystemEmailConfig",
        details: JSON.stringify({ senderEmail: config.senderEmail, isEnabled: config.isEnabled }),
      },
    }).catch(() => {});

    const safeConfig = {
      ...config,
      smtpPass: config.smtpPass ? "••••••••" : null,
      hasSmtpPass: Boolean(config.smtpPass),
    };

    return NextResponse.json({ config: safeConfig, message: "Email configuration updated successfully" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
