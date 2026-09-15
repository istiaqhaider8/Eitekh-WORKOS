import nodemailer from "nodemailer";
import { prisma } from "./prisma";

export interface SendEmailOptions {
  to: string;
  templateKey?: string;
  variables?: Record<string, string | number | undefined | null>;
  customSubject?: string;
  customHtml?: string;
}

export const DEFAULT_SENDER_EMAIL = process.env.EMAIL_FROM || "noreply@eitekh.com";
export const DEFAULT_SENDER_NAME = process.env.EMAIL_FROM_NAME || "Eitekh WorkOS";

// Shared email wrapper — table-based layout for maximum client compatibility
function wrap(content: string): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f8;">
  <tr><td align="center" style="padding:40px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <!-- Header -->
      <tr>
        <td style="background-color:#0f172a;padding:28px 32px;text-align:center;">
          <table cellpadding="0" cellspacing="0" border="0" align="center">
            <tr>
              <td style="width:36px;height:36px;background-color:#2563eb;border-radius:8px;text-align:center;vertical-align:middle;font-size:18px;font-weight:800;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">E</td>
              <td style="padding-left:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">Eitekh WorkOS</td>
            </tr>
          </table>
        </td>
      </tr>
      <!-- Body -->
      <tr>
        <td style="padding:32px 32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          ${content}
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="padding:0 32px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="border-top:1px solid #e5e7eb;padding-top:20px;text-align:center;">
              <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;">&copy; {{currentYear}} Eitekh Technologies. All rights reserved.</p>
              <p style="margin:0;font-size:11px;color:#d1d5db;">Enterprise Project Management &amp; Issue Tracking</p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </td></tr>
</table>`.trim();
}

// Shared button component
function btn(href: string, label: string, color = "#2563eb"): string {
  return `<table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto;">
  <tr><td align="center" style="background-color:${color};border-radius:6px;">
    <a href="${href}" target="_blank" style="display:inline-block;padding:13px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">${label}</a>
  </td></tr>
</table>`;
}

export const DEFAULT_TEMPLATES = [
  {
    key: "WELCOME",
    name: "Welcome & Account Verification",
    description: "Sent when a new user signs up or is invited to an organization",
    subject: "Welcome to Eitekh WorkOS, {{userName}}",
    variables: JSON.stringify(["userName", "userEmail", "organizationName", "actionUrl"]),
    bodyHtml: wrap(`
          <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#111827;">Welcome aboard, {{userName}}</h1>
          <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.5;">Your Eitekh WorkOS account has been created.</p>

          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Organization</p>
              <p style="margin:0;font-size:15px;font-weight:600;color:#111827;">{{organizationName}}</p>
            </td></tr>
          </table>

          <p style="margin:20px 0 0;font-size:14px;color:#374151;line-height:1.6;">You now have access to your projects, sprint boards, and team workloads. Click below to open your workspace.</p>
          ${btn("{{actionUrl}}", "Open Your Workspace")}
          <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">If you did not create this account, you can safely ignore this email.</p>
    `),
  },
  {
    key: "ISSUE_ASSIGNED",
    name: "Issue Assigned Notification",
    description: "Triggered when an issue or task is assigned to a user",
    subject: "[{{projectKey}}] {{issueKey}} assigned to you — {{issueTitle}}",
    variables: JSON.stringify(["userName", "projectKey", "projectName", "issueKey", "issueTitle", "priority", "issueType", "assignerName", "actionUrl"]),
    bodyHtml: wrap(`
          <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#2563eb;text-transform:uppercase;letter-spacing:0.5px;">Task Assignment</p>
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#111827;">You have a new assignment</h1>
          <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.5;"><strong>{{assignerName}}</strong> assigned an issue to you in <strong>{{projectName}}</strong>.</p>

          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;">
            <tr><td style="padding:20px;border-left:4px solid #2563eb;border-radius:6px;">
              <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#2563eb;font-family:'Courier New',Courier,monospace;">{{issueKey}}</p>
              <p style="margin:0 0 12px;font-size:16px;font-weight:600;color:#111827;">{{issueTitle}}</p>
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-right:16px;">
                    <span style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;">Type</span><br/>
                    <span style="font-size:13px;font-weight:600;color:#374151;">{{issueType}}</span>
                  </td>
                  <td>
                    <span style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;">Priority</span><br/>
                    <span style="font-size:13px;font-weight:600;color:#d97706;">{{priority}}</span>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
          ${btn("{{actionUrl}}", "View Issue")}
    `),
  },
  {
    key: "MENTION",
    name: "Mention in Comment",
    description: "Triggered when a user is @mentioned in an issue comment",
    subject: "[{{projectKey}}] {{authorName}} mentioned you on {{issueKey}}",
    variables: JSON.stringify(["userName", "authorName", "projectKey", "issueKey", "issueTitle", "commentContent", "actionUrl"]),
    bodyHtml: wrap(`
          <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
            <tr><td style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;padding:4px 10px;font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.5px;">@Mention</td></tr>
          </table>
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#111827;">You were mentioned in a comment</h1>
          <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.5;"><strong>{{authorName}}</strong> mentioned you on <strong style="color:#2563eb;">{{issueKey}}</strong>: {{issueTitle}}</p>

          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;font-style:italic;">&ldquo;{{commentContent}}&rdquo;</p>
            </td></tr>
          </table>
          ${btn("{{actionUrl}}", "View Comment")}
    `),
  },
  {
    key: "PASSWORD_RESET",
    name: "Password Reset Request",
    description: "Sent when a user requests to reset their password (link-based)",
    subject: "Reset your Eitekh WorkOS password",
    variables: JSON.stringify(["userName", "resetUrl", "expiresIn"]),
    bodyHtml: wrap(`
          <div style="text-align:center;margin-bottom:20px;">
            <table cellpadding="0" cellspacing="0" border="0" align="center">
              <tr><td style="width:48px;height:48px;background-color:#fef2f2;border-radius:50%;text-align:center;vertical-align:middle;font-size:22px;">&#128274;</td></tr>
            </table>
          </div>
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;text-align:center;">Password Reset</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#6b7280;text-align:center;line-height:1.5;">We received a request to reset the password for your account.</p>

          <p style="margin:0 0 4px;font-size:14px;color:#374151;line-height:1.6;">Hi <strong>{{userName}}</strong>,</p>
          <p style="margin:0 0 4px;font-size:14px;color:#374151;line-height:1.6;">Click the button below to choose a new password. This link expires in <strong>{{expiresIn}}</strong>.</p>
          ${btn("{{resetUrl}}", "Reset Password", "#dc2626")}
          <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">If you did not make this request, no action is needed. Your account remains secure.</p>
    `),
  },
  {
    key: "SPRINT_STARTED",
    name: "Sprint Started Notification",
    description: "Sent to team members when a project sprint is started",
    subject: "[{{projectName}}] Sprint started — {{sprintName}}",
    variables: JSON.stringify(["userName", "projectName", "sprintName", "sprintGoal", "startDate", "endDate", "actionUrl"]),
    bodyHtml: wrap(`
          <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#059669;text-transform:uppercase;letter-spacing:0.5px;">Sprint Active</p>
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#111827;">{{sprintName}} has started</h1>
          <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.5;">Project: <strong>{{projectName}}</strong></p>

          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;">
            <tr><td style="padding:20px;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Sprint Goal</p>
              <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#111827;line-height:1.5;">{{sprintGoal}}</p>
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-right:20px;">
                    <span style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;">Start</span><br/>
                    <span style="font-size:13px;font-weight:600;color:#374151;">{{startDate}}</span>
                  </td>
                  <td>
                    <span style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;">End</span><br/>
                    <span style="font-size:13px;font-weight:600;color:#374151;">{{endDate}}</span>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
          ${btn("{{actionUrl}}", "Open Sprint Board")}
    `),
  },
  {
    key: "REGISTRATION_OTP",
    name: "Registration OTP Code",
    description: "Sent when a user registers to verify their email address",
    subject: "{{otpCode}} is your Eitekh WorkOS verification code",
    variables: JSON.stringify(["otpCode", "expiresIn"]),
    bodyHtml: wrap(`
          <div style="text-align:center;margin-bottom:20px;">
            <table cellpadding="0" cellspacing="0" border="0" align="center">
              <tr><td style="width:48px;height:48px;background-color:#eff6ff;border-radius:50%;text-align:center;vertical-align:middle;font-size:22px;">&#128272;</td></tr>
            </table>
          </div>
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;text-align:center;">Verify your email</h1>
          <p style="margin:0 0 28px;font-size:14px;color:#6b7280;text-align:center;line-height:1.5;">Enter the code below to activate your Eitekh WorkOS account.</p>

          <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 28px;">
            <tr><td style="background-color:#f9fafb;border:2px solid #2563eb;border-radius:8px;padding:18px 36px;text-align:center;">
              <span style="font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:800;color:#111827;letter-spacing:10px;">{{otpCode}}</span>
            </td></tr>
          </table>

          <p style="margin:0 0 4px;font-size:13px;color:#6b7280;text-align:center;">This code expires in <strong style="color:#374151;">{{expiresIn}}</strong>.</p>
          <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">If you did not create an account, you can ignore this email.</p>
    `),
  },
  {
    key: "PASSWORD_RESET_OTP",
    name: "Password Reset OTP Code",
    description: "Sent when a user requests a password reset via OTP",
    subject: "{{otpCode}} is your Eitekh WorkOS password reset code",
    variables: JSON.stringify(["otpCode", "expiresIn"]),
    bodyHtml: wrap(`
          <div style="text-align:center;margin-bottom:20px;">
            <table cellpadding="0" cellspacing="0" border="0" align="center">
              <tr><td style="width:48px;height:48px;background-color:#fef2f2;border-radius:50%;text-align:center;vertical-align:middle;font-size:22px;">&#128274;</td></tr>
            </table>
          </div>
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;text-align:center;">Password Reset Code</h1>
          <p style="margin:0 0 28px;font-size:14px;color:#6b7280;text-align:center;line-height:1.5;">Use the code below to reset your Eitekh WorkOS password.</p>

          <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 28px;">
            <tr><td style="background-color:#fef2f2;border:2px solid #dc2626;border-radius:8px;padding:18px 36px;text-align:center;">
              <span style="font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:800;color:#111827;letter-spacing:10px;">{{otpCode}}</span>
            </td></tr>
          </table>

          <p style="margin:0 0 4px;font-size:13px;color:#6b7280;text-align:center;">This code expires in <strong style="color:#374151;">{{expiresIn}}</strong>.</p>
          <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">If you did not request this, no action is needed. Your account is still secure.</p>
    `),
  },
  {
    key: "INVITATION",
    name: "Organization Invitation",
    description: "Sent when a user is invited to join an organization",
    subject: "{{inviterName}} invited you to {{organizationName}} on Eitekh WorkOS",
    variables: JSON.stringify(["inviterName", "organizationName", "roleName", "actionUrl"]),
    bodyHtml: wrap(`
          <div style="text-align:center;margin-bottom:20px;">
            <table cellpadding="0" cellspacing="0" border="0" align="center">
              <tr><td style="width:48px;height:48px;background-color:#f0fdf4;border-radius:50%;text-align:center;vertical-align:middle;font-size:22px;">&#9993;</td></tr>
            </table>
          </div>
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;text-align:center;">You're invited</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#6b7280;text-align:center;line-height:1.5;"><strong style="color:#374151;">{{inviterName}}</strong> has invited you to join their team.</p>

          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:8px;">
            <tr>
              <td style="padding:16px 20px;width:50%;border-right:1px solid #e5e7eb;">
                <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Organization</p>
                <p style="margin:0;font-size:15px;font-weight:600;color:#111827;">{{organizationName}}</p>
              </td>
              <td style="padding:16px 20px;">
                <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Role</p>
                <p style="margin:0;font-size:15px;font-weight:600;color:#111827;">{{roleName}}</p>
              </td>
            </tr>
          </table>
          ${btn("{{actionUrl}}", "Accept Invitation")}
          <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">This invitation expires in 7 days. If you did not expect this, you can safely ignore it.</p>
    `),
  },
];

/**
 * Retrieves the global email configuration, creating the default with cocofbd@gmail.com if not exists.
 */
export async function getEmailConfig() {
  try {
    let config = await prisma.systemEmailConfig.findFirst();
    if (!config) {
      config = await prisma.systemEmailConfig.create({
        data: {
          senderEmail: process.env.SMTP_USER || DEFAULT_SENDER_EMAIL,
          senderName: DEFAULT_SENDER_NAME,
          smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
          smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
          smtpUser: process.env.SMTP_USER || DEFAULT_SENDER_EMAIL,
          smtpPass: process.env.SMTP_PASS || null,
          isEnabled: true,
        },
      });
    }
    return {
      ...config,
      senderEmail: config.senderEmail || process.env.SMTP_USER || DEFAULT_SENDER_EMAIL,
      smtpHost: config.smtpHost || process.env.SMTP_HOST || "smtp.gmail.com",
      smtpPort: config.smtpPort || (process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587),
      smtpUser: config.smtpUser || process.env.SMTP_USER || config.senderEmail || DEFAULT_SENDER_EMAIL,
      smtpPass: config.smtpPass || process.env.SMTP_PASS || null,
    };
  } catch (error) {
    console.error("Failed to load email config:", error);
    return {
      id: "default",
      senderEmail: process.env.SMTP_USER || DEFAULT_SENDER_EMAIL,
      senderName: DEFAULT_SENDER_NAME,
      smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
      smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
      smtpUser: process.env.SMTP_USER || DEFAULT_SENDER_EMAIL,
      smtpPass: process.env.SMTP_PASS || null,
      isSecure: false,
      isEnabled: true,
    };
  }
}

/**
 * Seeds or retrieves all email templates.
 */
export async function getEmailTemplates() {
  try {
    let templates = await prisma.emailTemplate.findMany({ orderBy: { key: "asc" } });
    if (templates.length === 0) {
      for (const t of DEFAULT_TEMPLATES) {
        await prisma.emailTemplate.create({ data: t }).catch(() => {});
      }
      templates = await prisma.emailTemplate.findMany({ orderBy: { key: "asc" } });
    }
    return templates;
  } catch (error) {
    console.error("Failed to load templates:", error);
    return DEFAULT_TEMPLATES.map((t, idx) => ({ ...t, id: `mock-${idx}`, updatedAt: new Date() }));
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const URL_VARIABLE_NAMES = new Set([
  "actionUrl", "resetUrl", "loginUrl", "projectUrl", "issueUrl", "linkUrl",
]);

/**
 * Replace placeholders like {{userName}} with actual values.
 * All values are HTML-escaped to prevent injection.
 * URL variables (actionUrl, resetUrl, etc.) are placed in href attributes
 * and must already be safe URLs — they are still escaped for attribute context.
 */
export function renderTemplate(text: string, variables: Record<string, any> = {}) {
  let rendered = text;
  const allVars = { currentYear: new Date().getFullYear().toString(), ...variables };
  for (const [key, val] of Object.entries(allVars)) {
    const raw = String(val ?? "");
    const safe = URL_VARIABLE_NAMES.has(key) ? encodeURI(raw) : escapeHtml(raw);
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    rendered = rendered.replace(regex, safe);
  }
  return rendered;
}

/**
 * Centralized email sending function.
 * Every email is dispatched using the configured sender email (default: cocofbd@gmail.com).
 */
export async function sendEmail({
  to,
  templateKey,
  variables = {},
  customSubject,
  customHtml,
}: SendEmailOptions) {
  const config = await getEmailConfig();

  if (!config.isEnabled) {
    console.log(`[Email] System email notifications are currently disabled. Skipping to: ${to}`);
    return { success: false, reason: "DISABLED" };
  }

  const fromAddress = `"${config.senderName}" <${config.senderEmail}>`;
  let subject = customSubject || "Eitekh WorkOS Notification";
  let html = customHtml || "<p>Notification from Eitekh WorkOS</p>";

  // If a templateKey was provided, load and render template
  if (templateKey) {
    const templates = await getEmailTemplates();
    const tpl = templates.find((t) => t.key === templateKey);
    if (tpl) {
      subject = renderTemplate(tpl.subject, variables);
      html = renderTemplate(tpl.bodyHtml, variables);
    }
  }

  let status = "SENT";
  let errorMessage: string | null = null;
  let messageId: string | undefined;

  try {
    // If SMTP password or host is configured, attempt real dispatch via Nodemailer
    if (config.smtpPass && config.smtpHost) {
      const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort || 587,
        secure: config.isSecure,
        auth: {
          user: config.smtpUser || config.senderEmail,
          pass: config.smtpPass,
        },
      });

      const info = await transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        html,
      });
      messageId = info.messageId;
      status = "SENT";
    } else {
      console.warn(`[Email] SMTP not configured (no smtpPass). Email to ${to} was NOT sent. Subject: "${subject}"`);
      status = "MOCKED";
      messageId = `mock-${Date.now()}`;
    }
  } catch (err: any) {
    console.error(`[Email Send Error] To: ${to} Error:`, err);
    status = "FAILED";
    errorMessage = err.message || "Failed to dispatch email";
  }

  // Audit log to EmailLog table
  try {
    await prisma.emailLog.create({
      data: {
        to,
        from: config.senderEmail,
        subject,
        bodySnippet: html.replace(/<[^>]*>/g, "").substring(0, 150),
        templateKey: templateKey || null,
        status,
        error: errorMessage,
      },
    });
  } catch (e) {
    // Ignore logging errors
  }

  return {
    success: status !== "FAILED",
    from: config.senderEmail,
    to,
    subject,
    status,
    messageId,
    error: errorMessage,
  };
}
