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

// ── Resource creation schemas ──────────────────────────────────────

export const projectCreateSchema = z.object({
  workspaceId: cuidSchema,
  name: safeStringSchema.min(1, "Project name is required").trim(),
  key: z.string().min(1, "Project key is required").max(10).regex(/^[A-Z0-9]+$/, "Key must be uppercase alphanumeric"),
  description: safeLongStringSchema.optional().nullable(),
  template: z.enum(["SCRUM", "KANBAN", "WATERFALL"]).default("SCRUM"),
  teamId: cuidSchema.optional(),
});

export const issueCreateSchema = z.object({
  title: safeStringSchema.min(1, "Title is required").trim(),
  description: safeLongStringSchema.optional().nullable(),
  issueType: z.enum(["BUG", "TASK", "STORY", "EPIC", "SUBTASK", "IMPROVEMENT", "FEATURE"]).default("TASK"),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"]).default("MEDIUM"),
  statusId: cuidSchema.optional(),
  assigneeId: optionalCuidSchema,
  teamId: optionalCuidSchema,
  epicId: optionalCuidSchema,
  sprintId: optionalCuidSchema,
  parentIssueId: optionalCuidSchema,
  componentId: optionalCuidSchema,
  securityLevel: z.string().max(50).default("PUBLIC"),
  estimatePoints: z.coerce.number().min(0).max(1000).nullable().optional(),
  estimateHours: z.coerce.number().min(0).max(10000).nullable().optional(),
  timeSpentHours: z.coerce.number().min(0).max(10000).nullable().optional(),
  startDate: z.string().max(50).nullable().optional(),
  dueDate: z.string().max(50).nullable().optional(),
  labels: z.array(z.string().max(100).trim()).max(50).default([]),
});

export const sprintCreateSchema = z.object({
  projectId: cuidSchema,
  name: safeStringSchema.min(1, "Sprint name is required").trim(),
  goal: safeStringSchema.trim().optional().nullable(),
  startDate: z.string().max(50).optional().nullable(),
  endDate: z.string().max(50).optional().nullable(),
});

export const sprintUpdateSchema = z.object({
  sprintId: cuidSchema,
  status: z.enum(["FUTURE", "ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  name: safeStringSchema.trim().optional(),
  goal: safeStringSchema.trim().optional().nullable(),
  startDate: z.string().max(50).optional().nullable(),
  endDate: z.string().max(50).optional().nullable(),
  retrospectiveNotes: safeLongStringSchema.trim().optional().nullable(),
  position: z.coerce.number().int().min(0).optional(),
  rolloverToSprintId: cuidSchema.optional().nullable(),
});

export const sprintReorderSchema = z.object({
  projectId: cuidSchema,
  sprintOrders: z.array(z.object({
    id: cuidSchema,
    position: z.coerce.number().int().min(0),
  })).max(200),
});

export const teamCreateSchema = z.object({
  projectId: cuidSchema.optional(),
  workspaceId: cuidSchema.optional(),
  name: safeStringSchema.min(1, "Team name is required").trim(),
  description: safeStringSchema.trim().optional().nullable(),
  leadId: cuidSchema.optional(),
});

export const workspaceCreateSchema = z.object({
  orgId: cuidSchema,
  name: safeStringSchema.min(1, "Workspace name is required").trim(),
  description: safeStringSchema.trim().optional().nullable(),
});

export const orgMemberCreateSchema = z.object({
  email: emailSchema,
  firstName: z.string().max(100).trim().optional(),
  lastName: z.string().max(100).trim().optional(),
  jobTitle: z.string().max(200).trim().optional(),
  password: z.string().max(64).optional(),
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
  projectIds: z.array(cuidSchema).max(100).optional(),
  projectRole: z.string().max(50).optional(),
});

export const orgMemberUpdateSchema = z.object({
  userId: cuidSchema,
  role: z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]),
});

export const bulkIssueUpdateSchema = z.object({
  issueIds: z.array(cuidSchema).min(1).max(500),
  updates: z.object({
    statusId: cuidSchema.optional(),
    priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"]).optional(),
    assigneeId: z.string().max(50).nullable().optional(),
    teamId: z.string().max(50).nullable().optional(),
    sprintId: z.string().max(50).nullable().optional(),
    epicId: z.string().max(50).nullable().optional(),
    dueDate: z.string().max(50).nullable().optional(),
  }).refine(obj => Object.keys(obj).length > 0, "At least one update field is required"),
});

export const bulkIssueDeleteSchema = z.object({
  issueIds: z.array(cuidSchema).min(1).max(500),
});

export const epicCreateSchema = z.object({
  projectId: cuidSchema,
  name: safeStringSchema.min(1, "Epic name is required").trim(),
  summary: safeStringSchema.trim().optional().nullable(),
  color: z.string().max(20).regex(/^#[0-9a-fA-F]{3,8}$/, "Invalid color").default("#3b82f6"),
  ownerId: cuidSchema.optional(),
  startDate: z.string().max(50).optional().nullable(),
  targetDate: z.string().max(50).optional().nullable(),
});

export const commentUpdateSchema = z.object({
  content: z.string().min(1, "Comment content is required").max(10_000).trim(),
});

export const workspaceUpdateSchema = z.object({
  name: safeStringSchema.min(1).trim().optional(),
  description: safeStringSchema.trim().optional().nullable(),
  isArchived: z.boolean().optional(),
});

export const workspaceMemberSchema = z.object({
  userId: cuidSchema,
  role: z.enum(["WORKSPACE_ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
});

export const teamUpdateSchema = z.object({
  name: safeStringSchema.min(1).trim().optional(),
  description: safeStringSchema.trim().optional().nullable(),
  leadId: cuidSchema.optional().nullable(),
});

export const teamMemberSchema = z.object({
  userId: cuidSchema,
  role: z.enum(["LEAD", "MEMBER"]).default("MEMBER"),
});

export const epicUpdateSchema = z.object({
  name: safeStringSchema.min(1).trim().optional(),
  summary: safeStringSchema.trim().optional().nullable(),
  color: z.string().max(20).regex(/^#[0-9a-fA-F]{3,8}$/, "Invalid color").optional(),
  status: z.string().max(50).optional(),
  ownerId: cuidSchema.optional().nullable(),
  startDate: z.string().max(50).optional().nullable(),
  targetDate: z.string().max(50).optional().nullable(),
});

export const subtaskCreateSchema = z.object({
  title: safeStringSchema.min(1, "Subtask title is required").trim(),
  assigneeId: cuidSchema.optional().nullable(),
  estimateHours: z.coerce.number().min(0).max(10000).optional().nullable(),
  dueDate: z.string().max(50).optional().nullable(),
});

export const subtaskUpdateSchema = z.object({
  title: safeStringSchema.trim().optional(),
  assigneeId: cuidSchema.optional().nullable(),
  priority: z.string().max(50).optional(),
  estimateHours: z.coerce.number().min(0).max(10000).optional().nullable(),
  dueDate: z.string().max(50).optional().nullable(),
  isCompleted: z.boolean().optional(),
  status: z.string().max(50).optional(),
});

export const timeEntryCreateSchema = z.object({
  durationMinutes: z.coerce.number().int().min(1, "Valid duration is required").max(1440),
  description: safeStringSchema.trim().optional().nullable(),
  workDate: z.string().max(50).optional(),
});

export const dependencyCreateSchema = z.object({
  targetIssueId: cuidSchema,
  type: z.enum(["BLOCKS", "BLOCKED_BY", "RELATES_TO", "DUPLICATES", "FINISH_TO_START", "START_TO_START"]),
});

export const dependencyDeleteSchema = z.object({
  dependencyId: cuidSchema,
});

export const watcherSchema = z.object({
  userId: cuidSchema.optional(),
});

// ── Workflow schemas ───────────────────────────────────────────────

export const workflowCreateSchema = z.object({
  projectId: cuidSchema,
  name: safeStringSchema.min(1, "Workflow name is required").trim(),
});

export const workflowUpdateSchema = z.object({
  name: safeStringSchema.trim().optional(),
  isDefault: z.boolean().optional(),
});

export const workflowStatusCreateSchema = z.object({
  name: safeStringSchema.min(1, "Status name is required").trim(),
  category: z.string().max(50).default("TO_DO"),
  color: z.string().max(20).regex(/^#[0-9a-fA-F]{3,8}$/, "Invalid color").default("#6b7280"),
  position: z.coerce.number().int().min(0).default(0),
  wipLimit: z.coerce.number().int().min(0).nullable().optional(),
});

export const workflowStatusUpdateSchema = z.object({
  statusId: cuidSchema,
  name: safeStringSchema.trim().optional(),
  color: z.string().max(20).regex(/^#[0-9a-fA-F]{3,8}$/, "Invalid color").optional(),
  position: z.coerce.number().int().min(0).optional(),
  wipLimit: z.coerce.number().int().min(0).nullable().optional(),
});

export const workflowStatusDeleteSchema = z.object({
  statusId: cuidSchema,
});

// ── Custom field schemas ──────────────────────────────────────────

export const customFieldCreateSchema = z.object({
  scopeType: z.enum(["PROJECT", "ORG"]),
  scopeId: cuidSchema,
  name: safeStringSchema.min(1, "Field name is required").trim(),
  fieldType: z.string().min(1, "Field type is required").max(50),
  optionsJson: z.string().max(10_000).nullable().optional(),
  isRequired: z.boolean().default(false),
});

export const customFieldUpdateSchema = z.object({
  name: safeStringSchema.trim().optional(),
  optionsJson: z.string().max(10_000).nullable().optional(),
  isRequired: z.boolean().optional(),
});

export const customFieldValueSchema = z.object({
  values: z.array(z.object({
    customFieldId: cuidSchema,
    valueString: z.string().max(5000).nullable().optional(),
    valueNumber: z.coerce.number().nullable().optional(),
    valueDate: z.string().max(50).nullable().optional(),
    valueJson: z.string().max(10_000).nullable().optional(),
  })).max(100),
});

// ── Automation schemas ────────────────────────────────────────────

export const automationCreateSchema = z.object({
  projectId: cuidSchema,
  name: safeStringSchema.min(1, "Automation name is required").trim(),
  triggerType: z.string().min(1, "Trigger type is required").max(100),
  triggerConfig: z.string().max(10_000).nullable().optional(),
  conditionRules: z.string().max(10_000).nullable().optional(),
  actionType: z.string().min(1, "Action type is required").max(100),
  actionConfig: z.string().max(10_000).nullable().optional(),
});

export const automationUpdateSchema = z.object({
  name: safeStringSchema.trim().optional(),
  triggerConfig: z.string().max(10_000).nullable().optional(),
  conditionRules: z.string().max(10_000).nullable().optional(),
  actionConfig: z.string().max(10_000).nullable().optional(),
  isActive: z.boolean().optional(),
});

// ── Webhook schemas ───────────────────────────────────────────────

export const webhookCreateSchema = z.object({
  orgId: cuidSchema,
  projectId: cuidSchema.optional().nullable(),
  targetUrl: z.string().min(1, "Target URL is required").max(2000).url("Must be a valid URL"),
  secret: z.string().min(1, "Secret is required").max(500),
  events: z.union([
    z.array(z.string().max(100)).max(50),
    z.string().max(5000),
  ]),
  isActive: z.boolean().default(true),
});

export const webhookUpdateSchema = z.object({
  targetUrl: z.string().max(2000).url("Must be a valid URL").optional(),
  secret: z.string().max(500).optional(),
  events: z.union([
    z.array(z.string().max(100)).max(50),
    z.string().max(5000),
  ]).optional(),
  isActive: z.boolean().optional(),
});

// ── Component schemas ─────────────────────────────────────────────

export const componentCreateSchema = z.object({
  projectId: cuidSchema,
  name: safeStringSchema.min(1, "Component name is required").trim(),
  description: safeStringSchema.trim().optional().nullable(),
  ownerId: cuidSchema.optional(),
});

export const componentUpdateSchema = z.object({
  name: safeStringSchema.min(1).trim().optional(),
  description: safeStringSchema.trim().optional().nullable(),
  ownerId: cuidSchema.optional().nullable(),
});

// ── Org schemas ───────────────────────────────────────────────────

export const orgUpdateSchema = z.object({
  name: safeStringSchema.min(1).trim().optional(),
  domain: z.string().max(255).trim().optional(),
  timezone: z.string().max(100).optional(),
  language: z.string().max(10).optional(),
  dateFormat: z.string().max(50).optional(),
  workingDays: z.string().max(100).optional(),
  workingHours: z.string().max(100).optional(),
});

export const orgRoleCreateSchema = z.object({
  name: safeStringSchema.min(1, "Role name is required").trim(),
  description: safeStringSchema.trim().optional(),
  scope: z.enum(["PROJECT", "ORG", "WORKSPACE"]).default("ORG"),
  permissions: z.array(z.string().max(100)).max(200).default([]),
});

// ── Recurring task schemas ────────────────────────────────────────

export const recurringTaskCreateSchema = z.object({
  projectId: cuidSchema,
  scheduleCron: z.string().min(1, "Cron schedule is required").max(100),
  templateData: z.any(),
  isActive: z.boolean().default(true),
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
