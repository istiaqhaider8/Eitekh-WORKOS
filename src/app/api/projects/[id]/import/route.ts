import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectPermission } from "@/lib/tenant";
import { bulkTaskImportSchema, parseJsonBody } from "@/lib/validation";
import { readCsvTable, cell, stripCsvComments } from "@/lib/csv";
import { handleApiError } from "@/lib/api-error";
import {
  ALLOWED_ISSUE_TYPES,
  ALLOWED_PRIORITIES,
  MAX_IMPORT_ROWS,
  parseDateCell,
  parseIntCell,
  summarise,
  type RowResult,
} from "@/lib/bulk-import";

/**
 * Bulk task upload.
 *
 * `mode: "validate"` performs every check and writes nothing — that is the
 * preview the UI shows before the user commits. `mode: "import"` re-runs the
 * same validation and then writes only the rows that passed, so a preview and
 * the subsequent import can never disagree about what is valid.
 *
 * Replaces an earlier version that read only title and description, ignored
 * every other column, performed no validation, had no duplicate detection, and
 * called project.update() once per row to allocate an issue key (an N+1 that
 * also raced concurrent creates).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id: projectId } = await params;

    await assertProjectPermission(projectId, "export:import_data");

    const parsed = await parseJsonBody(request, bulkTaskImportSchema);
    if (!parsed.success) return parsed.error;
    const { csvData, mode } = parsed.data;

    const { headers, rows } = readCsvTable(stripCsvComments(csvData));

    if (headers.length === 0 || rows.length === 0) {
      return NextResponse.json(
        { error: "The file needs a header row and at least one data row." },
        { status: 400 }
      );
    }
    if (!headers.includes("title")) {
      return NextResponse.json(
        { error: `A "title" column is required. Found: ${headers.join(", ")}` },
        { status: 400 }
      );
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        { error: `Too many rows: ${rows.length}. The maximum per upload is ${MAX_IMPORT_ROWS}.` },
        { status: 400 }
      );
    }

    // ---- Load the project's reference data once, not per row ----
    const [statuses, sprints, epics, members, existingIssues] = await Promise.all([
      prisma.workflowStatus.findMany({
        where: { workflow: { projectId } },
        select: { id: true, name: true },
        orderBy: { position: "asc" },
      }),
      prisma.sprint.findMany({ where: { projectId }, select: { id: true, name: true } }),
      prisma.epic.findMany({ where: { projectId }, select: { id: true, name: true } }),
      prisma.projectMember.findMany({
        where: { projectId },
        select: { userId: true, user: { select: { email: true } } },
      }),
      prisma.issue.findMany({ where: { projectId }, select: { title: true } }),
    ]);

    if (statuses.length === 0) {
      return NextResponse.json(
        { error: "This project has no workflow statuses, so tasks cannot be created." },
        { status: 400 }
      );
    }

    const byLower = <T extends { name: string }>(list: T[]) =>
      new Map(list.map((x) => [x.name.trim().toLowerCase(), x]));
    const statusMap = byLower(statuses);
    const sprintMap = byLower(sprints);
    const epicMap = byLower(epics);
    // Assignees are resolved against PROJECT MEMBERS only. Accepting any user
    // in the system would let an import assign work to someone with no access
    // to the project, which is also how cross-tenant references creep in.
    const memberMap = new Map(
      members
        .filter((m) => m.user?.email)
        .map((m) => [m.user!.email.trim().toLowerCase(), m.userId])
    );

    const existingTitles = new Set(existingIssues.map((i) => i.title.trim().toLowerCase()));
    const titlesSeenInFile = new Set<string>();

    interface PreparedRow {
      rowNumber: number;
      title: string;
      data: {
        description: string | null;
        issueType: string;
        priority: string;
        statusId: string;
        assigneeId: string | null;
        sprintId: string | null;
        epicId: string | null;
        estimatePoints: number | null;
        startDate: Date | null;
        dueDate: Date | null;
      };
    }

    const results: RowResult[] = [];
    const prepared: PreparedRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      // +2 because row 1 is the header and spreadsheets are 1-based.
      const rowNumber = i + 2;
      const row = rows[i];
      const title = cell(headers, row, "title");

      const fail = (reason: string) =>
        results.push({ row: rowNumber, outcome: "failed", subject: title || "(no title)", reason });
      const skip = (reason: string) =>
        results.push({ row: rowNumber, outcome: "skipped", subject: title || "(no title)", reason });

      if (!title) {
        fail("title is required");
        continue;
      }
      if (title.length > 500) {
        fail(`title is too long (${title.length} characters, maximum 500)`);
        continue;
      }

      const key = title.trim().toLowerCase();

      // Field validation runs BEFORE the duplicate checks so a row carrying a
      // genuine data error is reported as that error rather than as a
      // duplicate. A row can be both, and the fixable mistake is the useful
      // thing to tell the operator.

      // ---- type ----
      const rawType = cell(headers, row, "type").toUpperCase();
      if (rawType && !ALLOWED_ISSUE_TYPES.has(rawType)) {
        fail(`type "${rawType}" is not valid (${[...ALLOWED_ISSUE_TYPES].join(", ")})`);
        continue;
      }

      // ---- priority ----
      const rawPriority = cell(headers, row, "priority").toUpperCase();
      if (rawPriority && !ALLOWED_PRIORITIES.has(rawPriority)) {
        fail(`priority "${rawPriority}" is not valid (${[...ALLOWED_PRIORITIES].join(", ")})`);
        continue;
      }

      // ---- status ----
      const rawStatus = cell(headers, row, "status");
      let statusId = statuses[0].id;
      if (rawStatus) {
        const found = statusMap.get(rawStatus.toLowerCase());
        if (!found) {
          fail(`status "${rawStatus}" does not exist in this project (${statuses.map((s) => s.name).join(", ")})`);
          continue;
        }
        statusId = found.id;
      }

      // ---- assignee ----
      const rawAssignee = cell(headers, row, "assignee");
      let assigneeId: string | null = null;
      if (rawAssignee) {
        const found = memberMap.get(rawAssignee.toLowerCase());
        if (!found) {
          fail(`assignee "${rawAssignee}" is not a member of this project`);
          continue;
        }
        assigneeId = found;
      }

      // ---- sprint ----
      const rawSprint = cell(headers, row, "sprint");
      let sprintId: string | null = null;
      if (rawSprint) {
        const found = sprintMap.get(rawSprint.toLowerCase());
        if (!found) {
          fail(`sprint "${rawSprint}" does not exist in this project`);
          continue;
        }
        sprintId = found.id;
      }

      // ---- epic ----
      const rawEpic = cell(headers, row, "epic");
      let epicId: string | null = null;
      if (rawEpic) {
        const found = epicMap.get(rawEpic.toLowerCase());
        if (!found) {
          fail(`epic "${rawEpic}" does not exist in this project`);
          continue;
        }
        epicId = found.id;
      }

      // ---- points ----
      const pointsResult = parseIntCell(cell(headers, row, "points"), "points");
      if (!pointsResult.ok) {
        fail(pointsResult.error);
        continue;
      }

      // ---- dates ----
      const startResult = parseDateCell(cell(headers, row, "startdate"));
      if (!startResult.ok) {
        fail(`startdate: ${startResult.error}`);
        continue;
      }
      const dueResult = parseDateCell(cell(headers, row, "duedate"));
      if (!dueResult.ok) {
        fail(`duedate: ${dueResult.error}`);
        continue;
      }
      if (startResult.date && dueResult.date && dueResult.date < startResult.date) {
        fail("duedate cannot be earlier than startdate");
        continue;
      }

      const description = cell(headers, row, "description");
      if (description.length > 20000) {
        fail(`description is too long (${description.length} characters)`);
        continue;
      }

      // Duplicate checks last: the row is well-formed, so the only remaining
      // reason not to create it is that it already exists.
      if (titlesSeenInFile.has(key)) {
        skip("duplicate of an earlier row in this file");
        continue;
      }
      if (existingTitles.has(key)) {
        skip("a task with this title already exists in the project");
        continue;
      }

      titlesSeenInFile.add(key);
      prepared.push({
        rowNumber,
        title: title.trim(),
        data: {
          description: description || null,
          issueType: rawType || "TASK",
          priority: rawPriority || "MEDIUM",
          statusId,
          assigneeId,
          sprintId,
          epicId,
          estimatePoints: pointsResult.value,
          startDate: startResult.date,
          dueDate: dueResult.date,
        },
      });
    }

    // ---- Preview: report what WOULD happen, write nothing ----
    if (mode === "validate") {
      const previewResults = [
        ...results,
        ...prepared.map((p) => ({
          row: p.rowNumber,
          outcome: "created" as const,
          subject: p.title,
        })),
      ].sort((a, b) => a.row - b.row);

      return NextResponse.json(summarise("validate", previewResults));
    }

    // ---- Import ----
    if (prepared.length === 0) {
      return NextResponse.json(summarise("import", results.sort((a, b) => a.row - b.row)));
    }

    // Allocate the whole key range in ONE update instead of once per row, then
    // hand out numbers locally. The previous per-row update was both an N+1 and
    // a race against concurrent issue creation.
    const created = await prisma.$transaction(async (tx) => {
      const maxIssue = await tx.issue.findFirst({
        where: { projectId },
        orderBy: { keyNumber: "desc" },
        select: { keyNumber: true },
      });
      const highestExisting = maxIssue?.keyNumber || 0;

      const project = await tx.project.update({
        where: { id: projectId },
        data: { issueCounter: { increment: prepared.length } },
        select: { key: true, issueCounter: true },
      });

      // issueCounter now points at the END of our reserved block.
      let next = project.issueCounter - prepared.length;
      if (next < highestExisting) {
        // The counter had drifted behind reality (possible with older data);
        // start above the highest real key so issueKey stays unique.
        next = highestExisting;
      }

      const out: { rowNumber: number; id: string; issueKey: string; title: string }[] = [];
      for (const p of prepared) {
        next += 1;
        const issueKey = `${project.key}-${next}`;
        const issue = await tx.issue.create({
          data: {
            projectId,
            keyNumber: next,
            issueKey,
            title: p.title,
            description: p.data.description,
            issueType: p.data.issueType,
            priority: p.data.priority,
            statusId: p.data.statusId,
            assigneeId: p.data.assigneeId,
            sprintId: p.data.sprintId,
            epicId: p.data.epicId,
            estimatePoints: p.data.estimatePoints,
            startDate: p.data.startDate,
            dueDate: p.data.dueDate,
            reporterId: user.id,
          },
          select: { id: true, issueKey: true },
        });
        out.push({ rowNumber: p.rowNumber, id: issue.id, issueKey: issue.issueKey, title: p.title });
      }
      return out;
    });

    for (const c of created) {
      results.push({
        row: c.rowNumber,
        outcome: "created",
        subject: c.title,
        createdId: c.id,
        createdKey: c.issueKey,
      });
    }

    return NextResponse.json(summarise("import", results.sort((a, b) => a.row - b.row)));
  } catch (error: any) {
    const msg = error?.message || "Internal Server Error";
    return handleApiError(error, "projects/[id]/import");
  }
}
