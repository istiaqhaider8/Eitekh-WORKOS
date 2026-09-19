/**
 * M4 — optimistic locking on the other six things people edit.
 *
 * B1 put a version column on `Issue` and stopped there. The reasoning it gave
 * applies unchanged to every record below: two people editing at once is the
 * normal case, and without a guard the second write silently wins. Nobody
 * reports it, because there is nothing to see.
 *
 * WHAT THESE TESTS ARE FOR
 *
 * Not to re-prove the mechanism. All seven routes share one implementation in
 * `optimistic-lock.ts`, and `optimistic-locking.test.ts` already establishes
 * its full contract against issues. Re-running that contract six more times
 * would be six copies of the same assertion.
 *
 * What sharing an implementation does NOT prove is that each route wired it
 * up. The helper can be perfect while a route forgets to pass `version`
 * through from its schema, and every test of the helper still passes. So each
 * entity gets the two tests that catch exactly that — the current version is
 * honoured, and a stale one is refused — and the deeper contract is checked
 * once, on a representative route.
 *
 * WHY THE ACTING USER IS SPREAD ACROSS ENTITIES
 *
 * The middleware allows 30 mutations per minute PER USER, and that limit is
 * real in this suite. A first draft ran 36 tests as a single ADMIN, exhausted
 * the budget partway through, and the remaining routes answered 429 — which
 * looked exactly like a locking failure and was nothing of the kind.
 *
 * That is worth stating plainly because it is the same trap the load harness
 * documents: once you are rate limited, you are measuring the rate limiter.
 * The fix is not to raise the limit for tests — that would stop the suite
 * exercising what production does — but to stay inside it, as a real user
 * would.
 */

import { PrismaClient } from "@prisma/client";
import { api, assertSafeTestDatabase, type Fixture } from "./harness";
import { createFixture, destroyFixture } from "./fixture";

const dbUrl = assertSafeTestDatabase(process.env.DATABASE_URL);
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

let fx: Fixture;

beforeAll(async () => {
  fx = await createFixture(prisma);
}, 60_000);

afterAll(async () => {
  await destroyFixture(prisma);
  await prisma.$disconnect();
});

interface Subject {
  name: string;
  /** The field these tests edit, and two distinct values for it. */
  field: string;
  first: string;
  second: string;
  /** The key the 409 body returns the record under. */
  conflictKey: string;
  /** Read from the DATABASE, so a route that fails to serialise `version` cannot hide one that fails to check it. */
  read: () => Promise<{ version: number; [k: string]: any }>;
  patch: (body: Record<string, unknown>) => Promise<{ status: number; body: any; text: string }>;
}

/**
 * Both OWNER and ADMIN hold PROJECT_ADMIN, so either can edit any of these.
 * They are alternated only to halve each one's share of the mutation budget.
 * `comment` is the exception that is not a choice: only its author may edit
 * it, and the fixture's comment belongs to OWNER.
 */
const subjects = (): Subject[] => [
  {
    name: "project",
    field: "description",
    first: "First writer's project description",
    second: "Second writer's project description",
    conflictKey: "project",
    read: () => prisma.project.findUniqueOrThrow({ where: { id: fx.orgA.projectId } }),
    patch: (body) =>
      api(fx.orgA.users.ADMIN, `/api/projects/${fx.orgA.projectId}`, { method: "PATCH", body }),
  },
  {
    name: "epic",
    field: "summary",
    first: "First writer's epic summary",
    second: "Second writer's epic summary",
    conflictKey: "epic",
    read: () => prisma.epic.findUniqueOrThrow({ where: { id: fx.orgA.epicId } }),
    patch: (body) =>
      api(fx.orgA.users.ADMIN, `/api/epics/${fx.orgA.epicId}`, { method: "PATCH", body }),
  },
  {
    name: "comment",
    field: "content",
    first: "First writer's comment text",
    second: "Second writer's comment text",
    conflictKey: "comment",
    read: () => prisma.comment.findUniqueOrThrow({ where: { id: fx.orgA.commentId } }),
    patch: (body) =>
      api(fx.orgA.users.OWNER, `/api/comments/${fx.orgA.commentId}`, { method: "PATCH", body }),
  },
  {
    name: "subtask",
    field: "title",
    first: "First writer's subtask title",
    second: "Second writer's subtask title",
    conflictKey: "subtask",
    read: () => prisma.subtask.findUniqueOrThrow({ where: { id: fx.orgA.subtaskId } }),
    patch: (body) =>
      api(fx.orgA.users.OWNER, `/api/subtasks/${fx.orgA.subtaskId}`, { method: "PATCH", body }),
  },
  {
    name: "sprint",
    field: "goal",
    first: "First writer's sprint goal",
    second: "Second writer's sprint goal",
    conflictKey: "sprint",
    read: () => prisma.sprint.findUniqueOrThrow({ where: { id: fx.orgA.sprintId } }),
    // This route takes its id in the body, not the path.
    patch: (body) =>
      api(fx.orgA.users.ADMIN, "/api/sprints", {
        method: "PATCH",
        body: { sprintId: fx.orgA.sprintId, ...body },
      }),
  },
  {
    name: "automation rule",
    field: "name",
    first: "First writer's rule name",
    second: "Second writer's rule name",
    conflictKey: "rule",
    read: () => prisma.automationRule.findUniqueOrThrow({ where: { id: fx.orgA.automationId } }),
    patch: (body) =>
      api(fx.orgA.users.OWNER, `/api/automations/${fx.orgA.automationId}`, { method: "PATCH", body }),
  },
];

// ---------------------------------------------------------------------------
// Per entity: is the route WIRED to the shared guard? Three mutations each.
describe.each(subjects().map((s) => [s.name, s] as const))("%s", (_name, s) => {
  it("honours the CURRENT version and moves the counter on", async () => {
    const before = await s.read();

    const res = await s.patch({ [s.field]: s.first, version: before.version });

    expect(res.status).toBe(200);
    const after = await s.read();
    expect(after[s.field]).toBe(s.first);
    // The counter moving is what proves the route reached the shared helper
    // rather than its own untouched `update`.
    expect(after.version).toBe(before.version + 1);
  });

  it("REFUSES a stale version, and the row is untouched", async () => {
    // Both writers read the same version.
    const read = await s.read();
    const stale = read.version;

    const first = await s.patch({ [s.field]: s.first, version: stale });
    expect(first.status).toBe(200);

    // The second submits the edit they began before that landed.
    const second = await s.patch({ [s.field]: s.second, version: stale });
    expect(second.status).toBe(409);

    // The row, not the status code, is the assertion that matters.
    const after = await s.read();
    expect(after[s.field]).toBe(s.first);
    expect(after.version).toBe(stale + 1);
  });
});

// ---------------------------------------------------------------------------
/**
 * The full contract, once.
 *
 * `project` stands in for all of them because they run the same code path.
 * What is specific to a route is whether it passes `version` through, and the
 * per-entity block above is what establishes that.
 */
describe("the shared guard's contract (via project)", () => {
  const s = () => subjects()[0];

  it("the 409 carries the current server state so a diff can be shown", async () => {
    const before = await s().read();
    const committed = await s().patch({ description: "The value they would have overwritten", version: before.version });
    expect(committed.status).toBe(200);

    const conflict = await s().patch({ description: "stale", version: before.version });

    expect(conflict.status).toBe(409);
    expect(conflict.body?.code).toBe("VERSION_CONFLICT");
    expect(conflict.body?.currentVersion).toBe(before.version + 1);
    // Without the record itself the user is told "someone changed this" and
    // has no way to find out what — barely better than losing the edit.
    expect(conflict.body?.project?.description).toBe("The value they would have overwritten");
  });

  it("an update with NO version still works, and still moves the counter", async () => {
    // The opt-in promise. A client that has never heard of `version` keeps
    // working; a client that HAS must not be fooled into thinking nothing
    // happened, so the counter moves either way.
    const before = await s().read();

    const res = await s().patch({ description: "Written by a version-unaware client" });

    expect(res.status).toBe(200);
    const after = await s().read();
    expect(after.description).toBe("Written by a version-unaware client");
    expect(after.version).toBe(before.version + 1);
  });

  it("two genuinely concurrent writes: exactly one succeeds", async () => {
    // The race the column exists for. A read-then-compare in application code
    // would let both through; `where: { id, version }` is evaluated by the
    // database inside the write itself.
    const read = await s().read();

    const [a, b] = await Promise.all([
      s().patch({ description: "racer A", version: read.version }),
      s().patch({ description: "racer B", version: read.version }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const after = await s().read();
    expect(after.version).toBe(read.version + 1);
  });

  it("a malformed version is a 400, not a silently unguarded write", async () => {
    // Absent means "do not check", so anything present but unusable has to
    // fail loudly. Letting it become undefined would switch conflict
    // detection off for the client trying hardest to use it.
    const before = await s().read();

    const res = await s().patch({ description: "should not land", version: "not-a-number" });

    expect(res.status).toBe(400);
    const after = await s().read();
    expect(after.version).toBe(before.version);
    expect(after.description).toBe(before.description);
  });

  it("version: null means 'I have none', not 'I expect version 0'", async () => {
    // z.coerce.number() sends null through Number() and gets 0, which would
    // make a client that serialises a missing version as null claim to expect
    // version 0 — a spurious 409 on any row past 0, and an unguarded write
    // that looks guarded on a fresh one.
    const before = await s().read();
    expect(before.version).toBeGreaterThan(0);

    const res = await s().patch({ description: "null means absent", version: null });

    expect(res.status).toBe(200);
    const after = await s().read();
    expect(after.version).toBe(before.version + 1);
  });
});
