import { prisma } from "./prisma";
import { ACTIVATE_PHASE_CONTENT } from "./activate-template-content";

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
      name: ACTIVATE_PHASE_CONTENT.DISCOVER.gate.name,
      description: "Scope, value and approach are agreed before a project is funded.",
      criteria: ACTIVATE_PHASE_CONTENT.DISCOVER.gate.criteria,
    },
  },
  {
    key: "PREPARE",
    name: "Prepare",
    gate: {
      name: ACTIVATE_PHASE_CONTENT.PREPARE.gate.name,
      description: "The project can actually start: plan, people and environments.",
      criteria: ACTIVATE_PHASE_CONTENT.PREPARE.gate.criteria,
    },
  },
  {
    key: "EXPLORE",
    name: "Explore",
    gate: {
      name: ACTIVATE_PHASE_CONTENT.EXPLORE.gate.name,
      description: "Requirements are understood and every gap has a decision.",
      criteria: ACTIVATE_PHASE_CONTENT.EXPLORE.gate.criteria,
    },
  },
  {
    key: "REALIZE",
    name: "Realize",
    gate: {
      name: ACTIVATE_PHASE_CONTENT.REALIZE.gate.name,
      description: "The solution is built and proven, and the data move is rehearsed.",
      criteria: ACTIVATE_PHASE_CONTENT.REALIZE.gate.criteria,
    },
  },
  {
    key: "DEPLOY",
    name: "Deploy",
    gate: {
      name: ACTIVATE_PHASE_CONTENT.DEPLOY.gate.name,
      description:
        "The go-live decision. This is the gate where separation of duties matters most.",
      criteria: ACTIVATE_PHASE_CONTENT.DEPLOY.gate.criteria,
    },
  },
  {
    key: "RUN",
    name: "Run",
    gate: {
      name: ACTIVATE_PHASE_CONTENT.RUN.gate.name,
      description: "Hypercare ends and the solution is owned by operations.",
      criteria: ACTIVATE_PHASE_CONTENT.RUN.gate.criteria,
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
  /**
   * Added for the phase worksheet, which needs a home for two kinds of work
   * the eleven above have nowhere obvious to put.
   *
   * Security is not Application Design: who may see a salary is a separate
   * conversation from how the salary process runs, and on every real
   * programme it has different people and a different sign-off. Cutover is
   * not Operations & Support either — it is the few days around go-live,
   * planned and rehearsed months in advance, and folding it into the
   * team that runs the system afterwards loses the rehearsal.
   *
   * Appended rather than inserted, so existing workstreams keep their
   * positions and no project's ordering changes underneath it.
   */
  { key: "SECURITY_PERMISSIONS", name: "Security & Permissions" },
  { key: "CUTOVER_GO_LIVE", name: "Cutover & Go-Live" },
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
export async function enableActivate(
  projectId: string,
  templateId?: string,
  /**
   * Who is turning it on. Required to seed the plan, because every
   * deliverable becomes a real issue and an issue must have a reporter.
   * Optional so that callers which only want the phases — the older
   * signature, and the template-equivalence tests — still compile; the
   * plan is simply not seeded without one.
   */
  actorId?: string
): Promise<void> {
  /**
   * Seeded FROM A TEMPLATE since increment 8.
   *
   * Called without a `templateId` this behaves exactly as it always did,
   * because the built-in template is the constants above loaded into template
   * rows — same keys, same names, same gates, same criteria, same order. The
   * integration suite asserts that equivalence directly rather than trusting
   * this sentence.
   *
   * The template is resolved OUTSIDE the transaction. Resolving it inside
   * would hold this transaction's connection open while `ensureBuiltInTemplate`
   * takes a second one for its own transaction — a deadlock under load, for no
   * benefit: the template is committed before this project is touched.
   */
  const { ensureBuiltInTemplate, loadTemplate } = await import("./activate-templates");
  const resolvedId = templateId ?? (await ensureBuiltInTemplate());
  const template = await loadTemplate(resolvedId);
  if (!template) throw new Error(`Methodology template ${resolvedId} not found`);

  await prisma.$transaction(async (tx) => {
    await tx.activateProfile.upsert({
      where: { projectId },
      update: {
        enabled: true,
        // Re-enabling restamps: it is the same act as enabling, and leaving a
        // stale stamp would claim the project came from a template it did not.
        templateId: template.id,
        templateVersion: template.version,
      },
      create: {
        projectId,
        enabled: true,
        methodologyVersion: ACTIVATE_METHODOLOGY_VERSION,
        currentPhaseKey: template.phases[0]?.key ?? ACTIVATE_PHASES[0].key,
        templateId: template.id,
        templateVersion: template.version,
      },
    });

    for (let i = 0; i < template.phases.length; i += 1) {
      const seed = template.phases[i];
      const phase = await tx.activatePhase.upsert({
        where: { projectId_key: { projectId, key: seed.key } },
        update: { name: seed.name, position: seed.position },
        create: { projectId, key: seed.key, name: seed.name, position: seed.position },
        select: { id: true },
      });

      // One gate per phase. Seeded only when absent, so re-enabling never
      // discards criteria an operator has already marked met.
      for (const g of seed.gates) {
        const existingGate = await tx.activateGate.findFirst({
          where: { phaseId: phase.id, name: g.name },
          select: { id: true },
        });
        if (existingGate) continue;
        await tx.activateGate.create({
          data: {
            phaseId: phase.id,
            name: g.name,
            description: g.description,
            isMandatory: g.isMandatory,
            position: g.position,
            criteria: {
              create: g.criteria.map((c) => ({ criterion: c.criterion, position: c.position })),
            },
          },
        });
      }
    }

    for (const ws of template.workstreams) {
      await tx.activateWorkstream.upsert({
        where: { projectId_key: { projectId, key: ws.key } },
        update: { name: ws.name, position: ws.position },
        create: { projectId, key: ws.key, name: ws.name, position: ws.position },
      });
    }
  });

  /**
   * The plan, seeded AFTER the transaction above has committed.
   *
   * Deliberately outside it: this creates one issue, one link and a
   * handful of subtasks per deliverable — several hundred writes for a
   * six-phase methodology. Inside the transaction that also writes the
   * profile, that is a long-running lock and a plausible timeout, and a
   * timeout there would roll back the phases as well and leave the
   * project with nothing.
   *
   * Out here, the worst case is a project with its phases, its gates and
   * part of its plan — a working screen that finishes filling in when
   * Activate is enabled again, because seeding skips any phase that
   * already has deliverables.
   */
  if (actorId) {
    const { seedPhaseDeliverablesFromTemplate } = await import('./activate-worksheet');
    const phases = await prisma.activatePhase.findMany({
      where: { projectId },
      select: { id: true, key: true },
    });
    const byKey = new Map(phases.map((p) => [p.key, p.id]));
    for (const seed of template.phases) {
      const phaseId = byKey.get(seed.key);
      if (!phaseId || seed.deliverables.length === 0) continue;
      await seedPhaseDeliverablesFromTemplate({
        projectId,
        phaseId,
        actorId,
        deliverables: seed.deliverables.map((d) => ({
          name: d.name,
          workstreamKey: d.workstreamKey,
          tasks: d.tasks.map((t) => t.title),
        })),
      });
    }
  }
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

/**
 * Refuse a write to a project that has switched Activate off.
 *
 * WHY THIS IS A SHARED FUNCTION AND NOT A LINE IN EACH ROUTE
 *
 * It was a line in each route, and only five of nineteen route files had it.
 * The rest — raising a gate, signing one off, completing a phase, editing a
 * fit-to-standard decision, renaming a scope item — went through untouched,
 * so a project with the methodology switched off could still accumulate
 * approved gates and completed phases. Disabling looked like it worked
 * because the screens disappear; the API never stopped accepting the writes
 * behind them.
 *
 * Every mutating Activate route calls this. Reads deliberately do not: the
 * rows survive a disable by design, and a project turning Activate back on
 * expects to find its history rather than a blank methodology.
 *
 * A 409 rather than a 403: the caller holds the right permission, the project
 * is in the wrong state, and enabling it makes the identical request succeed.
 */
export async function assertActivateEnabled(projectId: string): Promise<void> {
  if (!(await isActivateEnabled(projectId))) {
    const { ConflictError } = await import("./api-error");
    throw new ConflictError("Activate is not enabled for this project.", "ACTIVATE_DISABLED");
  }
}
