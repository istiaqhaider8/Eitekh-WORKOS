/**
 * A3 — realistic-volume dataset.
 *
 * Every performance claim about this system so far was measured on the seed
 * database: 460 rows, 5 issues. At that size nothing in PERFORMANCE-PLAN.md is
 * visible, and the 2026-09-18 work demonstrated the trap — the 20-relation
 * issue-detail query runs in 10 ms, so every "slow query" hypothesis was wrong
 * and the real causes were write contention and request fan-out. Measuring
 * against production-like volume is a prerequisite for Phases 5, 7 and 9.
 *
 * SAFETY: this script REFUSES to run against a database that is not obviously
 * a volume database. Pass DATABASE_URL explicitly and include "volume" in the
 * filename, or set VOLUME_SEED_FORCE=1. The default dev database holds real
 * work and 20,000 issues must not land in it.
 *
 *   DATABASE_URL="file:./volume.db" npx prisma migrate deploy
 *   DATABASE_URL="file:./volume.db" node prisma/seed-volume.js
 *
 * Scale is configurable so the same script serves a quick smoke run and a
 * full-size one:
 *   VOLUME_ORGS=3 VOLUME_PROJECTS=50 VOLUME_ISSUES=20000 node prisma/seed-volume.js
 *
 * Distribution is deliberately skewed rather than uniform, because the risks
 * being hunted are tail risks:
 *   - a few "hot" issues carry hundreds of comments and activity rows, which is
 *     what makes B10 (unbounded relation loads in GET /api/issues/[id]) bite
 *   - most issues carry almost nothing, as in real projects
 * A uniform spread would hide exactly the shape that hurts.
 */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const ORGS = Number(process.env.VOLUME_ORGS || 3);
const PROJECTS = Number(process.env.VOLUME_PROJECTS || 50);
const ISSUES = Number(process.env.VOLUME_ISSUES || 20000);
const USERS = Number(process.env.VOLUME_USERS || 120);
const BATCH = 500;

const dbUrl = process.env.DATABASE_URL || "";
if (!/volume/i.test(dbUrl) && process.env.VOLUME_SEED_FORCE !== "1") {
  console.error(
    `\nRefusing to run.\n\n` +
      `DATABASE_URL is "${dbUrl || "(unset)"}", which does not look like a volume database.\n` +
      `This script writes ${ISSUES.toLocaleString()} issues and would overwhelm a working database.\n\n` +
      `Use a dedicated file:\n` +
      `  DATABASE_URL="file:./volume.db" npx prisma migrate deploy\n` +
      `  DATABASE_URL="file:./volume.db" node prisma/seed-volume.js\n\n` +
      `Override with VOLUME_SEED_FORCE=1 only if you are certain.\n`
  );
  process.exit(1);
}

// Deterministic PRNG, so two runs produce the same dataset and a measurement
// can be repeated against identical data.
let seed = 20260918;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const daysAgo = (d) => new Date(Date.now() - d * 86400_000);

const TYPES = ["TASK", "BUG", "STORY", "EPIC"];
const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const VERBS = ["Fix", "Refactor", "Add", "Investigate", "Migrate", "Document", "Optimise", "Remove"];
const NOUNS = ["login flow", "billing export", "search index", "webhook retry", "audit trail",
  "sprint board", "email template", "permission check", "CSV import", "timeline view"];

async function main() {
  const t0 = Date.now();
  console.log(`Seeding volume data into ${dbUrl}`);
  console.log(`  orgs=${ORGS} projects=${PROJECTS} issues=${ISSUES.toLocaleString()} users=${USERS}\n`);

  // ---- wipe, child tables first ----
  console.log("clearing…");
  for (const t of ["activityLog", "comment", "timeEntry", "subtask", "issueLabel", "label",
    "issueDependency", "attachment", "watcher", "customFieldValue", "customField", "issue",
    "sprint", "epic", "component", "workflowTransition", "workflowStatus", "workflow",
    "projectMember", "project", "teamMember", "team", "workspaceMember", "workspace",
    "organizationMember", "organization", "session", "notification", "user"]) {
    if (prisma[t]?.deleteMany) await prisma[t].deleteMany();
  }

  // ---- users ----
  const passwordHash = await bcrypt.hash("VolumeTest123!", 10);
  const users = [];
  for (let i = 0; i < USERS; i++) {
    users.push({
      email: `vol-user-${i}@example.test`,
      passwordHash,
      firstName: `User${i}`,
      lastName: pick(["Ahmed", "Chen", "Okafor", "Silva", "Novak", "Haider"]),
      status: "ACTIVE",
      // ~20% clients, so USER_TYPE targeting and Employee/Client filters have
      // something real to select.
      userType: rnd() < 0.2 ? "CLIENT" : "EMPLOYEE",
      emailVerifiedAt: daysAgo(int(30, 400)),
    });
  }
  await prisma.user.createMany({ data: users });
  const userIds = (await prisma.user.findMany({ select: { id: true } })).map((u) => u.id);
  console.log(`users: ${userIds.length}`);

  // ---- orgs, workspaces, projects ----
  const projects = [];
  for (let o = 0; o < ORGS; o++) {
    const org = await prisma.organization.create({
      data: { name: `Volume Org ${o + 1}`, slug: `volume-org-${o + 1}` },
    });
    // Membership is skewed: org 1 holds most people, as a real tenant mix does.
    const share = o === 0 ? 0.6 : 0.2;
    // Deduped up front: createMany({ skipDuplicates }) is not supported on
    // SQLite, so a repeated userId would violate the composite unique index.
    const members = [...new Set(userIds.filter(() => rnd() < share))];
    await prisma.organizationMember.createMany({
      data: members.map((userId, i) => ({
        orgId: org.id,
        userId,
        role: i === 0 ? "OWNER" : i < 3 ? "ADMIN" : "MEMBER",
      })),
    });

    const ws = await prisma.workspace.create({
      data: { orgId: org.id, name: `Workspace ${o + 1}`, slug: `volume-ws-${o + 1}` },
    });
    await prisma.workspaceMember.createMany({
      data: members.map((userId) => ({ workspaceId: ws.id, userId, role: "MEMBER" })),
    });

    const perOrg = Math.ceil(PROJECTS / ORGS);
    for (let p = 0; p < perOrg && projects.length < PROJECTS; p++) {
      const n = projects.length + 1;
      const owner = pick(members.length ? members : userIds);
      const project = await prisma.project.create({
        data: {
          workspaceId: ws.id,
          name: `Volume Project ${n}`,
          key: `VP${n}`,
          ownerId: owner,
          template: "SCRUM",
        },
      });

      // A workflow per project, since statusId is required on every issue.
      const wf = await prisma.workflow.create({
        data: { projectId: project.id, name: "Default", isDefault: true },
      });
      const statusNames = [
        ["Backlog", "TODO"], ["In Progress", "IN_PROGRESS"],
        ["In Review", "IN_PROGRESS"], ["Done", "DONE"],
      ];
      const statuses = [];
      for (let i = 0; i < statusNames.length; i++) {
        statuses.push(await prisma.workflowStatus.create({
          data: { workflowId: wf.id, name: statusNames[i][0], category: statusNames[i][1], position: i, color: "#64748b" },
        }));
      }

      // Project membership is also skewed: a handful of large projects, most small.
      const size = rnd() < 0.15 ? int(20, 40) : int(3, 8);
      const pool = members.length ? members : userIds;
      const pmembers = [...new Set([owner, ...Array.from({ length: size }, () => pick(pool))])];
      await prisma.projectMember.createMany({
        data: pmembers.map((userId, i) => ({
          projectId: project.id,
          userId,
          role: userId === owner ? "PROJECT_ADMIN" : i === 1 ? "PROJECT_MANAGER" : i % 7 === 0 ? "VIEWER" : "MEMBER",
        })),
      });

      const sprints = [];
      for (let s = 0; s < 4; s++) {
        sprints.push(await prisma.sprint.create({
          data: {
            projectId: project.id, name: `VP${n} Sprint ${s + 1}`, position: s,
            status: s < 2 ? "COMPLETED" : s === 2 ? "ACTIVE" : "PLANNED",
            startDate: daysAgo(60 - s * 14), endDate: daysAgo(46 - s * 14),
          },
        }));
      }
      const epics = [];
      for (let e = 0; e < 3; e++) {
        epics.push(await prisma.epic.create({
          data: { projectId: project.id, name: `VP${n} Epic ${e + 1}`, color: "#8b5cf6", status: "IN_PROGRESS" },
        }));
      }

      projects.push({ ...project, statuses, sprints, epics, members: pmembers });
    }
  }
  console.log(`orgs: ${ORGS}  projects: ${projects.length}`);

  // ---- issues, in batches ----
  console.log(`issues: writing ${ISSUES.toLocaleString()}…`);
  const perProject = Math.ceil(ISSUES / projects.length);
  let written = 0;
  const hotIssueIds = [];

  for (const project of projects) {
    for (let start = 0; start < perProject && written < ISSUES; start += BATCH) {
      const rows = [];
      const count = Math.min(BATCH, perProject - start, ISSUES - written);
      for (let i = 0; i < count; i++) {
        const keyNumber = start + i + 1;
        const status = pick(project.statuses);
        const done = status.category === "DONE";
        const created = daysAgo(int(1, 365));
        rows.push({
          projectId: project.id,
          keyNumber,
          issueKey: `${project.key}-${keyNumber}`,
          title: `${pick(VERBS)} the ${pick(NOUNS)}`,
          description: rnd() < 0.7 ? `Longer description for ${project.key}-${keyNumber}. `.repeat(int(1, 12)) : null,
          issueType: pick(TYPES),
          statusId: status.id,
          priority: pick(PRIORITIES),
          reporterId: pick(project.members),
          assigneeId: rnd() < 0.85 ? pick(project.members) : null,
          epicId: rnd() < 0.5 ? pick(project.epics).id : null,
          sprintId: rnd() < 0.7 ? pick(project.sprints).id : null,
          estimatePoints: rnd() < 0.6 ? pick([1, 2, 3, 5, 8, 13]) : null,
          startDate: rnd() < 0.4 ? created : null,
          dueDate: rnd() < 0.5 ? daysAgo(int(-60, 300)) : null,
          completedAt: done ? created : null,
          position: keyNumber,
          createdAt: created,
        });
      }
      await prisma.issue.createMany({ data: rows });
      written += count;
      if (written % 5000 === 0) console.log(`  ${written.toLocaleString()}…`);
    }
  }
  console.log(`issues: ${written.toLocaleString()}`);

  // ---- the skewed tail: a few issues with heavy history ----
  //
  // This is the shape that exposes B10. GET /api/issues/[id] loads comments,
  // activityLogs, timeEntries and attachments with no `take`, so one issue with
  // 800 activity rows is the realistic worst case, not 20,000 thin ones.
  const sample = await prisma.issue.findMany({
    take: 400, orderBy: { createdAt: "asc" },
    select: { id: true, projectId: true, reporterId: true },
  });
  console.log("history: writing comments / activity / time / attachments…");
  let comments = 0, activity = 0, times = 0, atts = 0;

  for (let i = 0; i < sample.length; i++) {
    const issue = sample[i];
    // top 5 are "hot", the rest taper off
    const heat = i < 5 ? int(150, 400) : i < 40 ? int(20, 60) : int(0, 6);
    hotIssueIds.push({ id: issue.id, heat });

    const project = projects.find((p) => p.id === issue.projectId) || projects[0];
    const cRows = [], aRows = [], tRows = [];
    for (let k = 0; k < heat; k++) {
      cRows.push({
        issueId: issue.id, userId: pick(project.members),
        content: `Comment ${k + 1}. `.repeat(int(1, 20)),
        createdAt: daysAgo(int(1, 200)),
      });
      aRows.push({
        issueId: issue.id, actorId: pick(project.members),
        actionType: pick(["CREATED", "UPDATED_STATUS", "UPDATED_ASSIGNEE", "COMMENTED", "UPDATED_PRIORITY"]),
        fieldChanged: pick(["status", "assignee", "priority", null]),
        oldValue: "A", newValue: "B",
        timestamp: daysAgo(int(1, 200)),
      });
      if (k % 4 === 0) {
        tRows.push({
          issueId: issue.id, userId: pick(project.members),
          durationMinutes: int(15, 480), description: "worked", workDate: daysAgo(int(1, 120)),
        });
      }
    }
    if (cRows.length) { await prisma.comment.createMany({ data: cRows }); comments += cRows.length; }
    if (aRows.length) { await prisma.activityLog.createMany({ data: aRows }); activity += aRows.length; }
    if (tRows.length) { await prisma.timeEntry.createMany({ data: tRows }); times += tRows.length; }

    // Attachments are stored as base64 data URLs today (F1), so a handful of
    // realistic ones is what makes that cost measurable.
    if (i < 10) {
      const n = int(1, 4);
      const rows = [];
      for (let k = 0; k < n; k++) {
        const kb = int(80, 400);
        rows.push({
          issueId: issue.id, uploaderId: pick(project.members),
          fileName: `screenshot-${k + 1}.png`, fileSize: kb * 1024, mimeType: "image/png",
          fileUrl: "data:image/png;base64," + "A".repeat(kb * 1024),
        });
      }
      await prisma.attachment.createMany({ data: rows });
      atts += rows.length;
    }
  }
  console.log(`history: ${comments.toLocaleString()} comments, ${activity.toLocaleString()} activity, ${times.toLocaleString()} time entries, ${atts} attachments`);

  const hottest = hotIssueIds.sort((a, b) => b.heat - a.heat)[0];
  // Counted through the client rather than raw SQL: SQLite returns COUNT(*)
  // as a BigInt, which JSON.stringify refuses.
  const total = {
    issues: await prisma.issue.count(),
    comments: await prisma.comment.count(),
    activity: await prisma.activityLog.count(),
    timeEntries: await prisma.timeEntry.count(),
    attachments: await prisma.attachment.count(),
    users: await prisma.user.count(),
    projects: await prisma.project.count(),
  };
  console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`totals: ${JSON.stringify(total)}`);
  console.log(`hottest issue: ${hottest.id} (~${hottest.heat} comments and activity rows each)`);
  console.log(`\nMeasure against it with:  DATABASE_URL="${dbUrl}" npm run dev`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
