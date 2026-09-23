/**
 * The SAP Activate plan, as content: every phase's deliverables, their task
 * checklists and its quality-gate criteria.
 *
 * WHY THIS IS A LIBRARY AND NOT A SEED SCRIPT
 *
 * These 57 deliverables and 213 tasks existed only inside
 * `scripts/seed-activate-worksheet.mjs`, so the only way to get a populated
 * worksheet was to run a script against a project by hand. Every new project
 * started with six empty phases and a gate, and the plan that makes the
 * methodology worth running had to be typed in from nothing.
 *
 * Here, it is template content. `ensureBuiltInTemplate` writes it into the
 * template's own tables and `enableActivate` seeds a project from them, so
 * turning Activate on produces a complete, working plan.
 *
 * WHY THE SEEDER STILL EXISTS
 *
 * It imports this file rather than carrying its own copy. It remains the way
 * to populate a project that was created BEFORE the template had content —
 * enabling is idempotent and will not retrofit a phase that already has
 * deliverables, and rebuilding an existing project's plan is not something
 * this code should do behind anybody's back.
 *
 * A TEMPLATE DESCRIBES A PLAN, NOT PROGRESS
 *
 * No task here is marked complete and no criterion is marked met. The
 * seeder's demo-completion counts are deliberately absent: a new project
 * that arrives with work already ticked is lying about itself.
 *
 * ON THE CONTENT ITSELF: it is SAP Activate-aligned, drawn from the
 * published methodology's shape. It is not certified by, endorsed by or
 * affiliated with SAP.
 */

/** One numbered line of a phase's plan, with the checklist that completes it. */
export interface TemplateDeliverableSeed {
  name: string;
  /** An `ACTIVATE_WORKSTREAMS` key. Checked by a test, not just by eye. */
  workstreamKey: string;
  tasks: string[];
}

export interface PhaseContentSeed {
  gate: { name: string; criteria: string[] };
  deliverables: TemplateDeliverableSeed[];
}

export const ACTIVATE_PHASE_CONTENT: Record<string, PhaseContentSeed> = {
  DISCOVER: {
    gate: {
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
    },
    deliverables: [
      {
        name: "Business case and target outcomes",
        workstreamKey: "PROJECT_MANAGEMENT",
        tasks: [
          "Assess current HR operating model and its pain points",
          "Map target outcomes to measurable indicators",
          "Baseline current process cost and cycle effort",
          "Run the executive alignment session",
        ],
      },
      {
        name: "Suite scope and module roadmap",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Confirm which modules are in scope for this release",
          "Decide the phasing and sequence across modules",
          "Confirm populations, countries and legal entities",
          "List processes explicitly out of scope",
        ],
      },
      {
        name: "Current landscape assessment",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Inventory existing HR systems and their owners",
          "Map process ownership across the HR function",
          "Assess data quality and completeness at a high level",
          "Identify systems to be retired and their dependencies",
        ],
      },
      {
        name: "Delivery approach and indicative plan",
        workstreamKey: "PROJECT_MANAGEMENT",
        tasks: [
          "Decide the release and wave strategy",
          "Draft the indicative timeline and major milestones",
          "Agree the estimating model and effort bands",
          "Decide the partner and internal delivery split",
        ],
      },
      {
        name: "Standard process demonstration",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Request a demonstration or trial tenant",
          "Demonstrate standard flows for each candidate module",
          "Record adopt-standard appetite by module and process area",
        ],
      },
      {
        name: "Commercial and licensing model",
        workstreamKey: "PROJECT_MANAGEMENT",
        tasks: [
          "Size subscriptions by module and population",
          "Confirm the budget envelope",
          "Confirm the funding path and approval route",
        ],
      },
      {
        name: "Change readiness assessment",
        workstreamKey: "SOLUTION_ADOPTION",
        tasks: [
          "Assess appetite and capacity for change",
          "Identify the populations most affected",
          "Identify sponsorship gaps and how they will be closed",
        ],
      },
    ],
  },
  PREPARE: {
    gate: {
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
    },
    deliverables: [
      {
        name: "Project charter and governance",
        workstreamKey: "PROJECT_MANAGEMENT",
        tasks: [
          "Write and approve the project charter",
          "Stand up the steering committee and its terms of reference",
          "Publish the RACI and decision rights",
          "Define the escalation path and decision turnaround times",
          "Set the meeting and reporting cadence",
        ],
      },
      {
        name: "Plan, RAID and reporting",
        workstreamKey: "PROJECT_MANAGEMENT",
        tasks: [
          "Baseline the schedule",
          "Establish the RAID log and its review rhythm",
          "Build the status reporting pack",
          "Create the cross-workstream dependency register",
        ],
      },
      {
        name: "Instance provisioning and landscape",
        workstreamKey: "INTEGRATION",
        tasks: [
          "Provision the required instances",
          "Agree the instance strategy and refresh policy",
          "Establish provisioning access and who holds it",
          "Define how configuration moves between instances",
        ],
      },
      {
        name: "Configuration standards and governance",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Agree data model governance and who approves changes",
          "Agree picklist and custom object governance",
          "Publish naming and configuration standards",
          "Decide the extension policy and its approval route",
        ],
      },
      {
        name: "Integration architecture and strategy",
        workstreamKey: "INTEGRATION",
        tasks: [
          "Build the integration inventory",
          "Decide the middleware approach and its ownership",
          "Plan authentication, certificates and renewal ownership",
          "Agree monitoring and failure alerting standards",
        ],
      },
      {
        name: "Data migration strategy",
        workstreamKey: "DATA_MANAGEMENT",
        tasks: [
          "Inventory source systems and extract owners",
          "Decide data scope, history depth and retention",
          "Choose the migration approach per object",
          "Baseline data quality and agree the cleansing plan",
          "Plan the load cycles and the reconciliation method",
        ],
      },
      {
        name: "Test strategy",
        workstreamKey: "TESTING",
        tasks: [
          "Define test levels with entry and exit criteria",
          "Define the end-to-end scenarios that cross modules",
          "Agree the defect severity model and triage process",
          "Decide test tooling and the test data approach",
        ],
      },
      {
        name: "Change and communications strategy",
        workstreamKey: "SOLUTION_ADOPTION",
        tasks: [
          "Build the stakeholder map and change impact heatmap",
          "Publish the communications plan",
          "Define the training strategy and delivery channels",
          "Recruit and brief the change network",
        ],
      },
      {
        name: "Permission and privacy strategy",
        workstreamKey: "SECURITY_PERMISSIONS",
        tasks: [
          "Draft the role-based permission concept",
          "Set segregation of duties principles",
          "Complete the privacy, residency and retention assessment",
          "Agree who owns permission changes after go-live",
        ],
      },
      {
        name: "Fit-to-standard workshop plan",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Confirm the scope item catalogue to be worked through",
          "Schedule workshops and confirm decision-makers per session",
          "Prepare pre-reads and standard process demonstrations",
          "Publish the decision log format and the decision rules",
        ],
      },
      {
        name: "Reporting and analytics strategy",
        workstreamKey: "ANALYTICS",
        tasks: [
          "Inventory current reports and their real users",
          "Decide what is rebuilt, replaced or retired",
          "Agree the reporting tool approach",
          "Agree data access and privacy rules for reporting",
        ],
      },
      {
        name: "Team onboarding and enablement",
        workstreamKey: "PROJECT_MANAGEMENT",
        tasks: [
          "Onboard the team to roles and ways of working",
          "Induct the team into the method and tooling",
          "Deliver enablement for customer team members",
        ],
      },
    ],
  },
  EXPLORE: {
    gate: {
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
    },
    deliverables: [
      {
        name: "Fit-to-standard workshop execution",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Run the workshop series by scope item",
          "Demonstrate the standard process before discussing change",
          "Record a decision for every scope item",
          "Capture each delta with its business justification",
          "Log open questions with an owner and a due date",
        ],
      },
      {
        name: "Backlog consolidation and sizing",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Convert deltas into backlog items",
          "Classify each item by build type",
          "Prioritise using the agreed model",
          "Size items and sequence them into releases",
          "Review the backlog with the steering committee",
        ],
      },
      {
        name: "Foundation configuration design",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Design the data models and field-level configuration",
          "Design foundation objects and company structure",
          "Design workflows, approvals and notifications",
          "Build the business rule inventory",
        ],
      },
      {
        name: "Module solution design",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Design each in-scope module against the standard process",
          "Document end-to-end process flows",
          "Identify cross-module dependencies and name their owners",
          "Agree module-to-module data handoffs",
        ],
      },
      {
        name: "Integration design",
        workstreamKey: "INTEGRATION",
        tasks: [
          "Design each interface in the inventory",
          "Design downstream data handoffs",
          "Design error handling, monitoring and alerting",
          "Agree interface ownership after go-live",
        ],
      },
      {
        name: "Data migration design",
        workstreamKey: "DATA_MANAGEMENT",
        tasks: [
          "Complete field-level source-to-target mapping",
          "Define transformation and defaulting rules",
          "Decide the treatment of historical data",
          "Execute the first mock load and publish reconciliation results",
        ],
      },
      {
        name: "Permission design",
        workstreamKey: "SECURITY_PERMISSIONS",
        tasks: [
          "Build the role catalogue",
          "Design permission groups and their membership rules",
          "Design target population and data scoping rules",
          "Produce the segregation of duties matrix",
        ],
      },
      {
        name: "Reporting design",
        workstreamKey: "ANALYTICS",
        tasks: [
          "Confirm the report catalogue to be built",
          "Define metric definitions and their owners",
          "Design dashboards by audience",
          "Agree row-level access rules",
        ],
      },
      {
        name: "Change impact assessment",
        workstreamKey: "SOLUTION_ADOPTION",
        tasks: [
          "Assess impact by role and population",
          "Draft the training curriculum by audience",
          "Plan communications against the delivery milestones",
        ],
      },
      {
        name: "Release and change control",
        workstreamKey: "PROJECT_MANAGEMENT",
        tasks: [
          "Baseline the backlog",
          "Produce the sprint or iteration plan",
          "Activate scope change control",
        ],
      },
      {
        name: "Design documentation and sign-off",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Assemble the solution design documentation",
          "Close the decision log",
          "Obtain business sign-off per module",
        ],
      },
    ],
  },
  REALIZE: {
    gate: {
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
    },
    deliverables: [
      {
        name: "Iterative configuration",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Configure in sprints against the backlog",
          "Run a playback at the end of each sprint",
          "Maintain the configuration workbook as you build",
          "Resolve playback feedback back into the backlog",
        ],
      },
      {
        name: "Extension and enhancement build",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Build custom objects and extension fields",
          "Develop approved extensions and custom interfaces",
          "Peer review developments against the design",
          "Record each extension in the upgrade regression pack",
        ],
      },
      {
        name: "Integration build and unit test",
        workstreamKey: "INTEGRATION",
        tasks: [
          "Build and configure each interface",
          "Implement error handling and alerting",
          "Unit test each interface against its design",
          "Test failure and reprocessing paths",
        ],
      },
      {
        name: "Data migration build and load cycles",
        workstreamKey: "DATA_MANAGEMENT",
        tasks: [
          "Build load templates and transformation logic",
          "Execute the second mock load and analyse defects",
          "Execute the final mock load and reconcile",
          "Publish data validation and exception reports",
        ],
      },
      {
        name: "Functional and end-to-end testing",
        workstreamKey: "TESTING",
        tasks: [
          "Run unit and string tests",
          "Run system integration test cycles",
          "Run end-to-end scenarios that cross modules",
          "Run the regression pack",
          "Operate defect triage and burndown",
        ],
      },
      {
        name: "User acceptance testing",
        workstreamKey: "TESTING",
        tasks: [
          "Build the acceptance scenario pack",
          "Execute acceptance testing with business users",
          "Close or accept every business-raised defect",
          "Obtain acceptance sign-off",
        ],
      },
      {
        name: "Permission build and test",
        workstreamKey: "SECURITY_PERMISSIONS",
        tasks: [
          "Build roles and permission groups",
          "Test roles with real business users on real tasks",
          "Validate segregation of duties",
          "Plan production role assignment",
        ],
      },
      {
        name: "Report build and validation",
        workstreamKey: "ANALYTICS",
        tasks: [
          "Build the agreed reports and dashboards",
          "Validate figures against a trusted source",
          "Test report access under each role",
          "Hand reports over to their named owners",
        ],
      },
      {
        name: "Training build and readiness",
        workstreamKey: "SOLUTION_ADOPTION",
        tasks: [
          "Complete training needs analysis by role",
          "Build materials and job aids",
          "Prepare the training environment and data",
          "Enable trainers and super users",
        ],
      },
      {
        name: "Cutover plan build",
        workstreamKey: "CUTOVER_GO_LIVE",
        tasks: [
          "Build the cutover task list with T-minus offsets",
          "Assign owners and durations to every task",
          "Execute the first dry run and record actual timings",
          "Write rollback and contingency plans",
          "Set up the command centre and communications",
        ],
      },
      {
        name: "Support model design",
        workstreamKey: "OPERATIONS_SUPPORT",
        tasks: [
          "Design the hypercare model and staffing",
          "Define support processes and service levels",
          "Plan knowledge transfer",
          "Configure ticket routing and categorisation",
        ],
      },
      {
        name: "Cross-module validation",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Validate data handoffs between modules",
          "Validate end-to-end processes with real role combinations",
          "Resolve ownership of cross-module defects",
        ],
      },
    ],
  },
  DEPLOY: {
    gate: {
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
    },
    deliverables: [
      {
        name: "Production readiness assessment",
        workstreamKey: "PROJECT_MANAGEMENT",
        tasks: [
          "Complete the readiness checklist across workstreams",
          "Confirm go or no-go criteria and thresholds",
          "Hold the go or no-go decision meeting",
        ],
      },
      {
        name: "Production setup and integration activation",
        workstreamKey: "INTEGRATION",
        tasks: [
          "Move configuration to production",
          "Activate production integrations and certificates",
          "Enable production monitoring and alerting",
        ],
      },
      {
        name: "Final cutover rehearsal",
        workstreamKey: "CUTOVER_GO_LIVE",
        tasks: [
          "Execute the final dry run end to end",
          "Validate timings and the critical path",
          "Resolve rehearsal issues and re-baseline the plan",
        ],
      },
      {
        name: "Production data load",
        workstreamKey: "DATA_MANAGEMENT",
        tasks: [
          "Take the final extract and complete cleansing",
          "Execute the production load",
          "Reconcile and obtain data sign-off",
        ],
      },
      {
        name: "Cutover execution",
        workstreamKey: "CUTOVER_GO_LIVE",
        tasks: [
          "Operate the command centre",
          "Track task completion against the T-minus plan",
          "Hold checkpoint decisions at the agreed milestones",
          "Confirm go-live and communicate it",
        ],
      },
      {
        name: "Access provisioning",
        workstreamKey: "SECURITY_PERMISSIONS",
        tasks: [
          "Assign production roles and permission groups",
          "Verify access for a sample of every role",
          "Hand permission administration to its owner",
        ],
      },
      {
        name: "Training delivery and launch",
        workstreamKey: "SOLUTION_ADOPTION",
        tasks: [
          "Deliver training to end users",
          "Issue launch communications",
          "Stand up floorwalking and local support",
        ],
      },
      {
        name: "Hypercare mobilisation",
        workstreamKey: "OPERATIONS_SUPPORT",
        tasks: [
          "Stand up the hypercare team",
          "Open the issue log and triage process",
          "Start the daily stand-up cadence",
        ],
      },
      {
        name: "Post-go-live validation",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Validate the first live transactions in each module",
          "Validate integrations running on schedule",
          "Validate reports against expected values",
        ],
      },
    ],
  },
  RUN: {
    gate: {
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
    },
    deliverables: [
      {
        name: "Hypercare execution",
        workstreamKey: "OPERATIONS_SUPPORT",
        tasks: [
          "Run daily triage and issue burndown",
          "Monitor integrations and scheduled jobs",
          "Report hypercare status to the steering committee",
        ],
      },
      {
        name: "Transition to support",
        workstreamKey: "OPERATIONS_SUPPORT",
        tasks: [
          "Complete knowledge transfer sessions",
          "Hand over to the support organisation",
          "Hand over documentation and administrative access",
        ],
      },
      {
        name: "Benefits review and closure",
        workstreamKey: "PROJECT_MANAGEMENT",
        tasks: [
          "Measure benefits against the baseline",
          "Run the lessons learned review",
          "Close the project formally and release the team",
        ],
      },
      {
        name: "Release management setup",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Subscribe to vendor release information and set an owner",
          "Establish the release assessment and regression routine",
          "Maintain the regression pack against every extension",
          "Plan how optional features are evaluated and adopted",
        ],
      },
      {
        name: "Adoption measurement and optimisation",
        workstreamKey: "SOLUTION_ADOPTION",
        tasks: [
          "Measure adoption by process and role",
          "Collect user feedback",
          "Deliver targeted retraining where adoption is weak",
        ],
      },
      {
        name: "Continuous improvement",
        workstreamKey: "APPLICATION_DESIGN_CONFIGURATION",
        tasks: [
          "Open the improvement backlog",
          "Agree the prioritisation forum and its cadence",
          "Plan the next module wave",
        ],
      },
    ],
  },
};

/** Totals, for the tests and for anything that wants to report the size. */
export function contentTotals(): { deliverables: number; tasks: number; criteria: number } {
  let deliverables = 0;
  let tasks = 0;
  let criteria = 0;
  for (const phase of Object.values(ACTIVATE_PHASE_CONTENT)) {
    deliverables += phase.deliverables.length;
    criteria += phase.gate.criteria.length;
    for (const d of phase.deliverables) tasks += d.tasks.length;
  }
  return { deliverables, tasks, criteria };
}
