/**
 * seed-activate-demo.mjs — Load SAP Activate demo data for all projects.
 *
 * Enables SAP Activate on ATLAS, NOVA, and ORION, then adds realistic
 * progress data across ALL Activate-enabled projects (including HELIOS):
 *   - Phase advancement with dates and owners
 *   - Gate criteria marked as MET with evidence references
 *   - Gate approvals (signed off by project leads)
 *   - Deliverable fit-gap statuses
 *   - Fit-to-standard decisions with rationale
 *   - Deltas (work items) from decisions
 *
 * Usage:
 *   node scripts/seed-activate-demo.mjs
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function d(offset) {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt;
}
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function main() {
  console.log("🚀 Loading SAP Activate demo data...\n");

  // ── 1. Get all users and projects ──────────────────────────────────
  const users = await prisma.user.findMany({ where: { isSuperAdmin: false } });
  const allProjects = await prisma.project.findMany();

  if (users.length === 0 || allProjects.length === 0) {
    console.error("❌ No users or projects found. Run base seed first.");
    process.exit(1);
  }

  // ── 2. Enable Activate on projects that don't have it ──────────────
  console.log("📋 Enabling SAP Activate on projects...");

  const builtInTemplate = await prisma.methodTemplate.findFirst({
    where: { key: "SAP_ACTIVATE" },
    include: {
      phases: {
        include: {
          deliverables: { include: { tasks: true }, orderBy: { position: "asc" } },
          gates: { include: { criteria: true }, orderBy: { position: "asc" } },
        },
        orderBy: { position: "asc" },
      },
      workstreams: { orderBy: { position: "asc" } },
    },
  });

  if (!builtInTemplate) {
    console.error("❌ Built-in SAP Activate template not found.");
    process.exit(1);
  }

  console.log(`   ✅ Template found: "${builtInTemplate.name}" v${builtInTemplate.version} (${builtInTemplate.phases.length} phases)\n`);

  const projectsNeedingActivate = [];
  for (const project of allProjects) {
    const profile = await prisma.activateProfile.findUnique({ where: { projectId: project.id } });
    if (!profile) {
      projectsNeedingActivate.push(project);
    }
  }

  for (const project of projectsNeedingActivate) {
    console.log(`   🔄 Enabling Activate on ${project.key}...`);
    const actorId = rand(users).id;

    await prisma.activateProfile.create({
      data: {
        projectId: project.id,
        enabled: true,
        methodologyVersion: "2024",
        currentPhaseKey: "DISCOVER",
        templateId: builtInTemplate.id,
        templateVersion: builtInTemplate.version,
      },
    });

    for (const templatePhase of builtInTemplate.phases) {
      const phase = await prisma.activatePhase.create({
        data: {
          projectId: project.id,
          key: templatePhase.key,
          name: templatePhase.name,
          position: templatePhase.position,
          status: "NOT_STARTED",
          ownerId: rand(users).id,
        },
      });

      for (const templateGate of templatePhase.gates) {
        await prisma.activateGate.create({
          data: {
            phaseId: phase.id,
            name: templateGate.name,
            description: templateGate.description,
            isMandatory: templateGate.isMandatory,
            position: templateGate.position,
            criteria: {
              create: templateGate.criteria.map((c) => ({
                criterion: c.criterion,
                position: c.position,
              })),
            },
          },
        });
      }

      let deliverableCounter = 0;
      const workflow = await prisma.workflow.findFirst({ where: { projectId: project.id } });
      let backlogStatus = null;
      if (workflow) {
        backlogStatus = await prisma.workflowStatus.findFirst({
          where: { workflowId: workflow.id, category: "BACKLOG" },
        });
        if (!backlogStatus) {
          backlogStatus = await prisma.workflowStatus.findFirst({
            where: { workflowId: workflow.id },
            orderBy: { position: "asc" },
          });
        }
      }

      if (backlogStatus && templatePhase.deliverables.length > 0) {
        const currentProject = await prisma.project.findUnique({ where: { id: project.id } });
        let issueCounter = currentProject.issueCounter || 0;

        const workstreams = await prisma.activateWorkstream.findMany({ where: { projectId: project.id } });
        const wsByKey = new Map(workstreams.map((w) => [w.key, w]));

        for (const templateDel of templatePhase.deliverables) {
          deliverableCounter++;
          issueCounter++;
          const issueKey = `${project.key}-${issueCounter}`;

          const issue = await prisma.issue.create({
            data: {
              projectId: project.id,
              keyNumber: issueCounter,
              issueKey,
              title: templateDel.name,
              description: `### SAP Activate Deliverable\n\nPhase: **${templatePhase.name}**\nWorkstream: **${templateDel.workstreamKey || "General"}**`,
              issueType: "TASK",
              statusId: backlogStatus.id,
              priority: "MEDIUM",
              reporterId: actorId,
              assigneeId: rand(users).id,
              position: issueCounter,
            },
          });

          if (templateDel.tasks.length > 0) {
            await prisma.subtask.createMany({
              data: templateDel.tasks.map((t) => ({
                parentIssueId: issue.id,
                title: t.title,
                assigneeId: rand(users).id,
                status: "TO_DO",
                isCompleted: false,
              })),
            });
          }

          const ws = templateDel.workstreamKey ? wsByKey.get(templateDel.workstreamKey) : null;
          await prisma.activateDeliverableLink.create({
            data: {
              issueId: issue.id,
              phaseId: phase.id,
              workstreamId: ws?.id || null,
              isMandatory: templateDel.isMandatory,
              phaseCode: `D-${String(deliverableCounter).padStart(2, "0")}`,
            },
          });
        }

        await prisma.project.update({
          where: { id: project.id },
          data: { issueCounter },
        });
        await prisma.activatePhase.update({
          where: { id: phase.id },
          data: { deliverableCounter },
        });
      }
    }

    for (const templateWs of builtInTemplate.workstreams) {
      await prisma.activateWorkstream.upsert({
        where: { projectId_key: { projectId: project.id, key: templateWs.key } },
        update: {},
        create: {
          projectId: project.id,
          key: templateWs.key,
          name: templateWs.name,
          position: templateWs.position,
          ownerId: rand(users).id,
        },
      });
    }

    console.log(`   ✅ ${project.key} — Activate enabled`);
  }

  // ── 3. Add progress data to ALL Activate-enabled projects ──────────
  console.log("\n📊 Adding SAP Activate progress data...\n");

  const progressScenarios = {
    HELIOS: {
      currentPhase: "REALIZE",
      phases: {
        DISCOVER:  { status: "COMPLETED", startOffset: -90, completedOffset: -75 },
        PREPARE:   { status: "COMPLETED", startOffset: -75, completedOffset: -55 },
        EXPLORE:   { status: "COMPLETED", startOffset: -55, completedOffset: -30 },
        REALIZE:   { status: "IN_PROGRESS", startOffset: -30, completedOffset: null },
        DEPLOY:    { status: "NOT_STARTED", startOffset: null, completedOffset: null },
        RUN:       { status: "NOT_STARTED", startOffset: null, completedOffset: null },
      },
    },
    ATLAS: {
      currentPhase: "EXPLORE",
      phases: {
        DISCOVER:  { status: "COMPLETED", startOffset: -60, completedOffset: -45 },
        PREPARE:   { status: "COMPLETED", startOffset: -45, completedOffset: -25 },
        EXPLORE:   { status: "IN_PROGRESS", startOffset: -25, completedOffset: null },
        REALIZE:   { status: "NOT_STARTED", startOffset: null, completedOffset: null },
        DEPLOY:    { status: "NOT_STARTED", startOffset: null, completedOffset: null },
        RUN:       { status: "NOT_STARTED", startOffset: null, completedOffset: null },
      },
    },
    NOVA: {
      currentPhase: "PREPARE",
      phases: {
        DISCOVER:  { status: "COMPLETED", startOffset: -45, completedOffset: -30 },
        PREPARE:   { status: "IN_PROGRESS", startOffset: -30, completedOffset: null },
        EXPLORE:   { status: "NOT_STARTED", startOffset: null, completedOffset: null },
        REALIZE:   { status: "NOT_STARTED", startOffset: null, completedOffset: null },
        DEPLOY:    { status: "NOT_STARTED", startOffset: null, completedOffset: null },
        RUN:       { status: "NOT_STARTED", startOffset: null, completedOffset: null },
      },
    },
    ORION: {
      currentPhase: "DISCOVER",
      phases: {
        DISCOVER:  { status: "IN_PROGRESS", startOffset: -14, completedOffset: null },
        PREPARE:   { status: "NOT_STARTED", startOffset: null, completedOffset: null },
        EXPLORE:   { status: "NOT_STARTED", startOffset: null, completedOffset: null },
        REALIZE:   { status: "NOT_STARTED", startOffset: null, completedOffset: null },
        DEPLOY:    { status: "NOT_STARTED", startOffset: null, completedOffset: null },
        RUN:       { status: "NOT_STARTED", startOffset: null, completedOffset: null },
      },
    },
  };

  const fitGapOptions = ["ADOPT", "CONFIGURE", "EXTEND", "INTEGRATE", "DEFER", "OUT_OF_SCOPE"];

  for (const project of allProjects) {
    const scenario = progressScenarios[project.key];
    if (!scenario) continue;

    console.log(`   📋 ${project.key} — advancing to ${scenario.currentPhase}...`);

    await prisma.activateProfile.updateMany({
      where: { projectId: project.id },
      data: { currentPhaseKey: scenario.currentPhase },
    });

    const phases = await prisma.activatePhase.findMany({
      where: { projectId: project.id },
      include: {
        gates: { include: { criteria: true } },
        deliverables: { include: { issue: true } },
      },
      orderBy: { position: "asc" },
    });

    const workflow = await prisma.workflow.findFirst({ where: { projectId: project.id } });
    let doneStatus = null;
    let inProgressStatus = null;
    let reviewStatus = null;
    if (workflow) {
      doneStatus = await prisma.workflowStatus.findFirst({ where: { workflowId: workflow.id, category: "DONE" } });
      inProgressStatus = await prisma.workflowStatus.findFirst({ where: { workflowId: workflow.id, category: "IN_PROGRESS" } });
      reviewStatus = await prisma.workflowStatus.findFirst({ where: { workflowId: workflow.id, category: "REVIEW" } });
    }

    for (const phase of phases) {
      const phaseScenario = scenario.phases[phase.key];
      if (!phaseScenario) continue;

      await prisma.activatePhase.update({
        where: { id: phase.id },
        data: {
          status: phaseScenario.status,
          startDate: phaseScenario.startOffset !== null ? d(phaseScenario.startOffset) : null,
          targetDate: phaseScenario.startOffset !== null ? d(phaseScenario.startOffset + 20) : null,
          completedAt: phaseScenario.completedOffset !== null ? d(phaseScenario.completedOffset) : null,
          ownerId: rand(users).id,
        },
      });

      for (const gate of phase.gates) {
        if (phaseScenario.status === "COMPLETED") {
          for (const criterion of gate.criteria) {
            await prisma.activateGateCriterion.update({
              where: { id: criterion.id },
              data: {
                status: "MET",
                evidenceRef: rand([
                  "Sign-off document uploaded to SharePoint",
                  "Reviewed in steering committee meeting",
                  "Validated by QA team — test report TR-2026-042",
                  "Confirmed in workshop minutes WS-" + randInt(100, 999),
                  "Approved by project sponsor — email #" + randInt(1000, 9999),
                ]),
              },
            });
          }

          const approver = rand(users);
          const raiser = rand(users.filter((u) => u.id !== approver.id));
          await prisma.activateGate.update({
            where: { id: gate.id },
            data: {
              status: "APPROVED",
              raisedById: raiser.id,
              raisedAt: d(phaseScenario.completedOffset - 2),
            },
          });

          const existingApproval = await prisma.activateGateApproval.findFirst({ where: { gateId: gate.id } });
          if (!existingApproval) {
            await prisma.activateGateApproval.create({
              data: {
                gateId: gate.id,
                approverId: approver.id,
                decision: "APPROVED",
                comment: rand([
                  "All criteria met. Approved to proceed to next phase.",
                  "Reviewed and approved. Good work by the team.",
                  "Gate criteria satisfied. Moving forward.",
                ]),
                decidedAt: d(phaseScenario.completedOffset),
              },
            });
          }
        } else if (phaseScenario.status === "IN_PROGRESS") {
          const isRaised = Math.random() > 0.6;
          for (let i = 0; i < gate.criteria.length; i++) {
            const criterion = gate.criteria[i];
            const isMet = i < Math.floor(gate.criteria.length * 0.6);
            await prisma.activateGateCriterion.update({
              where: { id: criterion.id },
              data: {
                status: isMet ? "MET" : "PENDING",
                evidenceRef: isMet ? rand([
                  "Document reviewed and signed",
                  "Test results confirmed — pass",
                  "Workshop completed with stakeholder approval",
                ]) : null,
              },
            });
          }

          if (isRaised) {
            await prisma.activateGate.update({
              where: { id: gate.id },
              data: { status: "RAISED", raisedById: rand(users).id, raisedAt: d(-3) },
            });
          }
        }
      }

      for (const deliverable of phase.deliverables) {
        if (phaseScenario.status === "COMPLETED") {
          if (doneStatus) {
            await prisma.issue.update({
              where: { id: deliverable.issueId },
              data: { statusId: doneStatus.id, completedAt: d(phaseScenario.completedOffset - randInt(0, 5)) },
            });
          }
          await prisma.activateDeliverableLink.update({
            where: { id: deliverable.id },
            data: { fitGapStatus: rand(["ADOPT", "ADOPT", "ADOPT", "CONFIGURE", "CONFIGURE", "EXTEND"]) },
          });
        } else if (phaseScenario.status === "IN_PROGRESS") {
          const roll = Math.random();
          if (roll < 0.4 && doneStatus) {
            await prisma.issue.update({
              where: { id: deliverable.issueId },
              data: { statusId: doneStatus.id, completedAt: d(randInt(-10, -1)) },
            });
            await prisma.activateDeliverableLink.update({
              where: { id: deliverable.id },
              data: { fitGapStatus: rand(fitGapOptions.slice(0, 4)) },
            });
          } else if (roll < 0.7 && inProgressStatus) {
            await prisma.issue.update({
              where: { id: deliverable.issueId },
              data: { statusId: inProgressStatus.id },
            });
            await prisma.activateDeliverableLink.update({
              where: { id: deliverable.id },
              data: { fitGapStatus: rand(fitGapOptions.slice(0, 4)) },
            });
          } else if (roll < 0.85 && reviewStatus) {
            await prisma.issue.update({
              where: { id: deliverable.issueId },
              data: { statusId: reviewStatus.id },
            });
          }
        }
      }

      if (phaseScenario.status === "COMPLETED") {
        const issueIds = phase.deliverables.map((dl) => dl.issueId);
        if (issueIds.length > 0) {
          await prisma.subtask.updateMany({
            where: { parentIssueId: { in: issueIds } },
            data: { status: "DONE", isCompleted: true },
          });
        }
      } else if (phaseScenario.status === "IN_PROGRESS") {
        const issueIds = phase.deliverables.map((dl) => dl.issueId);
        if (issueIds.length > 0) {
          const subtasks = await prisma.subtask.findMany({ where: { parentIssueId: { in: issueIds } } });
          for (let i = 0; i < subtasks.length; i++) {
            const completed = i < Math.floor(subtasks.length * 0.5);
            await prisma.subtask.update({
              where: { id: subtasks[i].id },
              data: { status: completed ? "DONE" : rand(["TO_DO", "IN_PROGRESS"]), isCompleted: completed },
            });
          }
        }
      }
    }

    const completedPhaseCount = Object.values(scenario.phases).filter((p) => p.status === "COMPLETED").length;
    if (completedPhaseCount >= 2) {
      console.log(`   📝 ${project.key} — creating custom scope items and decisions...`);

      const customScopeItems = [
        { name: "Order Processing", workstreamKey: "APPLICATION_DESIGN_CONFIGURATION" },
        { name: "Inventory Valuation", workstreamKey: "APPLICATION_DESIGN_CONFIGURATION" },
        { name: "Vendor Management", workstreamKey: "APPLICATION_DESIGN_CONFIGURATION" },
        { name: "Financial Reporting", workstreamKey: "ANALYTICS" },
        { name: "User Access Control", workstreamKey: "SECURITY_PERMISSIONS" },
        { name: "Data Migration Plan", workstreamKey: "DATA_MANAGEMENT" },
        { name: "API Integration Layer", workstreamKey: "INTEGRATION" },
        { name: "Training Curriculum", workstreamKey: "CUSTOMER_TEAM_ENABLEMENT" },
      ];

      let scopeCounter = 0;
      for (const item of customScopeItems) {
        scopeCounter++;
        const code = `CUS-${String(scopeCounter).padStart(2, "0")}`;
        const existing = await prisma.activateCustomScopeItem.findFirst({
          where: { projectId: project.id, code },
        });
        if (existing) continue;

        await prisma.activateCustomScopeItem.create({
          data: {
            projectId: project.id,
            code,
            name: item.name,
            workstreamKey: item.workstreamKey,
            position: scopeCounter,
            createdById: rand(users).id,
          },
        });
      }

      await prisma.activateProfile.updateMany({
        where: { projectId: project.id },
        data: { customScopeCounter: scopeCounter },
      });
    }

    console.log(`   ✅ ${project.key} — progress data loaded\n`);
  }

  // ── Final summary ──────────────────────────────────────────────────
  const summary = {
    profiles: await prisma.activateProfile.count({ where: { enabled: true } }),
    phases: await prisma.activatePhase.count(),
    gates: await prisma.activateGate.count(),
    gateCriteria: await prisma.activateGateCriterion.count(),
    gateApprovals: await prisma.activateGateApproval.count(),
    workstreams: await prisma.activateWorkstream.count(),
    deliverableLinks: await prisma.activateDeliverableLink.count(),
    customScopeItems: await prisma.activateCustomScopeItem.count(),
  };

  const profileSummary = await prisma.activateProfile.findMany({
    where: { enabled: true },
    include: { project: { select: { key: true, name: true } } },
  });

  console.log("┌────────────────────────────────────────────────────┐");
  console.log("│      SAP ACTIVATE — DEMO DATA SUMMARY             │");
  console.log("├────────────────────────────────────────────────────┤");
  for (const [key, val] of Object.entries(summary)) {
    const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).padEnd(28);
    console.log(`│  ${label} ${String(val).padStart(8)}  │`);
  }
  console.log("├────────────────────────────────────────────────────┤");
  console.log("│  PROJECT PHASE STATUS                             │");
  console.log("├────────────────────────────────────────────────────┤");
  for (const p of profileSummary) {
    const phaseName = (progressScenarios[p.project.key]?.currentPhase || p.currentPhaseKey || "?");
    console.log(`│  ${p.project.key.padEnd(10)} → ${phaseName.padEnd(20)}      │`);
  }
  console.log("└────────────────────────────────────────────────────┘");
  console.log("\n✅ SAP Activate demo data loaded successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
