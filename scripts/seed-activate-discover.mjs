/**
 * The Discover worksheet, seeded: seven deliverables, twenty-five tasks and
 * the G0 quality gate.
 *
 * WHY A SEEDER AND NOT THE METHODOLOGY TEMPLATE
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
 *   node scripts/seed-activate-discover.mjs [--project HELIOS]
 *                                           [--base http://127.0.0.1:3100]
 *                                           [--email alex@acme.com]
 *                                           [--password 'Password123!']
 */

import { PrismaClient } from "@prisma/client";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE = argOf("--base", "http://127.0.0.1:3100");
const PROJECT_KEY = argOf("--project", "HELIOS");
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

const DELIVERABLES = [
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

const GATE_NAME = "Discovery complete";
const GATE_CRITERIA = [
  "Modules in scope for this release confirmed and signed by the sponsor",
  "Populations, countries and legal entities fixed",
  "Target outcomes baselined with measurable before-state figures",
  "Indicative effort and budget envelope accepted",
  "Appetite for adopting standard process tested and recorded per module",
  "Executive sponsor named and actively engaged",
  "Top ten risks logged with named owners",
];

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
  console.log(`\nSeeding the Discover worksheet of ${PROJECT_KEY} against ${BASE}\n`);

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
    where: { projectId_key: { projectId: project.id, key: "DISCOVER" } },
    select: { id: true },
  });
  if (!phase) throw new Error(`${PROJECT_KEY} has no Discover phase — is Activate enabled?`);

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

  const sheetPath = `/api/projects/${project.id}/activate/phases/DISCOVER/worksheet`;
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
