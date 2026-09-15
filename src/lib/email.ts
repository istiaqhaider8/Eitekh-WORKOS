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

export const DEFAULT_TEMPLATES = [
  {
    key: "WELCOME",
    name: "Welcome & Account Verification",
    description: "Sent when a new user signs up or is invited to an organization",
    subject: "Welcome to Eitekh WorkOS, {{userName}}! 🚀",
    variables: JSON.stringify(["userName", "userEmail", "organizationName", "actionUrl"]),
    bodyHtml: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 20px; background-color: #0f172a; color: #f8fafc; border-radius: 16px;">
  <div style="text-align: center; margin-bottom: 24px;">
    <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; background: #2563eb; color: #ffffff; font-weight: 900; font-size: 22px; border-radius: 12px;">E</div>
    <h1 style="color: #ffffff; font-size: 22px; font-weight: 800; margin-top: 12px; margin-bottom: 4px;">Welcome to Eitekh WorkOS</h1>
    <p style="color: #94a3b8; font-size: 13px; margin: 0;">Enterprise Project Management & Issue Tracking</p>
  </div>

  <div style="background-color: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid #334155;">
    <p style="color: #f1f5f9; font-size: 14px; margin-top: 0;">Hi <strong>{{userName}}</strong>,</p>
    <p style="color: #cbd5e1; font-size: 13px; line-height: 1.6;">Your Eitekh WorkOS account is ready. You are a member of <strong>{{organizationName}}</strong>. You can now access your projects, sprint boards, and team workloads.</p>
    
    <div style="margin: 28px 0; text-align: center;">
      <a href="{{actionUrl}}" style="background-color: #2563eb; color: #ffffff; padding: 12px 28px; font-size: 13px; font-weight: 600; text-decoration: none; border-radius: 8px; display: inline-block;">Open Workspace →</a>
    </div>

    <p style="color: #64748b; font-size: 11px; margin-bottom: 0;">If you did not request this account, you can safely ignore this email.</p>
  </div>

  <div style="text-align: center; margin-top: 24px; color: #64748b; font-size: 11px;">
    Sent with Eitekh WorkOS Platform &bull; System Notification
  </div>
</div>
`.trim(),
  },
  {
    key: "ISSUE_ASSIGNED",
    name: "Issue Assigned Notification",
    description: "Triggered when an issue or task is assigned to a user",
    subject: "[{{projectKey}}] Assigned to you: {{issueKey}} - {{issueTitle}}",
    variables: JSON.stringify(["userName", "projectKey", "projectName", "issueKey", "issueTitle", "priority", "issueType", "assignerName", "actionUrl"]),
    bodyHtml: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 20px; background-color: #0f172a; color: #f8fafc; border-radius: 16px;">
  <div style="display: flex; align-items: center; margin-bottom: 20px;">
    <div style="display: inline-block; width: 32px; height: 32px; line-height: 32px; text-align: center; background: #2563eb; color: #ffffff; font-weight: 900; font-size: 16px; border-radius: 8px; margin-right: 12px;">E</div>
    <span style="color: #94a3b8; font-size: 12px; font-weight: 600; text-transform: uppercase;">Eitekh WorkOS &bull; Task Assignment</span>
  </div>

  <div style="background-color: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid #334155;">
    <p style="color: #f1f5f9; font-size: 14px; margin-top: 0;">Hi <strong>{{userName}}</strong>,</p>
    <p style="color: #cbd5e1; font-size: 13px; line-height: 1.5;"><strong>{{assignerName}}</strong> assigned a new issue to you in <strong>{{projectName}}</strong>:</p>

    <div style="background-color: #0f172a; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 6px; margin: 18px 0;">
      <div style="font-family: monospace; font-size: 12px; color: #60a5fa; font-weight: bold; margin-bottom: 4px;">{{issueKey}}</div>
      <div style="font-size: 15px; font-weight: 700; color: #ffffff; margin-bottom: 10px;">{{issueTitle}}</div>
      <div style="font-size: 12px; color: #94a3b8;">
        Type: <span style="color: #e2e8f0; font-weight: 600;">{{issueType}}</span> &nbsp;&bull;&nbsp;
        Priority: <span style="color: #f59e0b; font-weight: 600;">{{priority}}</span>
      </div>
    </div>

    <div style="margin-top: 24px;">
      <a href="{{actionUrl}}" style="background-color: #2563eb; color: #ffffff; padding: 10px 22px; font-size: 13px; font-weight: 600; text-decoration: none; border-radius: 8px; display: inline-block;">View Issue Details →</a>
    </div>
  </div>

  <div style="text-align: center; margin-top: 20px; color: #64748b; font-size: 11px;">
    Notification dispatched to {{userName}} via Eitekh WorkOS Email Engine
  </div>
</div>
`.trim(),
  },
  {
    key: "MENTION",
    name: "Mention in Comment",
    description: "Triggered when a user is @mentioned in an issue comment",
    subject: "[{{projectKey}}] {{authorName}} mentioned you on {{issueKey}}",
    variables: JSON.stringify(["userName", "authorName", "projectKey", "issueKey", "issueTitle", "commentContent", "actionUrl"]),
    bodyHtml: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 20px; background-color: #0f172a; color: #f8fafc; border-radius: 16px;">
  <div style="margin-bottom: 16px;">
    <span style="background-color: #3b82f6; color: #ffffff; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase;">@Mention</span>
  </div>

  <div style="background-color: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid #334155;">
    <p style="color: #f1f5f9; font-size: 14px; margin-top: 0;">Hi <strong>{{userName}}</strong>,</p>
    <p style="color: #cbd5e1; font-size: 13px;"><strong>{{authorName}}</strong> mentioned you on <strong>{{issueKey}}: {{issueTitle}}</strong>:</p>

    <div style="background-color: #0f172a; padding: 14px; border-radius: 8px; margin: 16px 0; border: 1px solid #334155; color: #e2e8f0; font-size: 13px; font-style: italic; line-height: 1.5;">
      "{{commentContent}}"
    </div>

    <div style="margin-top: 20px;">
      <a href="{{actionUrl}}" style="background-color: #2563eb; color: #ffffff; padding: 10px 22px; font-size: 13px; font-weight: 600; text-decoration: none; border-radius: 8px; display: inline-block;">Reply to Comment →</a>
    </div>
  </div>

  <div style="text-align: center; margin-top: 20px; color: #64748b; font-size: 11px;">
    Eitekh WorkOS Collaboration &bull; Sent to {{userName}}
  </div>
</div>
`.trim(),
  },
  {
    key: "PASSWORD_RESET",
    name: "Password Reset Request",
    description: "Sent when a user requests to reset their password",
    subject: "Reset your Eitekh WorkOS password 🔒",
    variables: JSON.stringify(["userName", "resetUrl", "expiresIn"]),
    bodyHtml: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 20px; background-color: #0f172a; color: #f8fafc; border-radius: 16px;">
  <div style="text-align: center; margin-bottom: 24px;">
    <h1 style="color: #ffffff; font-size: 20px; font-weight: 800;">Password Reset Request</h1>
  </div>

  <div style="background-color: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid #334155;">
    <p style="color: #f1f5f9; font-size: 14px; margin-top: 0;">Hi <strong>{{userName}}</strong>,</p>
    <p style="color: #cbd5e1; font-size: 13px; line-height: 1.5;">We received a request to reset your Eitekh WorkOS password. Click the button below to choose a new password. This link will expire in {{expiresIn}}.</p>

    <div style="margin: 24px 0; text-align: center;">
      <a href="{{resetUrl}}" style="background-color: #dc2626; color: #ffffff; padding: 12px 28px; font-size: 13px; font-weight: 600; text-decoration: none; border-radius: 8px; display: inline-block;">Reset Password</a>
    </div>

    <p style="color: #64748b; font-size: 11px; margin-bottom: 0;">If you did not make this request, your account is still secure and no changes were made.</p>
  </div>
</div>
`.trim(),
  },
  {
    key: "SPRINT_STARTED",
    name: "Sprint Started Notification",
    description: "Sent to team members when a project sprint is started",
    subject: "[{{projectName}}] Sprint {{sprintName}} is now Active! 🏁",
    variables: JSON.stringify(["userName", "projectName", "sprintName", "sprintGoal", "startDate", "endDate", "actionUrl"]),
    bodyHtml: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 20px; background-color: #0f172a; color: #f8fafc; border-radius: 16px;">
  <div style="background-color: #1e293b; padding: 24px; border-radius: 12px; border: 1px solid #334155;">
    <h2 style="color: #ffffff; font-size: 18px; margin-top: 0;">Sprint Started: {{sprintName}}</h2>
    <p style="color: #cbd5e1; font-size: 13px;">Project: <strong>{{projectName}}</strong></p>

    <div style="background-color: #0f172a; padding: 16px; border-radius: 8px; margin: 16px 0;">
      <p style="color: #94a3b8; font-size: 12px; margin: 0 0 6px 0;">Sprint Goal:</p>
      <p style="color: #f1f5f9; font-size: 14px; margin: 0; font-weight: 600;">{{sprintGoal}}</p>
      <div style="margin-top: 10px; font-size: 12px; color: #64748b;">Duration: {{startDate}} to {{endDate}}</div>
    </div>

    <div style="margin-top: 20px;">
      <a href="{{actionUrl}}" style="background-color: #2563eb; color: #ffffff; padding: 10px 22px; font-size: 13px; font-weight: 600; text-decoration: none; border-radius: 8px; display: inline-block;">Open Sprint Board →</a>
    </div>
  </div>
</div>
`.trim(),
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
  for (const [key, val] of Object.entries(variables)) {
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
      // In dev / unconfigured SMTP mode, simulate dispatch and log output
      console.log(`[Email Sent Mock] From: ${fromAddress} | To: ${to} | Subject: "${subject}"`);
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
