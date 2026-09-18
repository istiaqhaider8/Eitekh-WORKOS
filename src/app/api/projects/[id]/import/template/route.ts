import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertProjectPermission } from "@/lib/tenant";
import { buildTemplate } from "@/lib/csv";
import { TASK_IMPORT_HEADERS, MEMBER_IMPORT_HEADERS, ALLOWED_PROJECT_ROLES } from "@/lib/bulk-import";

/**
 * Downloadable CSV templates for bulk import.
 *
 * The allowed values in the reference block are read from THIS project's live
 * data (its workflow statuses, priorities, types, sprints, epics and members),
 * and the header lists are the same constants the importer validates against.
 * A template therefore cannot drift from the schema that will accept it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;

    const type = (req.nextUrl.searchParams.get("type") || "tasks").toLowerCase();
    const isMemberTemplate = type === "members" || type === "users";

    // A template is gated on the SAME permission as the upload it feeds, not
    // merely on project access. The member template lists the email addresses
    // of org members who are not yet in the project, which someone who cannot
    // manage members has no reason to receive.
    await assertProjectPermission(
      projectId,
      isMemberTemplate ? "projects:manage_members" : "export:import_data"
    );

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        key: true,
        name: true,
        workspace: { select: { orgId: true } },
      },
    });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    if (isMemberTemplate) {
      // Only org members can be added to a project, so the template lists the
      // candidates rather than letting someone guess at emails.
      const orgMembers = await prisma.organizationMember.findMany({
        where: { orgId: project.workspace.orgId },
        select: { user: { select: { email: true } } },
        take: 50,
      });
      const existing = await prisma.projectMember.findMany({
        where: { projectId },
        select: { user: { select: { email: true } } },
      });
      const existingSet = new Set(existing.map((m) => m.user?.email).filter(Boolean));
      const candidates = orgMembers
        .map((m) => m.user?.email)
        .filter((e): e is string => Boolean(e) && !existingSet.has(e));

      const csv = buildTemplate({
        headers: MEMBER_IMPORT_HEADERS,
        exampleRows: [[candidates[0] || "person@example.com", "PROJECT_MEMBER"]],
        notes: [
          `Bulk project member upload — ${project.name} (${project.key})`,
          "",
          "Required column: email",
          "Optional column: role (defaults to PROJECT_MEMBER)",
          "",
          `Allowed roles: ${[...ALLOWED_PROJECT_ROLES].join(" | ")}`,
          "",
          "The user must already exist and belong to this project's organization.",
          "Users already in the project are reported as skipped, not duplicated.",
          candidates.length
            ? `Org members not yet in this project: ${candidates.slice(0, 15).join(", ")}${candidates.length > 15 ? ", ..." : ""}`
            : "Every org member is already in this project.",
          "",
          "Lines starting with # are ignored. Delete these notes or leave them.",
        ],
      });

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${project.key}-project-members-template.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // ---- Task template ----
    const [statuses, sprints, epics, members, priorities, types] = await Promise.all([
      prisma.workflowStatus.findMany({
        where: { workflow: { projectId } },
        select: { name: true },
        orderBy: { position: "asc" },
      }),
      prisma.sprint.findMany({ where: { projectId }, select: { name: true }, take: 25 }),
      prisma.epic.findMany({ where: { projectId }, select: { name: true }, take: 25 }),
      prisma.projectMember.findMany({
        where: { projectId },
        select: { user: { select: { email: true } } },
        take: 25,
      }),
      // Priorities and types come from the same source the UI dropdowns use.
      Promise.resolve(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
      Promise.resolve(["TASK", "BUG", "STORY", "EPIC", "SUBTASK"]),
    ]);

    const statusNames = statuses.map((s) => s.name);
    const memberEmails = members.map((m) => m.user?.email).filter(Boolean) as string[];

    const csv = buildTemplate({
      headers: TASK_IMPORT_HEADERS,
      exampleRows: [
        [
          "Example: wire up the settings page",
          "Optional longer description of the work.",
          "TASK",
          "MEDIUM",
          statusNames[0] || "",
          memberEmails[0] || "",
          sprints[0]?.name || "",
          epics[0]?.name || "",
          5,
          "01-10-2026",
          "15-10-2026",
        ],
      ],
      notes: [
        `Bulk task upload — ${project.name} (${project.key})`,
        "",
        "Required column: title",
        "All other columns are optional; blank means 'use the project default'.",
        "",
        `type:     ${types.join(" | ")}`,
        `priority: ${priorities.join(" | ")}`,
        `status:   ${statusNames.length ? statusNames.join(" | ") : "(this project has no workflow statuses)"}`,
        `assignee: an email of a project member — ${memberEmails.length ? memberEmails.join(", ") : "(no members yet)"}`,
        `sprint:   ${sprints.length ? sprints.map((s) => s.name).join(" | ") : "(no sprints)"}`,
        `epic:     ${epics.length ? epics.map((e) => e.name).join(" | ") : "(no epics)"}`,
        "points:   a whole number, 0 or greater",
        "startdate / duedate: DD-MM-YYYY, e.g. 01-10-2026. A due date cannot precede",
        "          the start date. Slashes are fine (01/10/2026) -- a spreadsheet",
        "          often rewrites dates that way on save.",
        "",
        "A row whose title already exists in this project is reported as a",
        "duplicate and skipped, so re-uploading the same file is safe.",
        "",
        "Lines starting with # are ignored. Delete these notes or leave them.",
      ],
    });

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${project.key}-tasks-template.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    const msg = error?.message || "Failed to build template";
    const status = msg.includes("Unauthorized")
      ? 401
      : msg.includes("Forbidden") || msg.includes("access")
      ? 403
      // "Project not found" from assertProjectAccess; 500 here reported a
      // mistyped project id as a server fault.
      : msg.includes("not found")
      ? 404
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
