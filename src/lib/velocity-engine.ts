import { prisma } from "@/lib/prisma";

export interface SprintVelocitySummary {
  id: string;
  name: string;
  goal: string | null;
  status: string; // 'COMPLETED' | 'ACTIVE' | 'FUTURE'
  startDate: string | null;
  endDate: string | null;
  completedAt: string | null;
  plannedPoints: number;
  completedPoints: number; // Velocity
  velocity: number; // Alias of completedPoints
  completionRate: number; // percentage 0-100
  totalIssues: number;
  completedIssues: number;
  unestimatedCompletedIssues: number;
  remainingIssues: number;
  remainingPoints: number;
  initialCommittedPoints: number;
  addedPoints: number;
  subtasksExcludedCount: number;
}

export interface ActiveSprintProgress {
  id: string;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  plannedPoints: number;
  completedPoints: number;
  remainingPoints: number;
  totalIssues: number;
  completedIssues: number;
  unestimatedCompletedIssues: number;
  remainingIssues: number;
  completionRate: number;
  inProgressPoints: number;
  inProgressIssues: number;
}

export interface VelocityForecast {
  averageVelocity: number;
  totalBacklogPoints: number;
  unestimatedBacklogCount: number;
  totalBacklogIssues: number;
  estimatedSprintsNeeded: number | null;
  disclaimer: string;
}

export interface ProjectVelocityResult {
  projectId: string;
  projectName: string;
  teamId: string | null;
  teamName: string | null;
  averageVelocity: number;
  rolling3SprintAverage: number;
  rolling5SprintAverage: number;
  totalCompletedSprints: number;
  currentSprint: ActiveSprintProgress | null;
  historicalSprints: SprintVelocitySummary[];
  forecast: VelocityForecast;
}

/**
 * Returns whether an issue status represents a cancelled/rejected/abandoned state.
 * Cancelled issues must never inflate velocity.
 */
export function isCancelledStatus(status: { name?: string | null; category?: string | null } | null | undefined): boolean {
  if (!status) return false;
  const category = (status.category || "").toUpperCase();
  if (category === "CANCELLED") return true;
  const name = (status.name || "").toLowerCase();
  return (
    name.includes("cancel") ||
    name.includes("reject") ||
    name.includes("abandon") ||
    name.includes("wont fix") ||
    name.includes("won't fix") ||
    name.includes("discard")
  );
}

/**
 * Returns whether an issue status represents a successfully completed state.
 * Respects configurable project workflow statuses.
 */
export function isCompletedStatus(status: { name?: string | null; category?: string | null } | null | undefined): boolean {
  if (!status) return false;
  if (isCancelledStatus(status)) return false;
  const category = (status.category || "").toUpperCase();
  if (category === "DONE") return true;
  const name = (status.name || "").toLowerCase();
  return name.includes("done") || name.includes("closed") || name.includes("resolved") || name.includes("complete");
}

export interface CalculateVelocityOptions {
  projectId: string;
  teamId?: string | null;
  limit?: number; // Number of historical completed sprints to return (default 5)
  includeActive?: boolean;
}

/**
 * Authoritative Sprint Velocity calculation function for Eitekh WorkOS.
 * Enforces:
 * - Velocity = Total Story Points of primary issues successfully completed during sprint
 * - Subtask deduplication (only top-level parentIssueId == null issues count)
 * - Cancelled issue exclusion
 * - Unestimated completed issue tracking (does not invent points)
 * - True historical accuracy using status transition timestamps & snapshots
 * - Clean segregation between Current Sprint Progress and Historical Velocity
 */
export async function calculateProjectVelocity(
  optionsOrProjectId: CalculateVelocityOptions | string,
  maybeOptions?: Partial<CalculateVelocityOptions>
): Promise<ProjectVelocityResult> {
  const options: CalculateVelocityOptions =
    typeof optionsOrProjectId === "string"
      ? { projectId: optionsOrProjectId, ...maybeOptions }
      : optionsOrProjectId;
  const { projectId, teamId, limit = 5, includeActive = true } = options;

  // 1. Fetch Project with metadata
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      workflows: {
        include: { statuses: true },
      },
    },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  let teamName: string | null = null;
  if (teamId && teamId !== "ALL") {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { name: true },
    });
    teamName = team?.name || null;
  }

  // 2. Fetch all Sprints for this project (and optionally team)
  const sprintWhere: any = { projectId };
  if (teamId && teamId !== "ALL") {
    sprintWhere.teamId = teamId;
  }

  const allSprints = await prisma.sprint.findMany({
    where: sprintWhere,
    include: {
      issues: {
        where: teamId && teamId !== "ALL" ? { teamId } : undefined,
        include: {
          status: true,
          activityLogs: {
            where: { actionType: { in: ["UPDATED_STATUS", "UPDATED_SPRINT", "CREATED"] } },
            orderBy: { timestamp: "asc" },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Segregate active sprint
  const activeSprintRecord = allSprints.find((s) => s.status === "ACTIVE") || null;
  const completedSprints = allSprints
    .filter((s) => s.status === "COMPLETED")
    .sort((a, b) => {
      const dateA = a.completedAt || a.endDate || a.updatedAt || a.createdAt;
      const dateB = b.completedAt || b.endDate || b.updatedAt || b.createdAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

  // 3. Process Completed Sprints (Historical Velocity)
  const historicalSprints: SprintVelocitySummary[] = [];

  for (const sprint of completedSprints) {
    const sIssues = sprint.issues;
    let subtasksExcludedCount = 0;

    // Filter to primary work items to prevent double-counting subtasks (Section 7)
    const primaryIssues = sIssues.filter((i) => {
      if (i.parentIssueId !== null) {
        subtasksExcludedCount++;
        return false;
      }
      return true;
    });

    const sprintStart = sprint.startDate ? new Date(sprint.startDate) : new Date(sprint.createdAt);
    const sprintEnd = sprint.completedAt
      ? new Date(sprint.completedAt)
      : sprint.endDate
      ? new Date(sprint.endDate)
      : new Date(sprint.updatedAt);

    // Initial committed vs Added scope (Section 15)
    let initialCommittedPoints = 0;
    let addedPoints = 0;

    primaryIssues.forEach((i) => {
      const pts = i.estimatePoints || 0;
      // Check when issue joined sprint
      const sprintAddedLog = i.activityLogs.find(
        (log) => log.actionType === "UPDATED_SPRINT" && log.newValue === sprint.name
      );
      const joinedDate = sprintAddedLog ? new Date(sprintAddedLog.timestamp) : new Date(i.createdAt);

      if (joinedDate <= new Date(sprintStart.getTime() + 24 * 60 * 60 * 1000)) {
        initialCommittedPoints += pts;
      } else {
        addedPoints += pts;
      }
    });

    // Check completed issues during this sprint
    let completedPoints = 0;
    let completedIssues = 0;
    let unestimatedCompletedIssues = 0;

    primaryIssues.forEach((i) => {
      // Exclude cancelled issues
      if (isCancelledStatus(i.status)) return;

      // Check if completed
      if (isCompletedStatus(i.status)) {
        // Verify historical completion timestamp falls within sprint horizon (Section 5)
        let wasCompletedDuringSprint = true;

        if (sprint.startDate && (sprint.completedAt || sprint.endDate)) {
          // Check transition to DONE timestamp
          const doneTransition = [...i.activityLogs]
            .reverse()
            .find((l) => l.actionType === "UPDATED_STATUS" && isCompletedStatus({ name: l.newValue, category: "DONE" }));

          const completionDate = doneTransition
            ? new Date(doneTransition.timestamp)
            : i.completedAt
            ? new Date(i.completedAt)
            : new Date(i.updatedAt);

          // Allow a slight 12-hour grace period for retrospective wrap-ups
          const lowerBound = new Date(sprintStart.getTime() - 12 * 60 * 60 * 1000);
          const upperBound = new Date(sprintEnd.getTime() + 12 * 60 * 60 * 1000);

          if (completionDate < lowerBound || completionDate > upperBound) {
            // Completed outside sprint window; only count if currently on sprint and no newer sprint
            wasCompletedDuringSprint = i.sprintId === sprint.id;
          }
        }

        if (wasCompletedDuringSprint) {
          completedIssues++;
          if (i.estimatePoints && i.estimatePoints > 0) {
            completedPoints += i.estimatePoints;
          } else {
            // Unestimated completed issue (Section 9)
            unestimatedCompletedIssues++;
          }
        }
      }
    });

    // Planned points: sum of all non-subtask issues committed to sprint
    // If snapshot exists and is non-zero, honor snapshot; otherwise use computed planned points
    const computedPlannedPts = primaryIssues.reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
    const plannedPoints = sprint.plannedPoints != null && sprint.plannedPoints > 0
      ? sprint.plannedPoints
      : computedPlannedPts;

    // Velocity = Completed Points
    const velocity = sprint.completedPoints != null && sprint.completedPoints > 0
      ? sprint.completedPoints
      : completedPoints;

    const remainingPoints = Math.max(0, plannedPoints - velocity);
    const remainingIssues = Math.max(0, primaryIssues.length - completedIssues);

    const completionRate = plannedPoints > 0
      ? Math.min(100, Math.round((velocity / plannedPoints) * 100))
      : completedIssues > 0
      ? 100
      : 0;

    historicalSprints.push({
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      status: sprint.status,
      startDate: sprint.startDate ? sprint.startDate.toISOString() : null,
      endDate: sprint.endDate ? sprint.endDate.toISOString() : null,
      completedAt: sprint.completedAt ? sprint.completedAt.toISOString() : sprint.updatedAt.toISOString(),
      plannedPoints,
      completedPoints: velocity,
      velocity,
      completionRate,
      totalIssues: primaryIssues.length,
      completedIssues,
      unestimatedCompletedIssues,
      remainingIssues,
      remainingPoints,
      initialCommittedPoints: initialCommittedPoints || plannedPoints,
      addedPoints,
      subtasksExcludedCount,
    });
  }

  // Respect requested limit (e.g. last 5 completed sprints)
  const slicedHistorical = historicalSprints.slice(0, limit);

  // 4. Calculate Average Velocity across completed sprints (Section 11)
  const totalVelocitySum = slicedHistorical.reduce((sum, s) => sum + s.velocity, 0);
  const averageVelocity = slicedHistorical.length > 0
    ? Math.round((totalVelocitySum / slicedHistorical.length) * 10) / 10
    : 0;

  // Rolling 3-Sprint Average
  const last3Sprints = slicedHistorical.slice(0, 3);
  const rolling3SprintAverage = last3Sprints.length > 0
    ? Math.round((last3Sprints.reduce((sum, s) => sum + s.velocity, 0) / last3Sprints.length) * 10) / 10
    : averageVelocity;

  // Rolling 5-Sprint Average
  const last5Sprints = slicedHistorical.slice(0, 5);
  const rolling5SprintAverage = last5Sprints.length > 0
    ? Math.round((last5Sprints.reduce((sum, s) => sum + s.velocity, 0) / last5Sprints.length) * 10) / 10
    : averageVelocity;

  // 5. Active Sprint Metrics (Segregated from Historical Velocity)
  let currentSprint: ActiveSprintProgress | null = null;
  if (includeActive && activeSprintRecord) {
    const activePrimaryIssues = activeSprintRecord.issues.filter((i) => i.parentIssueId === null);
    const activePlannedPts = activePrimaryIssues.reduce((sum, i) => sum + (i.estimatePoints || 0), 0);

    let activeCompletedPts = 0;
    let activeCompletedIssues = 0;
    let activeUnestimatedCompleted = 0;
    let activeInProgPts = 0;
    let activeInProgIssues = 0;

    activePrimaryIssues.forEach((i) => {
      if (isCancelledStatus(i.status)) return;
      if (isCompletedStatus(i.status)) {
        activeCompletedIssues++;
        if (i.estimatePoints && i.estimatePoints > 0) {
          activeCompletedPts += i.estimatePoints;
        } else {
          activeUnestimatedCompleted++;
        }
      } else {
        const cat = (i.status?.category || "").toUpperCase();
        if (cat === "IN_PROGRESS" || cat === "REVIEW" || cat === "TESTING") {
          activeInProgIssues++;
          activeInProgPts += i.estimatePoints || 0;
        }
      }
    });

    const activeRemainingPts = Math.max(0, activePlannedPts - activeCompletedPts);
    const activeRemainingIssues = Math.max(0, activePrimaryIssues.length - activeCompletedIssues);
    const activeCompletionRate = activePlannedPts > 0
      ? Math.min(100, Math.round((activeCompletedPts / activePlannedPts) * 100))
      : activeCompletedIssues > 0
      ? 100
      : 0;

    currentSprint = {
      id: activeSprintRecord.id,
      name: activeSprintRecord.name,
      goal: activeSprintRecord.goal,
      startDate: activeSprintRecord.startDate ? activeSprintRecord.startDate.toISOString() : null,
      endDate: activeSprintRecord.endDate ? activeSprintRecord.endDate.toISOString() : null,
      plannedPoints: activePlannedPts,
      completedPoints: activeCompletedPts,
      remainingPoints: activeRemainingPts,
      totalIssues: activePrimaryIssues.length,
      completedIssues: activeCompletedIssues,
      unestimatedCompletedIssues: activeUnestimatedCompleted,
      remainingIssues: activeRemainingIssues,
      completionRate: activeCompletionRate,
      inProgressPoints: activeInProgPts,
      inProgressIssues: activeInProgIssues,
    };
  }

  // 6. Backlog Forecast (Section 14)
  // Fetch uncompleted backlog issues (not in completed sprints and not completed)
  const backlogIssues = await prisma.issue.findMany({
    where: {
      projectId,
      parentIssueId: null, // Only count primary issues
      ...(teamId && teamId !== "ALL" ? { teamId } : {}),
      OR: [
        { sprintId: null },
        { sprint: { status: { in: ["FUTURE", "ACTIVE"] } } },
      ],
      status: {
        category: { notIn: ["DONE", "CANCELLED"] },
      },
    },
    select: {
      id: true,
      estimatePoints: true,
    },
  });

  const totalBacklogPoints = backlogIssues.reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
  const unestimatedBacklogCount = backlogIssues.filter((i) => i.estimatePoints == null || i.estimatePoints <= 0).length;

  const estimatedSprintsNeeded = averageVelocity > 0
    ? Math.ceil(totalBacklogPoints / averageVelocity)
    : null;

  const forecast: VelocityForecast = {
    averageVelocity,
    totalBacklogPoints,
    unestimatedBacklogCount,
    totalBacklogIssues: backlogIssues.length,
    estimatedSprintsNeeded,
    disclaimer: "Forecast estimate based on historical velocity. Does not constitute a guaranteed delivery date.",
  };

  return {
    projectId,
    projectName: project.name,
    teamId: teamId || null,
    teamName,
    averageVelocity,
    rolling3SprintAverage,
    rolling5SprintAverage,
    totalCompletedSprints: completedSprints.length,
    currentSprint,
    historicalSprints: slicedHistorical,
    forecast,
  };
}
