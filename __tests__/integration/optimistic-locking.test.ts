/**
 * B1 — concurrent edits must not silently overwrite each other.
 *
 * WHAT WAS WRONG
 *
 * `Issue` had `updatedAt` and nothing else, and the update path compared
 * nothing. Two people editing the same issue — the ordinary case on a busy
 * team — and the second write won. No error, no warning, no record: the first
 * person's change was simply gone, and neither of them could tell. Users do
 * not report this, because from inside it looks like they never typed it.
 *
 * WHAT IS BEING ASSERTED
 *
 * That the loser loses LOUDLY. A 409, carrying the server's current state so
 * the client can show what it would have overwritten, and with the losing
 * edit not applied — including its activity-log rows, which must roll back
 * with it or the history will claim a change that did not happen.
 *
 * The version is OPTIONAL on the wire. A client that sends none is choosing
 * last-write-wins, which is what every existing client and script does today;
 * requiring it would have broken them all on the day this shipped. So there is
 * a test for that path too — it must still work, and must still move the
 * counter, or a client that DOES send versions would be fooled into thinking
 * nothing had changed.
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

const readIssue = () =>
  prisma.issue.findUniqueOrThrow({ where: { id: fx.orgA.issueId } });

beforeEach(async () => {
  await prisma.issue.update({
    where: { id: fx.orgA.issueId },
    data: { title: "Secret of tenant A", description: null, version: 0 },
  });
});

describe("optimistic locking on issue updates", () => {
  it("exposes the version on the issue", async () => {
    // The client cannot participate in a scheme whose token it never sees.
    const res = await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}`);
    expect(res.status).toBe(200);
    expect(typeof res.body?.issue?.version).toBe("number");
  });

  it("accepts an update carrying the CURRENT version, and moves it on", async () => {
    const before = await readIssue();

    const res = await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}`, {
      method: "PATCH",
      body: { title: "Edited by the first writer", version: before.version },
    });

    expect(res.status).toBe(200);
    const after = await readIssue();
    expect(after.title).toBe("Edited by the first writer");
    expect(after.version).toBe(before.version + 1);
  });

  it("REFUSES an update carrying a stale version", async () => {
    // Both clients read version 0.
    const read = await readIssue();
    const staleVersion = read.version;

    // The first writer commits.
    const first = await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}`, {
      method: "PATCH",
      body: { title: "First writer wins", version: staleVersion },
    });
    expect(first.status).toBe(200);

    // The second writer submits the edit they started before that landed.
    const second = await api(fx.orgA.users.MANAGER, `/api/issues/${fx.orgA.issueId}`, {
      method: "PATCH",
      body: { title: "Second writer should NOT win", version: staleVersion },
    });

    expect(second.status).toBe(409);

    const after = await readIssue();
    expect(after.title).toBe("First writer wins");
    expect(after.version).toBe(staleVersion + 1);
  });

  it("the 409 carries the current server state so a diff can be shown", async () => {
    const read = await readIssue();
    await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}`, {
      method: "PATCH",
      body: { title: "The value they would have overwritten", version: read.version },
    });

    const conflict = await api(fx.orgA.users.MANAGER, `/api/issues/${fx.orgA.issueId}`, {
      method: "PATCH",
      body: { title: "stale", version: read.version },
    });

    expect(conflict.status).toBe(409);
    expect(conflict.body?.code).toBe("VERSION_CONFLICT");
    // Without these the user sees "someone else changed this" and has no way
    // to find out what, which is barely better than losing the edit.
    expect(conflict.body?.issue?.title).toBe("The value they would have overwritten");
    expect(conflict.body?.currentVersion).toBe(read.version + 1);
  });

  it("a refused update writes NO activity log", async () => {
    // The update and its activity rows share a transaction. If the rollback
    // were incomplete the history would record a change that never happened —
    // worse than the silent overwrite, because it is evidence of a lie.
    const read = await readIssue();
    await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}`, {
      method: "PATCH",
      body: { title: "committed", version: read.version },
    });

    const logsBefore = await prisma.activityLog.count({ where: { issueId: fx.orgA.issueId } });

    const conflict = await api(fx.orgA.users.MANAGER, `/api/issues/${fx.orgA.issueId}`, {
      method: "PATCH",
      body: { title: "rejected", description: "also rejected", version: read.version },
    });
    expect(conflict.status).toBe(409);

    const logsAfter = await prisma.activityLog.count({ where: { issueId: fx.orgA.issueId } });
    expect(logsAfter).toBe(logsBefore);
  });

  it("two genuinely concurrent writes: exactly one succeeds", async () => {
    // The race the version column exists for. A read-then-compare in
    // application code would let both of these through, because both would
    // read the same value before either wrote.
    const read = await readIssue();

    const [a, b] = await Promise.all([
      api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}`, {
        method: "PATCH",
        body: { title: "racer A", version: read.version },
      }),
      api(fx.orgA.users.MANAGER, `/api/issues/${fx.orgA.issueId}`, {
        method: "PATCH",
        body: { title: "racer B", version: read.version },
      }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const after = await readIssue();
    expect(["racer A", "racer B"]).toContain(after.title);
    expect(after.version).toBe(read.version + 1);
  });

  it("an update with NO version still works — and still moves the counter", async () => {
    // Backwards compatibility. Every existing client sends no version, and a
    // 400 for a missing field would be a worse regression than the bug being
    // fixed. But the counter must still advance, or a version-aware client
    // would never notice this write.
    const before = await readIssue();

    const res = await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}`, {
      method: "PATCH",
      body: { title: "legacy client, no version" },
    });

    expect(res.status).toBe(200);
    const after = await readIssue();
    expect(after.title).toBe("legacy client, no version");
    expect(after.version).toBe(before.version + 1);
  });

  it("a version-aware client detects an edit made by a legacy client", async () => {
    // The combination that would be easy to get wrong: if the no-version path
    // did not increment, this conflict would go undetected.
    const read = await readIssue();

    await api(fx.orgA.users.ADMIN, `/api/issues/${fx.orgA.issueId}`, {
      method: "PATCH",
      body: { title: "written by a legacy client" },
    });

    const conflict = await api(fx.orgA.users.MANAGER, `/api/issues/${fx.orgA.issueId}`, {
      method: "PATCH",
      body: { title: "stale edit", version: read.version },
    });

    expect(conflict.status).toBe(409);
    expect((await readIssue()).title).toBe("written by a legacy client");
  });
});
