/**
 * A phase worksheet, seeded: its deliverables, their tasks and its gate.
 *
 * All six phases are here, chosen with --phase. One script,
 * because the worksheet has never been phase-specific — one screen, one API,
 * one code allocator, addressed by phase key — and only the content differs.
 * A second script would have meant a second copy of the login, the rate-limit
 * pacing and the gate reconciliation, which is three chances to drift.
 *
 * THE METHODOLOGY TEMPLATE NOW CARRIES THIS CONTENT
 *
 * `src/lib/activate-template-content.ts` holds the same six phase plans,
 * and enabling Activate seeds a project from them — so a NEW project no
 * longer needs this script at all. The library is the authoritative copy;
 * the arrays below are a second one, kept because this script predates it
 * and still runs. If the two ever disagree, the library is right.
 *
 * Retiring these arrays means teaching this script to read the template's
 * own rows, which is worth doing and is not done here.
 *
 * WHY A SEEDER STILL EXISTS
 *
 * These seven deliverables are one organisation's Discover plan for one
 * product line. The built-in methodology deliberately carries phases, gates
 * and workstreams — the parts that are the same everywhere — and not a fixed
 * list of deliverables, because hard-coding somebody's roadmap into the
 * methodology makes it wrong for the next customer. A template capability
 * for deliverables would be the way to make this repeatable for real; this
 * script is how the worksheet gets real content to work with today.
 *
 * WHY IT DRIVES THE HTTP API
 *
 * Writing rows directly would let it produce states the product cannot: a
 * deliverable with no issue behind it, a code that skipped the allocator, a
 * task on an issue nobody may edit. Going through the API means the seeded
 * worksheet is, by construction, one a person could have built by hand.
 *
 * SAFE TO RE-RUN. A deliverable whose name already exists in the phase is
 * skipped rather than duplicated. The gate's criteria are RECONCILED to the
 * seven below — missing ones added, others removed — because a gate that
 * accumulates a second set of questions on every run is not the gate
 * anybody agreed. Deliverables and tasks are never deleted.
 *
 *   node scripts/seed-activate-worksheet.mjs --phase PREPARE
 *                                            [--project HELIOS]
 *                                            [--base http://127.0.0.1:3100]
 *                                            [--email alex@acme.com]
 *                                            [--password 'Password123!']
 */

import { PrismaClient } from "@prisma/client";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE = argOf("--base", "http://127.0.0.1:3100");
const PROJECT_KEY = argOf("--project", "HELIOS");
const PHASE_KEY = argOf("--phase", "DISCOVER").toUpperCase();
const EMAIL = argOf("--email", "alex@acme.com");
const PASSWORD = argOf("--password", "Password123!");

const prisma = new PrismaClient();
let cookie = "";

/**
 * The reference build's ten workstream names, mapped onto the methodology's
 * own keys.
 *
 * Two of them had no home before this work and were added to the
 * methodology: security is not application design, and cutover is not the
 * team that runs the system afterwards. The other eight already existed
 * under SAP Activate's own names, and renaming those to match a screenshot
 * would have changed what every other project displays.
 */
const WORKSTREAM_BY_LABEL = {
  "Project management and governance": "PROJECT_MANAGEMENT",
  "Solution design and configuration": "APPLICATION_DESIGN_CONFIGURATION",
  "Data migration": "DATA_MANAGEMENT",
  "Integration and technology": "INTEGRATION",
  "Testing and quality": "TESTING",
  "Change management and adoption": "SOLUTION_ADOPTION",
  "Security and permissions": "SECURITY_PERMISSIONS",
  "Reporting and analytics": "ANALYTICS",
  "Cutover and go-live": "CUTOVER_GO_LIVE",
  "Support and release management": "OPERATIONS_SUPPORT",
};

const DISCOVER_DELIVERABLES = [
  {
    name: "Business case and target outcomes",
    workstream: "Project management and governance",
    tasks: [
      "Assess current HR operating model and its pain points",
      "Map target outcomes to measurable indicators",
      "Baseline current process cost and cycle effort",
      "Run the executive alignment session",
    ],
    complete: 0,
  },
  {
    name: "Suite scope and module roadmap",
    workstream: "Solution design and configuration",
    tasks: [
      "Confirm which modules are in scope for this release",
      "Decide the phasing and sequence across modules",
      "Confirm populations, countries and legal entities",
      "List processes explicitly out of scope",
    ],
    // The one deliverable that starts finished, so the worksheet shows a
    // mixed state rather than a uniformly empty one.
    complete: 4,
  },
  {
    name: "Current landscape assessment",
    workstream: "Solution design and configuration",
    tasks: [
      "Inventory existing HR systems and their owners",
      "Map process ownership across the HR function",
      "Assess data quality and completeness at a high level",
      "Identify systems to be retired and their dependencies",
    ],
    complete: 0,
  },
  {
    name: "Delivery approach and indicative plan",
    workstream: "Project management and governance",
    tasks: [
      "Decide the release and wave strategy",
      "Draft the indicative timeline and major milestones",
      "Agree the estimating model and effort bands",
      "Decide the partner and internal delivery split",
    ],
    complete: 0,
  },
  {
    name: "Standard process demonstration",
    workstream: "Solution design and configuration",
    tasks: [
      "Request a demonstration or trial tenant",
      "Demonstrate standard flows for each candidate module",
      "Record adopt-standard appetite by module and process area",
    ],
    complete: 0,
  },
  {
    name: "Commercial and licensing model",
    workstream: "Project management and governance",
    tasks: [
      "Size subscriptions by module and population",
      "Confirm the budget envelope",
      "Confirm the funding path and approval route",
    ],
    complete: 0,
  },
  {
    name: "Change readiness assessment",
    workstream: "Change management and adoption",
    tasks: [
      "Assess appetite and capacity for change",
      "Identify the populations most affected",
      "Identify sponsorship gaps and how they will be closed",
    ],
    complete: 0,
  },
];


/**
 * Prepare: project initiation, governance, planning and the strategies the
 * later phases execute against.
 *
 * The fit-to-standard entry here (P-10) is the PLAN for those workshops —
 * scheduling them, confirming who decides, publishing the decision log
 * format. Running them belongs to Explore, and putting the analysis in
 * Prepare would have a phase claiming work it has not done.
 */
const PREPARE_DELIVERABLES = [
  {
    name: "Project charter and governance",
    workstream: "Project management and governance",
    tasks: [
      "Write and approve the project charter",
      "Stand up the steering committee and its terms of reference",
      "Publish the RACI and decision rights",
      "Define the escalation path and decision turnaround times",
      "Set the meeting and reporting cadence",
    ],
    complete: 0,
  },
  {
    name: "Plan, RAID and reporting",
    workstream: "Project management and governance",
    tasks: [
      "Baseline the schedule",
      "Establish the RAID log and its review rhythm",
      "Build the status reporting pack",
      "Create the cross-workstream dependency register",
    ],
    complete: 0,
  },
  {
    name: "Instance provisioning and landscape",
    workstream: "Integration and technology",
    tasks: [
      "Provision the required instances",
      "Agree the instance strategy and refresh policy",
      "Establish provisioning access and who holds it",
      "Define how configuration moves between instances",
    ],
    complete: 0,
  },
  {
    name: "Configuration standards and governance",
    workstream: "Solution design and configuration",
    tasks: [
      "Agree data model governance and who approves changes",
      "Agree picklist and custom object governance",
      "Publish naming and configuration standards",
      "Decide the extension policy and its approval route",
    ],
    complete: 0,
  },
  {
    name: "Integration architecture and strategy",
    workstream: "Integration and technology",
    tasks: [
      "Build the integration inventory",
      "Decide the middleware approach and its ownership",
      "Plan authentication, certificates and renewal ownership",
      "Agree monitoring and failure alerting standards",
    ],
    complete: 0,
  },
  {
    name: "Data migration strategy",
    workstream: "Data migration",
    tasks: [
      "Inventory source systems and extract owners",
      "Decide data scope, history depth and retention",
      "Choose the migration approach per object",
      "Baseline data quality and agree the cleansing plan",
      "Plan the load cycles and the reconciliation method",
    ],
    complete: 0,
  },
  {
    name: "Test strategy",
    workstream: "Testing and quality",
    tasks: [
      "Define test levels with entry and exit criteria",
      "Define the end-to-end scenarios that cross modules",
      "Agree the defect severity model and triage process",
      "Decide test tooling and the test data approach",
    ],
    complete: 0,
  },
  {
    name: "Change and communications strategy",
    workstream: "Change management and adoption",
    tasks: [
      "Build the stakeholder map and change impact heatmap",
      "Publish the communications plan",
      "Define the training strategy and delivery channels",
      "Recruit and brief the change network",
    ],
    complete: 0,
  },
  {
    name: "Permission and privacy strategy",
    workstream: "Security and permissions",
    tasks: [
      "Draft the role-based permission concept",
      "Set segregation of duties principles",
      "Complete the privacy, residency and retention assessment",
      "Agree who owns permission changes after go-live",
    ],
    complete: 0,
  },
  {
    name: "Fit-to-standard workshop plan",
    workstream: "Solution design and configuration",
    tasks: [
      "Confirm the scope item catalogue to be worked through",
      "Schedule workshops and confirm decision-makers per session",
      "Prepare pre-reads and standard process demonstrations",
      "Publish the decision log format and the decision rules",
    ],
    complete: 0,
  },
  {
    name: "Reporting and analytics strategy",
    workstream: "Reporting and analytics",
    tasks: [
      "Inventory current reports and their real users",
      "Decide what is rebuilt, replaced or retired",
      "Agree the reporting tool approach",
      "Agree data access and privacy rules for reporting",
    ],
    complete: 0,
  },
  {
    name: "Team onboarding and enablement",
    workstream: "Project management and governance",
    tasks: [
      "Onboard the team to roles and ways of working",
      "Induct the team into the method and tooling",
      "Deliver enablement for customer team members",
    ],
    complete: 0,
  },
];

const DISCOVER_GATE = {
  name: "Discovery complete",
  criteria: [
  "Modules in scope for this release confirmed and signed by the sponsor",
  "Populations, countries and legal entities fixed",
  "Target outcomes baselined with measurable before-state figures",
  "Indicative effort and budget envelope accepted",
  "Appetite for adopting standard process tested and recorded per module",
  "Executive sponsor named and actively engaged",
    "Top ten risks logged with named owners",
  ],
};

/**
 * Prepare's gate.
 *
 * Two of these read differently from the plain-text list that accompanied
 * the screenshots — "RACI signed" rather than "RAID signed", and "naming
 * standards" rather than "standards". The screenshots and the reference
 * build agree with each other, and both were described as authoritative, so
 * that is what is seeded. RACI is also the right word here: the criterion
 * beside it is about decision rights, and RAID has a criterion of its own.
 */
const PREPARE_GATE = {
  name: "Project readiness",
  criteria: [
    "Charter, governance model and RACI signed",
    "Named business decision-maker confirmed for every module in scope",
    "Instances provisioned and access granted to the team",
    "Configuration, extension and naming standards agreed",
    "Test, data migration and reporting strategies approved",
    "Permission strategy approved including the privacy assessment",
    "Fit-to-standard workshop schedule published with attendees confirmed",
    "Baseline schedule and RAID log established",
  ],
};


/**
 * Explore: where fit-to-standard is actually RUN.
 *
 * Prepare scheduled the workshops and confirmed who decides; E-01 runs them,
 * and everything downstream of it — the deltas, the backlog, the designs —
 * is the output of that conversation. Keeping the two apart matters: a phase
 * that claims the workshops it only planned reports progress it has not
 * made.
 *
 * Build and configuration are NOT here. E-03 and E-04 design the
 * configuration; Realize performs it against the backlog this phase
 * baselines.
 */
const EXPLORE_DELIVERABLES = [
  {
    name: "Fit-to-standard workshop execution",
    workstream: "Solution design and configuration",
    tasks: [
      "Run the workshop series by scope item",
      "Demonstrate the standard process before discussing change",
      "Record a decision for every scope item",
      "Capture each delta with its business justification",
      "Log open questions with an owner and a due date",
    ],
    complete: 0,
  },
  {
    name: "Backlog consolidation and sizing",
    workstream: "Solution design and configuration",
    tasks: [
      "Convert deltas into backlog items",
      "Classify each item by build type",
      "Prioritise using the agreed model",
      "Size items and sequence them into releases",
      "Review the backlog with the steering committee",
    ],
    complete: 0,
  },
  {
    name: "Foundation configuration design",
    workstream: "Solution design and configuration",
    tasks: [
      "Design the data models and field-level configuration",
      "Design foundation objects and company structure",
      "Design workflows, approvals and notifications",
      "Build the business rule inventory",
    ],
    complete: 0,
  },
  {
    name: "Module solution design",
    workstream: "Solution design and configuration",
    tasks: [
      "Design each in-scope module against the standard process",
      "Document end-to-end process flows",
      "Identify cross-module dependencies and name their owners",
      "Agree module-to-module data handoffs",
    ],
    complete: 0,
  },
  {
    name: "Integration design",
    workstream: "Integration and technology",
    tasks: [
      "Design each interface in the inventory",
      "Design downstream data handoffs",
      "Design error handling, monitoring and alerting",
      "Agree interface ownership after go-live",
    ],
    complete: 0,
  },
  {
    name: "Data migration design",
    workstream: "Data migration",
    tasks: [
      "Complete field-level source-to-target mapping",
      "Define transformation and defaulting rules",
      "Decide the treatment of historical data",
      "Execute the first mock load and publish reconciliation results",
    ],
    complete: 0,
  },
  {
    name: "Permission design",
    workstream: "Security and permissions",
    tasks: [
      "Build the role catalogue",
      "Design permission groups and their membership rules",
      "Design target population and data scoping rules",
      "Produce the segregation of duties matrix",
    ],
    complete: 0,
  },
  {
    name: "Reporting design",
    workstream: "Reporting and analytics",
    tasks: [
      "Confirm the report catalogue to be built",
      "Define metric definitions and their owners",
      "Design dashboards by audience",
      "Agree row-level access rules",
    ],
    complete: 0,
  },
  {
    name: "Change impact assessment",
    workstream: "Change management and adoption",
    tasks: [
      "Assess impact by role and population",
      "Draft the training curriculum by audience",
      "Plan communications against the delivery milestones",
    ],
    complete: 0,
  },
  {
    name: "Release and change control",
    workstream: "Project management and governance",
    tasks: [
      "Baseline the backlog",
      "Produce the sprint or iteration plan",
      "Activate scope change control",
    ],
    complete: 0,
  },
  {
    name: "Design documentation and sign-off",
    workstream: "Solution design and configuration",
    tasks: [
      "Assemble the solution design documentation",
      "Close the decision log",
      "Obtain business sign-off per module",
    ],
    complete: 0,
  },
];

const EXPLORE_GATE = {
  name: "Design complete",
  criteria: [
    "Every in-scope scope item has a recorded and signed decision",
    "All deltas converted into backlog items with owner, size and priority",
    "Cross-module dependencies identified and owned",
    "Integration and data migration designs approved",
    "Permission design approved including privacy review",
    "Reporting design agreed with the report owners",
    "No open critical design questions",
    "Backlog baselined and sequenced into releases",
  ],
};


/**
 * Realize: building what Explore decided.
 *
 * Every line here consumes the backlog rather than adding to it. R-01
 * configures in sprints against it; R-05 and R-06 test what was built; R-10
 * rehearses the cutover. Nothing in this phase discovers requirements — that
 * conversation finished at G2, and a Realize that re-opens it is a project
 * about to miss its date.
 *
 * Deploy still owns the production setup and the go-live itself. R-10 builds
 * and rehearses the cutover plan; it does not run it.
 */
const REALIZE_DELIVERABLES = [
  {
    name: "Iterative configuration",
    workstream: "Solution design and configuration",
    tasks: [
      "Configure in sprints against the backlog",
      "Run a playback at the end of each sprint",
      "Maintain the configuration workbook as you build",
      "Resolve playback feedback back into the backlog",
    ],
    complete: 0,
  },
  {
    name: "Extension and enhancement build",
    workstream: "Solution design and configuration",
    tasks: [
      "Build custom objects and extension fields",
      "Develop approved extensions and custom interfaces",
      "Peer review developments against the design",
      "Record each extension in the upgrade regression pack",
    ],
    complete: 0,
  },
  {
    name: "Integration build and unit test",
    workstream: "Integration and technology",
    tasks: [
      "Build and configure each interface",
      "Implement error handling and alerting",
      "Unit test each interface against its design",
      "Test failure and reprocessing paths",
    ],
    complete: 0,
  },
  {
    name: "Data migration build and load cycles",
    workstream: "Data migration",
    tasks: [
      "Build load templates and transformation logic",
      "Execute the second mock load and analyse defects",
      "Execute the final mock load and reconcile",
      "Publish data validation and exception reports",
    ],
    complete: 0,
  },
  {
    name: "Functional and end-to-end testing",
    workstream: "Testing and quality",
    tasks: [
      "Run unit and string tests",
      "Run system integration test cycles",
      "Run end-to-end scenarios that cross modules",
      "Run the regression pack",
      "Operate defect triage and burndown",
    ],
    complete: 0,
  },
  {
    name: "User acceptance testing",
    workstream: "Testing and quality",
    tasks: [
      "Build the acceptance scenario pack",
      "Execute acceptance testing with business users",
      "Close or accept every business-raised defect",
      "Obtain acceptance sign-off",
    ],
    complete: 0,
  },
  {
    name: "Permission build and test",
    workstream: "Security and permissions",
    tasks: [
      "Build roles and permission groups",
      "Test roles with real business users on real tasks",
      "Validate segregation of duties",
      "Plan production role assignment",
    ],
    complete: 0,
  },
  {
    name: "Report build and validation",
    workstream: "Reporting and analytics",
    tasks: [
      "Build the agreed reports and dashboards",
      "Validate figures against a trusted source",
      "Test report access under each role",
      "Hand reports over to their named owners",
    ],
    complete: 0,
  },
  {
    name: "Training build and readiness",
    workstream: "Change management and adoption",
    tasks: [
      "Complete training needs analysis by role",
      "Build materials and job aids",
      "Prepare the training environment and data",
      "Enable trainers and super users",
    ],
    complete: 0,
  },
  {
    name: "Cutover plan build",
    workstream: "Cutover and go-live",
    tasks: [
      "Build the cutover task list with T-minus offsets",
      "Assign owners and durations to every task",
      "Execute the first dry run and record actual timings",
      "Write rollback and contingency plans",
      "Set up the command centre and communications",
    ],
    complete: 0,
  },
  {
    name: "Support model design",
    workstream: "Support and release management",
    tasks: [
      "Design the hypercare model and staffing",
      "Define support processes and service levels",
      "Plan knowledge transfer",
      "Configure ticket routing and categorisation",
    ],
    complete: 0,
  },
  {
    name: "Cross-module validation",
    workstream: "Solution design and configuration",
    tasks: [
      "Validate data handoffs between modules",
      "Validate end-to-end processes with real role combinations",
      "Resolve ownership of cross-module defects",
    ],
    complete: 0,
  },
];

const REALIZE_GATE = {
  name: "Solution ready",
  criteria: [
    "All backlog items delivered, deferred with approval, or formally descoped",
    "End-to-end process tested across every in-scope module",
    "Integrations tested with real volumes and failure cases",
    "User acceptance testing signed off",
    "No open critical or high defects without an accepted workaround",
    "Final mock data load reconciled and signed",
    "Permissions built and tested by business users",
    "Cutover dry run completed with timings recorded",
    "Training materials approved",
  ],
};


/**
 * Deploy: putting it into production and switching the business over.
 *
 * Nothing here builds anything. Realize finished the solution and rehearsed
 * the cutover; Deploy moves configuration to production, loads the real
 * data, runs the cutover, provisions access, launches training, stands up
 * hypercare and validates the first live transactions.
 *
 * DP-01 holds the go or no-go MEETING. The decision is a governance act and
 * the gate criterion beside it is evidence that it happened — neither is the
 * same as approving G4, which is why the criterion and the gate's own
 * lifecycle stay separate.
 */
const DEPLOY_DELIVERABLES = [
  {
    name: "Production readiness assessment",
    workstream: "Project management and governance",
    tasks: [
      "Complete the readiness checklist across workstreams",
      "Confirm go or no-go criteria and thresholds",
      "Hold the go or no-go decision meeting",
    ],
    complete: 0,
  },
  {
    name: "Production setup and integration activation",
    workstream: "Integration and technology",
    tasks: [
      "Move configuration to production",
      "Activate production integrations and certificates",
      "Enable production monitoring and alerting",
    ],
    complete: 0,
  },
  {
    name: "Final cutover rehearsal",
    workstream: "Cutover and go-live",
    tasks: [
      "Execute the final dry run end to end",
      "Validate timings and the critical path",
      "Resolve rehearsal issues and re-baseline the plan",
    ],
    complete: 0,
  },
  {
    name: "Production data load",
    workstream: "Data migration",
    tasks: [
      "Take the final extract and complete cleansing",
      "Execute the production load",
      "Reconcile and obtain data sign-off",
    ],
    complete: 0,
  },
  {
    name: "Cutover execution",
    workstream: "Cutover and go-live",
    tasks: [
      "Operate the command centre",
      "Track task completion against the T-minus plan",
      "Hold checkpoint decisions at the agreed milestones",
      "Confirm go-live and communicate it",
    ],
    complete: 0,
  },
  {
    name: "Access provisioning",
    workstream: "Security and permissions",
    tasks: [
      "Assign production roles and permission groups",
      "Verify access for a sample of every role",
      "Hand permission administration to its owner",
    ],
    complete: 0,
  },
  {
    name: "Training delivery and launch",
    workstream: "Change management and adoption",
    tasks: [
      "Deliver training to end users",
      "Issue launch communications",
      "Stand up floorwalking and local support",
    ],
    complete: 0,
  },
  {
    name: "Hypercare mobilisation",
    workstream: "Support and release management",
    tasks: [
      "Stand up the hypercare team",
      "Open the issue log and triage process",
      "Start the daily stand-up cadence",
    ],
    complete: 0,
  },
  {
    name: "Post-go-live validation",
    workstream: "Solution design and configuration",
    tasks: [
      "Validate the first live transactions in each module",
      "Validate integrations running on schedule",
      "Validate reports against expected values",
    ],
    complete: 0,
  },
];

const DEPLOY_GATE = {
  name: "Go-live readiness",
  criteria: [
    "Go or no-go decision approved by the steering committee",
    "Production data load reconciled and signed",
    "First live transactions validated end to end",
    "Integrations running on schedule and monitored in production",
    "Reports validated in production against expected values",
    "Users trained and access provisioned",
    "Hypercare team active with triage running",
    "No open critical defects in production",
  ],
};


/**
 * Run: the handover into normal operations, and what happens afterwards.
 *
 * Deploy mobilised hypercare; RN-01 runs it and RN-02 hands the solution to
 * the support organisation. Nothing here cuts over or configures. The last
 * two deliverables are the ones projects skip and regret: a release routine
 * that keeps extensions working through vendor upgrades, and an improvement
 * backlog with a forum that actually meets.
 *
 * Continuous improvement lives INSIDE Run rather than being a seventh
 * phase, which is what the methodology says and what the first draft of
 * this application got wrong.
 *
 * RN-04's first task reads "set an owner", matching the screenshots and the
 * reference build. The plain-text list that came with them said "set a
 * calendar"; the screenshots were described as authoritative, and an owner
 * is the part that decays — a calendar with nobody responsible for it is
 * how release assessment quietly stops happening.
 */
const RUN_DELIVERABLES = [
  {
    name: "Hypercare execution",
    workstream: "Support and release management",
    tasks: [
      "Run daily triage and issue burndown",
      "Monitor integrations and scheduled jobs",
      "Report hypercare status to the steering committee",
    ],
    complete: 0,
  },
  {
    name: "Transition to support",
    workstream: "Support and release management",
    tasks: [
      "Complete knowledge transfer sessions",
      "Hand over to the support organisation",
      "Hand over documentation and administrative access",
    ],
    complete: 0,
  },
  {
    name: "Benefits review and closure",
    workstream: "Project management and governance",
    tasks: [
      "Measure benefits against the baseline",
      "Run the lessons learned review",
      "Close the project formally and release the team",
    ],
    complete: 0,
  },
  {
    name: "Release management setup",
    workstream: "Solution design and configuration",
    tasks: [
      "Subscribe to vendor release information and set an owner",
      "Establish the release assessment and regression routine",
      "Maintain the regression pack against every extension",
      "Plan how optional features are evaluated and adopted",
    ],
    complete: 0,
  },
  {
    name: "Adoption measurement and optimisation",
    workstream: "Change management and adoption",
    tasks: [
      "Measure adoption by process and role",
      "Collect user feedback",
      "Deliver targeted retraining where adoption is weak",
    ],
    complete: 0,
  },
  {
    name: "Continuous improvement",
    workstream: "Solution design and configuration",
    tasks: [
      "Open the improvement backlog",
      "Agree the prioritisation forum and its cadence",
      "Plan the next module wave",
    ],
    complete: 0,
  },
];

const RUN_GATE = {
  name: "Transition to operations",
  criteria: [
    "Agreed stabilisation period completed without critical incident",
    "Open issue count below the agreed threshold",
    "Support handover formally accepted by the operations team",
    "Documentation complete and stored in the agreed location",
    "Lessons learned captured and published",
    "Benefits measured against the baseline",
    "Vendor release assessment routine operating",
    "Improvement backlog open with a named prioritisation forum",
  ],
};

const PHASES = {
  DISCOVER: { deliverables: DISCOVER_DELIVERABLES, gate: DISCOVER_GATE },
  PREPARE: { deliverables: PREPARE_DELIVERABLES, gate: PREPARE_GATE },
  EXPLORE: { deliverables: EXPLORE_DELIVERABLES, gate: EXPLORE_GATE },
  REALIZE: { deliverables: REALIZE_DELIVERABLES, gate: REALIZE_GATE },
  DEPLOY: { deliverables: DEPLOY_DELIVERABLES, gate: DEPLOY_GATE },
  RUN: { deliverables: RUN_DELIVERABLES, gate: RUN_GATE },
};

const chosen = PHASES[PHASE_KEY];
if (!chosen) {
  console.error(`\nNo seed data for phase ${PHASE_KEY}. Known: ${Object.keys(PHASES).join(", ")}\n`);
  process.exit(2);
}
const DELIVERABLES = chosen.deliverables;
const GATE_NAME = chosen.gate.name;
const GATE_CRITERIA = chosen.gate.criteria;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The mutation rate limit is 30 a minute per subject and this script makes
 * well over that. It waits rather than being exempted: the limit is the
 * product working, and widening it for a seeder is how a limit stops
 * meaning anything.
 */
const BUDGET = 25;
let windowStart = Date.now();
let spent = 0;

async function throttle() {
  const elapsed = Date.now() - windowStart;
  if (elapsed >= 60_000) {
    windowStart = Date.now();
    spent = 0;
    return;
  }
  if (spent >= BUDGET) {
    const wait = 60_000 - elapsed + 500;
    process.stdout.write(`    (pausing ${Math.ceil(wait / 1000)}s for the rate limit)\n`);
    await sleep(wait);
    windowStart = Date.now();
    spent = 0;
  }
}

async function api(path, init = {}, attempt = 0) {
  const method = init.method || "GET";
  if (method !== "GET") {
    await throttle();
    spent += 1;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      Origin: BASE,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* not json */
  }
  if (res.status === 429 && attempt < 3) {
    const named = Number((text.match(/in (\d+) second/) || [])[1]);
    const wait = (Number.isFinite(named) ? named : 60) * 1000 + 1000;
    process.stdout.write(`    (rate limited; waiting ${Math.ceil(wait / 1000)}s)\n`);
    await sleep(wait);
    windowStart = Date.now();
    spent = 0;
    return api(path, init, attempt + 1);
  }
  if (res.status >= 400) {
    throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 250)}`);
  }
  return body;
}

async function main() {
  console.log(`\nSeeding the ${PHASE_KEY} worksheet of ${PROJECT_KEY} against ${BASE}\n`);

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");

  const project = await prisma.project.findFirst({
    where: { key: PROJECT_KEY },
    select: { id: true, name: true },
  });
  if (!project) throw new Error(`No project with key ${PROJECT_KEY}`);

  const phase = await prisma.activatePhase.findUnique({
    where: { projectId_key: { projectId: project.id, key: PHASE_KEY } },
    select: { id: true },
  });
  if (!phase) throw new Error(`${PROJECT_KEY} has no ${PHASE_KEY} phase — is Activate enabled?`);

  /**
   * The two workstreams added for this worksheet exist in the methodology but
   * not on projects seeded before it. Created here rather than by a
   * migration: a migration that writes rows into every existing project is a
   * decision taken on behalf of customers who never asked for it.
   */
  const existingWs = await prisma.activateWorkstream.findMany({
    where: { projectId: project.id },
    select: { key: true },
  });
  const have = new Set(existingWs.map((w) => w.key));
  const missing = [
    { key: "SECURITY_PERMISSIONS", name: "Security & Permissions", position: 11 },
    { key: "CUTOVER_GO_LIVE", name: "Cutover & Go-Live", position: 12 },
  ].filter((w) => !have.has(w.key));
  for (const w of missing) {
    await prisma.activateWorkstream.create({ data: { projectId: project.id, ...w } });
    console.log(`  added missing workstream: ${w.name}`);
  }

  const workstreams = await prisma.activateWorkstream.findMany({
    where: { projectId: project.id },
    select: { id: true, key: true },
  });
  const wsIdByKey = new Map(workstreams.map((w) => [w.key, w.id]));

  const sheetPath = `/api/projects/${project.id}/activate/phases/${PHASE_KEY}/worksheet`;
  const before = await api(sheetPath);
  const existingNames = new Set(before.worksheet.deliverables.map((d) => d.name));

  for (const d of DELIVERABLES) {
    if (existingNames.has(d.name)) {
      console.log(`  ${d.name}: already present — skipped`);
      continue;
    }
    const wsKey = WORKSTREAM_BY_LABEL[d.workstream];
    const created = await api(sheetPath, {
      method: "POST",
      body: { name: d.name, workstreamId: wsIdByKey.get(wsKey) ?? null },
    });
    const { issueId, phaseCode } = created.deliverable;

    for (let i = 0; i < d.tasks.length; i += 1) {
      const task = await api(`/api/issues/${issueId}/subtasks`, {
        method: "POST",
        body: { title: d.tasks[i] },
      });
      const taskId = task.subtask?.id ?? task.id;
      if (i < d.complete && taskId) {
        await api(`/api/subtasks/${taskId}`, {
          method: "PATCH",
          body: { isCompleted: true },
        });
      }
    }
    console.log(`  ${phaseCode}  ${d.name} — ${d.complete}/${d.tasks.length} complete`);
  }

  // ---- the gate ----------------------------------------------------------
  const gate = await prisma.activateGate.findFirst({
    where: { phaseId: phase.id },
    select: { id: true, name: true, status: true, criteria: { select: { id: true, criterion: true } } },
  });
  if (!gate) {
    console.log("\n  no gate on this phase — skipping the criteria");
  } else if (gate.status !== "OPEN") {
    console.log(`\n  the gate is ${gate.status}; its criteria are frozen and were left alone`);
  } else {
    if (gate.name !== GATE_NAME) {
      await prisma.activateGate.update({ where: { id: gate.id }, data: { name: GATE_NAME } });
      console.log(`\n  renamed the gate to "${GATE_NAME}"`);
    }
    /**
     * RECONCILED, not appended.
     *
     * The phase arrives with the three criteria the built-in methodology
     * seeds. Adding seven on top left a gate asking ten questions, which is
     * not the Discover gate this organisation agreed -- it is two gates
     * merged by accident. The missing ones are added first and the extras
     * removed afterwards, so the count never passes through zero and the
     * route never has to refuse an empty gate.
     */
    const present = new Set(gate.criteria.map((c) => c.criterion));
    for (const criterion of GATE_CRITERIA) {
      if (present.has(criterion)) continue;
      await api(`/api/projects/${project.id}/activate/gates/${gate.id}/criteria`, {
        method: "POST",
        body: { criterion },
      });
    }

    const wanted = new Set(GATE_CRITERIA);
    for (const c of gate.criteria) {
      if (wanted.has(c.criterion)) continue;
      await api(`/api/projects/${project.id}/activate/gates/${gate.id}/criteria/${c.id}`, {
        method: "DELETE",
      });
      console.log(`  removed the methodology criterion: ${c.criterion}`);
    }
    console.log(`  gate criteria: ${GATE_CRITERIA.length}`);
  }

  const after = await api(sheetPath);
  const w = after.worksheet;
  console.log(
    `\n${w.deliverableCount} deliverables · ${w.tasksComplete} of ${w.tasksTotal} tasks complete` +
      (w.gate ? ` · ${w.gate.code} ${w.gate.name} ${w.gate.criteriaMet}/${w.gate.criteriaTotal}` : "")
  );
  for (const ws of w.workstreams.filter((x) => x.deliverableCount > 0)) {
    console.log(`  ${ws.name}: ${ws.deliverableCount}`);
  }
  console.log("");
}

main()
  .catch((e) => {
    console.error(`\n${e.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
