/**
 * Demonstration data for SAP Activate: several projects at different stages.
 *
 * WHY THIS IS A REPOSITORY SCRIPT AND NOT A THROWAWAY
 *
 * The first version of this lived in a temporary directory, and when Windows
 * cleaned that directory the data and the means of recreating it went
 * together. Anything worth loading twice belongs in the repository.
 *
 * WHY IT DRIVES THE HTTP API RATHER THAN WRITING ROWS
 *
 * Writing straight to the database would let it produce states the
 * application cannot: a decision with no permission behind it, a backlog item
 * with no origin key, a phase whose gate was never raised. Going through the
 * API means the demo data is, by construction, data the product can actually
 * produce — and a failure here is a real failure, not a fixture quirk.
 *
 * SAFE TO RE-RUN. Every project is keyed, and a project whose key already
 * exists is skipped rather than duplicated. It never deletes anything.
 *
 *   node scripts/seed-activate-demo.mjs [--base http://127.0.0.1:3100]
 *                                       [--email alex@acme.com]
 *                                       [--password 'Password123!']
 */

import { PrismaClient } from "@prisma/client";

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE = argOf("--base", "http://127.0.0.1:3100");
const EMAIL = argOf("--email", "alex@acme.com");
const PASSWORD = argOf("--password", "Password123!");

const prisma = new PrismaClient();
let cookie = "";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * THE RATE LIMIT IS NOT IN THE WAY — IT IS THE PRODUCT WORKING.
 *
 * A signed-in subject gets 30 mutations a minute, and a seeder that records
 * sixty decisions is well past that. The first run died on a 429 halfway
 * through Nova. Raising the ceiling, or exempting this caller, would mean the
 * demo data was produced by a system that behaves differently from the one
 * anybody else uses — and the next person to hit the limit legitimately would
 * find it had been quietly widened for convenience.
 *
 * So this waits. It honours the seconds the server names, and it paces itself
 * below the ceiling so that it usually does not have to.
 */
const MUTATION_BUDGET = 25; // under the server's 30, leaving room for retries
const WINDOW_MS = 60_000;
let windowStart = Date.now();
let mutationsThisWindow = 0;

async function throttleMutation() {
  const elapsed = Date.now() - windowStart;
  if (elapsed >= WINDOW_MS) {
    windowStart = Date.now();
    mutationsThisWindow = 0;
    return;
  }
  if (mutationsThisWindow >= MUTATION_BUDGET) {
    const wait = WINDOW_MS - elapsed + 500;
    process.stdout.write(`    (pausing ${Math.ceil(wait / 1000)}s for the rate limit)\n`);
    await sleep(wait);
    windowStart = Date.now();
    mutationsThisWindow = 0;
  }
}

async function api(path, init = {}, attempt = 0) {
  const method = init.method || "GET";
  const mutating = method !== "GET";
  if (mutating) {
    await throttleMutation();
    mutationsThisWindow += 1;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      // Mutations are refused without it: the CSRF guard treats a request with
      // no Origin as one it cannot vouch for.
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
    mutationsThisWindow = 0;
    return api(path, init, attempt + 1);
  }

  if (res.status >= 400) {
    throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return body;
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.getSetCookie?.() || [];
  cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("login returned no session cookie");
}

/**
 * The four projects, chosen to show the methodology at four different points
 * rather than four copies of the same screen: one still deciding, one with a
 * backlog generated, one approaching a go-live gate, and one barely started.
 */
const PROJECTS = [
  {
    key: "NOVA",
    name: "Nova HR Rollout",
    description: "Core HR and employee central for 4,200 employees across three countries.",
    pack: "SuccessFactors",
    currentPhase: "EXPLORE",
    decideRatio: 0.7,
    generate: true,
  },
  {
    key: "ORION",
    name: "Orion Payroll",
    description: "Payroll and time, replacing two legacy systems.",
    pack: "SuccessFactors",
    currentPhase: "REALIZE",
    decideRatio: 1,
    generate: true,
  },
  {
    key: "ATLAS",
    name: "Atlas Benefits and Compensation",
    description: "Compensation, benefits and variable pay, wave two.",
    pack: "SuccessFactors",
    currentPhase: "DEPLOY",
    decideRatio: 1,
    generate: true,
  },
  {
    /**
     * Still in Prepare with nothing decided — the state a real programme
     * spends its first weeks in, and the one an empty screen has to look
     * deliberate in. It carries a catalogue like the others: only one content
     * pack ships today, and a project stamped with the plain methodology has
     * no scope items at all, which is a different and less useful emptiness.
     */
    key: "HELIOS",
    name: "Helios Discovery",
    description: "Discovery and value assessment. Nothing decided yet.",
    pack: "SuccessFactors",
    currentPhase: "PREPARE",
    decideRatio: 0,
    generate: false,
  },
];

/** A decision that is plausible for the item, not a random one. */
function decisionFor(item, index) {
  const tags = item.tags || [];
  if (index % 7 === 0) return "ADOPT";
  if (index % 7 === 1) return "CONFIGURE";
  if (index % 7 === 2) return tags.includes("ux") ? "EXTEND" : "CONFIGURE";
  if (index % 7 === 3) return "INTEGRATE";
  if (index % 7 === 4) return "ADOPT";
  if (index % 7 === 5) return "DEFER";
  return "OUT_OF_SCOPE";
}

const GENERATES = new Set(["CONFIGURE", "EXTEND", "INTEGRATE", "DEFER"]);

async function seedProject(workspaceId, spec) {
  /**
   * RESUMES RATHER THAN SKIPS.
   *
   * The first version skipped a project whose key already existed, which was
   * wrong in the one case that matters: a run interrupted partway through —
   * by a rate limit, as it happens — leaves a project that exists and is half
   * seeded, and skipping it means the only way to finish the job is to delete
   * it by hand. Everything below is written to be safe on an item that is
   * already done.
   */
  const existing = await prisma.project.findFirst({
    where: { key: spec.key, workspaceId },
    select: { id: true },
  });

  let projectId = existing?.id;
  if (!projectId) {
    const created = await api("/api/projects", {
      method: "POST",
      body: {
        workspaceId,
        name: spec.name,
        key: spec.key,
        description: spec.description,
        template: "SCRUM",
      },
    });
    projectId = created.project?.id || created.id;
    if (!projectId) throw new Error(`no project id returned for ${spec.key}`);
  }

  // The template list is also what creates the built-in methodology and the
  // shipped content packs on a fresh database, so it has to come first.
  /**
   * A pack is matched loosely on purpose: it ships as key `SAP_ACTIVATE_SF`
   * with variant `SuccessFactors`, and an exact-match on either spelling
   * quietly found nothing and fell through to the plain methodology — which
   * has phases and gates but no scope catalogue, so every project came out
   * with an empty workshop and no error anywhere.
   */
  const { templates } = await api(`/api/projects/${projectId}/activate/templates`);
  const wanted = (spec.pack || "").toLowerCase();
  const template = spec.pack
    ? templates.find(
        (t) =>
          (t.variant || "").toLowerCase() === wanted ||
          t.key.toLowerCase().replace(/[^a-z]/g, "").includes(wanted.replace(/[^a-z]/g, ""))
      )
    : templates.find((t) => t.builtIn && !t.variant);
  if (spec.pack && !template) {
    throw new Error(
      `no template matches pack "${spec.pack}" — available: ` +
        templates.map((t) => `${t.key}/${t.variant ?? "-"}`).join(", ")
    );
  }
  await api(`/api/projects/${projectId}/activate`, {
    method: "POST",
    body: { enabled: true, templateId: template?.id },
  });

  if (spec.currentPhase) {
    const { phases } = await api(`/api/projects/${projectId}/activate`);
    const position = phases.findIndex((p) => p.key === spec.currentPhase);
    for (const phase of phases) {
      const wantStatus =
        phase.position < position
          ? "COMPLETED"
          : phase.key === spec.currentPhase
            ? "IN_PROGRESS"
            : null;
      // Already in the state we want: a PATCH would burn a mutation from the
      // rate-limit budget to change nothing.
      if (!wantStatus || phase.status === wantStatus) continue;
      await api(`/api/projects/${projectId}/activate/phases/${phase.id}`, {
        method: "PATCH",
        body: { status: wantStatus },
      });
    }
  }

  const catalogue = await api(`/api/projects/${projectId}/activate/scope-items`);
  const inScope = (catalogue.scopeItems || []).filter((i) => i.inScope);
  /**
   * Capped as well as proportioned. Sixty decisions is a slower demo, not a
   * richer one, and every one of them spends a mutation from a budget the
   * server is right to enforce.
   */
  const target = Math.min(Math.floor(inScope.length * spec.decideRatio), 18);

  let decided = 0;
  for (let i = 0; i < target; i += 1) {
    const item = inScope[i];
    if (item.decision) {
      decided += 1;
      continue; // already recorded by an earlier run
    }
    const decision = decisionFor(item, i);
    await api(`/api/projects/${projectId}/activate/decisions/${item.id}`, {
      method: "PUT",
      body: {
        decision,
        status: i % 4 === 3 ? "DRAFT" : "AGREED",
        rationale:
          decision === "ADOPT"
            ? "Standard process reviewed in the workshop and accepted as it stands."
            : `Agreed in the fit-to-standard workshop: ${item.name.toLowerCase()} needs tailoring.`,
        deltas: GENERATES.has(decision)
          ? [
              {
                title: `${item.name}: configure to agreed design`,
                buildType: decision === "INTEGRATE" ? "INTERFACE" : "CONFIGURATION",
                priority: i % 3 === 0 ? "MUST" : "SHOULD",
                size: i % 5 === 0 ? "L" : "M",
              },
            ]
          : [],
      },
    });
    decided += 1;
  }

  let generated = 0;
  if (spec.generate && decided > 0) {
    const res = await api(`/api/projects/${projectId}/activate/backlog`, {
      method: "POST",
      body: {},
    });
    generated = res.created || 0;
  }

  console.log(
    `  ${spec.key}: ${spec.name} — ${inScope.length} scope items, ${decided} decided, ` +
      `${generated} backlog items generated`
  );
}

async function main() {
  console.log(`\nSeeding SAP Activate demo data against ${BASE} as ${EMAIL}\n`);
  await login();

  const workspace = await prisma.workspace.findFirst({ select: { id: true, name: true } });
  if (!workspace) throw new Error("No workspace exists. Run `npm run prisma:seed` first.");
  console.log(`Workspace: ${workspace.name}\n`);

  for (const spec of PROJECTS) {
    try {
      await seedProject(workspace.id, spec);
    } catch (e) {
      console.error(`  ${spec.key}: FAILED — ${e.message}`);
      throw e;
    }
  }

  console.log("\nDone.\n");
}

main()
  .catch((e) => {
    console.error("\n" + e.message + "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
