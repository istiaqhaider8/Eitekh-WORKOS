import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { assertProjectPermission } from "@/lib/tenant";
import { bulkMemberImportSchema, parseJsonBody } from "@/lib/validation";
import { readCsvTable, cell, stripCsvComments } from "@/lib/csv";
import { ALLOWED_PROJECT_ROLES, MAX_IMPORT_ROWS, summarise, type RowResult } from "@/lib/bulk-import";
import { logAuditEvent } from "@/lib/audit-logger";
import { handleApiError } from "@/lib/api-error";

/**
 * Bulk project member upload.
 *
 * Authorization is the same gate the single-member route uses
 * ("projects:manage_members"), so bulk upload is not a way around PBAC.
 *
 * Tenant isolation is enforced by requiring every target user to already be a
 * member of THIS project's organization. Without that check, a CSV of arbitrary
 * email addresses would be a way to pull users out of other organizations into
 * a project — the bulk equivalent of a cross-tenant assignment.
 *
 * Unlike the single-member route, bulk upload deliberately does NOT create
 * users or send invitations: a mistyped column would otherwise mass-invite
 * strangers. Unknown emails are reported as failures for the operator to fix.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id: projectId } = await params;

    const { project } = await assertProjectPermission(projectId, "projects:manage_members");

    const parsed = await parseJsonBody(request, bulkMemberImportSchema);
    if (!parsed.success) return parsed.error;
    const { csvData, mode } = parsed.data;

    const { headers, rows } = readCsvTable(stripCsvComments(csvData));

    if (headers.length === 0 || rows.length === 0) {
      return NextResponse.json(
        { error: "The file needs a header row and at least one data row." },
        { status: 400 }
      );
    }
    if (!headers.includes("email")) {
      return NextResponse.json(
        { error: `An "email" column is required. Found: ${headers.join(", ")}` },
        { status: 400 }
      );
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        { error: `Too many rows: ${rows.length}. The maximum per upload is ${MAX_IMPORT_ROWS}.` },
        { status: 400 }
      );
    }

    const fullProject = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, key: true, name: true, workspace: { select: { orgId: true } } },
    });
    if (!fullProject) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const orgId = fullProject.workspace.orgId;

    // Reference data loaded once. Org membership is the tenant boundary.
    const [orgMembers, existingMembers] = await Promise.all([
      prisma.organizationMember.findMany({
        where: { orgId },
        select: { userId: true, user: { select: { email: true, status: true } } },
      }),
      prisma.projectMember.findMany({
        where: { projectId },
        select: { userId: true, role: true, user: { select: { email: true } } },
      }),
    ]);

    const orgMemberByEmail = new Map(
      orgMembers
        .filter((m) => m.user?.email)
        .map((m) => [m.user!.email.trim().toLowerCase(), { userId: m.userId, status: m.user!.status }])
    );
    const alreadyInProject = new Map(
      existingMembers
        .filter((m) => m.user?.email)
        .map((m) => [m.user!.email.trim().toLowerCase(), m.role])
    );

    const results: RowResult[] = [];
    const prepared: { rowNumber: number; email: string; userId: string; role: string }[] = [];
    const emailsSeen = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2;
      const row = rows[i];
      const rawEmail = cell(headers, row, "email");
      const email = rawEmail.toLowerCase();

      const fail = (reason: string) =>
        results.push({ row: rowNumber, outcome: "failed", subject: rawEmail || "(no email)", reason });
      const skip = (reason: string) =>
        results.push({ row: rowNumber, outcome: "skipped", subject: rawEmail, reason });

      if (!rawEmail) {
        fail("email is required");
        continue;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        fail(`"${rawEmail}" is not a valid email address`);
        continue;
      }

      // Role whitelist — mirrors the single-member route so an org-scoped PBAC
      // role id cannot be smuggled in as a project role.
      //
      // Checked BEFORE the cross-row duplicate test on purpose: a row's own
      // fields must be judged on their own merits. Testing duplicates first
      // meant a row with an invalid role was reported as "duplicate", which
      // told the operator nothing about the actual mistake in that row.
      const rawRole = cell(headers, row, "role");
      const role = rawRole ? rawRole.toUpperCase() : "PROJECT_MEMBER";
      if (!ALLOWED_PROJECT_ROLES.has(role)) {
        fail(`role "${rawRole}" is not allowed (${[...ALLOWED_PROJECT_ROLES].join(", ")})`);
        continue;
      }

      if (emailsSeen.has(email)) {
        skip("duplicate of an earlier row in this file");
        continue;
      }

      // Tenant boundary: the user must already belong to this organization.
      // A user who exists but is in a different org is reported the same way as
      // one who does not exist at all, so this cannot be used to probe for
      // accounts in other tenants.
      const orgMember = orgMemberByEmail.get(email);
      if (!orgMember) {
        fail("no user with this email in this organization");
        continue;
      }
      if (orgMember.status === "SUSPENDED" || orgMember.status === "INACTIVE") {
        fail(`user account is ${String(orgMember.status).toLowerCase()}`);
        continue;
      }

      const existingRole = alreadyInProject.get(email);
      if (existingRole) {
        skip(`already a project member (${existingRole})`);
        continue;
      }

      emailsSeen.add(email);
      prepared.push({ rowNumber, email: rawEmail, userId: orgMember.userId, role });
    }

    if (mode === "validate") {
      const previewResults = [
        ...results,
        ...prepared.map((p) => ({
          row: p.rowNumber,
          outcome: "created" as const,
          subject: p.email,
          reason: `will be added as ${p.role}`,
        })),
      ].sort((a, b) => a.row - b.row);

      return NextResponse.json(summarise("validate", previewResults));
    }

    if (prepared.length === 0) {
      return NextResponse.json(summarise("import", results.sort((a, b) => a.row - b.row)));
    }

    // createMany with a single transaction. The unique constraint on
    // (projectId, userId) is the final guard against a duplicate slipping in
    // between validation and write.
    const createdRows = await prisma.$transaction(async (tx) => {
      const out: { rowNumber: number; email: string; id: string }[] = [];
      for (const p of prepared) {
        const created = await tx.projectMember.create({
          data: { projectId, userId: p.userId, role: p.role },
          select: { id: true },
        });
        out.push({ rowNumber: p.rowNumber, email: p.email, id: created.id });
      }
      return out;
    });

    for (const c of createdRows) {
      const p = prepared.find((x) => x.rowNumber === c.rowNumber)!;
      results.push({
        row: c.rowNumber,
        outcome: "created",
        subject: c.email,
        reason: `added as ${p.role}`,
        createdId: c.id,
      });
    }

    // Membership changes are a permission change, so they belong in the audit
    // trail just as the single-member route records them.
    await logAuditEvent({
      actor: { id: user.id, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email, email: user.email },
      action: "PROJECT_MEMBERS_BULK_ADDED",
      category: "PROJECT",
      severity: "INFO",
      status: "SUCCESS",
      targetResource: `Project:${fullProject.key}`,
      orgId,
      details: {
        projectId,
        added: createdRows.length,
        roles: prepared.map((p) => ({ email: p.email, role: p.role })),
      },
    }).catch((e) => console.error("Failed to audit bulk member add:", e));

    return NextResponse.json(summarise("import", results.sort((a, b) => a.row - b.row)));
  } catch (error: any) {
    const msg = error?.message || "Internal Server Error";
    return handleApiError(error, "projects/[id]/members/bulk");
  }
}
