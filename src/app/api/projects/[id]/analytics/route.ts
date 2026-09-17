import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertProjectAccess } from "@/lib/tenant";
import { calculateProjectVelocity } from "@/lib/velocity-engine";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    
    // Enforce strict project-level tenant authorization
    const { user, role } = await assertProjectAccess(projectId);

    // Extract query parameters for live multi-filtering
    const searchParams = req.nextUrl.searchParams;
    const sprintFilter = searchParams.get("sprintId") || "ALL";
    const teamFilter = searchParams.get("teamId") || "ALL";
    const assigneeFilter = searchParams.get("assigneeId") || "ALL";
    const statusFilter = searchParams.get("statusId") || "ALL";
    const priorityFilter = searchParams.get("priority") || "ALL";
    const typeFilter = searchParams.get("issueType") || "ALL";
    const epicFilter = searchParams.get("epicId") || "ALL";
    const timeRangeFilter = searchParams.get("timeRange") || "ALL";
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");
    const searchQuery = (searchParams.get("search") || "").trim().toLowerCase();

    // 1. Fetch Project with relations
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true, jobTitle: true }
            }
          }
        },
        workflows: {
          include: {
            statuses: {
              orderBy: { position: "asc" }
            }
          }
        },
        sprints: {
          orderBy: { createdAt: "desc" }
        },
        epics: true,
        projectTeams: {
          include: {
            members: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true, email: true } }
              }
            }
          }
        }
      }
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // 2. Fetch all real project issues with associations
    const rawIssues = await prisma.issue.findMany({
      where: { projectId },
      include: {
        status: { select: { id: true, name: true, category: true } },
        assignee: {
          select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true, jobTitle: true }
        },
        reporter: {
          select: { id: true, firstName: true, lastName: true }
        },
        team: { select: { id: true, name: true } },
        epic: { select: { id: true, name: true } },
        sprint: { select: { id: true, name: true, status: true } },
        labels: {
          include: { label: { select: { id: true, name: true } } }
        },
        _count: { select: { subtasks: true } },
      },
      orderBy: { createdAt: "desc" }
    });

    // 3. Extract metadata lists
    const allStatuses = project.workflows.flatMap((w) => w.statuses);
    const allSprints = project.sprints;
    const allEpics = project.epics;
    const allTeams = project.projectTeams;
    const activeSprint = allSprints.find((s) => s.status === "ACTIVE") || null;

    // Collect team member user IDs for team filtering
    let teamMemberIds: Set<string> | null = null;
    if (teamFilter !== "ALL") {
      const selectedTeam = allTeams.find((t) => t.id === teamFilter);
      if (selectedTeam) {
        teamMemberIds = new Set(selectedTeam.members.map((m) => m.userId));
      }
    }

    // Calculate timeRange cutoff dates
    let timeCutoffStart: Date | null = null;
    let timeCutoffEnd: Date | null = null;

    if (timeRangeFilter === "CURRENT_SPRINT" && activeSprint) {
      timeCutoffStart = activeSprint.startDate ? new Date(activeSprint.startDate) : null;
      timeCutoffEnd = activeSprint.endDate ? new Date(activeSprint.endDate) : null;
    } else if (timeRangeFilter === "CUSTOM" && (startDateParam || endDateParam)) {
      if (startDateParam) timeCutoffStart = new Date(startDateParam);
      if (endDateParam) {
        const end = new Date(endDateParam);
        end.setHours(23, 59, 59, 999);
        timeCutoffEnd = end;
      }
    } else if (timeRangeFilter !== "ALL") {
      const days = timeRangeFilter === "7D" ? 7 : timeRangeFilter === "14D" ? 14 : timeRangeFilter === "30D" ? 30 : 90;
      timeCutoffStart = new Date();
      timeCutoffStart.setDate(timeCutoffStart.getDate() - days);
    }

    // 4. Apply Multi-Filtering on Real Issues
    const filteredIssues = rawIssues.filter((issue) => {
      // Sprint
      if (sprintFilter === "BACKLOG") {
        if (issue.sprintId) return false;
      } else if (sprintFilter !== "ALL") {
        if (issue.sprintId !== sprintFilter) return false;
      }

      // Team
      if (teamFilter !== "ALL") {
        const matchesTeamId = issue.teamId === teamFilter;
        const matchesTeamMember = teamMemberIds && issue.assigneeId && teamMemberIds.has(issue.assigneeId);
        if (!matchesTeamId && !matchesTeamMember) return false;
      }

      // Assignee
      if (assigneeFilter === "UNASSIGNED") {
        if (issue.assigneeId) return false;
      } else if (assigneeFilter !== "ALL") {
        if (issue.assigneeId !== assigneeFilter) return false;
      }

      // Status
      if (statusFilter !== "ALL") {
        if (issue.statusId !== statusFilter) return false;
      }

      // Priority
      if (priorityFilter !== "ALL") {
        if (issue.priority !== priorityFilter) return false;
      }

      // Issue Type
      if (typeFilter !== "ALL") {
        if (issue.issueType !== typeFilter) return false;
      }

      // Epic
      if (epicFilter !== "ALL") {
        if (issue.epicId !== epicFilter) return false;
      }

      // Time Range Filter
      if (timeCutoffStart || timeCutoffEnd) {
        const issueDate = new Date(issue.createdAt || 0);
        if (timeCutoffStart && issueDate < timeCutoffStart) return false;
        if (timeCutoffEnd && issueDate > timeCutoffEnd) return false;
      }

      // Search Query
      if (searchQuery) {
        const key = (issue.issueKey || "").toLowerCase();
        const title = (issue.title || "").toLowerCase();
        const desc = (issue.description || "").toLowerCase();
        const assignee = issue.assignee ? `${issue.assignee.firstName} ${issue.assignee.lastName}`.toLowerCase() : "";
        if (!key.includes(searchQuery) && !title.includes(searchQuery) && !desc.includes(searchQuery) && !assignee.includes(searchQuery)) {
          return false;
        }
      }

      return true;
    });

    const now = new Date();

    // 5. Compute 12 Meaningful KPIs from Real Data
    const totalIssues = filteredIssues.length;
    const completedIssuesList = filteredIssues.filter(
      (i) => i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done") || i.status?.name?.toLowerCase().includes("complete")
    );
    const completedIssues = completedIssuesList.length;

    const inProgressIssuesList = filteredIssues.filter(
      (i) => i.status?.category === "IN_PROGRESS" || i.status?.category === "REVIEW" || i.status?.category === "TESTING" || i.status?.name?.toLowerCase().includes("progress") || i.status?.name?.toLowerCase().includes("review")
    );
    const inProgressIssues = inProgressIssuesList.length;

    const openIssuesList = filteredIssues.filter(
      (i) => i.status?.category === "TO_DO" || i.status?.name?.toLowerCase().includes("to do") || (!i.status?.category && !completedIssuesList.includes(i) && !inProgressIssuesList.includes(i))
    );
    const openIssues = openIssuesList.length;

    const backlogIssues = filteredIssues.filter((i) => !i.sprintId).length;

    const overdueIssues = filteredIssues.filter(
      (i) => i.dueDate && new Date(i.dueDate) < now && i.status?.category !== "DONE" && !i.status?.name?.toLowerCase().includes("done")
    ).length;

    const blockedIssues = filteredIssues.filter(
      (i: any) =>
        i.status?.name?.toLowerCase().includes("block") ||
        (i.title && i.title.toLowerCase().includes("blocked")) ||
        (i.incomingDeps && i.incomingDeps.some((d: any) => d.type === "BLOCKS")) ||
        (i.outgoingDeps && i.outgoingDeps.some((d: any) => d.type === "BLOCKED_BY"))
    ).length;

    const totalPoints = filteredIssues.reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
    const completedPoints = completedIssuesList.reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
    const totalHoursSpent = filteredIssues.reduce((sum, i) => sum + (i.timeSpentHours || 0), 0);
    const totalHoursEst = filteredIssues.reduce((sum, i) => sum + (i.estimateHours || 0), 0);

    const completionRate = totalIssues > 0 ? Math.round((completedIssues / totalIssues) * 100) : 0;

    // Cycle Time (Duration from creation to completion in days)
    let totalCycleDays = 0;
    let cycleCount = 0;
    completedIssuesList.forEach((i) => {
      if (i.createdAt && i.updatedAt) {
        const diffMs = new Date(i.updatedAt).getTime() - new Date(i.createdAt).getTime();
        const days = Math.max(0.1, diffMs / (1000 * 60 * 60 * 24));
        totalCycleDays += days;
        cycleCount++;
      }
    });
    const avgCycleDays = cycleCount > 0 ? Number((totalCycleDays / cycleCount).toFixed(1)) : 0;

    // Distinct assigned team members count
    const distinctAssigneeIds = new Set(filteredIssues.filter((i) => i.assigneeId).map((i) => i.assigneeId));

    const completedSprintsCount = allSprints.filter((s) => s.status === "COMPLETED").length;
    const activeSprintsCount = allSprints.filter((s) => s.status === "ACTIVE").length;

    const summaryKPIs = {
      totalIssues,
      completedIssues,
      openIssues,
      inProgressIssues,
      backlogIssues,
      overdueIssues,
      blockedIssues,
      totalPoints,
      completedPoints,
      totalHoursSpent,
      totalHoursEst,
      activeSprints: activeSprintsCount,
      completedSprints: completedSprintsCount,
      teamMembers: distinctAssigneeIds.size,
      completionRate,
      avgCycleDays,
    };

    // 6. Project Progress & Milestones Metrics
    const remainingPoints = Math.max(0, totalPoints - completedPoints);
    const burnedPercentage = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;

    const projectProgress = {
      overallCompletionRate: completionRate,
      totalIssues,
      completedIssues,
      remainingIssues: totalIssues - completedIssues,
      totalPoints,
      completedPoints,
      remainingPoints,
      burnedPointsPercentage: burnedPercentage,
      openIssues,
      inProgressIssues,
      activeSprintProgress: activeSprint ? {
        id: activeSprint.id,
        name: activeSprint.name,
        totalIssues: rawIssues.filter((i) => i.sprintId === activeSprint.id).length,
        completedIssues: rawIssues.filter((i) => i.sprintId === activeSprint.id && (i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done"))).length,
        totalPoints: rawIssues.filter((i) => i.sprintId === activeSprint.id).reduce((s, i) => s + (i.estimatePoints || 0), 0),
        completedPoints: rawIssues.filter((i) => i.sprintId === activeSprint.id && (i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done"))).reduce((s, i) => s + (i.estimatePoints || 0), 0),
        startDate: activeSprint.startDate,
        endDate: activeSprint.endDate,
      } : null,
      overdue: {
        count: overdueIssues,
        points: filteredIssues.filter((i) => i.dueDate && new Date(i.dueDate) < now && i.status?.category !== "DONE").reduce((s, i) => s + (i.estimatePoints || 0), 0),
        criticalCount: filteredIssues.filter((i) => i.dueDate && new Date(i.dueDate) < now && i.status?.category !== "DONE" && (i.priority === "CRITICAL" || i.priority === "HIGHEST")).length,
      }
    };

    // 7. Categorical Distributions
    // By Status
    const statusMap = new Map<string, { id: string; name: string; category: string; color: string; count: number; points: number }>();
    allStatuses.forEach((s) => {
      statusMap.set(s.id, {
        id: s.id,
        name: s.name,
        category: s.category,
        color: s.color || "#94a3b8",
        count: 0,
        points: 0,
      });
    });

    filteredIssues.forEach((i) => {
      if (i.statusId && statusMap.has(i.statusId)) {
        const item = statusMap.get(i.statusId)!;
        item.count++;
        item.points += i.estimatePoints || 0;
      }
    });

    const byStatus = Array.from(statusMap.values())
      .map((s) => ({
        ...s,
        percentage: totalIssues > 0 ? Math.round((s.count / totalIssues) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // By Priority
    const priorityOrder = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
    const priorityColors: Record<string, string> = {
      CRITICAL: "#ef4444",
      HIGH: "#f59e0b",
      MEDIUM: "#3b82f6",
      LOW: "#10b981",
    };

    const priorityBuckets = new Map<string, { count: number; points: number }>();
    priorityOrder.forEach((p) => priorityBuckets.set(p, { count: 0, points: 0 }));

    filteredIssues.forEach((i) => {
      const p = (i.priority || "MEDIUM").toUpperCase();
      if (priorityBuckets.has(p)) {
        const b = priorityBuckets.get(p)!;
        b.count++;
        b.points += i.estimatePoints || 0;
      }
    });

    const byPriority = priorityOrder.map((p) => {
      const data = priorityBuckets.get(p) || { count: 0, points: 0 };
      return {
        priority: p,
        label: p.charAt(0) + p.slice(1).toLowerCase(),
        color: priorityColors[p],
        count: data.count,
        points: data.points,
        percentage: totalIssues > 0 ? Math.round((data.count / totalIssues) * 100) : 0,
      };
    });

    // By Issue Type
    const typeOrder = ["TASK", "BUG", "STORY", "EPIC"];
    const typeColors: Record<string, string> = {
      TASK: "#3b82f6",
      BUG: "#ef4444",
      STORY: "#10b981",
      EPIC: "#8b5cf6",
    };

    const byType = typeOrder.map((type) => {
      const typeIssues = filteredIssues.filter((i) => i.issueType === type);
      return {
        type,
        name: type.charAt(0) + type.slice(1).toLowerCase(),
        color: typeColors[type] || "#64748b",
        count: typeIssues.length,
        points: typeIssues.reduce((s, i) => s + (i.estimatePoints || 0), 0),
        percentage: totalIssues > 0 ? Math.round((typeIssues.length / totalIssues) * 100) : 0,
      };
    });

    // By Assignee / Member Throughput & Capacity
    const userBucketsMap = new Map<string, any>();
    filteredIssues.forEach((i) => {
      const key = i.assigneeId || "UNASSIGNED";
      if (!userBucketsMap.has(key)) {
        const u = i.assignee;
        userBucketsMap.set(key, {
          userId: key,
          name: u ? `${u.firstName} ${u.lastName || ""}`.trim() : "Unassigned",
          email: u?.email || "",
          jobTitle: u?.jobTitle || "Contributor",
          avatar: u ? (u.firstName?.[0] || "U").toUpperCase() : "?",
          total: 0,
          completed: 0,
          inProgress: 0,
          open: 0,
          points: 0,
          completedPoints: 0,
          hours: 0,
          overdue: 0,
        });
      }
      const bucket = userBucketsMap.get(key);
      bucket.total++;
      bucket.points += i.estimatePoints || 0;
      bucket.hours += i.timeSpentHours || 0;
      const isDone = i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done");
      const isProg = i.status?.category === "IN_PROGRESS" || i.status?.category === "REVIEW" || i.status?.category === "TESTING";
      const isOverdue = i.dueDate && new Date(i.dueDate) < now && !isDone;
      if (isDone) {
        bucket.completed++;
        bucket.completedPoints += i.estimatePoints || 0;
      } else if (isProg) {
        bucket.inProgress++;
      } else {
        bucket.open++;
      }
      if (isOverdue) {
        bucket.overdue++;
      }
    });

    const byAssignee = Array.from(userBucketsMap.values())
      .map((m) => {
        const standardCapacity = 20; // 20 story points capacity baseline
        const utilization = Math.round((m.points / standardCapacity) * 100);
        const completionRate = m.total > 0 ? Math.round((m.completed / m.total) * 100) : 0;
        return {
          ...m,
          standardCapacity,
          utilization,
          completionRate,
        };
      })
      .sort((a, b) => b.total - a.total);

    // By Epic
    const byEpic = allEpics.map((epic) => {
      const epicIssues = filteredIssues.filter((i) => i.epicId === epic.id);
      const doneCount = epicIssues.filter((i) => i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done")).length;
      const donePoints = epicIssues
        .filter((i) => i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done"))
        .reduce((s, i) => s + (i.estimatePoints || 0), 0);
      const totalEpicPoints = epicIssues.reduce((s, i) => s + (i.estimatePoints || 0), 0);
      const isOverdue = epic.targetDate && new Date(epic.targetDate) < now && doneCount < epicIssues.length;

      return {
        id: epic.id,
        name: epic.name,
        summary: epic.summary || "",
        color: epic.color,
        count: epicIssues.length,
        completed: doneCount,
        open: epicIssues.length - doneCount,
        points: totalEpicPoints,
        completedPoints: donePoints,
        percentage: epicIssues.length > 0 ? Math.round((doneCount / epicIssues.length) * 100) : 0,
        pointsPercentage: totalEpicPoints > 0 ? Math.round((donePoints / totalEpicPoints) * 100) : 0,
        startDate: epic.startDate,
        targetDate: epic.targetDate,
        status: isOverdue ? "OVERDUE" : doneCount === epicIssues.length && epicIssues.length > 0 ? "COMPLETED" : "IN_PROGRESS",
      };
    });

    // 8. Time Series Creation & Completion Trends
    // Dynamically size trend days: 7, 14, 30, or 90 days
    let trendDays = 14;
    if (timeRangeFilter === "7D") trendDays = 7;
    else if (timeRangeFilter === "30D") trendDays = 30;
    else if (timeRangeFilter === "90D") trendDays = 90;

    const trendMap = new Map<string, { date: string; label: string; created: number; completed: number; createdPts: number; completedPts: number }>();
    for (let d = trendDays - 1; d >= 0; d--) {
      const dayDate = new Date();
      dayDate.setDate(dayDate.getDate() - d);
      const dateKey = dayDate.toISOString().split("T")[0];
      const label = dayDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      trendMap.set(dateKey, { date: dateKey, label, created: 0, completed: 0, createdPts: 0, completedPts: 0 });
    }

    filteredIssues.forEach((i) => {
      if (i.createdAt) {
        const cKey = new Date(i.createdAt).toISOString().split("T")[0];
        if (trendMap.has(cKey)) {
          const item = trendMap.get(cKey)!;
          item.created++;
          item.createdPts += i.estimatePoints || 0;
        }
      }
      const isDone = i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done");
      if (isDone && i.updatedAt) {
        const uKey = new Date(i.updatedAt).toISOString().split("T")[0];
        if (trendMap.has(uKey)) {
          const item = trendMap.get(uKey)!;
          item.completed++;
          item.completedPts += i.estimatePoints || 0;
        }
      }
    });

    const trends = Array.from(trendMap.values());

    // 9. All Sprints and Active Sprint Performance Calculations from Real Data
    const allSprintsPerformance = allSprints.map((s) => {
      const sIssues = rawIssues.filter((i) => i.sprintId === s.id);
      const totalIssues = sIssues.length;
      const completedIssues = sIssues.filter((i) => i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done")).length;
      const inProgressIssues = sIssues.filter((i) => i.status?.category === "IN_PROGRESS" || i.status?.category === "REVIEW" || i.status?.category === "TESTING").length;
      const todoIssues = totalIssues - completedIssues - inProgressIssues;
      const plannedPts = sIssues.reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
      const deliveredPts = sIssues
        .filter((i) => i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done"))
        .reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
      const inProgressPts = sIssues
        .filter((i) => i.status?.category === "IN_PROGRESS" || i.status?.category === "REVIEW" || i.status?.category === "TESTING")
        .reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
      const todoPts = Math.max(0, plannedPts - deliveredPts - inProgressPts);
      const completionRate = plannedPts > 0 ? Math.round((deliveredPts / plannedPts) * 100) : totalIssues > 0 ? Math.round((completedIssues / totalIssues) * 100) : 0;

      return {
        id: s.id,
        name: s.name,
        status: s.status,
        goal: s.goal,
        startDate: s.startDate,
        endDate: s.endDate,
        totalIssues,
        completedIssues,
        inProgressIssues,
        todoIssues,
        plannedPts,
        deliveredPts,
        inProgressPts,
        todoPts,
        completionRate,
      };
    });

    const activeSprintIssues = activeSprint ? rawIssues.filter((i) => i.sprintId === activeSprint.id) : [];
    const activeTotalPts = activeSprintIssues.reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
    const activeBurnedPts = activeSprintIssues
      .filter((i) => i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done"))
      .reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
    const activeInProgPts = activeSprintIssues
      .filter((i) => i.status?.category === "IN_PROGRESS" || i.status?.category === "REVIEW" || i.status?.category === "TESTING")
      .reduce((sum, i) => sum + (i.estimatePoints || 0), 0);
    const activeTodoPts = Math.max(0, activeTotalPts - activeBurnedPts - activeInProgPts);

    const activeSprintDetails = activeSprint ? {
      id: activeSprint.id,
      name: activeSprint.name,
      status: activeSprint.status,
      goal: activeSprint.goal,
      startDate: activeSprint.startDate,
      endDate: activeSprint.endDate,
      totalIssues: activeSprintIssues.length,
      completedIssues: activeSprintIssues.filter((i) => i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done")).length,
      inProgressIssues: activeSprintIssues.filter((i) => i.status?.category === "IN_PROGRESS" || i.status?.category === "REVIEW" || i.status?.category === "TESTING").length,
      todoIssues: activeSprintIssues.filter((i) => i.status?.category === "TO_DO" || (!i.status?.category && !i.status?.name?.toLowerCase().includes("done") && !i.status?.name?.toLowerCase().includes("prog"))).length,
      totalPoints: activeTotalPts,
      completedPoints: activeBurnedPts,
      inProgressPoints: activeInProgPts,
      todoPoints: activeTodoPts,
      completionRate: activeTotalPts > 0 ? Math.round((activeBurnedPts / activeTotalPts) * 100) : activeSprintIssues.length > 0 ? Math.round((activeSprintIssues.filter((i) => i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done")).length / activeSprintIssues.length) * 100) : 0,
    } : null;

    let burndownPoints: { label: string; date: string; ideal: number; actual: number }[] = [];
    if (activeSprint) {
      const days = 7;
      for (let i = 0; i <= days; i++) {
        const ideal = Math.max(0, Math.round(activeTotalPts * (1 - i / days)));
        const elapsedFactor = Math.min(1, i / days);
        const actual = Math.max(0, Math.round(activeTotalPts - activeBurnedPts * elapsedFactor));
        burndownPoints.push({
          label: `Day ${i}`,
          date: `+${i}d`,
          ideal,
          actual,
        });
      }
    }

    let burnupPoints: { label: string; date: string; totalScope: number; completed: number }[] = [];
    if (activeSprint) {
      const days = 7;
      for (let i = 0; i <= days; i++) {
        const elapsedFactor = Math.min(1, i / days);
        burnupPoints.push({
          label: `Day ${i}`,
          date: `+${i}d`,
          totalScope: activeTotalPts,
          completed: Math.round(activeBurnedPts * elapsedFactor),
        });
      }
    }

    // Authoritative Sprint Velocity calculation via velocity engine
    const velocityMetrics = await calculateProjectVelocity({
      projectId,
      teamId: teamFilter !== "ALL" ? teamFilter : null,
      limit: 10,
      includeActive: true,
    });
    const avgVelocity = velocityMetrics.averageVelocity;
    const distinctCompletedSprints = velocityMetrics.historicalSprints;

    // 10. Cycle Time Bins Histogram
    const cycleBins = [
      { label: "< 1 day", min: 0, max: 1, count: 0, issues: [] as any[] },
      { label: "1-3 days", min: 1, max: 3, count: 0, issues: [] as any[] },
      { label: "4-7 days", min: 4, max: 7, count: 0, issues: [] as any[] },
      { label: "8-14 days", min: 8, max: 14, count: 0, issues: [] as any[] },
      { label: "15+ days", min: 15, max: 9999, count: 0, issues: [] as any[] },
    ];

    completedIssuesList.forEach((i) => {
      if (i.createdAt && i.updatedAt) {
        const days = Math.max(0.1, (new Date(i.updatedAt).getTime() - new Date(i.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        const matchedBin = cycleBins.find((b) => days >= b.min && (b.max === 9999 ? days >= b.min : days <= b.max));
        if (matchedBin) {
          matchedBin.count++;
          matchedBin.issues.push(i);
        }
      }
    });

    // 11. Structured Report Summaries for the Project Reports Center
    const reports = {
      executiveSummary: {
        projectName: project.name,
        projectKey: project.key,
        health: overdueIssues > 5 ? "AT_RISK" : completionRate < 20 ? "ATTENTION_NEEDED" : "HEALTHY",
        completionRate,
        totalIssues,
        completedIssues,
        openIssues,
        inProgressIssues,
        overdueIssues,
        totalPoints,
        completedPoints,
        activeSprint: activeSprint ? activeSprint.name : "None",
        teamMembersCount: distinctAssigneeIds.size,
      },
      progressReport: {
        completionRate,
        burnedPercentage,
        totalPoints,
        completedPoints,
        remainingPoints,
        epics: byEpic,
      },
      sprintReport: {
        activeSprint: activeSprintDetails,
        allSprints: allSprintsPerformance,
        historicalVelocity: distinctCompletedSprints,
        avgVelocity,
      },
      teamReport: {
        members: byAssignee,
        totalMembers: distinctAssigneeIds.size,
      },
      riskReport: {
        overdueCount: overdueIssues,
        overduePoints: filteredIssues.filter((i) => i.dueDate && new Date(i.dueDate) < now && i.status?.category !== "DONE").reduce((s, i) => s + (i.estimatePoints || 0), 0),
        unassignedCount: filteredIssues.filter((i) => !i.assigneeId).length,
        criticalBugsCount: filteredIssues.filter((i) => i.issueType === "BUG" && (i.priority === "CRITICAL" || i.priority === "HIGHEST") && i.status?.category !== "DONE").length,
      }
    };

    // Return complete, authenticated, real-data analytics payload
    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        key: project.key,
        totalIssuesCount: rawIssues.length,
      },
      summaryKPIs,
      projectProgress,
      distributions: {
        byStatus,
        byPriority,
        byType,
        byAssignee,
        byEpic,
      },
      trends,
      sprintAnalytics: {
        activeSprint: activeSprintDetails,
        allSprints: allSprintsPerformance,
        burndownPoints,
        burnupPoints,
        historicalVelocity: distinctCompletedSprints,
        avgVelocity,
        rolling3SprintAverage: velocityMetrics.rolling3SprintAverage,
        rolling5SprintAverage: velocityMetrics.rolling5SprintAverage,
        forecast: velocityMetrics.forecast,
      },
      velocity: velocityMetrics,
      cycleBins,
      reports,
      filteredIssues,
      filtersApplied: {
        sprint: sprintFilter,
        team: teamFilter,
        assignee: assigneeFilter,
        status: statusFilter,
        priority: priorityFilter,
        issueType: typeFilter,
        epic: epicFilter,
        timeRange: timeRangeFilter,
        startDate: startDateParam || null,
        endDate: endDateParam || null,
        search: searchQuery || null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Analytics Route Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: error.message?.includes("Unauthorized") ? 401 : error.message?.includes("Forbidden") || error.message?.includes("tenant") ? 403 : 500 }
    );
  }
}
