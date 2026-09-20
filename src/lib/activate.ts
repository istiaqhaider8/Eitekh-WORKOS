import { prisma } from "./prisma";

/**
 * SAP Activate — methodology data and seeding.
 *
 * SCOPE OF THE CLAIM
 *
 * This is "SAP Activate-aligned": the phases, workstreams, deliverables and
 * quality gates follow the published methodology. It is NOT certified,
 * endorsed by or compliant with SAP — that requires SAP's own validation, and
 * nothing in this repository should say otherwise.
 *
 * WHY THIS IS DATA AND NOT AN ENUM
 *
 * Workstream names are SAP's, and SAP has changed them: Organisational Change
 * Management is now absorbed into Solution Adoption. If the vocabulary were an
 * enum, a rename by SAP would be a schema migration for every customer. Seeded
 * per project, it is an UPDATE — and a customer who calls something else can
 * rename it without affecting anybody.
 *
 * A workstream SPANS phases. It is not owned by one, which is why the phase
 * link lives on the deliverable rather than on the workstream.
 */

export const ACTIVATE_METHODOLOGY_VERSION = "2024";

export interface PhaseSeed {
  key: string;
  name: string;
  /** Gate name and its criteria, seeded with the phase. */
  gate: { name: string; description: string; criteria: string[] };
}

/**
 * The six phases. Continuous improvement is deliberately NOT a seventh —
 * it lives inside Run as an ongoing workstream, which is what the methodology
 * actually says and what the earlier draft of this plan got wrong.
 */
export const ACTIVATE_PHASES: PhaseSeed[] = [
  {
    key: "DISCOVER",
    name: "Discover",
    gate: {
      name: "Discover gate",
      description: "Scope, value and approach are agreed before a project is funded.",
      criteria: [
        "Value case documented",
        "Solution scope outlined",
        "Deployment approach chosen",
      ],
    },
  },
  {
    key: "PREPARE",
    name: "Prepare",
    gate: {
      name: "Prepare gate",
      description: "The project can actually start: plan, people and environments.",
      criteria: [
        "Project plan baselined",
        "Team onboarded and roles assigned",
        "Environments provisioned",
        "Kickoff completed",
      ],
    },
  },
  {
    key: "EXPLORE",
    name: "Explore",
    gate: {
      name: "Explore gate",
      description: "Requirements are understood and every gap has a decision.",
      criteria: [
        "Fit-to-standard workshops completed",
        "Backlog confirmed",
        "Gaps classified as FIT, GAP or ACCEPTED_GAP",
        "Key decisions recorded",
      ],
    },
  },
  {
    key: "REALIZE",
    name: "Realize",
    gate: {
      name: "Realize gate",
      description: "The solution is built and proven, and the data move is rehearsed.",
      criteria: [
        "Configuration and build complete",
        "Test cycles passed",
        "Data migration rehearsed",
        "Integrations verified",
      ],
    },
  },
  {
    key: "DEPLOY",
    name: "Deploy",
    gate: {
      name: "Go-live gate",
      description:
        "The go-live decision. This is the gate where separation of duties matters most.",
      criteria: [
        "Cutover plan approved",
        "Production readiness confirmed",
        "Support model in place",
        "Go-live decision recorded",
      ],
    },
  },
  {
    key: "RUN",
    name: "Run",
    gate: {
      name: "Transition to operations",
      description: "Hypercare ends and the solution is owned by operations.",
      criteria: [
        "Hypercare completed",
        "Incidents within agreed thresholds",
        "Operations handover accepted",
      ],
    },
  },
];

/**
 * Default workstreams, current as of the 2024 naming.
 *
 * `Solution Adoption` is where organisational change management now sits.
 * Kept as the seed rather than a constant the code reads, so renaming one on a
 * project cannot break the application.
 */
export const ACTIVATE_WORKSTREAMS: { key: string; name: string }[] = [
  { key: "PROJECT_MANAGEMENT", name: "Project Management" },
  { key: "SOLUTION_ADOPTION", name: "Solution Adoption" },
  { key: "CUSTOMER_TEAM_ENABLEMENT", name: "Customer Team Enablement" },
  { key: "APPLICATION_DESIGN_CONFIGURATION", name: "Application: Design & Configuration" },
  { key: "TESTING", name: "Testing" },
  { key: "TECHNICAL_ARCHITECTURE_INFRASTRUCTURE", name: "Technical Architecture & Infrastructure" },
  { key: "EXTENSIBILITY", name: "Extensibility" },
  { key: "DATA_MANAGEMENT", name: "Data Management" },
  { key: "INTEGRATION", name: "Integration" },
  { key: "ANALYTICS", name: "Analytics" },
  { key: "OPERATIONS_SUPPORT", name: "Operations & Support" },
];

export const ACTIVATE_PHASE_KEYS = ACTIVATE_PHASES.map((p) => p.key);

/**
 * Enable Activate on a project, seeding phases, gates, criteria and
 * workstreams.
 *
 * Idempotent by construction: every write is scoped by a unique key
 * (`projectId + key`), so enabling twice converges rather than duplicating.
 * That matters because "enable" is the kind of button a user double-clicks,
 * and because a partial failure must be safe to retry.
 *
 * Runs in a single transaction. A project left with phases but no profile —
 * or half its workstreams — would be a state no screen knows how to render.
 */
export async function enableActivate(projectId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.activateProfile.upsert({
      where: { projectId },
      update: { enabled: true },
      create: {
        projectId,
        enabled: true,
        methodologyVersion: ACTIVATE_METHODOLOGY_VERSION,
        currentPhaseKey: ACTIVATE_PHASES[0].key,
      },
    });

    for (let i = 0; i < ACTIVATE_PHASES.length; i += 1) {
      const seed = ACTIVATE_PHASES[i];
      const phase = await tx.activatePhase.upsert({
        where: { projectId_key: { projectId, key: seed.key } },
        update: { name: seed.name, position: i },
        create: { projectId, key: seed.key, name: seed.name, position: i },
        select: { id: true },
      });

      // One gate per phase. Seeded only when absent, so re-enabling never
      // discards criteria an operator has already marked met.
      const existingGate = await tx.activateGate.findFirst({
        where: { phaseId: phase.id, name: seed.gate.name },
        select: { id: true },
      });
      if (!existingGate) {
        await tx.activateGate.create({
          data: {
            phaseId: phase.id,
            name: seed.gate.name,
            description: seed.gate.description,
            isMandatory: true,
            position: 0,
            criteria: {
              create: seed.gate.criteria.map((criterion, idx) => ({
                criterion,
                position: idx,
              })),
            },
          },
        });
      }
    }

    for (let i = 0; i < ACTIVATE_WORKSTREAMS.length; i += 1) {
      const ws = ACTIVATE_WORKSTREAMS[i];
      await tx.activateWorkstream.upsert({
        where: { projectId_key: { projectId, key: ws.key } },
        update: { name: ws.name, position: i },
        create: { projectId, key: ws.key, name: ws.name, position: i },
      });
    }
  });
}

/**
 * Disable without destroying anything.
 *
 * The rollback story for this feature is "turn it off", not "drop the tables".
 * Phases, gates and sign-off history are a record of decisions that were
 * genuinely taken; deleting them because a flag was flipped would be the wrong
 * default. Re-enabling restores the same rows.
 */
export async function disableActivate(projectId: string): Promise<void> {
  await prisma.activateProfile.updateMany({
    where: { projectId },
    data: { enabled: false },
  });
}

/** True when the project has Activate switched on. */
export async function isActivateEnabled(projectId: string): Promise<boolean> {
  const profile = await prisma.activateProfile.findUnique({
    where: { projectId },
    select: { enabled: true },
  });
  return Boolean(profile?.enabled);
}
