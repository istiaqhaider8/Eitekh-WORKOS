import { z } from "zod";
import { NextResponse } from "next/server";
import { RECURRENCE_VALUES } from "./recurrence";
import {
  ACTIVATE_DECISIONS,
  ACTIVATE_BUILD_TYPES,
  ACTIVATE_PRIORITIES,
  ACTIVATE_SIZES,
  ACTIVATE_DECISION_STATUSES,
} from "./activate-generation";

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

/**
 * The SHAPE of an issue type or priority value. Membership is checked in the
 * route, against the project.
 *
 * These were `z.enum([...])` with the five built-in types and five built-in
 * priorities hard-coded. Both are per-project configurable — `PROJECT_ISSUE_TYPES`
 * and `PROJECT_PRIORITIES` custom fields, written by
 * `/api/projects/[id]/types` and `/api/projects/[id]/priorities` — so a value
 * could be defined, offered in the UI, and then rejected on first use:
 *
 *     POST /api/projects/{id}/issues  {"issueType":"REQUIREMENT"}
 *     -> 400  issueType: Invalid option: expected one of "BUG"|"TASK"|...
 *
 * A static schema cannot know what a project has configured. So it validates
 * what it CAN — that the value is an upper-case token of the shape the types
 * route produces (`.toUpperCase().replace(/[^A-Z0-9_]/g, "_")`) and is
 * bounded — and the route asks the project whether it is allowed.
 *
 * This is the same split the codebase already uses for `statusId`: zod checks
 * it is a cuid, the route checks it belongs to this project's workflow. Shape
 * here, membership there. Loosening the schema WITHOUT the route check would
 * make this worse than the bug it fixes, so the two must land together.
 */
export const issueTypeTokenSchema = z
  .string()
  .trim()
  .min(1, "Issue type is required")
  .max(50, "Issue type is too long")
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z0-9_]+$/.test(v), "Issue type must be letters, digits or underscores");

export const priorityTokenSchema = z
  .string()
  .trim()
  .min(1, "Priority is required")
  .max(50, "Priority is too long")
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z0-9_]+$/.test(v), "Priority must be letters, digits or underscores");

export const cuidSchema = z.string().min(1).max(50);
export const optionalCuidSchema = z.string().max(50).nullable().optional();

/**
 * A PBAC role id, e.g. `role_<orgId>_<slug>` for a system role and
 * `role_<orgId>_<slug>_<timestamp>` for one created through the admin UI.
 *
 * These are not cuids and they are long: a system id runs to ~46 characters and
 * a custom one to ~64. Validating them with cuidSchema (max 50) let a system
 * role through but rejected every custom role with a 400, so a role could be
 * created and then never edited.
 */
export const pbacRoleIdSchema = z.string().min(1).max(200);

/**
 * User.userType — the single source of truth for the allowed values.
 *
 * EMPLOYEE is internal staff; CLIENT is an external customer contact. The
 * database enforces the same pair with a CHECK constraint (migration
 * 0005_user_type), so a value that slips past the API is still refused by
 * SQLite rather than stored.
 */
export const USER_TYPES = ["EMPLOYEE", "CLIENT"] as const;
export type UserType = (typeof USER_TYPES)[number];
export const DEFAULT_USER_TYPE: UserType = "EMPLOYEE";
export const userTypeSchema = z.enum(USER_TYPES);

/** Human label for a userType, for UI use. */
export function userTypeLabel(value?: string | null): string {
  return value === "CLIENT" ? "Client" : "Employee";
}

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
    .max(MAX_ATTACHMENT_URL_LENGTH, "Attachment too large (max 5MB)")
    .refine((url) => {
      const lower = url.toLowerCase().trim();
      return (
        lower.startsWith("https://") ||
        lower.startsWith("http://") ||
        lower.startsWith("data:image/") ||
        lower.startsWith("data:application/pdf") ||
        lower.startsWith("data:application/octet-stream") ||
        lower.startsWith("/")
      );
    }, "Invalid or unsafe file URL"),
});

export const notificationPostSchema = z.object({
  recipientUserIds: z.array(z.string().max(50)).max(100).optional(),
  type: z.string().max(50).default("INFO"),
  title: z.string().min(1, "Title is required").max(500),
  message: z.string().min(1, "Message is required").max(5000),
  linkUrl: z.string().max(2000).optional(),
  projectId: z.string().max(50).optional(),
});

/**
 * B1 / M4 — the version the client last read, on every route that has one.
 *
 * Optional, deliberately. Making it required would break every existing client
 * and every script the moment it shipped, and a 400 for a missing field is a
 * worse failure than the one being fixed. When it IS sent, a mismatch is a 409
 * rather than a silent overwrite — so a client opts into conflict detection by
 * sending back what it read.
 *
 * ABSENT IS THE ONLY THING THAT MEANS "DO NOT CHECK", which is why this is not
 * a bare `z.coerce.number().optional()`. `z.coerce` sends `null` through
 * `Number()` and gets 0, so `{"version": null}` — which is what a client with
 * no version loaded naturally serialises — would have meant "I expect version
 * 0" rather than "I have none". On a row past 0 that is a spurious 409; on a
 * fresh row it is an unguarded write that looks guarded. Both are worse than
 * either honest answer, so null and "" are mapped to absent explicitly, and
 * anything else unparseable is a 400 rather than being quietly dropped.
 *
 * This lives here, once, because it is a validation rule. An earlier draft
 * also parsed `version` inside `optimistic-lock.ts`, which would have been two
 * validators for one field — the duplication that module exists to remove.
 */
export const optimisticVersionField = z.preprocess(
  (v) => (v === null || v === "" ? undefined : v),
  z.coerce.number().int().min(0).optional()
);

export const issueUpdateSchema = z.object({
  title: safeStringSchema.min(1).optional(),
  description: safeLongStringSchema.optional().nullable(),
  priority: priorityTokenSchema.optional(),
  issueType: issueTypeTokenSchema.optional(),
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
  version: optimisticVersionField,
}).passthrough();

export const projectUpdateSchema = z.object({
  name: safeStringSchema.min(1).optional(),
  description: safeLongStringSchema.optional().nullable(),
  status: z.string().max(50).optional(),
  priority: z.string().max(50).optional(),
  startDate: z.string().max(50).nullable().optional(),
  targetDate: z.string().max(50).nullable().optional(),
  // M4 — see optimisticVersionField.
  version: optimisticVersionField,
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
  // Only meaningful when inviting a NEW person: it classifies the account being
  // created. Ignored when assigning someone who already exists, whose type is
  // an attribute of their account, not of this project.
  userType: userTypeSchema.optional(),
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
  issueType: issueTypeTokenSchema.default("TASK"),
  priority: priorityTokenSchema.default("MEDIUM"),
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
  // M4 — see optimisticVersionField.
  version: optimisticVersionField,
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

// ── Invitation and OTP schemas ──────────────────────────────────────
//
// These four routes read `await req.json()` and destructured it directly, with
// only ad-hoc truthiness checks. Three of them are unauthenticated. The gap was
// not cosmetic:
//
//  * auth/invite accepted `role` verbatim with no validation and no check on
//    the inviter's own role, and auth/invitation then creates the
//    OrganizationMember with `role: invitation.role`. An organization MEMBER
//    could therefore mint an OWNER invitation -- verified against the running
//    app -- and a nonsense value such as "GOD_MODE" was stored as-is.
//  * auth/invitation checked only `password.length < 8`, so accepting an
//    invitation bypassed the upper/lower/digit/symbol policy that
//    registration enforces through passwordSchema.
//  * every one of them would 500 rather than 400 on a non-string field, because
//    `.trim()` / `.toLowerCase()` was called on whatever arrived.

/** Organization roles an invitation may carry. */
export const ORG_ROLES = ["OWNER", "ADMIN", "MEMBER", "GUEST"] as const;
export const orgRoleSchema = z.enum(ORG_ROLES);

export const invitationCreateSchema = z.object({
  email: emailSchema,
  orgId: cuidSchema,
  workspaceId: optionalCuidSchema,
  projectId: optionalCuidSchema,
  // Constrained to the known roles. Whether the INVITER may grant this
  // particular role is a separate, authorization question, enforced in the
  // route -- a schema cannot know who is asking.
  role: orgRoleSchema.default("MEMBER"),
});

export const invitationAcceptSchema = z.object({
  token: z.string().min(1, "Invitation token is required").max(256),
  firstName: z.string().min(1, "First name is required").max(100).trim(),
  lastName: z.string().min(1, "Last name is required").max(100).trim(),
  // The same policy registration uses. Accepting an invitation was the one way
  // into the product with a weaker password than the product demands.
  password: passwordSchema,
});

export const OTP_PURPOSES = ["REGISTRATION", "PASSWORD_RESET"] as const;
export const otpPurposeSchema = z.enum(OTP_PURPOSES);

export const otpRequestSchema = z.object({
  email: emailSchema,
  purpose: otpPurposeSchema,
});

export const otpVerifySchema = z.object({
  email: emailSchema,
  /**
   * Six digits. Bounding the length also stops a caller submitting a huge
   * string to the hash comparison.
   *
   * This was `/^d{6}$/` — `d` rather than `\d`, so it matched the literal
   * string "dddddd" and nothing else. Every OTP the application has ever
   * issued was rejected here before `verifyOtp` was reached, which made
   * registration and password reset structurally impossible to complete. The
   * user-visible symptom was "Code must be 6 digits" shown against a code
   * that was six digits.
   *
   * One character, and no test covered it. `validation.test.ts` now asserts a
   * real code passes and that the message is not a lie.
   */
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
  purpose: otpPurposeSchema,
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
    priority: priorityTokenSchema.optional(),
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
  // M4 — see optimisticVersionField.
  version: optimisticVersionField,
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
  // M4 — see optimisticVersionField.
  version: optimisticVersionField,
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
  // M4 — see optimisticVersionField.
  version: optimisticVersionField,
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
  // M4 — see optimisticVersionField.
  version: optimisticVersionField,
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

/**
 * C1 — the body of a delivery replay.
 *
 * One field, but it is an id used to look a row up, so it goes through the
 * same gate as everything else. `cuidSchema` rather than `z.string()` because
 * the alternative is a free-form value reaching a `findFirst` — and the route
 * checker exists precisely to stop "it's only one string" reasoning.
 */
/** C2 — the body of an outbox replay. */
export const emailOutboxReplaySchema = z.object({
  id: cuidSchema,
});

export const webhookReplaySchema = z.object({
  deliveryId: cuidSchema,
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

// ── PBAC schemas (security-critical) ─────────────────────────────

// `projectId` and `projectName` are nullable, not merely optional. An ORG-scoped
// role has no project, and the role editor sends an explicit `null` for it
// rather than omitting the field. With `.optional()` alone that null was
// rejected — "projectId: Invalid input: expected string, received null" — so
// creating a role failed with a 400 for every role that was not tied to a
// project, which is the common case.
export const pbacRoleCreateSchema = z.object({
  orgId: cuidSchema.optional(),
  id: pbacRoleIdSchema.optional(),
  name: safeStringSchema.min(1, "Role name is required").trim(),
  description: safeStringSchema.trim().optional(),
  scope: z.enum(["PROJECT", "ORG", "WORKSPACE"]).optional(),
  projectId: optionalCuidSchema,
  projectName: safeStringSchema.trim().nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  permissions: z.array(z.string().max(100)).max(500).default([]),
  cloneFromId: pbacRoleIdSchema.optional(),
});

export const pbacRoleUpdateSchema = z.object({
  orgId: cuidSchema.optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  name: safeStringSchema.trim().optional(),
  description: safeStringSchema.trim().optional(),
  permissions: z.array(z.string().max(100)).max(500).optional(),
  scope: z.enum(["PROJECT", "ORG", "WORKSPACE"]).optional(),
  projectId: optionalCuidSchema,
  projectName: safeStringSchema.trim().nullable().optional(),
});

export const pbacRoleUsersSchema = z.object({
  orgId: cuidSchema.optional(),
  userId: cuidSchema.optional(),
  userIds: z.array(cuidSchema).max(500).optional(),
});

export const pbacBulkUserActionSchema = z.object({
  orgId: cuidSchema.optional(),
  action: z.enum(["ASSIGN_ROLE", "REMOVE_ROLE"]).optional(),
  userIds: z.array(cuidSchema).min(1).max(500),
  roleId: cuidSchema.optional(),
  simulate: z.boolean().optional(),
});

export const pbacUserRolesUpdateSchema = z.object({
  orgId: cuidSchema.optional(),
  roleIds: z.array(cuidSchema).max(200),
});

export const pbacClassicActionSchema = z.object({
  userId: cuidSchema,
  projectId: cuidSchema,
  role: z.string().max(50).optional(),
  action: z.string().max(50).optional(),
});

export const recurringTaskCreateSchema = z.object({
  projectId: cuidSchema,
  /**
   * Named "cron" and never a cron expression: the schema comment has always
   * said DAILY | WEEKLY | MONTHLY and those are the only values the product
   * produces. An enum here means no NEW row can be ambiguous; existing rows
   * holding something else still run, daily and with a warning.
   */
  scheduleCron: z.enum(RECURRENCE_VALUES),
  templateData: z.any(),
  isActive: z.boolean().default(true),
});

// ── Super-admin schemas ───────────────────────────────────────────

export const superAdminUserCreateSchema = z.object({
  email: emailSchema,
  firstName: z.string().max(100).trim().optional(),
  lastName: z.string().max(100).trim().optional(),
  jobTitle: z.string().max(200).trim().optional(),
  company: z.string().max(200).trim().optional(),
  timezone: z.string().max(100).optional(),
  language: z.string().max(10).optional(),
  orgId: cuidSchema.optional(),
  role: z.string().max(50).optional(),
  isSuperAdmin: z.boolean().optional(),
  password: z.string().max(64).optional(),
  status: z.string().max(50).optional(),
  userType: userTypeSchema.optional(),
});

export const superAdminUserUpdateSchema = z.object({
  userId: cuidSchema,
  firstName: z.string().max(100).trim().optional(),
  lastName: z.string().max(100).trim().optional(),
  email: z.string().email().max(254).optional(),
  jobTitle: z.string().max(200).trim().optional(),
  company: z.string().max(200).trim().optional(),
  timezone: z.string().max(100).optional(),
  language: z.string().max(10).optional(),
  status: z.string().max(50).optional(),
  isSuperAdmin: z.boolean().optional(),
  password: z.string().max(64).optional(),
  resetMfa: z.boolean().optional(),
  revokeSessions: z.boolean().optional(),
  orgId: cuidSchema.optional(),
  role: z.string().max(50).optional(),
  userType: userTypeSchema.optional(),
});

export const superAdminSecurityActionSchema = z.object({
  action: z.enum(["SUSPEND_USER", "ACTIVATE_USER", "REVOKE_SESSION", "REVOKE_ALL_SESSIONS"]),
  targetUserId: cuidSchema.optional(),
  sessionId: cuidSchema.optional(),
});

export const superAdminOrgCreateSchema = z.object({
  name: safeStringSchema.min(1, "Organization name is required").trim(),
  slug: z.string().max(100).trim().optional(),
  domain: z.string().max(255).trim().optional(),
  timezone: z.string().max(100).optional(),
  language: z.string().max(10).optional(),
});

export const superAdminOrgUpdateSchema = z.object({
  orgId: cuidSchema,
  name: safeStringSchema.trim().optional(),
  slug: z.string().max(100).trim().optional(),
  domain: z.string().max(255).trim().optional(),
  status: z.string().max(50).optional(),
  timezone: z.string().max(100).optional(),
  language: z.string().max(10).optional(),
  dateFormat: z.string().max(50).optional(),
  workingDays: z.string().max(100).optional(),
  workingHours: z.string().max(100).optional(),
});

export const superAdminProjectCreateSchema = z.object({
  workspaceId: cuidSchema,
  name: safeStringSchema.min(1, "Project name is required").trim(),
  key: z.string().min(1, "Project key is required").max(10).trim(),
  description: safeLongStringSchema.trim().optional().nullable(),
  template: z.enum(["SCRUM", "KANBAN", "WATERFALL"]).default("SCRUM"),
  status: z.string().max(50).default("ACTIVE"),
  priority: z.string().max(50).default("MEDIUM"),
  startDate: z.string().max(50).optional().nullable(),
  targetDate: z.string().max(50).optional().nullable(),
});

export const superAdminProjectUpdateSchema = z.object({
  projectId: cuidSchema,
  name: safeStringSchema.trim().optional(),
  key: z.string().max(10).trim().optional(),
  description: safeLongStringSchema.trim().optional().nullable(),
  template: z.string().max(50).optional(),
  status: z.string().max(50).optional(),
  priority: z.string().max(50).optional(),
  startDate: z.string().max(50).optional().nullable(),
  targetDate: z.string().max(50).optional().nullable(),
  workspaceId: cuidSchema.optional(),
});

export const superAdminWorkspaceCreateSchema = z.object({
  orgId: cuidSchema,
  name: safeStringSchema.min(1, "Workspace name is required").trim(),
  slug: z.string().max(100).trim().optional(),
  description: safeStringSchema.trim().optional().nullable(),
});

export const superAdminWorkspaceUpdateSchema = z.object({
  workspaceId: cuidSchema,
  name: safeStringSchema.trim().optional(),
  slug: z.string().max(100).trim().optional(),
  description: safeStringSchema.trim().optional().nullable(),
  isArchived: z.boolean().optional(),
  orgId: cuidSchema.optional(),
});

export const superAdminFeatureCreateSchema = z.object({
  key: z.string().min(1, "Feature flag key is required").max(200).trim(),
  description: safeStringSchema.trim().optional().nullable(),
  isGlobalEnabled: z.boolean().default(true),
});

export const superAdminFeatureUpdateSchema = z.object({
  key: z.string().min(1, "key is required").max(200),
  isGlobalEnabled: z.boolean().optional(),
  description: safeStringSchema.trim().optional().nullable(),
});

// Audience targeting for announcements. The kinds and their allowed values live
// in lib/announcement-targeting.ts, which is also what resolves a match, so the
// request shape and the resolver cannot drift apart.
export const announcementTargetSchema = z.object({
  kind: z.enum(["ORG", "PROJECT", "TEAM", "USER", "USER_TYPE", "ORG_ROLE", "PROJECT_ROLE"]),
  value: z.string().min(1, "Target value is required").max(100).trim(),
});

export const announcementAudienceFields = {
  audienceMode: z.enum(["ALL", "FILTERED"]).default("ALL"),
  matchMode: z.enum(["ANY", "ALL"]).default("ANY"),
  // Bounded so one request cannot store an unbounded audience.
  targets: z.array(announcementTargetSchema).max(200).default([]),
};

export const superAdminAnnouncementCreateSchema = z.object({
  title: safeStringSchema.min(1, "Announcement title is required").trim(),
  message: safeLongStringSchema.min(1, "Announcement message is required").trim(),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]).default("INFO"),
  targetAudience: z.enum(["ALL", "ORGS", "USERS"]).default("ALL"),
  isActive: z.boolean().default(true),
  startsAt: z.string().max(50).optional().nullable(),
  expiresAt: z.string().max(50).optional().nullable(),
  broadcast: z.boolean().default(false),
  ...announcementAudienceFields,
});

export const superAdminAnnouncementUpdateSchema = z.object({
  id: cuidSchema,
  title: safeStringSchema.trim().optional(),
  message: safeLongStringSchema.trim().optional(),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]).optional(),
  targetAudience: z.enum(["ALL", "ORGS", "USERS"]).optional(),
  isActive: z.boolean().optional(),
  startsAt: z.string().max(50).optional().nullable(),
  expiresAt: z.string().max(50).optional().nullable(),
  audienceMode: z.enum(["ALL", "FILTERED"]).optional(),
  matchMode: z.enum(["ANY", "ALL"]).optional(),
  // Omitted leaves the existing audience untouched; [] clears it.
  targets: z.array(announcementTargetSchema).max(200).optional(),
});

export const superAdminEmailTemplateResetSchema = z.object({
  resetAll: z.boolean().optional(),
});

export const superAdminEmailTemplateUpdateSchema = z.object({
  subject: safeStringSchema.trim().optional(),
  bodyHtml: safeLongStringSchema.optional(),
  resetToDefault: z.boolean().optional(),
});

export const superAdminEmailTemplatePreviewSchema = z.object({
  sampleVariables: z.record(z.string(), z.string().max(2000)).optional().default({}),
});

export const superAdminSyncMonitorActionSchema = z.object({
  projectId: z.string().max(200).optional(),
  message: safeStringSchema.optional(),
});

export const superAdminSecurityThreatUpdateSchema = z.object({
  threatId: z.string().min(1, "Missing threatId").max(200),
  status: z.enum(["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED", "FALSE_POSITIVE"]),
  note: safeStringSchema.optional(),
});

export const superAdminJobActionSchema = z.object({
  action: z.enum(["TRIGGER_RECURRING_TASK", "RETRY_EMAIL"]),
  taskId: cuidSchema.optional(),
  ruleId: cuidSchema.optional(),
  emailLogId: cuidSchema.optional(),
});

export const superAdminEmailSettingsUpdateSchema = z.object({
  senderEmail: z.string().email().max(254).optional(),
  senderName: safeStringSchema.trim().optional(),
  smtpHost: z.string().max(255).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpUser: z.string().max(254).optional(),
  smtpPass: z.string().max(500).optional(),
  isSecure: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
});

export const superAdminEmailTestSchema = z.object({
  to: z.string().email().max(254).optional(),
});

// ── Auth schemas ─────────────────────────────────────────────────

export const mfaToggleSchema = z.object({
  enabled: z.boolean(),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, "Verification token is required").max(256),
});

export const sessionDeleteSchema = z.object({
  sessionId: cuidSchema.optional(),
  revokeAll: z.boolean().optional(),
});

// ── Notification action schemas ──────────────────────────────────

export const notificationMarkReadSchema = z.object({
  id: cuidSchema.optional(),
  ids: z.array(cuidSchema).max(500).optional(),
  markAllRead: z.boolean().optional(),
});

// ── Workflow transition schemas ──────────────────────────────────

export const workflowTransitionCreateSchema = z.object({
  fromStatusId: cuidSchema,
  toStatusId: cuidSchema,
  requiredRole: z.string().max(50).optional().nullable(),
});

export const workflowTransitionDeleteSchema = z.object({
  transitionId: cuidSchema,
});

// ── Project type/priority schemas ────────────────────────────────

export const issueTypeCreateSchema = z.object({
  name: safeStringSchema.min(1, "Type name is required").trim(),
  color: z.string().max(20).optional(),
  icon: z.string().max(50).optional(),
  description: safeStringSchema.trim().optional(),
  value: z.string().max(50).optional(),
});

export const issueTypeUpdateSchema = z.object({
  originalValue: z.string().min(1, "originalValue is required").max(50),
  name: safeStringSchema.trim().optional(),
  color: z.string().max(20).optional(),
  icon: z.string().max(50).optional(),
  description: safeStringSchema.trim().optional(),
  newValue: z.string().max(50).optional(),
});

export const priorityCreateSchema = z.object({
  name: safeStringSchema.min(1, "Priority name is required").trim(),
  color: z.string().max(20).optional(),
});

// ── Import schema ────────────────────────────────────────────────

export const csvImportSchema = z.object({
  csvData: z.string().min(1, "Missing csvData").max(5_000_000),
});


// ── Bulk import schemas ──────────────────────────────────────────
// mode defaults to "validate" so an omitted mode previews rather than writes.
// Getting this default backwards would mean an accidental import.
export const bulkTaskImportSchema = z.object({
  csvData: z.string().min(1, "Missing csvData").max(5_000_000),
  mode: z.enum(["validate", "import"]).default("validate"),
});

export const bulkMemberImportSchema = z.object({
  csvData: z.string().min(1, "Missing csvData").max(2_000_000),
  mode: z.enum(["validate", "import"]).default("validate"),
});

// ── Member action schemas (delete/role update) ───────────────────

export const memberUserIdSchema = z.object({
  userId: cuidSchema,
  role: z.string().max(50).optional(),
});

// ── Recurring task update schema ─────────────────────────────────

export const recurringTaskUpdateSchema = z.object({
  scheduleCron: z.string().max(100).optional(),
  templateData: z.any().optional(),
  isActive: z.boolean().optional(),
});

// ── Leave schemas ────────────────────────────────────────────────

export const leaveCreateSchema = z.object({
  orgId: cuidSchema.optional(),
  userId: cuidSchema.optional(),
  startDate: z.string().min(1, "Start date is required").max(50),
  endDate: z.string().min(1, "End date is required").max(50),
  leaveType: safeStringSchema.optional(),
  note: safeStringSchema.optional().nullable(),
});

export const leaveUpdateSchema = z.object({
  startDate: z.string().max(50).optional(),
  endDate: z.string().max(50).optional(),
  leaveType: safeStringSchema.optional(),
  note: safeStringSchema.optional().nullable(),
});

// ── Delegation schemas ───────────────────────────────────────────

export const delegationCreateSchema = z.object({
  leaveId: cuidSchema.optional().nullable(),
  delegateUserId: cuidSchema,
  scope: z.string().max(50).optional(),
  issueIds: z.array(cuidSchema).max(500).optional(),
  startDate: z.string().min(1, "Start date is required").max(50),
  endDate: z.string().min(1, "End date is required").max(50),
  reason: safeStringSchema.optional(),
});

export const delegationUpdateSchema = z.object({
  status: z.string().max(50).optional(),
  action: z.string().max(50).optional(),
  details: safeStringSchema.optional(),
});

// ── Cache refresh schema ─────────────────────────────────────────

export const cacheRefreshSchema = z.object({
  action: z.enum(["REFRESH_SESSION", "CLEAR_CLIENT_CACHE", "REFRESH_APP_DATA", "CLEAR_SERVER_CACHE", "REBUILD_ANALYTICS_CACHE", "REFRESH_REALTIME", "FULL_SYSTEM_REFRESH", "BUMP_CACHE_VERSION"]),
  orgId: cuidSchema.optional(),
  projectId: cuidSchema.optional(),
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

/**
 * Read and validate a JSON request body in one step.
 *
 * `parseBody(schema, await req.json())` was the established pattern, but
 * `req.json()` throws a SyntaxError on a malformed body BEFORE validation runs,
 * which propagated to each route's catch block and surfaced as a 500. A client
 * sending bad JSON is a client error, so it must be a 400.
 */
export async function parseJsonBody<T extends z.ZodTypeAny>(
  req: { json: () => Promise<unknown> },
  schema: T,
): Promise<{ success: true; data: z.infer<T> } | { success: false; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      success: false,
      error: NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 }),
    };
  }
  return parseBody(schema, raw);
}

// ── SAP Activate ─────────────────────────────────────────────────

export const activateEnableSchema = z.object({
  enabled: z.boolean(),
  /**
   * Which methodology template to seed from. Omitted means the built-in one,
   * which is what every caller sent before templates existed — so the field is
   * optional rather than required, and the old request shape still means
   * exactly what it used to.
   */
  templateId: optionalCuidSchema,
});

/**
 * Phase status values.
 *
 * A closed set, unlike issue types: these are the methodology's own states,
 * not a project's vocabulary, so there is nothing for a customer to extend
 * and an enum is the honest representation.
 */
export const ACTIVATE_PHASE_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "SKIPPED"] as const;

export const activatePhaseUpdateSchema = z.object({
  name: safeStringSchema.trim().min(1).max(120).optional(),
  status: z.enum(ACTIVATE_PHASE_STATUSES).optional(),
  ownerId: optionalCuidSchema,
  // Nullable so a date can be cleared, not only set.
  startDate: z.string().max(50).optional().nullable(),
  targetDate: z.string().max(50).optional().nullable(),
  // Optimistic locking is opt-in; see the route.
  version: z.coerce.number().int().min(0).optional(),
});

/**
 * Workstream status.
 *
 * A workstream is never deleted — it spans phases and its deliverables are
 * history — so "we are not running this one" is a status, not a removal.
 */
export const ACTIVATE_WORKSTREAM_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export const activateWorkstreamUpdateSchema = z.object({
  name: safeStringSchema.trim().min(1).max(120).optional(),
  status: z.enum(ACTIVATE_WORKSTREAM_STATUSES).optional(),
  ownerId: optionalCuidSchema,
});

/**
 * Linking an issue to a phase as a deliverable.
 *
 * `issueId` and `phaseId` are required: a deliverable that names no issue is
 * nothing, and one that names no phase has nowhere to appear. `workstreamId`
 * is optional because not every deliverable belongs to a workstream.
 */
export const activateDeliverableCreateSchema = z.object({
  issueId: cuidSchema,
  phaseId: cuidSchema,
  workstreamId: optionalCuidSchema,
  isMandatory: z.boolean().optional(),
  acceleratorKey: safeStringSchema.trim().max(120).nullable().optional(),
});

/**
 * Fit-to-standard outcomes.
 *
 * FIT — the standard solution covers it. GAP — it does not, and something has
 * to be built or changed. ACCEPTED_GAP — it does not, and the business has
 * decided to live with that. The third is the one that matters at a gate: an
 * accepted gap is a decision with somebody's name on it, not an outstanding
 * task, and a gate review that cannot tell those apart is not a review.
 *
 * Nullable is a real state, not a missing value: most of a backlog has not
 * been through a workshop yet, and that must stay distinguishable from "we
 * looked at it and it fits".
 */
export const ACTIVATE_FIT_GAP_STATUSES = ["FIT", "GAP", "ACCEPTED_GAP"] as const;

export const activateDeliverableUpdateSchema = z.object({
  phaseId: cuidSchema.optional(),
  workstreamId: optionalCuidSchema,
  isMandatory: z.boolean().optional(),
  acceleratorKey: safeStringSchema.trim().max(120).nullable().optional(),
  fitGapStatus: z.enum(ACTIVATE_FIT_GAP_STATUSES).nullable().optional(),
});

// ── SAP Activate: quality gates ──────────────────────────────────

/**
 * Criterion states. WAIVED is not a synonym for MET — it records that a human
 * decided the criterion does not apply, which reads differently to an auditor.
 */
export const ACTIVATE_CRITERION_STATUSES = ["PENDING", "MET", "NOT_MET", "WAIVED"] as const;

export const activateCriterionUpdateSchema = z.object({
  status: z.enum(ACTIVATE_CRITERION_STATUSES).optional(),
  evidenceRef: safeStringSchema.trim().max(500).nullable().optional(),
  evidenceIssueId: optionalCuidSchema,
});

/**
 * Raising a gate carries no required input — the act is the message. A schema
 * is defined anyway so the route validates whatever body a client does send,
 * rather than accepting arbitrary JSON because it happens to ignore it.
 */
export const activateGateRaiseSchema = z.object({
  comment: safeStringSchema.trim().max(2000).nullable().optional(),
});

export const activateGateApprovalSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: safeStringSchema.trim().max(2000).nullable().optional(),
});

/**
 * Applying an accelerator.
 *
 * Only the key: the title, description, phase, workstream and whether it is
 * mandatory all come from the catalogue file. Accepting them from the body
 * would let a caller invent an "accelerator" that matches nothing SAP
 * published, which is the opposite of what a catalogue is for.
 */
export const activateAcceleratorApplySchema = z.object({
  key: z.string().min(3).max(64),
});

// ── SAP Activate: modules, decisions and deltas ──────────────────

export const activateModuleScopeSchema = z.object({
  moduleId: cuidSchema,
  inScope: z.boolean().optional(),
  /** Which release wave. Null clears it, which is not the same as wave 0. */
  waveNumber: z.coerce.number().int().min(0).max(99).nullable().optional(),
  ownerId: optionalCuidSchema,
});

export const activateDeltaInputSchema = z.object({
  /** Present when editing an existing delta, absent when adding one. */
  id: cuidSchema.optional(),
  title: safeStringSchema.trim().min(1).max(300),
  buildType: z.enum(ACTIVATE_BUILD_TYPES).optional(),
  priority: z.enum(ACTIVATE_PRIORITIES).optional(),
  size: z.enum(ACTIVATE_SIZES).optional(),
  ownerId: optionalCuidSchema,
  targetPhaseKey: safeStringSchema.trim().max(40).nullable().optional(),
  note: safeStringSchema.trim().max(2000).nullable().optional(),
});

/**
 * A decision and its deltas are recorded in ONE request.
 *
 * A fit-to-standard workshop settles a scope item as a unit — the outcome, why,
 * and what therefore has to be built. Splitting that across three calls would
 * let a decision exist for a while with deltas that contradict it, on screen,
 * in front of the people who just agreed something else.
 */
export const activateDecisionSchema = z.object({
  decision: z.enum(ACTIVATE_DECISIONS),
  status: z.enum(ACTIVATE_DECISION_STATUSES).optional(),
  rationale: safeStringSchema.trim().max(4000).nullable().optional(),
  openQuestion: safeStringSchema.trim().max(500).nullable().optional(),
  questionOwnerId: optionalCuidSchema,
  deltas: z.array(activateDeltaInputSchema).max(50).optional(),
  version: z.coerce.number().int().min(0).optional(),
});
