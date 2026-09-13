import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEmailConfig } from "@/lib/email";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Unauthorized: Super Admin required" }, { status: 403 });
    }

    const config = await getEmailConfig();
    const logs = await prisma.emailLog.findMany({
      take: 25,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ config, logs });
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

    const body = await req.json();
    const { senderEmail, senderName, smtpHost, smtpPort, smtpUser, smtpPass, isSecure, isEnabled } = body;

    let config = await prisma.systemEmailConfig.findFirst();
    if (!config) {
      config = await prisma.systemEmailConfig.create({
        data: {
          senderEmail: senderEmail || "cocofbd@gmail.com",
          senderName: senderName || "Eitekh WorkOS",
          smtpHost: smtpHost || "smtp.gmail.com",
          smtpPort: Number(smtpPort) || 587,
          smtpUser: smtpUser || senderEmail || "cocofbd@gmail.com",
          smtpPass: smtpPass || null,
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
      if (smtpPass !== undefined) updateData.smtpPass = smtpPass;
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

    return NextResponse.json({ config, message: "Email configuration updated successfully" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
