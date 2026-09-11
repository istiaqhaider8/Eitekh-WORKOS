import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectAccess, assertProjectPermission } from "@/lib/tenant";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id: projectId } = await params;

    const { searchParams } = new URL(request.url);
    const format = (searchParams.get("format") || "json").toLowerCase();
    const requiredPerm = format === "excel" ? "export:excel" : format === "pdf" ? "export:pdf" : "export:csv";
    await assertProjectPermission(projectId, requiredPerm);
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

    // Fetch Project and Team Info
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        projectTeams: {
          include: {
            members: true,
          }
        },
        sprints: true,
      }
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const activeSprint = project.sprints.find((s) => s.status === "ACTIVE") || null;

    // Collect team member user IDs for team filtering
    let teamMemberIds: Set<string> | null = null;
    if (teamFilter !== "ALL") {
      const selectedTeam = project.projectTeams.find((t) => t.id === teamFilter);
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

    const allIssues = await prisma.issue.findMany({
      where: { projectId },
      include: {
        status: true,
        assignee: true,
        reporter: true,
        sprint: true,
        epic: true,
        team: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Apply Filter Criteria
    const filteredIssues = allIssues.filter((issue) => {
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

    const timestamp = new Date().toISOString().split("T")[0];
    const fileBase = `${project.key}-report-${timestamp}`;

    // 1. CSV Format
    if (format === "csv") {
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

      const rows = filteredIssues.map((issue) => [
        issue.issueKey,
        `"${(issue.title || "").replace(/"/g, '""')}"`,
        issue.issueType,
        `"${(issue.status?.name || "").replace(/"/g, '""')}"`,
        issue.priority,
        `"${issue.assignee ? `${issue.assignee.firstName} ${issue.assignee.lastName}` : "Unassigned"}"`,
        `"${issue.reporter ? `${issue.reporter.firstName} ${issue.reporter.lastName}` : ""}"`,
        `"${issue.sprint?.name || "Backlog"}"`,
        `"${issue.epic?.name || ""}"`,
        issue.estimatePoints ?? "",
        issue.estimateHours ?? "",
        issue.timeSpentHours ?? 0,
        issue.dueDate ? new Date(issue.dueDate).toISOString().split("T")[0] : "",
        new Date(issue.createdAt).toISOString().split("T")[0],
        `"${(issue.description || "").replace(/"/g, '""').replace(/\n/g, " ")}"`,
      ].join(","));

      const csvContent = [headers.join(","), ...rows].join("\n");

      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileBase}.csv"`,
        },
      });
    }

    // 2. TSV / Excel Format
    if (format === "tsv") {
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
      ];

      const rows = filteredIssues.map((issue) => [
        issue.issueKey,
        (issue.title || "").replace(/\t|\n/g, " "),
        issue.issueType,
        issue.status?.name || "",
        issue.priority,
        issue.assignee ? `${issue.assignee.firstName} ${issue.assignee.lastName}` : "Unassigned",
        issue.reporter ? `${issue.reporter.firstName} ${issue.reporter.lastName}` : "",
        issue.sprint?.name || "Backlog",
        issue.epic?.name || "",
        issue.estimatePoints ?? "",
        issue.estimateHours ?? "",
        issue.timeSpentHours ?? 0,
        issue.dueDate ? new Date(issue.dueDate).toISOString().split("T")[0] : "",
        new Date(issue.createdAt).toISOString().split("T")[0],
      ].join("\t"));

      const tsvContent = [headers.join("\t"), ...rows].join("\n");

      return new NextResponse(tsvContent, {
        headers: {
          "Content-Type": "text/tab-separated-values; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileBase}.tsv"`,
        },
      });
    }

    // 3. JSON Format
    const jsonReport = {
      project: {
        id: project.id,
        name: project.name,
        key: project.key,
      },
      exportedAt: new Date().toISOString(),
      filtersApplied: {
        sprint: sprintFilter,
        team: teamFilter,
        assignee: assigneeFilter,
        status: statusFilter,
        priority: priorityFilter,
        type: typeFilter,
        epic: epicFilter,
        timeRange: timeRangeFilter,
        search: searchQuery || null,
      },
      totalCount: filteredIssues.length,
      issues: filteredIssues,
    };

    return NextResponse.json(jsonReport, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileBase}.json"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: error.message?.includes("Unauthorized") ? 401 : error.message?.includes("Forbidden") || error.message?.includes("tenant") ? 403 : 500 }
    );
  }
}
