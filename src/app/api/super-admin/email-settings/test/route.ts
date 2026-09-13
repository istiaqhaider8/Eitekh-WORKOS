import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { sendEmail, getEmailConfig } from "@/lib/email";

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
      return NextResponse.json({ error: "Unauthorized: Super Admin required" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const targetEmail = body.to || user.email;
    const config = await getEmailConfig();

    const result = await sendEmail({
      to: targetEmail,
      customSubject: `[Test] Eitekh WorkOS Email Test via ${config.senderEmail}`,
      customHtml: `
<div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background: #0f172a; color: #fff; border-radius: 12px;">
  <h2 style="color: #38bdf8; margin-top: 0;">Email Delivery Verification</h2>
  <p style="font-size: 14px; color: #cbd5e1;">This is a test notification dispatched from Eitekh WorkOS.</p>
  <div style="background: #1e293b; padding: 14px; border-radius: 8px; font-size: 12px; color: #94a3b8; margin: 16px 0;">
    <div><strong>Sender Address:</strong> ${config.senderEmail}</div>
    <div><strong>Sender Display Name:</strong> ${config.senderName}</div>
    <div><strong>Dispatched At:</strong> ${new Date().toISOString()}</div>
    <div><strong>Target Recipient:</strong> ${targetEmail}</div>
  </div>
  <p style="color: #10b981; font-weight: bold; font-size: 13px;">✓ Outbound email service operational.</p>
</div>
      `.trim(),
    });

    return NextResponse.json({
      success: true,
      message: `Test email dispatched to ${targetEmail} from ${config.senderEmail}`,
      result,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
