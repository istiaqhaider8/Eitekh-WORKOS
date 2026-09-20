import { prisma } from "./prisma";

/**
 * Project-level metadata that the issue modal needs before it can render its
 * dropdowns: statuses, types, priorities, members, teams, epics, sprints,
 * custom fields and leave.
 *
 * Opening a task used to fetch these as nine separate requests, one per
 * endpoint. All nine enforce the same gate -- authenticated plus
 * `assertProjectAccess(projectId)` -- and none requires a distinct permission,
 * so serving them together is permission-equivalent while costing one auth
 * round-trip instead of nine.
 *
 * The type and priority merge rules live here rather than in the route so the
 * per-resource endpoints and the combined one cannot drift apart; this data has
 * a history of being defined in several places and disagreeing.
 */

export const DEFAULT_ISSUE_TYPES = [
  { name: "Task", value: "TASK", color: "#0ea5e9", icon: "CheckSquare", description: "Standard actionable work item" },
  { name: "Bug", value: "BUG", color: "#f43f5e", icon: "AlertCircle", description: "Defect, error or problem in functionality" },
  { name: "Story", value: "STORY", color: "#10b981", icon: "Bookmark", description: "User requirement or scenario" },
  { name: "Epic", value: "EPIC", color: "#a855f7", icon: "Layers", description: "Large body of work encompassing multiple tasks" },
];

export const DEFAULT_PRIORITIES = [
  { name: "Critical", value: "CRITICAL", color: "#f43f5e" },
  { name: "High", value: "HIGH", color: "#f59e0b" },
  { name: "Medium", value: "MEDIUM", color: "#3b82f6" },
  { name: "Low", value: "LOW", color: "#10b981" },
];

/** Reads a project-scoped option list stored as JSON on a CustomField row. */
async function readOptionList<T>(projectId: string, name: string): Promise<T[]> {
  const cf = await prisma.customField.findFirst({
    where: { scopeType: "PROJECT", scopeId: projectId, name },
  });
  if (!cf?.optionsJson) return [];
  try {
    const parsed = JSON.parse(cf.optionsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error(`Failed to parse ${name} JSON:`, e);
    return [];
  }
}

export type IssueTypeOption = {
  name: string;
  value: string;
  color: string;
  icon?: string;
  description?: string;
};

/** A project's issue types: defaults, with per-project overrides and additions. */
export async function resolveProjectIssueTypes(projectId: string) {
  const custom = await readOptionList<IssueTypeOption>(projectId, "PROJECT_ISSUE_TYPES");
  const types = [
    ...DEFAULT_ISSUE_TYPES.map((dt) => {
      const override = custom.find((c) => c.value?.toUpperCase() === dt.value.toUpperCase());
      return override || dt;
    }),
    ...custom.filter(
      (c) => !DEFAULT_ISSUE_TYPES.some((d) => d.value.toUpperCase() === c.value?.toUpperCase())
    ),
  ];
  return { defaults: DEFAULT_ISSUE_TYPES, custom, types };
}

/**
 * Accepted on an issue, but never offered in a dropdown.
 *
 * `SUBTASK` is written by the CSV importer (`bulk-import.ts`) and listed in
 * the import template, but it is not a type anyone should pick by hand — the
 * platform has a separate `Subtask` model for that. It therefore belongs in
 * the ALLOWED set without appearing in `DEFAULT_ISSUE_TYPES`.
 *
 * Keeping it here rather than in the defaults is what lets the membership
 * check below be strict without breaking imports.
 */
export const SYSTEM_ISSUE_TYPES = ["SUBTASK"] as const;

/**
 * Every issue type this project will accept, upper-cased.
 *
 * WHY THIS EXISTS
 *
 * `POST /api/projects/[id]/types` lets a project define its own work-item
 * types, stored as a `PROJECT_ISSUE_TYPES` custom field. The create and update
 * schemas hard-coded `z.enum(["BUG","TASK","STORY","EPIC","SUBTASK"])`, so a
 * type could be defined, offered in the UI, and then rejected the moment
 * anyone tried to use it:
 *
 *     POST /api/projects/{id}/issues  {"issueType":"REQUIREMENT"}
 *     -> 400  issueType: Invalid option: expected one of "BUG"|"TASK"|...
 *
 * The feature was reachable, configurable and structurally incapable of
 * working. FIVE places defined the vocabulary and disagreed: DEFAULT_ISSUE_TYPES
 * (4 values), the zod enum (5), the Prisma column comment (7, including
 * FEATURE and INCIDENT that nothing accepted), `ALLOWED_ISSUE_TYPES` in
 * bulk-import (5), and the per-project custom field (unbounded). The comment
 * at the top of this file already warned that this data "has a history of
 * being defined in several places and disagreeing".
 *
 * The schema now validates the SHAPE of the value and the route validates its
 * MEMBERSHIP here — the same split already used for `statusId`, which zod
 * checks is a cuid and the route checks belongs to the project's workflow.
 * A static schema cannot know a project's types; only a query can.
 */
export async function allowedIssueTypeValues(projectId: string): Promise<Set<string>> {
  const { types } = await resolveProjectIssueTypes(projectId);
  const allowed = new Set<string>(SYSTEM_ISSUE_TYPES);
  for (const t of types) {
    if (t?.value) allowed.add(String(t.value).toUpperCase());
  }
  return allowed;
}

export type PriorityOption = { name: string; value: string; color: string };

/** A project's priorities: the defaults followed by any custom additions. */
export async function resolveProjectPriorities(projectId: string) {
  const customList = await readOptionList<PriorityOption>(projectId, "PROJECT_PRIORITIES");
  const existingValues = new Set(DEFAULT_PRIORITIES.map((p) => p.value.toUpperCase()));
  const custom = customList.filter(
    (cp) => !existingValues.has(cp.value?.toUpperCase() || cp.name.toUpperCase())
  );
  return { defaults: DEFAULT_PRIORITIES, custom, priorities: [...DEFAULT_PRIORITIES, ...custom] };
}

/**
 * Accepted as a priority, but never offered.
 *
 * `NONE` is in the request schemas and nowhere else — not in
 * `DEFAULT_PRIORITIES`, not in any code path, and not on a single row in the
 * volume dataset. It is kept accepted so that any caller already sending it
 * does not break, and kept out of the defaults so it is not presented as a
 * choice.
 */
export const SYSTEM_PRIORITIES = ["NONE"] as const;

/**
 * Every priority this project will accept, upper-cased.
 *
 * Priorities carry the exact same defect as issue types, one file over:
 * `POST /api/projects/[id]/priorities` writes custom priorities to a
 * `PROJECT_PRIORITIES` custom field, and the request schemas hard-coded
 * `z.enum(["CRITICAL","HIGH","MEDIUM","LOW","NONE"])`, so a custom priority
 * could be created and never used. Fixing issue types alone would have left
 * its twin in place.
 */
export async function allowedPriorityValues(projectId: string): Promise<Set<string>> {
  const { priorities } = await resolveProjectPriorities(projectId);
  const allowed = new Set<string>(SYSTEM_PRIORITIES);
  for (const p of priorities) {
    if (p?.value) allowed.add(String(p.value).toUpperCase());
  }
  return allowed;
}

/**
 * Everything the issue modal needs, in the flat shape it already builds
 * client-side from the nine responses.
 *
 * `project` must come from `assertProjectAccess`, which the caller is
 * responsible for -- it carries the members and workspace needed for the leave
 * lookup, so passing it in avoids re-reading the project.
 *
 * Sprints, epics and teams are selected down to the fields the modal actually
 * renders. The per-resource endpoints stay as they are for their other
 * consumers; notably `/api/sprints` embeds up to 200 issues per sprint and
 * `/api/epics` loads every issue to compute progress, none of which a dropdown
 * needs.
 */
export async function getProjectContext(
  projectId: string,
  project: { ownerId: string; members: Array<{ userId: string }>; workspace: { orgId: string } }
) {
  const memberUserIds = project.members.map((m) => m.userId);
  if (!memberUserIds.includes(project.ownerId)) memberUserIds.push(project.ownerId);

  const [sprints, customFields, members, leaves, workflows, typeData, priorityData, teams, epics] =
    await Promise.all([
      prisma.sprint.findMany({
        where: { projectId },
        select: { id: true, name: true, status: true, startDate: true, endDate: true },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
      prisma.customField.findMany({
        where: { scopeType: "PROJECT", scopeId: projectId },
      }),
      prisma.projectMember.findMany({
        where: { projectId },
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } },
        },
      }),
      prisma.leave.findMany({
        where: {
          organizationId: project.workspace.orgId,
          userId: { in: memberUserIds },
          status: "ACTIVE",
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
          delegations: {
            where: { status: "ACTIVE" },
            include: {
              delegateUser: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
        },
        orderBy: { startDate: "asc" },
      }),
      prisma.workflow.findMany({
        where: { projectId },
        include: { statuses: { orderBy: { position: "asc" } } },
        orderBy: { createdAt: "desc" },
      }),
      resolveProjectIssueTypes(projectId),
      resolveProjectPriorities(projectId),
      // Kept as a full row plus members, matching /api/teams, because the modal
      // renders team fields directly and a narrower select would silently drop
      // whichever one it reaches for next.
      prisma.team.findMany({
        where: { projectId },
        include: {
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                  avatarUrl: true,
                  jobTitle: true,
                },
              },
            },
          },
          _count: { select: { members: true } },
        },
      }),
      prisma.epic.findMany({
        where: { projectId },
        select: { id: true, name: true, color: true, status: true },
      }),
    ]);

  return {
    sprints,
    customFields,
    members,
    leaves,
    workflowId: workflows[0]?.id ?? null,
    statuses: workflows[0]?.statuses ?? [],
    types: typeData.types,
    priorities: priorityData.priorities,
    teams,
    epics,
  };
}
