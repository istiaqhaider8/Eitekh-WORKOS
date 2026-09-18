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
