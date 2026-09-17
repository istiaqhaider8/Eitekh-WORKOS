# Eitekh WorkOS — Production Readiness Plan

> **Purpose**: This is the implementation plan for making Eitekh WorkOS safe to run as a
> real multi-tenant SaaS. It is written for AI sessions to execute task-by-task.
>
> **Created**: 2026-09-17 by Claude Opus 5 (1M context)
> **Branch**: `security/phase-1-critical-fixes`
> **Companion docs**: [`AI-STATUS.md`](AI-STATUS.md) (live tracker) · [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md) (73 findings) · [`DEPLOYMENT.md`](DEPLOYMENT.md) (deploy steps)

---

## Table of Contents

1. [Read This First](#1-read-this-first)
2. [Verified Baseline](#2-verified-baseline)
3. [Definition of Production Ready](#3-definition-of-production-ready)
4. [Gate 0 — Blockers](#gate-0--blockers)
5. [Gate 1 — Pre-Launch Hardening](#gate-1--pre-launch-hardening)
6. [Gate 2 — Post-Launch / Maintainability](#gate-2--post-launch--maintainability)
7. [Task Dependency Order](#7-task-dependency-order)
8. [Verification Protocol](#8-verification-protocol)
9. [Rules for AI Sessions](#9-rules-for-ai-sessions)

---

## 1. Read This First

### The trust problem

`AI-STATUS.md` previously claimed **74/74 findings resolved (100%)** while `SECURITY-AUDIT.md`
claimed **17/73 resolved (23%)**. Both cannot be true. A spot-check found at least one finding
marked COMPLETED that was **not actually resolved**:

> **ARCH-2** — "In-memory singletons as infrastructure (won't scale)" was marked COMPLETED.
> What was actually delivered is [`src/lib/container.ts`](src/lib/container.ts), a dependency-injection
> helper for **testability**. Its own docstring says *"Production code uses the real singletons by default."*
> The in-process state it was supposed to fix is still in-process. See PROD-2/3/4 below.

**Consequence for you**: do not trust a COMPLETED status in any tracker. Verify against the code
before deciding a task is done. Section 8 tells you how. If you find another over-claim, correct
the tracker and say so in the session log — that is real work, not a detour.

### Why this doc exists separately

`SECURITY-AUDIT.md` is a point-in-time audit (what is wrong). `AI-STATUS.md` is a task queue
(what to do next). Neither answers *"can we launch this to paying tenants?"* — that is this doc.
The findings here are about **infrastructure and verification**, not features. The product is
feature-rich and the security work already done is genuinely good; what blocks launch is the
foundation underneath it.

---

## 2. Verified Baseline

Everything in this section was verified by running commands against the repo on **2026-09-17**.
Each row lists how to re-verify it.

### What is genuinely working

| Fact | Evidence | Re-verify with |
|---|---|---|
| Production build passes | exit 0, clean isolated worktree | `npm run build` (see note below) |
| TypeScript compiles clean | exit 0, ~70k lines | `npx tsc --noEmit` |
| Unit tests pass | 6 suites, 74 tests, 0 failures | `npm test` |
| CI runs typecheck + test + lint + build | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | read the file |
| Secrets not committed | `.env` gitignored, 0 tracked | `git check-ignore -v .env` |
| Migrations exist | `0001_init`, `0002_…`, `0003_…` | `ls prisma/migrations` |
| Health endpoints exist | `/api/health`, `/api/super-admin/health` | `ls src/app/api/health` |
| All 10 Critical security findings fixed | Phase 1, audit §5 | see `SECURITY-AUDIT.md` |

> **Build note**: `next build` **fails** if `next dev` is running — both write to `.next`, producing a
> misleading `PageNotFoundError: Cannot find module for page: /api/auth/login`. Stop the dev server
> first, or build in a separate worktree. This is an environment artifact, **not** a code defect.

### Current stack

| Component | Version / Value |
|---|---|
| Next.js | `^15.1.0` (15.5.25 installed) |
| React | `^19.0.0` |
| Prisma | `^5.22.0` |
| Database | **SQLite** (`provider = "sqlite"`) |
| API routes | 118 `route.ts` files |
| Test files | 6 (all library-level) |
| External state store | **none** (no Redis / Memcached / Upstash) |

### Measured problems

| ID | Problem | Evidence |
|---|---|---|
| B1 | SQLite in a multi-tenant SaaS | `prisma/schema.prisma` → `provider = "sqlite"` |
| B2 | Rate limiting is in-process | `new Map()` at [`src/lib/rate-limit.ts:11`](src/lib/rate-limit.ts) |
| B3 | Cache is in-process | `private store: Map` at [`src/lib/cache-manager.ts:66`](src/lib/cache-manager.ts) |
| B4 | SSE client registry is in-process | `private clients: Map` at [`src/lib/sync-engine.ts:79`](src/lib/sync-engine.ts) |
| B5 | Zero authorization / tenant-isolation tests | grep for `assertProjectAccess`/`tenant` in tests → no matches |
| B6 | Logs go to `console.*` only | [`src/lib/logger.ts`](src/lib/logger.ts) — no sink, no alerting |
| B7 | `/projects/[id]` ships 310 kB First Load JS | `npm run build` output |
| B8 | `IssueDetailModal.tsx` is 4,466 lines | `wc -l src/components/issues/IssueDetailModal.tsx` |

---

## 3. Definition of Production Ready

"Production ready" here means: **safe to sell to multiple paying tenants on more than one instance.**

A gate is passed only when **every** task in it meets its acceptance criteria *and* the
verification command in that task passes.

| Gate | Meaning | Blocks what |
|---|---|---|
| **Gate 0** | Blockers | Any multi-tenant production launch |
| **Gate 1** | Pre-launch hardening | Public / paid launch |
| **Gate 2** | Maintainability | Nothing — do after launch |

### What is safe today

A **single-instance pilot with a handful of trusted tenants** is reasonable right now. The
product works, the critical vulnerabilities are fixed, and real usage would teach you more than
more auditing would. Gate 0 is what separates that pilot from genuine multi-tenant production.

---

## Gate 0 — Blockers

> Nothing in this gate is optional. Each item is a correctness or security problem under
> real multi-tenant load, not a nice-to-have.

### PROD-1 — Migrate SQLite → PostgreSQL

| | |
|---|---|
| **Severity** | Blocker |
| **Status** | PENDING |
| **Depends on** | nothing (do this first) |
| **Files** | `prisma/schema.prisma`, `prisma/migrations/`, `.env.example`, `DEPLOYMENT.md`, `.github/workflows/ci.yml` |

**Why**: SQLite has a single writer lock and is file-local. In a multi-tenant SaaS this means
concurrent writes from different tenants serialize and then fail under load, and you cannot run
more than one app instance against the same database. `DEPLOYMENT.md` already flags SQLite as
unsuitable beyond ~10 concurrent writers — that ceiling is below a real customer base.

**Do this**:
1. Change `datasource db { provider = "postgresql" }`.
2. Regenerate migrations for Postgres. SQLite migrations are **not** portable — do not hand-edit
   them. Create a fresh initial migration against a Postgres shadow DB.
3. Audit the schema for SQLite-isms: `String` columns used as enums, missing `@db.Text` on long
   fields, `DateTime` precision, any raw SQL (`$queryRaw`/`$executeRaw`) with SQLite syntax.
4. Update `.env.example` and `DEPLOYMENT.md` with a Postgres `DATABASE_URL`.
5. Add a Postgres service to the CI workflow so tests run against the real engine.
6. Write a data migration path for existing SQLite data (export → import), or document that
   pilot data is discarded. **Decide explicitly and write it down.**

**Acceptance criteria**:
- [ ] `provider = "postgresql"` in `schema.prisma`
- [ ] `npx prisma migrate deploy` succeeds against a clean Postgres
- [ ] `npm test` passes against Postgres in CI
- [ ] `npx tsc --noEmit` clean
- [ ] No `$queryRaw`/`$executeRaw` containing SQLite-only syntax
- [ ] `DEPLOYMENT.md` documents Postgres setup and the SQLite migration decision

**Verify**: `npx prisma migrate deploy && npm test && npx tsc --noEmit`

---

### PROD-2 — Move rate limiting to a shared store

| | |
|---|---|
| **Severity** | Blocker (security control) |
| **Status** | PENDING |
| **Depends on** | PROD-1 (pick the infra first) |
| **Files** | `src/lib/rate-limit.ts`, `src/middleware.ts`, `.env.example` |

**Why**: `rateLimitStore` is a process-local `Map`. With N instances behind a load balancer an
attacker gets **N× the configured limit**, and every deploy resets all counters. This is a
security control that silently degrades the moment you scale — the most dangerous kind of bug,
because the code looks correct and the tests pass.

**Do this**:
1. Add Redis (managed: Upstash / ElastiCache / Redis Cloud).
2. Reimplement the limiter on Redis using an atomic primitive — `INCR` + `EXPIRE` in a
   `MULTI`, or a sliding window via sorted sets. **Do not** read-then-write; that races.
3. Keep the existing exported function signatures so the 118 routes need no changes.
4. Fail **closed** on a Redis outage for auth-sensitive routes (login, register, password reset);
   failing open re-opens the brute-force window the Phase 1 audit closed.

**Acceptance criteria**:
- [ ] No process-local `Map` backing the limiter
- [ ] Limit is enforced *in aggregate* across ≥2 concurrently running instances
- [ ] Counter increments are atomic (no read-then-write)
- [ ] Redis unavailable → auth routes deny, documented behaviour
- [ ] Public call signatures unchanged; no route edits required

**Verify**: start two instances against one Redis, script `limit + 1` requests across both,
confirm the last one is rejected.

---

### PROD-3 — Move the cache to a shared store

| | |
|---|---|
| **Severity** | Blocker |
| **Status** | PENDING |
| **Depends on** | PROD-2 (reuse the Redis client) |
| **Files** | `src/lib/cache-manager.ts`, `src/lib/pbac-engine.ts` |

**Why**: `SystemCacheManager.store` is a process-local `Map`. Across instances the caches diverge,
so the same user can get different answers from different instances. This matters most for
**PBAC**: a revoked permission cached on instance B is a live authorization bug, not a stale-UI
annoyance.

**Do this**:
1. Back the cache with Redis, keeping the `CacheNamespace` API and TTL semantics.
2. Make invalidation **global** — a permission change must evict on every instance
   (Redis pub/sub, or delete the shared key).
3. Preserve the existing PBAC invalidation hooks (PBAC-2/PBAC-4 work); do not regress them.
4. Cache misses must fall back to the DB, never to a stale local copy.

**Acceptance criteria**:
- [ ] Cache reads/writes hit the shared store
- [ ] A role change on instance A is reflected on instance B within its documented TTL
- [ ] `cacheManager` public API unchanged
- [ ] PBAC invalidation still fires on role/permission mutation

**Verify**: two instances, change a role via A, assert B denies the permission.

---

### PROD-4 — Make SSE fan-out cross-instance

| | |
|---|---|
| **Severity** | Blocker |
| **Status** | PENDING |
| **Depends on** | PROD-2 |
| **Files** | `src/lib/sync-engine.ts`, `src/app/api/sync/events/route.ts` |

**Why**: `syncEngine.clients` is a process-local `Map`, so an event published on instance A never
reaches a browser connected to instance B. Real-time collaboration would appear to "randomly not
work" depending on which instance each user landed on — and it would work perfectly in
single-instance testing, so this will not be caught before launch without deliberate effort.

**Do this**:
1. Publish sync events to Redis pub/sub; each instance relays to its own connected clients.
2. Keep the local `Map` as the per-instance connection registry — that part is correct.
3. Confirm the SSE cleanup from PERF-3 still runs on disconnect (no leaked subscriptions).
4. Verify your host does not buffer or time out SSE responses (many proxies do; set
   `X-Accel-Buffering: no` for nginx and check the platform's streaming limits).

**Acceptance criteria**:
- [ ] Event published on instance A is received by a client connected to instance B
- [ ] Disconnect removes both the local client and its Redis subscription
- [ ] No unbounded growth in subscriptions over a soak run
- [ ] Documented streaming-timeout behaviour for the target host

**Verify**: two instances, client connected to each, mutate an issue on A, assert B's client receives it.

---

### PROD-5 — Tenant-isolation integration tests

| | |
|---|---|
| **Severity** | Blocker (highest risk item in this doc) |
| **Status** | PENDING |
| **Depends on** | PROD-1 (test against the real engine) |
| **Files** | new `__tests__/integration/tenant-isolation.test.ts`, `jest.config.js` |

**Why**: This is the one I would fix first if forced to pick a single item. For a multi-tenant
product the catastrophic failure is **one tenant reading another's data**. The audit records that
a cross-tenant injection bug already existed once (TENANT-1/DATA-1). Today **nothing** would catch
its return: all 74 tests are library-level (encryption, sanitization, validation, retention, DI),
and there are **zero** tests exercising `assertProjectAccess` / `assertOrgAccess` through a route.
118 routes have no integration coverage.

**Do this**:
1. Add an integration test setup: ephemeral Postgres (Docker or CI service), seed two
   organizations — Org A and Org B — each with its own project, issues, and users.
2. For every resource-scoped route family (issues, projects, sprints, epics, teams, comments,
   attachments, custom fields, workflows, reports, analytics), assert that a **User A token
   requesting an Org B resource** gets `403`/`404` — never `200` and never Org B's data.
3. Include the negative-path cases that actually bite: direct ID access (IDOR), `?projectId=`
   query overrides, bulk endpoints (`/api/issues/bulk`), and nested resources.
4. Wire it into CI as a required job.

**Acceptance criteria**:
- [ ] Two-org fixture, seeded and isolated per test run
- [ ] Every resource-scoped route family has a cross-tenant denial test
- [ ] IDOR, query-override, and bulk paths all covered
- [ ] Runs in CI and **fails the build** on regression
- [ ] Deliberately breaking `assertProjectAccess` makes the suite fail (prove the tests work)

**Verify**: `npm test` — plus the mutation check in the last criterion. A test suite that cannot
fail is not a test suite.

---

### PROD-6 — Authorization / PBAC route tests

| | |
|---|---|
| **Severity** | Blocker |
| **Status** | PENDING |
| **Depends on** | PROD-5 (shares the fixture) |
| **Files** | new `__tests__/integration/authz.test.ts` |

**Why**: PBAC is the most security-critical and most intricate subsystem in the codebase
([`pbac-engine.ts`](src/lib/pbac-engine.ts) is 2,254 lines) and it has **no** tests. Five PBAC
findings were filed, including privilege escalation (PBAC-1) and a stale-cache bug (PBAC-2).
Role-hierarchy logic without tests will regress.

**Do this**:
1. Reuse the PROD-5 fixture; add one user per role: `VIEWER`, `MEMBER`, `ADMIN`,
   `PROJECT_ADMIN`, `OWNER`, `SUPER_ADMIN`.
2. Assert the **hierarchy** holds: no role can grant or assume a level above itself (this is
   exactly PBAC-1 — prove it stays fixed).
3. Assert `VIEWER` is denied every mutating route.
4. Assert permission changes take effect within the documented cache TTL (guards PBAC-2/PBAC-4,
   and must still pass after PROD-3).
5. Cover the super-admin routes as a group (ADMIN-2 was a systemic authorization gap).

**Acceptance criteria**:
- [ ] One test user per role
- [ ] Escalation attempts denied for every role pair
- [ ] `VIEWER` denied on all mutating routes
- [ ] Cache-invalidation timing asserted
- [ ] Runs in CI as a required job

**Verify**: `npm test`

---

### PROD-7 — Error tracking and monitoring

| | |
|---|---|
| **Severity** | Blocker |
| **Status** | PENDING |
| **Depends on** | nothing (can run in parallel) |
| **Files** | `src/lib/logger.ts`, `next.config.ts`, `.env.example`, `DEPLOYMENT.md` |

**Why**: [`logger.ts`](src/lib/logger.ts) writes to `console.*` only. Note that OPS-3 ("No
monitoring or alerting") is marked COMPLETED in `AI-STATUS.md` with the justification
*"(health endpoint + logging)"* — a health endpoint is liveness, not monitoring. With no sink,
no aggregation, and no alerting, you would learn about production incidents from customers.
You cannot operate a paid SaaS blind.

**Do this**:
1. Add error tracking (Sentry or equivalent) for server and client, with release tagging and
   source maps so stack traces are readable.
2. Ship structured logs to an aggregator; keep the existing `SECURITY`/`AUDIT` log levels
   queryable — they are the audit trail for the PBAC-5 / ADMIN-3 work.
3. Alert on: 5xx rate, auth-failure spikes, DB connection-pool exhaustion, Redis unavailability,
   SSE connection count.
4. **Scrub PII and secrets** before anything leaves the process. Tenant data in a third-party
   error tracker is its own compliance problem.

**Acceptance criteria**:
- [ ] Unhandled server + client errors appear in the tracker with usable stack traces
- [ ] Structured logs queryable outside the host
- [ ] The five alerts above fire and route to a real destination
- [ ] PII/secret scrubbing verified with a deliberate test error containing a fake token
- [ ] `DEPLOYMENT.md` documents required env vars

**Verify**: throw a deliberate error in a non-production environment; confirm it arrives scrubbed
and alerts fire.

---

## Gate 1 — Pre-Launch Hardening

### PROD-8 — Load and soak testing

| | |
|---|---|
| **Severity** | High |
| **Status** | PENDING (**blocked**) |
| **Depends on** | **PROD-1, 2, 3, 4** — all of Gate 0's infra work |

**Why the dependency matters**: load testing before Gate 0 is **wasted effort**. You already know
the result — SQLite's single writer lock will be the bottleneck and it will mask everything behind
it. Measure the architecture you intend to ship, not the one you are replacing.

Also note: the slowness reported during development was **not** a load problem. Opening a task
took ~780 ms because of an 11-request serial waterfall in `IssueDetailModal` (fixed 2026-09-17,
see `AI-STATUS.md` session log). Confirm that class of N+1/waterfall bug is gone before load
testing, or you will just be measuring application bugs at scale.

**Do this**:
1. Write realistic scenarios (k6 / Artillery): login, board load, issue CRUD, comment, search,
   analytics, with SSE connections held open throughout.
2. Establish a baseline, then find the knee: concurrent users at p95 < 500 ms.
3. Soak for ≥2 hours watching for memory growth, connection-pool exhaustion, and SSE leaks.
4. Tune Prisma's connection pool for your instance count — `N_instances × pool_size` must stay
   under Postgres `max_connections`. This is a common and avoidable production outage.
5. Record results and the discovered ceiling in this doc.

**Acceptance criteria**:
- [ ] Documented p50/p95/p99 for each scenario
- [ ] Known ceiling (concurrent users before p95 > 500 ms)
- [ ] 2-hour soak with flat memory and no connection exhaustion
- [ ] Pool math documented against `max_connections`

---

### PROD-9 — Backup and restore drill

| | |
|---|---|
| **Severity** | High |
| **Status** | PENDING |
| **Depends on** | PROD-1 |
| **Files** | `src/lib/backup.ts`, `DEPLOYMENT.md` |

**Why**: [`backup.ts`](src/lib/backup.ts) was written for a SQLite **file** (OPS-2). After PROD-1
it is obsolete. More importantly: **an untested backup is not a backup.** The only thing that
proves a backup works is a restore.

**Do this**: replace file copying with Postgres-native backup (managed PITR, or `pg_dump` on a
schedule to off-host storage); document RPO/RTO; then **actually perform a restore** into a
scratch environment and verify data integrity.

**Acceptance criteria**:
- [ ] Automated scheduled backups, stored off-host
- [ ] RPO and RTO written down
- [ ] A restore has been **performed and verified**, with the date recorded
- [ ] Obsolete SQLite file-copy code removed
- [ ] Restore runbook in `DEPLOYMENT.md`

---

### PROD-10 — Secrets management

| | |
|---|---|
| **Severity** | High |
| **Status** | PENDING |
| **Files** | `.env.example`, `DEPLOYMENT.md`, `.github/workflows/ci.yml` |

**Why**: hygiene is currently correct (`.env` gitignored and untracked — verified), but production
should not read secrets from a file on disk. Note CI defaults `FIELD_ENCRYPTION_KEY` to an
all-zeros fallback; that must be impossible in production.

**Do this**: load secrets from the platform's secret manager; fail fast at boot if
`JWT_SECRET` or `FIELD_ENCRYPTION_KEY` is missing, weak, or the zero-default; document rotation
(especially `FIELD_ENCRYPTION_KEY` — rotating it requires re-encrypting existing data, so write
that procedure *before* you need it).

**Acceptance criteria**:
- [ ] No production secret read from a committed or on-disk file
- [ ] Boot fails loudly on missing/weak/default secrets
- [ ] Rotation procedure documented, including field re-encryption
- [ ] CI's zero-key fallback cannot apply outside CI

---

### PROD-11 — Migration safety in CI

| | |
|---|---|
| **Severity** | Medium |
| **Status** | PENDING |
| **Depends on** | PROD-1 |
| **Files** | `.github/workflows/ci.yml`, `DEPLOYMENT.md` |

**Why**: CI currently builds and tests but never proves a migration applies cleanly to a
**populated** database. Migrations are the highest-risk deploy step: they are hard to reverse and
they run against real customer data.

**Do this**: add a CI job applying migrations to a seeded Postgres via a shadow database; detect
drift between schema and migrations; document the rollback stance for destructive changes
(expand-contract for column drops).

**Acceptance criteria**:
- [ ] CI applies migrations to a seeded DB and fails on error
- [ ] Schema drift detection active
- [ ] Rollback/expand-contract policy documented

---

### PROD-12 — Front-end performance budget

| | |
|---|---|
| **Severity** | Medium |
| **Status** | PENDING |
| **Files** | `src/app/projects/[id]/ProjectClient.tsx`, view components, `next.config.ts` |

**Why**: `/projects/[id]` ships **310 kB First Load JS** (123 kB page). That is the main
application screen, and it is slow on mobile and poor connections. PERF-8 ("bundle size not
optimized") is marked COMPLETED, but this number says otherwise — re-verify before trusting it.

**Do this**: dynamic-import the heavy view components (`AnalyticsChartsView` 2,891 lines,
`ScrumBacklogView` 2,872, `CalendarView` 2,709, `WorkloadView` 2,469) so only the active view
loads; set a CI budget that fails on regression.

**Acceptance criteria**:
- [ ] `/projects/[id]` First Load JS materially reduced (target < 200 kB)
- [ ] Non-default views code-split
- [ ] CI fails if the budget is exceeded
- [ ] No functional regression in view switching

---

## Gate 2 — Post-Launch / Maintainability

These do not block launch. They are the cost of changing the system safely later.

| ID | Task | Why | Files |
|---|---|---|---|
| **PROD-13** | Decompose `IssueDetailModal` | 4,466 lines in one component — every change risks the whole task UI, and it resisted a simple dropdown edit in practice | `src/components/issues/IssueDetailModal.tsx` |
| **PROD-14** | Upgrade Prisma 5.22 → 6.x | Staying current on the data layer; do it deliberately, not under pressure | `package.json`, `prisma/` |
| **PROD-15** | Service layer between routes and Prisma | Already filed as ARCH-3 and explicitly deferred. Revisit only after Gate 0/1 — it touches all 118 routes | `src/lib/`, `src/app/api/` |
| **PROD-16** | Coverage thresholds in CI | Stops coverage silently decaying once PROD-5/6 exist | `jest.config.js`, CI |
| **PROD-17** | Decompose remaining large views | `AnalyticsChartsView`, `ScrumBacklogView`, `CalendarView`, `WorkloadView` are all >2,400 lines | `src/components/views/` |

---

## 7. Task Dependency Order

Do them in this order. Parallel tracks are marked.

```
PROD-1  Postgres ..................... START HERE (unblocks almost everything)
   │
   ├── PROD-2  Redis rate limiting
   │      ├── PROD-3  Redis cache
   │      └── PROD-4  Redis SSE fan-out
   │
   ├── PROD-5  Tenant-isolation tests   (highest risk-reduction per hour)
   │      └── PROD-6  PBAC / authz tests
   │
   ├── PROD-9  Backup + restore drill
   └── PROD-11 Migration safety in CI

PROD-7  Monitoring ................... parallel, no dependencies
PROD-10 Secrets ...................... parallel, no dependencies
PROD-12 Bundle budget ................ parallel, no dependencies

PROD-8  Load testing ................. ONLY after PROD-1/2/3/4 are done

────────── Gate 0 complete ⇒ multi-tenant production is viable ──────────

PROD-13..17 .......................... after launch
```

**If you only have time for two things**: PROD-1 (Postgres) and PROD-5 (tenant-isolation tests).
The first removes the hard scaling ceiling; the second protects against the failure that would
actually end the business.

---

## 8. Verification Protocol

Because the trackers have over-claimed before, verify rather than trust. Cheap checks:

```bash
# Is it really Postgres yet?
grep -A2 'datasource' prisma/schema.prisma

# Is state really shared, or still a process-local Map?
grep -rn 'new Map(' src/lib/rate-limit.ts src/lib/cache-manager.ts src/lib/sync-engine.ts

# Is there an external store at all?
grep -rn 'redis\|ioredis\|upstash' package.json src/lib/

# Do authorization tests actually exist?
grep -rln 'assertProjectAccess\|assertOrgAccess\|crossTenant' __tests__ src/lib/__tests__

# What do the tests really cover?
npx jest --listTests

# Baseline gates
npx tsc --noEmit && npm test
```

### Rules for marking a task COMPLETED

1. Every acceptance-criteria box is ticked.
2. The task's **Verify** command passes, and you ran it.
3. `npx tsc --noEmit` is clean.
4. For anything multi-instance (PROD-2/3/4): you tested with **two instances actually running**.
   Single-instance testing cannot detect these bugs — that is precisely why they are still here.
5. For test tasks (PROD-5/6): you proved the suite **can fail** by breaking the thing it guards.

If you cannot satisfy a criterion, mark the task **PARTIAL**, write down exactly what is missing,
and do not tick the box. A PARTIAL with an honest note is far more useful to the next session than
a COMPLETED that is wrong — as ARCH-2 demonstrates.

### Do not repeat the ARCH-2 mistake

ARCH-2 was closed by delivering something adjacent to the problem (DI for tests) instead of the
problem (shared state). Before closing a task, re-read its **Why** section and ask: *does my change
make that specific sentence false?* If not, the task is not done.

---

## 9. Rules for AI Sessions

1. **Read `AI-STATUS.md` first**, then this doc. `AI-STATUS.md` is the live queue; this is the plan.
2. **Pick the top PENDING task** respecting the dependency order in §7. Do not start PROD-8
   before its dependencies — the results would be meaningless.
3. **Set the task to IN_PROGRESS** in both this doc and `AI-STATUS.md` before starting.
4. **Follow existing patterns.** Keep public function signatures stable so the 118 routes need no
   edits. Read `src/lib/validation.ts` for the established validation pattern.
5. **`npx tsc --noEmit` must be clean before every commit.**
6. **Update both trackers** when done: tick the boxes here, update status + session log in
   `AI-STATUS.md`.
7. **Commit and push everything**, including the docs. Branch: `security/phase-1-critical-fixes`.
   Commit style: `feat(scope): short description`.
8. **Report honestly.** If a task turns out bigger than expected, or you find another over-claimed
   status, say so in the session log. Silent partial work is how this situation arose.
9. **Stop the dev server before `npm run build`** — otherwise you will chase a phantom
   `PageNotFoundError` (see §2).

---

## Change Log

| Date | Who | Change |
|---|---|---|
| 2026-09-17 | Claude Opus 5 (1M context) | Created. Baseline verified against the repo; ARCH-2 over-claim documented; 17 tasks defined across 3 gates. |
