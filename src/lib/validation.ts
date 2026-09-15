import { z } from "zod";
import { NextResponse } from "next/server";

// ── Reusable field schemas ──────────────────────────────────────────

export const emailSchema = z
  .string()
  .min(1, "Email is required")
  .email("Invalid email address")
  .max(254)
  .transform((v) => v.toLowerCase().trim());

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(64, "Password must be at most 64 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

export const cuidSchema = z.string().min(1).max(50);
export const optionalCuidSchema = z.string().max(50).nullable().optional();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const searchQuerySchema = z
  .string()
  .min(2, "Search query must be at least 2 characters")
  .max(200);

const safeStringSchema = z.string().max(1000);
const safeLongStringSchema = z.string().max(50_000);

// ── Route-specific schemas ──────────────────────────────────────────

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(64),
});

export const registerSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100).trim(),
  lastName: z.string().min(1, "Last name is required").max(100).trim(),
  email: emailSchema,
  password: passwordSchema,
  company: z.string().max(200).trim().optional(),
  jobTitle: z.string().max(200).trim().optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required").max(256),
  newPassword: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(64),
  newPassword: passwordSchema,
});

export const profileUpdateSchema = z.object({
  firstName: z.string().min(1).max(100).trim().optional(),
  lastName: z.string().min(1).max(100).trim().optional(),
  jobTitle: safeStringSchema.trim().optional(),
  company: safeStringSchema.trim().optional(),
  timezone: z.string().max(100).optional(),
  language: z.string().max(10).optional(),
});

export const commentSchema = z.object({
  content: z.string().min(1, "Comment content is required").max(10_000).trim(),
});

const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
  "application/pdf",
  "text/plain", "text/csv", "text/markdown",
  "application/json",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/octet-stream",
]);

const MAX_ATTACHMENT_URL_LENGTH = 5 * 1024 * 1024; // ~5MB base64

export const attachmentSchema = z.object({
  fileName: z.string().min(1, "File name is required").max(255).trim(),
  fileSize: z.coerce.number().int().min(0).max(50 * 1024 * 1024).optional().default(0),
  mimeType: z
    .string()
    .max(100)
    .optional()
    .default("application/octet-stream")
    .refine((v) => ALLOWED_ATTACHMENT_TYPES.has(v), "Unsupported file type"),
  fileUrl: z
    .string()
    .min(1, "File URL is required")
    .max(MAX_ATTACHMENT_URL_LENGTH, "Attachment too large (max 5MB)"),
});

export const notificationPostSchema = z.object({
  recipientUserIds: z.array(z.string().max(50)).max(100).optional(),
  type: z.string().max(50).default("INFO"),
  title: z.string().min(1, "Title is required").max(500),
  message: z.string().min(1, "Message is required").max(5000),
  linkUrl: z.string().max(2000).optional(),
  projectId: z.string().max(50).optional(),
});

export const issueUpdateSchema = z.object({
  title: safeStringSchema.min(1).optional(),
  description: safeLongStringSchema.optional().nullable(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"]).optional(),
  issueType: z.enum(["BUG", "TASK", "STORY", "EPIC", "SUBTASK", "IMPROVEMENT", "FEATURE"]).optional(),
  statusId: cuidSchema.optional(),
  assigneeId: optionalCuidSchema,
  teamId: optionalCuidSchema,
  sprintId: optionalCuidSchema,
  epicId: optionalCuidSchema,
  componentId: optionalCuidSchema,
  parentIssueId: optionalCuidSchema,
  estimatePoints: z.coerce.number().min(0).max(1000).nullable().optional(),
  estimateHours: z.coerce.number().min(0).max(10000).nullable().optional(),
  remainingHours: z.coerce.number().min(0).max(10000).nullable().optional(),
  timeSpentHours: z.coerce.number().min(0).max(10000).nullable().optional(),
  startDate: z.string().max(50).nullable().optional(),
  dueDate: z.string().max(50).nullable().optional(),
  position: z.coerce.number().int().min(0).optional(),
  securityLevel: z.string().max(50).nullable().optional(),
}).passthrough();

export const projectUpdateSchema = z.object({
  name: safeStringSchema.min(1).optional(),
  description: safeLongStringSchema.optional().nullable(),
  status: z.string().max(50).optional(),
  priority: z.string().max(50).optional(),
  startDate: z.string().max(50).nullable().optional(),
  targetDate: z.string().max(50).nullable().optional(),
});

export const searchSchema = z.object({
  q: searchQuerySchema,
  type: z.enum(["all", "issues", "comments", "projects"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const projectMemberSchema = z.object({
  userId: z.string().max(50).optional(),
  email: z.string().email().max(254).optional(),
  firstName: z.string().max(100).trim().optional(),
  lastName: z.string().max(100).trim().optional(),
  password: z.string().max(64).optional(),
  role: z.string().max(50).optional(),
});

// ── Parsing helper ──────────────────────────────────────────────────

export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
): { success: true; data: z.infer<T> } | { success: false; error: NextResponse } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const firstError = result.error.issues[0];
  const message = firstError
    ? `${firstError.path.join(".")}: ${firstError.message}`.replace(/^: /, "")
    : "Invalid request body";
  return {
    success: false,
    error: NextResponse.json({ error: message }, { status: 400 }),
  };
}

export function parseQuery<T extends z.ZodTypeAny>(
  schema: T,
  params: URLSearchParams,
): { success: true; data: z.infer<T> } | { success: false; error: NextResponse } {
  const obj: Record<string, string> = {};
  params.forEach((v, k) => { obj[k] = v; });
  return parseBody(schema, obj);
}
