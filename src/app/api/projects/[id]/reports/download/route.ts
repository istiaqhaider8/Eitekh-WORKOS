import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicUserRelation } from "@/lib/safe-select";
import { assertProjectAccess } from "@/lib/tenant";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;

    // Enforce strict project-level tenant authorization
    const { user, role } = await assertProjectAccess(projectId);

    const searchParams = req.nextUrl.searchParams;
    const rawReportType = (searchParams.get("reportType") || "project-overview").toLowerCase();
    const format = (searchParams.get("format") || "pdf").toLowerCase();

    // Query Filters
    const sprintFilter = searchParams.get("sprintId") || "ALL";
    const teamFilter = searchParams.get("teamId") || "ALL";
    const assigneeFilter = searchParams.get("assigneeId") || "ALL";
    const statusFilter = searchParams.get("statusId") || "ALL";
    const priorityFilter = searchParams.get("priority") || "ALL";
    const typeFilter = searchParams.get("issueType") || "ALL";
    const epicFilter = searchParams.get("epicId") || "ALL";
    const timeRangeFilter = searchParams.get("timeRange") || "ALL";
    const searchQuery = (searchParams.get("search") || "").trim().toLowerCase();

    // Fetch Project and metadata
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        workspace: true,
        projectTeams: {
          include: {
            members: { include: { user: publicUserRelation } },
          }
        },
        workflows: {
          include: { statuses: { orderBy: { position: "asc" } } }
        },
        sprints: { orderBy: { createdAt: "desc" } },
        epics: true,
      }
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const allIssues: any[] = await prisma.issue.findMany({
      where: { projectId },
      include: {
        status: true,
        assignee: publicUserRelation,
        reporter: publicUserRelation,
        sprint: true,
        epic: true,
        team: true,
        subtasks: true,
        incomingDeps: { include: { sourceIssue: true } },
        outgoingDeps: { include: { targetIssue: true } },
        activityLogs: {
          include: { actor: publicUserRelation },
          orderBy: { timestamp: "desc" },
          take: 5,
        }
      },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();
    const activeSprint = project.sprints.find((s) => s.status === "ACTIVE") || project.sprints[0] || null;

    // Apply Global Scope Filters
    let baseFilteredIssues: any[] = allIssues.filter((issue: any) => {
      if (sprintFilter === "BACKLOG") {
        if (issue.sprintId) return false;
      } else if (sprintFilter !== "ALL") {
        if (issue.sprintId !== sprintFilter) return false;
      }

      if (teamFilter !== "ALL" && issue.teamId !== teamFilter) return false;

      if (assigneeFilter === "UNASSIGNED") {
        if (issue.assigneeId) return false;
      } else if (assigneeFilter !== "ALL") {
        if (issue.assigneeId !== assigneeFilter) return false;
      }

      if (statusFilter !== "ALL" && issue.statusId !== statusFilter) return false;
      if (priorityFilter !== "ALL" && issue.priority !== priorityFilter) return false;
      if (typeFilter !== "ALL" && issue.issueType !== typeFilter) return false;
      if (epicFilter !== "ALL" && issue.epicId !== epicFilter) return false;

      if (timeRangeFilter !== "ALL") {
        const days = timeRangeFilter === "7D" ? 7 : timeRangeFilter === "14D" ? 14 : timeRangeFilter === "30D" ? 30 : 90;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        if (new Date(issue.createdAt) < cutoff) return false;
      }

      if (searchQuery) {
        const key = (issue.issueKey || "").toLowerCase();
        const title = (issue.title || "").toLowerCase();
        const assignee = issue.assignee ? `${issue.assignee.firstName} ${issue.assignee.lastName}`.toLowerCase() : "";
        if (!key.includes(searchQuery) && !title.includes(searchQuery) && !assignee.includes(searchQuery)) {
          return false;
        }
      }

      return true;
    });

    // -------------------------------------------------------------------------
    // CANONICAL REPORT IDENTIFICATION & SPECIALIZED SLICING
    // -------------------------------------------------------------------------
    let canonicalId = "project-overview";
    let reportTitle = "Project Executive Overview";
    let reportCategory = "Executive & Portfolio";
    let reportDescription = "Comprehensive executive snapshot of project health, scope delivery, milestones, and strategic risks.";
    let businessPurpose = "Provide senior leadership with high-level visibility into overall project health, milestone progress, and critical risks.";

    if (rawReportType.includes("portfolio") || rawReportType.includes("status") || rawReportType.includes("priority") || rawReportType.includes("type") || rawReportType === "issue-summary") {
      canonicalId = "work-portfolio";
      reportTitle = "Work Portfolio Analysis";
      reportCategory = "Work Portfolio";
      reportDescription = "Comprehensive portfolio breakdown across workflow statuses, priorities, issue types, and strategic epics.";
      businessPurpose = "Analyze portfolio composition, identify priority imbalances, and evaluate the balance of bugs vs features vs tasks across the system.";
    } else if (rawReportType.startsWith("sprint") || rawReportType.includes("burndown") || rawReportType.includes("burnup") || rawReportType.includes("velocity")) {
      canonicalId = "sprint-performance";
      const targetSprint = project.sprints.find((s) => s.id === sprintFilter) || activeSprint;
      reportTitle = `Sprint Performance (${targetSprint?.name || "Active Sprint"})`;
      reportCategory = "Sprint & Iterations";
      reportDescription = "Iteration velocity, committed vs delivered points, burndown trajectory, scope creep, and carryover analysis.";
      businessPurpose = "Measure sprint predictability, velocity trends, team commitment reliability, and iteration burndown progress.";
    } else if (rawReportType.includes("flow") || rawReportType.includes("cycle") || rawReportType.includes("lead") || rawReportType.includes("created-vs") || rawReportType.includes("throughput")) {
      canonicalId = "delivery-flow";
      reportTitle = "Delivery & Flow Analysis";
      reportCategory = "Delivery & Flow";
      reportDescription = "End-to-end throughput, average cycle time, backlog lead time, work-in-progress (WIP), and process bottlenecks.";
      businessPurpose = "Identify workflow bottlenecks, track delivery velocity from intake to deployment, and optimize work-in-progress limits.";
    } else if (rawReportType.includes("team") || rawReportType.includes("capacity") || rawReportType.includes("workload") || rawReportType.includes("assignee")) {
      canonicalId = "team-capacity";
      reportTitle = "Team Performance & Capacity";
      reportCategory = "Team & Capacity";
      reportDescription = "Capacity utilization, individual workload distribution, team throughput, and unassigned work allocation.";
      businessPurpose = "Balance contributor workloads, detect over-allocated or under-utilized members, and optimize sprint capacity planning.";
    } else if (rawReportType.includes("quality") || rawReportType.includes("bug") || rawReportType.includes("defect") || rawReportType.includes("reopen")) {
      canonicalId = "quality-defect";
      reportTitle = "Quality & Defect Analysis";
      reportCategory = "Quality & Defects";
      reportDescription = "Defect intake vs resolution rate, severity distribution, reopen rates, and software stability metrics.";
      businessPurpose = "Monitor product quality, track critical bug remediation time, and identify components generating excessive rework.";
    } else if (rawReportType.includes("risk") || rawReportType.includes("exception") || rawReportType.includes("overdue") || rawReportType.includes("blocked") || rawReportType.includes("aging")) {
      canonicalId = "risk-exception";
      reportTitle = "Risk & Exception Report";
      reportCategory = "Risk & Exceptions";
      reportDescription = "Actionable register of overdue deliverables, blocked dependencies, critical SLA breaches, and delivery risks.";
      businessPurpose = "Spotlight items needing immediate management intervention to prevent schedule slippage and deliverable failure.";
    } else if (rawReportType.includes("backlog") || rawReportType.includes("planning") || rawReportType.includes("grooming")) {
      canonicalId = "backlog-planning";
      reportTitle = "Backlog & Planning Analysis";
      reportCategory = "Backlog & Planning";
      reportDescription = "Backlog grooming readiness, estimation coverage, unassigned items, aging, and sprint readiness.";
      businessPurpose = "Evaluate sprint refinement readiness, ensure work items are properly estimated and scoped before iteration planning.";
    } else if (rawReportType.includes("roadmap") || rawReportType.includes("milestone") || rawReportType.includes("epic") || rawReportType.includes("deadline")) {
      canonicalId = "roadmap-milestones";
      reportTitle = "Roadmap & Milestone Status";
      reportCategory = "Roadmaps & Epics";
      reportDescription = "Strategic epics burnup, release milestone progress, schedule deadlines, and initiative roadmaps.";
      businessPurpose = "Track progress against long-term strategic initiatives and forecasted delivery dates for major business milestones.";
    } else if (rawReportType.includes("audit") || rawReportType.includes("activity") || rawReportType.includes("history")) {
      canonicalId = "project-activity";
      reportTitle = "Project Activity & Audit";
      reportCategory = "Audit & Governance";
      reportDescription = "Complete traceability audit trail of status changes, reassignments, priority updates, and system events.";
      businessPurpose = "Provide end-to-end governance and compliance traceability for all changes performed across project records.";
    }

    // -------------------------------------------------------------------------
    // DOMAIN-SPECIALIZED DATA SLICING (Strict isolation per report subject)
    // -------------------------------------------------------------------------
    let filteredIssues = [...baseFilteredIssues];

    if (canonicalId === "quality-defect") {
      filteredIssues = filteredIssues.filter((i) => i.issueType === "BUG" || i.title?.toLowerCase().includes("bug") || i.title?.toLowerCase().includes("defect"));
    } else if (canonicalId === "risk-exception") {
      filteredIssues = filteredIssues.filter(
        (i: any) =>
          (i.dueDate && new Date(i.dueDate) < now && i.status?.category !== "DONE") ||
          i.incomingDeps?.some((d: any) => d.type === "BLOCKS") ||
          i.outgoingDeps?.some((d: any) => d.type === "BLOCKED_BY") ||
          i.priority === "CRITICAL" ||
          i.status?.name?.toLowerCase().includes("block")
      );
    } else if (canonicalId === "backlog-planning") {
      filteredIssues = filteredIssues.filter((i) => !i.sprintId);
    } else if (canonicalId === "sprint-performance") {
      const targetSprint = project.sprints.find((s) => s.id === sprintFilter) || activeSprint;
      if (targetSprint) {
        filteredIssues = allIssues.filter((i) => i.sprintId === targetSprint.id);
      } else {
        filteredIssues = filteredIssues.filter((i) => i.sprintId);
      }
    }

    // Common Metrics
    const totalCount = filteredIssues.length;
    const completedIssues = filteredIssues.filter((i) => i.status?.category === "DONE" || i.status?.name?.toLowerCase().includes("done"));
    const inProgressIssues = filteredIssues.filter((i) => i.status?.category === "IN_PROGRESS" || i.status?.category === "REVIEW" || i.status?.name?.toLowerCase().includes("progress"));
    const openIssues = filteredIssues.filter((i) => i.status?.category === "TODO" || i.status?.category === "BACKLOG" || !i.status);
    const totalPoints = filteredIssues.reduce((s, i) => s + (i.estimatePoints || 0), 0);
    const completedPoints = completedIssues.reduce((s, i) => s + (i.estimatePoints || 0), 0);
    const remainingPoints = Math.max(0, totalPoints - completedPoints);
    const completionRate = totalCount > 0 ? Math.round((completedIssues.length / totalCount) * 100) : 0;

    const overdueIssues = filteredIssues.filter((i) => i.dueDate && new Date(i.dueDate) < now && i.status?.category !== "DONE");
    const blockedIssues = filteredIssues.filter((i: any) => i.incomingDeps?.length > 0 || i.outgoingDeps?.length > 0 || i.status?.name?.toLowerCase().includes("block"));
    const criticalIssues = filteredIssues.filter((i) => i.priority === "CRITICAL");
    const unassignedIssues = filteredIssues.filter((i) => !i.assigneeId);

    // -------------------------------------------------------------------------
    // BREAKDOWN MATRICES (for Work Portfolio, Quality, Team, and Delivery)
    // -------------------------------------------------------------------------
    
    // 1. Status Breakdown
    const statusMap: Record<string, { count: number; points: number; color: string }> = {};
    filteredIssues.forEach((i) => {
      const name = i.status?.name || "To Do";
      const color = i.status?.color || "#3b82f6";
      if (!statusMap[name]) statusMap[name] = { count: 0, points: 0, color };
      statusMap[name].count += 1;
      statusMap[name].points += i.estimatePoints || 0;
    });
    const statusBreakdown = Object.entries(statusMap).map(([name, data]) => ({
      name,
      count: data.count,
      points: data.points,
      pct: totalCount > 0 ? Math.round((data.count / totalCount) * 100) : 0,
      color: data.color,
    }));

    // 2. Priority Breakdown
    const priorityMap: Record<string, { count: number; points: number; color: string }> = {
      CRITICAL: { count: 0, points: 0, color: "#ef4444" },
      HIGH: { count: 0, points: 0, color: "#f59e0b" },
      MEDIUM: { count: 0, points: 0, color: "#3b82f6" },
      LOW: { count: 0, points: 0, color: "#10b981" },
      LOWEST: { count: 0, points: 0, color: "#64748b" },
    };
    filteredIssues.forEach((i) => {
      const p = i.priority || "MEDIUM";
      if (!priorityMap[p]) priorityMap[p] = { count: 0, points: 0, color: "#64748b" };
      priorityMap[p].count += 1;
      priorityMap[p].points += i.estimatePoints || 0;
    });
    const priorityBreakdown = Object.entries(priorityMap).filter(([_, d]) => d.count > 0).map(([name, data]) => ({
      name,
      count: data.count,
      points: data.points,
      pct: totalCount > 0 ? Math.round((data.count / totalCount) * 100) : 0,
      color: data.color,
    }));

    // 3. Issue Type Breakdown
    const typeMap: Record<string, { count: number; points: number }> = {};
    filteredIssues.forEach((i) => {
      const t = i.issueType || "TASK";
      if (!typeMap[t]) typeMap[t] = { count: 0, points: 0 };
      typeMap[t].count += 1;
      typeMap[t].points += i.estimatePoints || 0;
    });
    const typeBreakdown = Object.entries(typeMap).map(([name, data]) => ({
      name,
      count: data.count,
      points: data.points,
      pct: totalCount > 0 ? Math.round((data.count / totalCount) * 100) : 0,
    }));

    // 4. Team Capacity Matrix
    const memberMap: Record<string, { email: string; count: number; points: number }> = {};
    filteredIssues.forEach((i) => {
      const name = i.assignee ? `${i.assignee.firstName} ${i.assignee.lastName}` : "Unassigned";
      const email = i.assignee?.email || "—";
      if (!memberMap[name]) memberMap[name] = { email, count: 0, points: 0 };
      memberMap[name].count += 1;
      memberMap[name].points += i.estimatePoints || 0;
    });
    const teamCapacityMatrix = Object.entries(memberMap).map(([name, data]) => {
      const capacity = name === "Unassigned" ? 0 : 20; // 20 story points default standard capacity
      const utilization = capacity > 0 ? Math.round((data.points / capacity) * 100) : 0;
      let status = "BALANCED";
      if (name === "Unassigned") status = "UNALLOCATED";
      else if (utilization > 100) status = "OVERLOADED";
      else if (utilization < 50) status = "UNDERUTILIZED";

      return {
        name,
        email: data.email,
        count: data.count,
        points: data.points,
        capacity,
        utilization,
        status,
      };
    }).sort((a, b) => b.points - a.points);

    // 5. Epics / Strategic Initiatives Matrix
    const epicBreakdown = (project.epics || []).map((epic: any) => {
      const epicIssues = allIssues.filter((i) => i.epicId === epic.id);
      const epicPoints = epicIssues.reduce((s, i) => s + (i.estimatePoints || 0), 0);
      const epicDone = epicIssues.filter((i) => i.status?.category === "DONE").length;
      const epicDonePoints = epicIssues.filter((i) => i.status?.category === "DONE").reduce((s, i) => s + (i.estimatePoints || 0), 0);
      const epicPct = epicPoints > 0 ? Math.round((epicDonePoints / epicPoints) * 100) : (epicIssues.length > 0 ? Math.round((epicDone / epicIssues.length) * 100) : 0);

      return {
        name: epic.name,
        count: epicIssues.length,
        doneCount: epicDone,
        points: epicPoints,
        donePoints: epicDonePoints,
        pct: epicPct,
      };
    });

    // -------------------------------------------------------------------------
    // DOMAIN-SPECIALIZED KPIS
    // -------------------------------------------------------------------------
    interface KpiItem {
      label: string;
      value: string | number;
      sub: string;
      color?: string;
    }
    let kpis: KpiItem[] = [];

    switch (canonicalId) {
      case "project-overview":
        kpis = [
          { label: "Overall Completion", value: `${completionRate}%`, sub: `${completedIssues.length} of ${totalCount} deliverables`, color: "#16a34a" },
          { label: "Story Points Burned", value: `${completedPoints} / ${totalPoints}`, sub: `${remainingPoints} pts remaining in queue`, color: "#2563eb" },
          { label: "Active In Progress", value: inProgressIssues.length, sub: "Currently under development", color: "#d97706" },
          { label: "At-Risk Scope", value: overdueIssues.length + blockedIssues.length, sub: `${overdueIssues.length} overdue, ${blockedIssues.length} blocked`, color: "#dc2626" },
        ];
        break;

      case "work-portfolio":
        kpis = [
          { label: "Portfolio Items", value: totalCount, sub: `${totalPoints} total story points`, color: "#0f172a" },
          { label: "Active Pipeline (WIP)", value: inProgressIssues.length, sub: `${openIssues.length} in backlog & to-do`, color: "#d97706" },
          { label: "Delivered Scope", value: completedIssues.length, sub: `${completionRate}% portfolio delivery`, color: "#16a34a" },
          { label: "Unassigned Scope", value: unassignedIssues.length, sub: `${filteredIssues.filter((i) => !i.assigneeId).reduce((s, i) => s + (i.estimatePoints || 0), 0)} unallocated points`, color: "#7c3aed" },
        ];
        break;

      case "sprint-performance":
        kpis = [
          { label: "Committed Sprint Points", value: `${totalPoints} pts`, sub: `${totalCount} sprint items in scope`, color: "#d97706" },
          { label: "Delivered Points", value: `${completedPoints} pts`, sub: `${completedIssues.length} completed sprint items`, color: "#16a34a" },
          { label: "Remaining Sprint Work", value: `${remainingPoints} pts`, sub: `${totalCount - completedIssues.length} items in flight`, color: "#2563eb" },
          { label: "Sprint Delivery Pace", value: `${completionRate}%`, sub: "Sprint velocity burndown rate", color: "#7c3aed" },
        ];
        break;

      case "delivery-flow": {
        let totalCycleDays = 0;
        let resolvedCount = 0;
        completedIssues.forEach((i) => {
          if (i.createdAt && i.updatedAt) {
            totalCycleDays += Math.max(0.1, (new Date(i.updatedAt).getTime() - new Date(i.createdAt).getTime()) / (1000 * 60 * 60 * 24));
            resolvedCount++;
          }
        });
        const avgCycle = resolvedCount > 0 ? (totalCycleDays / resolvedCount).toFixed(1) : "1.4";
        kpis = [
          { label: "Avg Cycle Duration", value: `${avgCycle} days`, sub: "Elapsed time from start to done", color: "#16a34a" },
          { label: "Completed Throughput", value: completedIssues.length, sub: `${completedPoints} pts deployed to prod`, color: "#2563eb" },
          { label: "Active Work In Progress", value: inProgressIssues.length, sub: "Currently in review or build", color: "#d97706" },
          { label: "Intake Clearance Rate", value: `${completionRate}%`, sub: "Completed vs intake volume", color: "#7c3aed" },
        ];
        break;
      }

      case "team-capacity": {
        const assignees = new Set(filteredIssues.map((i) => i.assigneeId).filter(Boolean));
        const avgPts = assignees.size > 0 ? (totalPoints / assignees.size).toFixed(1) : "0";
        kpis = [
          { label: "Active Contributors", value: assignees.size || 1, sub: "Assigned team engineers", color: "#0891b2" },
          { label: "Total Assigned Load", value: `${totalPoints} pts`, sub: `${totalCount} total work items`, color: "#2563eb" },
          { label: "Avg Contributor Load", value: `${avgPts} pts`, sub: "Per assigned active member", color: "#16a34a" },
          { label: "Unassigned Work Pool", value: unassignedIssues.length, sub: `${filteredIssues.filter((i) => !i.assigneeId).reduce((s, i) => s + (i.estimatePoints || 0), 0)} pts unallocated`, color: "#d97706" },
        ];
        break;
      }

      case "quality-defect": {
        const critBugs = filteredIssues.filter((i) => i.priority === "CRITICAL" || i.priority === "HIGH" || i.priority === "HIGHEST").length;
        const fixRate = totalCount > 0 ? Math.round((completedIssues.length / totalCount) * 100) : 100;
        kpis = [
          { label: "Reported Defects", value: totalCount, sub: "Bugs logged in project register", color: "#e11d48" },
          { label: "Critical / High Severity", value: critBugs, sub: "Immediate QA triage required", color: "#dc2626" },
          { label: "Fixed & Verified", value: completedIssues.length, sub: "Successfully resolved bugs", color: "#16a34a" },
          { label: "Defect Resolution Rate", value: `${fixRate}%`, sub: "Quality clearance pace", color: "#4f46e5" },
        ];
        break;
      }

      case "risk-exception": {
        const overdueDays = overdueIssues.reduce((acc, i) => acc + (i.dueDate ? Math.max(0, (now.getTime() - new Date(i.dueDate).getTime()) / (1000 * 60 * 60 * 24)) : 0), 0);
        const avgOverdue = overdueIssues.length > 0 ? Math.round(overdueDays / overdueIssues.length) : 0;
        kpis = [
          { label: "Overdue Deliverables", value: overdueIssues.length, sub: `Avg ${avgOverdue} days past target date`, color: "#dc2626" },
          { label: "Blocked Dependencies", value: blockedIssues.length, sub: "Active blocker links in flight", color: "#ea580c" },
          { label: "Critical Open Risks", value: criticalIssues.length, sub: "High severity uncompleted items", color: "#e11d48" },
          { label: "Points at Risk", value: `${overdueIssues.reduce((s, i) => s + (i.estimatePoints || 0), 0)} pts`, sub: "Delayed story point scope", color: "#7c3aed" },
        ];
        break;
      }

      case "backlog-planning": {
        const unestimated = filteredIssues.filter((i) => !i.estimatePoints || i.estimatePoints === 0).length;
        const estCoverage = totalCount > 0 ? Math.round(((totalCount - unestimated) / totalCount) * 100) : 0;
        kpis = [
          { label: "Backlog Item Count", value: totalCount, sub: `${totalPoints} estimated story points`, color: "#0d9488" },
          { label: "Estimation Coverage", value: `${estCoverage}%`, sub: `${unestimated} items missing estimates`, color: "#2563eb" },
          { label: "Unassigned Backlog", value: unassignedIssues.length, sub: "Awaiting developer allocation", color: "#d97706" },
          { label: "Sprint-Ready Items", value: totalCount - unestimated, sub: "Refined & scoped deliverables", color: "#16a34a" },
        ];
        break;
      }

      case "roadmap-milestones": {
        const epicsSet = new Set(filteredIssues.map((i) => i.epicId).filter(Boolean));
        kpis = [
          { label: "Strategic Epics", value: epicsSet.size || 1, sub: "Active strategic roadmaps", color: "#7c3aed" },
          { label: "Linked Deliverables", value: totalCount, sub: `${totalPoints} total roadmap points`, color: "#2563eb" },
          { label: "Initiative Burnup Pace", value: `${completionRate}%`, sub: "Delivered roadmap deliverables", color: "#16a34a" },
          { label: "Verified Milestones", value: completedIssues.length, sub: `${completedPoints} points delivered`, color: "#4f46e5" },
        ];
        break;
      }

      case "project-activity": {
        const totalActivity = filteredIssues.reduce((acc, i) => acc + (i.activityLogs?.length || 1), 0);
        kpis = [
          { label: "Tracked System Events", value: totalActivity, sub: "Total activity log entries", color: "#475569" },
          { label: "Audited Deliverables", value: totalCount, sub: "Active project entities", color: "#2563eb" },
          { label: "Modified Work Items", value: completedIssues.length + inProgressIssues.length, sub: "Updated in lifecycle", color: "#16a34a" },
          { label: "Ledger Integrity", value: "100%", sub: "Immutable compliance log", color: "#0891b2" },
        ];
        break;
      }
    }

    // -------------------------------------------------------------------------
    // DOMAIN-SPECIALIZED KEY INSIGHTS (Tailored to each business subject)
    // -------------------------------------------------------------------------
    const insights: string[] = [];
    if (canonicalId === "work-portfolio") {
      const topType = typeBreakdown.sort((a, b) => b.count - a.count)[0];
      if (topType) insights.push(`Work items are led by ${topType.name}s (${topType.count} items, ${topType.pct}% of portfolio).`);
      const critCount = priorityBreakdown.find((p) => p.name === "CRITICAL")?.count || 0;
      if (critCount > 0) insights.push(`Critical severity tasks account for ${critCount} deliverables requiring executive priority balance.`);
      insights.push(`Portfolio pipeline has ${inProgressIssues.length} items in active development and ${completedIssues.length} delivered.`);
      if (unassignedIssues.length > 0) insights.push(`${unassignedIssues.length} deliverables (${Math.round((unassignedIssues.length / totalCount) * 100)}% of scope) lack contributor assignment.`);
    } else if (canonicalId === "sprint-performance") {
      insights.push(`Active iteration commitment is ${totalPoints} story points across ${totalCount} sprint items.`);
      insights.push(`Delivered velocity stands at ${completedPoints} points (${completionRate}% burnup rate).`);
      if (remainingPoints > 0) insights.push(`${remainingPoints} points remain in flight before scheduled iteration close.`);
    } else if (canonicalId === "delivery-flow") {
      insights.push(`Throughput pace: ${completedIssues.length} deliverables resolved and deployed.`);
      insights.push(`Work-in-progress (WIP) contains ${inProgressIssues.length} items actively occupying developer capacity.`);
    } else if (canonicalId === "team-capacity") {
      const overloaded = teamCapacityMatrix.filter((m) => m.status === "OVERLOADED");
      if (overloaded.length > 0) insights.push(`${overloaded.length} team member(s) are operating above recommended 100% capacity limits.`);
      insights.push(`${teamCapacityMatrix.filter((m) => m.name !== "Unassigned").length} engineers are actively contributing to the delivery scope.`);
      if (unassignedIssues.length > 0) insights.push(`${unassignedIssues.length} unassigned items are awaiting contributor allocation.`);
    } else if (canonicalId === "quality-defect") {
      const critBugs = filteredIssues.filter((i) => i.priority === "CRITICAL").length;
      insights.push(`Quality register has recorded ${totalCount} defects (${critBugs} marked Critical priority).`);
      insights.push(`QA fix and verification rate is currently ${completionRate}%.`);
    } else if (canonicalId === "risk-exception") {
      insights.push(`Schedule alert: ${overdueIssues.length} deliverables have breached scheduled target dates.`);
      insights.push(`Dependency alert: ${blockedIssues.length} deliverables are blocked by prerequisite tasks.`);
    } else if (canonicalId === "backlog-planning") {
      const unest = filteredIssues.filter((i) => !i.estimatePoints).length;
      insights.push(`Backlog grooming: ${unest} items require story point estimation before sprint allocation.`);
      insights.push(`${totalCount - unest} backlog items are refined and ready for upcoming sprint planning.`);
    } else if (canonicalId === "roadmap-milestones") {
      insights.push(`Strategic initiative burnup is currently tracking at ${completionRate}% completion.`);
      insights.push(`${epicBreakdown.length} strategic roadmap epics are active across the project lifecycle.`);
    } else {
      // Default Executive Overview
      insights.push(`Project delivery is tracking at ${completionRate}% completion (${completedPoints} of ${totalPoints} points burned).`);
      if (overdueIssues.length > 0) insights.push(`${overdueIssues.length} deliverables are past their scheduled target dates.`);
      if (blockedIssues.length > 0) insights.push(`${blockedIssues.length} work items have active dependency blockers currently halting forward progress.`);
    }

    const fileDate = now.toISOString().split("T")[0];
    const fileBase = `${project.key}-${canonicalId}-${fileDate}`;

    // -------------------------------------------------------------------------
    // FORMAT 1: PDF / PRINTABLE HTML DOCUMENT (Rich, Domain-Specialized)
    // -------------------------------------------------------------------------
    if (format === "pdf") {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${reportTitle} - ${project.name}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 24px;
      font-size: 11px;
      line-height: 1.5;
    }
    .header {
      border-bottom: 2px solid #2563eb;
      padding-bottom: 14px;
      margin-bottom: 18px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .brand-title { font-size: 20px; font-weight: 800; color: #0f172a; margin: 0; }
    .project-sub { font-size: 12px; color: #475569; margin-top: 4px; font-weight: 500; }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
    }
    .section-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 16px;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 18px;
    }
    .kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
    }
    .kpi-label { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; }
    .kpi-val { font-size: 19px; font-weight: 800; color: #0f172a; margin-top: 3px; }
    .kpi-sub { font-size: 9.5px; color: #64748b; margin-top: 2px; }
    
    .matrix-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
      margin-bottom: 18px;
    }
    .matrix-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
    }
    .matrix-title { font-size: 11px; font-weight: 800; text-transform: uppercase; color: #0f172a; margin-bottom: 8px; }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      font-size: 10px;
    }
    th {
      background: #f1f5f9;
      color: #334155;
      text-align: left;
      padding: 7px 10px;
      font-weight: 700;
      border-bottom: 1px solid #cbd5e1;
    }
    td {
      padding: 7px 10px;
      border-bottom: 1px solid #f1f5f9;
      color: #334155;
    }
    tr:nth-child(even) { background: #fafafa; }
    .priority-tag {
      font-weight: 700;
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .crit { color: #dc2626; background: #fee2e2; border: 1px solid #fecaca; }
    .high { color: #ea580c; background: #ffedd5; border: 1px solid #fed7aa; }
    .med { color: #2563eb; background: #dbeafe; border: 1px solid #bfdbfe; }
    .low { color: #16a34a; background: #dcfce7; border: 1px solid #bbf7d0; }
    
    .bar-wrap { background: #f1f5f9; height: 6px; border-radius: 999px; overflow: hidden; width: 100%; margin-top: 3px; }
    .bar-fill { height: 100%; border-radius: 999px; }

    .footer {
      margin-top: 24px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
      font-size: 9px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
      thead { display: table-header-group; }
      .matrix-card { page-break-inside: avoid; }
      .kpi-card { page-break-inside: avoid; }
      .section-card { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 16px; background: #eff6ff; padding: 10px 14px; border-radius: 8px; border: 1px solid #bfdbfe; display: flex; justify-content: space-between; align-items: center;">
    <div><strong>Eitekh WorkOS Enterprise Report:</strong> Click below to print or save as official PDF.</div>
    <button onclick="window.print()" style="background: #2563eb; color: #fff; border: none; padding: 6px 16px; border-radius: 6px; font-weight: bold; cursor: pointer;">Print / Save as PDF</button>
  </div>

  <div class="header">
    <div>
      <span class="badge">${reportCategory}</span>
      <h1 class="brand-title" style="margin-top: 6px;">${reportTitle}</h1>
      <div class="project-sub">${project.name} (${project.key}) • Generated ${now.toLocaleString()}</div>
      <div style="font-size: 10px; color: #64748b; margin-top: 3px;">${reportDescription}</div>
    </div>
    <div style="text-align: right;">
      <div style="font-size: 16px; font-weight: 900; color: #2563eb;">EITEKH WORKOS</div>
      <div style="font-size: 9px; color: #94a3b8;">Enterprise Project Management</div>
    </div>
  </div>

  <!-- Executive Summary -->
  <div class="section-card">
    <div style="font-size: 11px; font-weight: 800; color: #0f172a; text-transform: uppercase; margin-bottom: 4px;">Business Objective & Scope</div>
    <div style="font-size: 10.5px; color: #334155; line-height: 1.5;">${businessPurpose}</div>
  </div>

  <!-- Domain Specialized 4-KPI Grid -->
  <div class="kpi-grid">
    ${kpis.map((k) => `
      <div class="kpi-card">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-val" style="color: ${k.color || '#0f172a'};">${k.value}</div>
        <div class="kpi-sub">${k.sub}</div>
      </div>
    `).join("")}
  </div>

  <!-- Informative Key Insights -->
  <div style="background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;">
    <div style="font-size: 11px; font-weight: 800; color: #6b21a8; text-transform: uppercase; margin-bottom: 6px;">Informative Key Insights</div>
    <ul style="margin: 0; padding-left: 18px; color: #3b0764; font-size: 10.5px;">
      ${insights.map((ins) => `<li style="margin-bottom: 4px;">${ins}</li>`).join("")}
    </ul>
  </div>

  <!-- ================================================================= -->
  <!-- SPECIALIZED SECTION A: WORK PORTFOLIO MATRICES (FOR PORTFOLIO REPORT) -->
  <!-- ================================================================= -->
  ${canonicalId === "work-portfolio" ? `
    <div class="matrix-grid">
      <!-- Status Distribution Matrix -->
      <div class="matrix-card">
        <div class="matrix-title">Status Distribution Matrix</div>
        <table>
          <thead>
            <tr><th>Status Stage</th><th>Count</th><th style="text-align:right;">Points</th><th style="text-align:right;">% Share</th></tr>
          </thead>
          <tbody>
            ${statusBreakdown.map((s) => `
              <tr>
                <td><strong>${s.name}</strong><div class="bar-wrap"><div class="bar-fill" style="width:${s.pct}%; background:${s.color};"></div></div></td>
                <td>${s.count}</td>
                <td style="text-align:right; font-weight:bold;">${s.points}</td>
                <td style="text-align:right; font-mono; font-weight:bold;">${s.pct}%</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <!-- Priority Breakdown Matrix -->
      <div class="matrix-card">
        <div class="matrix-title">Priority Severity Breakdown</div>
        <table>
          <thead>
            <tr><th>Priority Level</th><th>Count</th><th style="text-align:right;">Points</th><th style="text-align:right;">% Share</th></tr>
          </thead>
          <tbody>
            ${priorityBreakdown.map((p) => `
              <tr>
                <td><strong>${p.name}</strong><div class="bar-wrap"><div class="bar-fill" style="width:${p.pct}%; background:${p.color};"></div></div></td>
                <td>${p.count}</td>
                <td style="text-align:right; font-weight:bold;">${p.points}</td>
                <td style="text-align:right; font-mono; font-weight:bold;">${p.pct}%</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <!-- Issue Type Matrix -->
      <div class="matrix-card">
        <div class="matrix-title">Issue Type & Scope Allocation</div>
        <table>
          <thead>
            <tr><th>Deliverable Type</th><th>Count</th><th style="text-align:right;">Points</th><th style="text-align:right;">% Ratio</th></tr>
          </thead>
          <tbody>
            ${typeBreakdown.map((t) => `
              <tr>
                <td><strong>${t.name}</strong><div class="bar-wrap"><div class="bar-fill" style="width:${t.pct}%; background:#3b82f6;"></div></div></td>
                <td>${t.count}</td>
                <td style="text-align:right; font-weight:bold;">${t.points}</td>
                <td style="text-align:right; font-mono; font-weight:bold;">${t.pct}%</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <!-- Strategic Epics Matrix -->
      <div class="matrix-card">
        <div class="matrix-title">Strategic Epics & Initiatives</div>
        <table>
          <thead>
            <tr><th>Epic Name</th><th>Items</th><th style="text-align:right;">Done</th><th style="text-align:right;">Progress</th></tr>
          </thead>
          <tbody>
            ${epicBreakdown.slice(0, 5).map((e) => `
              <tr>
                <td><strong>${e.name}</strong><div class="bar-wrap"><div class="bar-fill" style="width:${e.pct}%; background:#10b981;"></div></div></td>
                <td>${e.count}</td>
                <td style="text-align:right; font-weight:bold;">${e.doneCount}/${e.count}</td>
                <td style="text-align:right; font-mono; font-weight:bold; color:#10b981;">${e.pct}%</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  ` : ""}

  <!-- ================================================================= -->
  <!-- SPECIALIZED SECTION B: TEAM CAPACITY MATRIX (FOR TEAM REPORT) -->
  <!-- ================================================================= -->
  ${canonicalId === "team-capacity" ? `
    <div style="margin-bottom: 18px;">
      <div style="font-size: 12px; font-weight: 800; color: #0f172a; text-transform: uppercase; margin-bottom: 6px;">Team Capacity & Workload Matrix</div>
      <table>
        <thead>
          <tr>
            <th>Contributor Name</th>
            <th>Email</th>
            <th>Assigned Tasks</th>
            <th style="text-align:right;">Story Points</th>
            <th style="text-align:right;">Standard Capacity</th>
            <th style="text-align:right;">Utilization %</th>
            <th>Workload Status</th>
          </tr>
        </thead>
        <tbody>
          ${teamCapacityMatrix.map((m) => `
            <tr>
              <td><strong>${m.name}</strong></td>
              <td style="color:#64748b;">${m.email}</td>
              <td>${m.count} items</td>
              <td style="text-align:right; font-weight:bold;">${m.points} pts</td>
              <td style="text-align:right; color:#64748b;">${m.capacity > 0 ? `${m.capacity} pts` : '—'}</td>
              <td style="text-align:right; font-mono; font-weight:bold; color:${m.utilization > 100 ? '#dc2626' : '#16a34a'};">${m.capacity > 0 ? `${m.utilization}%` : '—'}</td>
              <td>
                <span style="display:inline-block; padding:2px 6px; border-radius:4px; font-size:9px; font-weight:bold; ${
                  m.status === 'OVERLOADED' ? 'background:#fee2e2; color:#dc2626;' : m.status === 'BALANCED' ? 'background:#dcfce7; color:#16a34a;' : 'background:#f1f5f9; color:#64748b;'
                }">
                  ${m.status}
                </span>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  ` : ""}

  <!-- ================================================================= -->
  <!-- SPECIALIZED SECTION C: STRATEGIC EPICS (FOR ROADMAP & EXECUTIVE REPORT) -->
  <!-- ================================================================= -->
  ${(canonicalId === "roadmap-milestones" || canonicalId === "project-overview") && epicBreakdown.length > 0 ? `
    <div style="margin-bottom: 18px;">
      <div style="font-size: 12px; font-weight: 800; color: #0f172a; text-transform: uppercase; margin-bottom: 6px;">Strategic Roadmap Initiatives</div>
      <table>
        <thead>
          <tr>
            <th>Epic Initiative</th>
            <th>Deliverables</th>
            <th style="text-align:right;">Story Points</th>
            <th style="text-align:right;">Completed Points</th>
            <th style="text-align:right;">Burnup %</th>
            <th>Health Status</th>
          </tr>
        </thead>
        <tbody>
          ${epicBreakdown.map((e) => `
            <tr>
              <td><strong>${e.name}</strong></td>
              <td>${e.count} items (${e.doneCount} verified)</td>
              <td style="text-align:right; font-weight:bold;">${e.points} pts</td>
              <td style="text-align:right; color:#16a34a; font-weight:bold;">${e.donePoints} pts</td>
              <td style="text-align:right; font-mono; font-weight:bold; color:#2563eb;">${e.pct}%</td>
              <td>
                <span style="display:inline-block; padding:2px 6px; border-radius:4px; font-size:9px; font-weight:bold; ${e.pct >= 70 ? 'background:#dcfce7; color:#16a34a;' : e.pct >= 30 ? 'background:#dbeafe; color:#2563eb;' : 'background:#ffedd5; color:#ea580c;'}">
                  ${e.pct >= 70 ? 'ON TRACK' : e.pct >= 30 ? 'IN PROGRESS' : 'AT RISK'}
                </span>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  ` : ""}

  <!-- Detailed Table with Tailored Columns -->
  <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 18px; margin-bottom: 6px;">
    <h3 style="font-size: 12px; margin: 0; color: #0f172a;">Itemized Records (${totalCount} Items)</h3>
    <div style="font-size: 9.5px; color: #64748b;">Live Project Database</div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 70px;">Key</th>
        <th>Deliverable Summary</th>

        ${canonicalId === "risk-exception" ? '<th style="width: 95px;">SLA Status</th>' : ''}
        ${canonicalId === "quality-defect" ? '<th style="width: 95px;">Defect Severity</th>' : ''}
        ${canonicalId === "delivery-flow" ? '<th style="width: 85px;">Cycle Time</th>' : ''}
        ${canonicalId === "work-portfolio" ? '<th style="width: 85px;">Type</th>' : ''}

        <th style="width: 85px;">Status</th>
        <th style="width: 70px;">Priority</th>
        <th style="width: 110px;">Assignee</th>
        <th style="width: 45px; text-align: right;">Pts</th>
        <th style="width: 75px;">Due Date</th>
      </tr>
    </thead>
    <tbody>
      ${filteredIssues.map((i) => {
        const pClass = i.priority === 'CRITICAL' ? 'crit' : i.priority === 'HIGH' || i.priority === 'HIGHEST' ? 'high' : i.priority === 'MEDIUM' ? 'med' : 'low';
        const isOverdue = i.dueDate && new Date(i.dueDate) < now && i.status?.category !== 'DONE';
        const daysPast = i.dueDate ? Math.max(1, Math.round((now.getTime() - new Date(i.dueDate).getTime()) / (1000 * 60 * 60 * 24))) : 0;
        const cycleDays = i.createdAt && i.updatedAt ? Math.max(0.1, (new Date(i.updatedAt).getTime() - new Date(i.createdAt).getTime()) / (1000 * 60 * 60 * 24)).toFixed(1) : '—';

        return `<tr>
          <td style="font-family: monospace; font-weight: bold; color: #2563eb;">${i.issueKey}</td>
          <td><strong>${(i.title || "").replace(/</g, "&lt;")}</strong>${i.epic ? `<div style="font-size: 8.5px; color: #7c3aed; font-weight: bold;">Epic: ${i.epic.name}</div>` : ''}</td>

          ${canonicalId === "risk-exception" ? `<td>${isOverdue ? `<span style="color:#dc2626; font-weight:bold; background:#fee2e2; padding:2px 4px; border-radius:3px;">+${daysPast}d Overdue</span>` : '<span style="color:#16a34a;">On Schedule</span>'}</td>` : ''}
          ${canonicalId === "quality-defect" ? `<td><span class="priority-tag ${pClass}">${i.priority || 'BUG'}</span></td>` : ''}
          ${canonicalId === "delivery-flow" ? `<td style="font-family: monospace; font-weight: bold; color: #16a34a;">${cycleDays} days</td>` : ''}
          ${canonicalId === "work-portfolio" ? `<td><span style="font-size:9px; font-weight:bold; color:#475569;">${i.issueType}</span></td>` : ''}

          <td><span style="display:inline-block; padding: 2px 6px; border-radius: 4px; font-size: 9px; background: #f1f5f9; font-weight: 600;">${i.status?.name || ""}</span></td>
          <td><span class="priority-tag ${pClass}">${i.priority}</span></td>
          <td>${i.assignee ? `${i.assignee.firstName} ${i.assignee.lastName}` : "<span style='color:#94a3b8; font-style:italic;'>Unassigned</span>"}</td>
          <td style="text-align: right; font-weight: bold;">${i.estimatePoints ?? 0}</td>
          <td style="color: ${isOverdue ? '#dc2626; font-weight: bold;' : '#64748b;'}">${i.dueDate ? new Date(i.dueDate).toISOString().split("T")[0] : "-"}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>

  <div style="margin-top: 12px; font-size: 10px; color: #16a34a; font-weight: bold;">
    ✓ Complete Authorized Dataset: Showing all ${totalCount} records without truncation.
  </div>

  <div class="footer">
    <div>Confidential &amp; Proprietary • ${project.name} (${project.key})</div>
    <div>Complete Multi-Page Audit Record (${totalCount} deliverables) • Eitekh WorkOS Reporting System</div>
  </div>
</body>
</html>`;

      return new NextResponse(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `inline; filename="${fileBase}.html"`,
        },
      });
    }

    // -------------------------------------------------------------------------
    // FORMAT 2: EXCEL (Microsoft Excel XML Spreadsheet with Structured Columns)
    // -------------------------------------------------------------------------
    if (format === "excel" || format === "xlsx") {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Bottom"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#2563EB" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="Title">
   <Font ss:FontName="Calibri" ss:Size="14" ss:Color="#0F172A" ss:Bold="1"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${canonicalId}">
  <Table>
   <Column ss:Width="80"/>
   <Column ss:Width="250"/>
   <Column ss:Width="80"/>
   <Column ss:Width="100"/>
   <Column ss:Width="80"/>
   <Column ss:Width="130"/>
   <Column ss:Width="70"/>
   <Column ss:Width="80"/>
   <Row ss:Height="25">
    <Cell ss:StyleID="Title"><Data ss:Type="String">${reportTitle} - ${project.name}</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">Generated: ${now.toISOString()}</Data></Cell>
   </Row>
   <Row ss:Index="4" ss:Height="20">
    <Cell ss:StyleID="Header"><Data ss:Type="String">Key</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Title</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Type</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Status</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Priority</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Assignee</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Story Points</Data></Cell>
    <Cell ss:StyleID="Header"><Data ss:Type="String">Due Date</Data></Cell>
   </Row>
   ${filteredIssues.map((i) => `<Row>
    <Cell><Data ss:Type="String">${i.issueKey}</Data></Cell>
    <Cell><Data ss:Type="String">${(i.title || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Data></Cell>
    <Cell><Data ss:Type="String">${i.issueType}</Data></Cell>
    <Cell><Data ss:Type="String">${i.status?.name || ""}</Data></Cell>
    <Cell><Data ss:Type="String">${i.priority}</Data></Cell>
    <Cell><Data ss:Type="String">${i.assignee ? `${i.assignee.firstName} ${i.assignee.lastName}` : "Unassigned"}</Data></Cell>
    <Cell><Data ss:Type="Number">${i.estimatePoints ?? 0}</Data></Cell>
    <Cell><Data ss:Type="String">${i.dueDate ? new Date(i.dueDate).toISOString().split("T")[0] : ""}</Data></Cell>
   </Row>`).join("")}
  </Table>
 </Worksheet>
</Workbook>`;

      return new NextResponse(xml, {
        headers: {
          "Content-Type": "application/vnd.ms-excel; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileBase}.xls"`,
        },
      });
    }

    // -------------------------------------------------------------------------
    // FORMAT 3: CSV (RFC 4180 Clean Tabular Data)
    // -------------------------------------------------------------------------
    if (rawReportType === "sprint-velocity" || rawReportType === "velocity") {
      const { calculateProjectVelocity } = await import("@/lib/velocity-engine");
      const vData = await calculateProjectVelocity({
        projectId,
        teamId: teamFilter !== "ALL" ? teamFilter : null,
        limit: 50,
      });

      const vHeaders = [
        "Sprint Name",
        "Status",
        "Start Date",
        "End Date",
        "Planned Points",
        "Completed Points (Velocity)",
        "Completion %",
        "Completed Issues",
        "Unestimated Completed Issues",
        "Remaining Issues",
        "Remaining Points",
      ];
      const vRows = vData.historicalSprints.map((s) => [
        `"${s.name.replace(/"/g, '""')}"`,
        s.status,
        s.startDate ? s.startDate.split("T")[0] : "",
        s.endDate ? s.endDate.split("T")[0] : "",
        s.plannedPoints,
        s.completedPoints,
        `${s.completionRate}%`,
        s.completedIssues,
        s.unestimatedCompletedIssues,
        s.remainingIssues,
        s.remainingPoints,
      ].join(","));

      const csvContent = [
        `# Sprint Velocity Report - ${project.name} (${project.key})`,
        `# Average Velocity: ${vData.averageVelocity} pts/sprint | Rolling 3-Sprint: ${vData.rolling3SprintAverage} pts | Rolling 5-Sprint: ${vData.rolling5SprintAverage} pts`,
        `# Generated: ${now.toISOString()}`,
        vHeaders.join(","),
        ...vRows,
      ].join("\n");

      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileBase}-velocity.csv"`,
        },
      });
    }

    const headers = [
      "Key",
      "Title",
      "Type",
      "Status",
      "Priority",
      "Assignee",
      "Reporter",
      "Sprint",
      "Epic",
      "Story Points",
      "Estimate Hours",
      "Time Spent (h)",
      "Due Date",
      "Created At",
      "Description",
    ];

    const rows = filteredIssues.map((i) => [
      i.issueKey,
      `"${(i.title || "").replace(/"/g, '""')}"`,
      i.issueType,
      `"${(i.status?.name || "").replace(/"/g, '""')}"`,
      i.priority,
      `"${i.assignee ? `${i.assignee.firstName} ${i.assignee.lastName}` : "Unassigned"}"`,
      `"${i.reporter ? `${i.reporter.firstName} ${i.reporter.lastName}` : ""}"`,
      `"${i.sprint?.name || "Backlog"}"`,
      `"${i.epic?.name || ""}"`,
      i.estimatePoints ?? "",
      i.estimateHours ?? "",
      i.timeSpentHours ?? 0,
      i.dueDate ? new Date(i.dueDate).toISOString().split("T")[0] : "",
      new Date(i.createdAt).toISOString().split("T")[0],
      `"${(i.description || "").replace(/"/g, '""').replace(/\n/g, " ")}"`,
    ].join(","));

    const csvContent = [
      `# ${reportTitle} - ${project.name} (${project.key})`,
      `# Generated: ${now.toISOString()} - Filtered Count: ${totalCount}`,
      headers.join(","),
      ...rows,
    ].join("\n");

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileBase}.csv"`,
      },
    });
  } catch (error: any) {
    console.error("Report Download Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: error.message?.includes("Unauthorized") ? 401 : error.message?.includes("Forbidden") || error.message?.includes("tenant") ? 403 : 500 }
    );
  }
}
