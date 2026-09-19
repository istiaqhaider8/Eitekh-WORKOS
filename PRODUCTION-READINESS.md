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
> The in-process state it was supposed to fix is still in-process for the cache and the SSE
> registry. The rate limiters were moved to a shared store on 2026-09-18 (PROD-2); see
> PROD-3/4 below for what remains.

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

Everything in this section was verified by running commands against the repo. Rows marked
**(re-verified 2026-09-18)** were checked again on that date; the rest date from **2026-09-17**.
Each row lists how to re-verify it.

### What is genuinely working

| Fact | Evidence | Re-verify with |
|---|---|---|
| Production build passes | exit 0, clean isolated worktree | `npm run build` (see note below) |
| TypeScript compiles clean | exit 0, ~70k lines | `npx tsc --noEmit` |
| Unit tests pass | 11 suites, 182 tests, 0 failures **(re-verified 2026-09-18, PROD-2)** | `npm test` |
| TypeScript clean, lint 0 errors | 64 warnings, all pre-existing **(re-verified 2026-09-18)** | `npx tsc --noEmit && npm run lint` |
| CI runs typecheck + test + lint + build | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | read the file |
| Secrets not committed | `.env` gitignored, 0 tracked | `git check-ignore -v .env` |
| Migrations reproduce the schema | 3 under `prisma/migrations`; `migrate diff` reports **no difference** **(re-verified 2026-09-18, PROD-2)** | `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code` — the shadow URL must be a **separate Postgres database**; the old `file:` form is a leftover from before PROD-1 |
| Health endpoints exist | `/api/health`, `/api/super-admin/health` | `ls src/app/api/health` |
| All 10 Critical security findings fixed | Phase 1, audit §5 | see `SECURITY-AUDIT.md` |
| Boot-time config guard works | refuses a production boot on missing `JWT_SECRET` / `FIELD_ENCRYPTION_KEY` / `BASE_URL` **(re-verified 2026-09-18)** | [`src/instrumentation.ts`](src/instrumentation.ts); read the dev-server banner |
| Task-open latency fixed | ~744 ms → ~90 ms, 10 requests → 2 **(2026-09-18)** | see §2 "Performance baseline" |

> **Build note**: `next build` **fails** if `next dev` is running — both write to `.next`, producing a
> misleading `PageNotFoundError: Cannot find module for page: /api/auth/login`. Stop the dev server
> first, or build in a separate worktree. This is an environment artifact, **not** a code defect.

### Current stack

| Component | Version / Value |
|---|---|
| Next.js | `^15.1.0` (15.5.25 installed) |
| React | `^19.0.0` |
| Prisma | `^5.22.0` |
| Database | **PostgreSQL** (`provider = "postgresql"`) since 2026-09-18 (PROD-1) |
| API routes | **121** `route.ts` files (was 118) |
| Test files | 6 suites, in `__tests__/` and `src/lib/__tests__/` — all library-level |
| Authorization / tenant tests | **0** |
| External state store | **none** (no Redis / Memcached / Upstash) |
| Known CVEs | 1 high, 1 moderate (postcss via Next) — see B12 |

### Performance baseline (2026-09-18)

Medians, dev server, seed data (460 rows). Measured by flipping the code and the SQLite journal
mode back and forth on one server, so before/after are directly comparable.

| Flow | Before | After |
|---|---|---|
| Sign-in (API) | 97 ms | ~100 ms — unchanged, bcrypt-bound by design |
| Task open | 744 ms · 10 req · 16.2 KB | **~90 ms · 2 req · 12.9 KB** |
| Super Admin mount | 249 ms · 7 req · 67.6 KB | **~120 ms · 5 req · 21.4 KB** |
| Sign-out (API) | 39 ms | ~50 ms — unchanged, within noise |

The root cause was never query cost: the 20-relation issue-detail query runs in **10 ms over 19
statements**. It was write contention (SQLite rollback-journal mode + a `Session.lastActiveAt`
write on every request + `getCurrentUser()` running 2–3× per request) multiplied by a
ten-request fan-out. Fixed in `9a899e4`.

**Do not read these as production numbers.** They are dev-server figures on 460 rows.

### Volume baseline (2026-09-18, A3 dataset)

Re-measured against `prisma/seed-volume.js`: **20,000 issues, 50 projects, 3 orgs, 120 users**,
32 MB, with a deliberately skewed history tail (a few issues carrying ~370 comments and ~370
activity rows, most carrying almost none). Medians, dev server, separate `volume.db` — the
working database was never loaded with this.

| Flow | Seed (460 rows) | Volume (20k issues) | |
|---|---|---|---|
| Issue detail — no history | — | 132 ms · **2.5 KB** | baseline |
| Issue detail — 374 comments + 374 activity | ~90 ms · 9.4 KB | 193 ms · **682.3 KB** | **B10 confirmed: 273× payload** |
| Issue detail — 2 attachments | — | 128 ms · **655.0 KB** | **F1 confirmed: base64 rides along** |
| Project page (server render) | 148 ms · 135 KB | **1,457 ms · 939.2 KB** | **PERF-P1 confirmed** |
| Analytics | — | 304 ms · **658.3 KB** | **PERF-P2 confirmed** |
| Project context (modal) | 77 ms · 12.9 KB | 77 ms · 3.8 KB | holds up |
| Issues list (paginated API) | — | 79 ms · 68.9 KB / 50 rows | holds up |
| Search | — | 76 ms · 9.6 KB | holds up |
| Sign-in | ~100 ms | 171 ms | bcrypt-bound |

What the volume run settles:

- **B10 is real and the worst of the three.** One issue with a year of ordinary discussion
  returns **682 KB**. The four unbounded includes are the cause; 20,000 thin issues are not the
  problem, one thick one is.
- **F1 compounds it.** Two attachments alone put the payload at **655 KB**, because the file
  bytes are base64 in the row and there is no way to ask for the issue without them.
- **PERF-P1 is the worst single number.** The main application screen server-renders **939 KB**
  of HTML in **1.46 s** — an order of magnitude worse than at seed scale — while its own
  paginated API answers in 79 ms. The page is bypassing it.
- The work already done holds: the consolidated context endpoint is *smaller* at volume
  (3.8 KB) than at seed scale, and search and the paginated list are unaffected.

Rebuild the dataset with:
```bash
DATABASE_URL="file:./volume.db" npx prisma migrate deploy
DATABASE_URL="file:./volume.db" node prisma/seed-volume.js
DATABASE_URL="file:./volume.db" npm run dev      # measure against it
```
The seed refuses to run against a database whose name does not contain "volume", so it cannot
be pointed at `dev.db` by accident.

### Measured problems

| ID | Problem | Evidence |
|---|---|---|
| ~~B1~~ | ✅ **FIXED 2026-09-18** (PROD-1). Was: SQLite in a multi-tenant SaaS | `prisma/schema.prisma` → `provider = "postgresql"` |
| ~~B2~~ | ✅ **FIXED 2026-09-18** (PROD-2). Was: rate limiting in-process. Both limiters now go through a shared Postgres-backed store. | [`src/lib/rate-limit-store.ts`](src/lib/rate-limit-store.ts); verified across 2 live instances, see PROD-2 below |
| ~~B3~~ | ✅ **ADDRESSED 2026-09-19** (PROD-3). The `Map` is still there and still in-process — because **nothing ever writes to it**: `set()` has no callers, so it holds no data. The real cross-instance defect in that file was the invalidation path, which now bumps the shared PBAC version. See the PROD-3 cache finding. | [`src/lib/cache-manager.ts`](src/lib/cache-manager.ts) header comment |
| ~~B4~~ | ✅ **FIXED 2026-09-19** (PROD-4). The registry is still per-process, which is correct — a socket belongs to the process holding it. What was missing was fan-out: events now relay between instances over Postgres `LISTEN/NOTIFY`. | [`src/lib/sync-bus.ts`](src/lib/sync-bus.ts); verified with a client on each of 2 live instances |
| ~~B5~~ | ⚠️ **HALF FIXED 2026-09-19** (PROD-5). Tenant isolation now has 40 integration tests running in CI — and they found a live cross-tenant leak of team members' email addresses on their first complete run. Authorization/PBAC route tests (PROD-6) are still absent. | [`__tests__/integration/tenant-isolation.test.ts`](__tests__/integration/tenant-isolation.test.ts) |
| B6 | Logs go to `console.*` only | [`src/lib/logger.ts`](src/lib/logger.ts) — no sink, no alerting |
| B7 | `/projects/[id]` ships **296 kB** First Load JS (was 310 kB; PROD-4 removed the server-side delegation engine from the client bundle, −20 kB) | `npm run build` output |
| B8 | `IssueDetailModal.tsx` is 4,466 lines | `wc -l src/components/issues/IssueDetailModal.tsx` |
| ~~**B9**~~ | ✅ **FIXED 2026-09-18** (PROD-0, originally `0007_repair_schema_drift`; the SQLite history was archived to `prisma/migrations-sqlite-archive/` when PROD-1 regenerated it for Postgres). Was: **migrations do not reproduce the schema.** A fresh `migrate deploy` omits `OtpCode` and `Invitation` and builds a different `SystemEmailConfig`. Both tables are used at runtime, so OTP/MFA login and invitations break on day one. Dev only works because the DB was `db push`ed. | `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "file:./_shadow.db"` → reports `[+] Added tables: OtpCode, Invitation` |
| **B10** | **MEASURED 2026-09-18: 682 KB for one issue.** **Unbounded relation loads.** `GET /api/issues/[id]` has no `take` on `activityLogs`, `comments`, `timeEntries` or `attachments`. Harmless at 19 activity rows / 9.4 KB; unbounded on a long-lived issue. | read [`src/app/api/issues/[id]/route.ts`](src/app/api/issues/[id]/route.ts) — no `take` in those four includes |
| ~~**B11**~~ | ✅ **FIXED 2026-09-18** (PROD-2). Was: rate limiting keyed per IP, so a team behind one NAT shared a single 100 reads/min budget. Authenticated traffic is now keyed per user, with a much looser per-IP backstop (600 reads/min) so that many stolen sessions from one host are still bounded. | `resolveSubject()` in [`src/middleware.ts`](src/middleware.ts); live test T2 — two users on one IP do not consume each other's budget |
| **B12** | **Known dependency CVEs**: 1 high, 1 moderate via postcss, reachable only through a Next major upgrade. | `npm audit --omit=dev` |
| ~~**B13**~~ | ✅ **FIXED 2026-09-19** (PROD-3). Was: PBAC state process-local *and* file-local, so authorization state itself diverged across instances. Roles, assignments and audit records are now Postgres rows; the `Map`s are a read-through cache reloaded on a shared version counter. 18 roles / 136 assignments / 157 audit records migrated. | [`src/lib/pbac-store.ts`](src/lib/pbac-store.ts); verified across 2 live instances |
| ~~**B14**~~ | ✅ **FIXED 2026-09-18** (PROD-2). Was: two independent in-process rate limiters. **Both** moved — verified live: the middleware limit and the `forgot-password` limit each refuse in aggregate across two instances. | [`src/lib/rate-limit.ts`](src/lib/rate-limit.ts) and [`src/middleware.ts`](src/middleware.ts) both call `getRateLimitStore()`; guarded by a test that greps the sources |

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

A **single-instance pilot with a handful of trusted tenants** is reasonable, and as of
2026-09-18 a *fresh* deployment is no longer broken before it serves a request: PROD-0 is done,
so `migrate deploy` now builds the schema the application expects.

The product works, the critical vulnerabilities are fixed, and real usage would teach you more
than more auditing would. Gate 0 is what separates that pilot from genuine multi-tenant
production.

### Readiness estimate (2026-09-18)

| Target | Ready | Gating |
|---|---|---|
| Fresh single-instance deploy | ~~blocked~~ **unblocked 2026-09-18** | PROD-0 done |
| Single-instance pilot, trusted tenants | ~85% after PROD-0 | PROD-7, PROD-10 advisable |
| **Multi-tenant paid production** | **~84%** | all of Gate 0 — 8 items, **6 complete** |

The percentage is a judgement, not a measurement. The countable part: **6 of 8 Gate 0 items are
complete** (PROD-0 through PROD-5). All of the shared-state work is done: the database, the rate
limiters, the authorization model and real-time fan-out now work across instances, and tenant
isolation is tested in CI. What remains is PROD-6 (authorization/PBAC route tests) and PROD-7
(error tracking).

One caveat on PROD-5 worth carrying forward: the suite covers the route families it covers, not
all 123 routes. An audit listed further families with no denial test; they are recorded under
PROD-5 as follow-up rather than treated as covered.

---

## Gate 0 — Blockers

> Nothing in this gate is optional. Each item is a correctness or security problem under
> real multi-tenant load, not a nice-to-have.

### PROD-0 — Repair the migration drift

| | |
|---|---|
| **Severity** | Blocker (blocked *every* deployment, including the pilot) |
| **Status** | **COMPLETED 2026-09-18** — `prisma/migrations/0007_repair_schema_drift` |
| **Depends on** | nothing — was done before anything else |
| **Files** | `prisma/migrations/0007_repair_schema_drift/`, `.github/workflows/ci.yml` |
| **Found** | 2026-09-18 |

> **Closed.** Evidence, in the order the acceptance criteria ask for it:
>
> - `migrate diff --from-migrations … --to-schema-datamodel …` → **"No difference detected."**
> - A database built **only** by `migrate deploy` on an empty file now contains
>   `OtpCode`, `Invitation` and `SystemEmailConfig`, 47 tables, with
>   `OtpCode_email_purpose_idx`, `Invitation_tokenHash_key` and
>   `Invitation_email_idx` present.
> - The two broken features were exercised against that migrations-only
>   database, **12/12**: an OTP is issued with its defaults, the verify lookup
>   finds it, a consumed code cannot be reused; an invitation is created, found
>   by token hash, the hash is unique, it can be accepted, and its `orgId`
>   foreign key is enforced. The data-retention queries over both tables run.
> - Nothing destructive. The generated SQL adds two tables and rebuilds
>   `SystemEmailConfig` — needed only because its `senderName` default changed
>   from `'Zenith WorkOS'` to `'Eitekh WorkOS'` at the rebrand, which affects
>   new rows only, and the `INSERT...SELECT` copies every existing column.
>   SQLite cannot alter a column default in place, so the rebuild is Prisma's
>   standard approach.
> - CI now fails on drift, and **the check was proved able to fail**: adding a
>   throwaway model to `schema.prisma` made `migrate diff --exit-code` exit 2
>   and name it. Clean tree exits 0. A second step applies the full history to a
>   **seeded** database, because applying cleanly to an empty one proves less.
> - The dev database was marked with `migrate resolve --applied` rather than
>   re-running the migration, since `db push` had already created those tables
>   there. Its `SystemEmailConfig.senderName` default therefore still reads
>   `'Zenith WorkOS'`; that is cosmetic, applies only to rows that do not exist,
>   and a fresh deploy gets the new default.

**Why**: the migration history and `schema.prisma` disagree. `prisma migrate status` says
"up to date" — that only proves the *dev* database has the existing migrations applied. The real
question is whether the migrations *reproduce* the schema, and they do not:

```
$ npx prisma migrate diff --from-migrations prisma/migrations \
    --to-schema-datamodel prisma/schema.prisma \
    --shadow-database-url "file:./_shadow.db"

[+] Added tables
  - OtpCode
  - Invitation
[*] Redefined table `SystemEmailConfig`
[*] Changed the `Invitation` table
  [+] Added unique index on columns (tokenHash)
  [+] Added index on columns (email)
[*] Changed the `OtpCode` table
  [+] Added index on columns (email, purpose)
```

Confirmed end to end on a clean database rather than inferred from the diff — note what
`migrate deploy` reports while doing it:

```
$ DATABASE_URL="file:/tmp/fresh.db" npx prisma migrate deploy
All migrations have been successfully applied.

$ # ... then list the tables in that database:
  OtpCode              MISSING
  Invitation           MISSING
  SystemEmailConfig    present
  User                 present
```

`OtpCode` and `Invitation` are not optional: they back OTP/MFA login
([`src/lib/otp.ts`](src/lib/otp.ts)) and the whole invitation flow
([`src/app/api/auth/invitation/route.ts`](src/app/api/auth/invitation/route.ts),
[`invite/route.ts`](src/app/api/auth/invite/route.ts)), and are read by
[`src/lib/data-retention.ts`](src/lib/data-retention.ts). A fresh production database gets
neither table, so those features fail on the first request. The local database works only
because it was built with `db push`, which writes the schema without recording a migration.

This is the classic shape of the failure this document exists to prevent: a green status command
covering a red fact.

**Do this**:
1. Generate the missing migration from the diff — do **not** hand-write it:
   `npx prisma migrate dev --name otp_invitation_email_config --create-only`
2. Read the generated SQL before applying it. Confirm it only *adds* `OtpCode`, `Invitation` and
   their indexes and redefines `SystemEmailConfig`; if it proposes dropping or recreating any
   table holding data, stop and rework it as expand-contract.
3. Prove it from empty: apply the full history to a clean database and re-run the diff. The
   second diff must report no changes.
4. Verify the affected features against that freshly-migrated database — request an OTP and
   create an invitation. A passing migration is not proof the feature works.
5. Add the drift check to CI so this cannot recur. This is the cheap half of PROD-11 and should
   land here rather than waiting for it.

**Acceptance criteria**:
- [ ] `migrate diff --from-migrations … --to-schema-datamodel …` reports **no** difference
- [ ] A clean database built only by `migrate deploy` contains `OtpCode` and `Invitation`
- [ ] OTP request and invitation creation both succeed against that database
- [ ] No migration in the history drops or recreates a populated table
- [ ] CI fails on schema/migration drift
- [ ] `npx tsc --noEmit` clean, `npm test` passes

**Verify**:
```bash
rm -f /tmp/fresh.db
DATABASE_URL="file:/tmp/fresh.db" npx prisma migrate deploy
DATABASE_URL="file:/tmp/fresh.db" npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "file:/tmp/shadow.db"   # must report no difference
```

> **Note for PROD-1**: SQLite migrations are not portable to Postgres, so this migration will be
> discarded when PROD-1 regenerates the history. Do it anyway — PROD-1 is a multi-day change, and
> until it lands every deploy is broken without PROD-0. It also proves the schema is internally
> consistent *before* you translate it, which is much easier to debug than doing both at once.

---

### PROD-1 — Migrate SQLite → PostgreSQL

| | |
|---|---|
| **Severity** | Blocker |
| **Status** | **COMPLETED 2026-09-18** — provider is `postgresql`, history regenerated |
| **Depends on** | PROD-0 (done first, so the schema was consistent before translating) |
| **Files** | `prisma/schema.prisma`, `prisma/migrations/`, `.env.example`, `DEPLOYMENT.md`, `.github/workflows/ci.yml`, `src/lib/prisma.ts` |

> **Closed.** Verified against a real PostgreSQL 18, not asserted:
>
> - `provider = "postgresql"`; the SQLite migration history is archived at
>   `prisma/migrations-sqlite-archive/` (not deleted) and replaced by a regenerated
>   `0001_init_postgres` — 46 tables, 1,232 lines — plus `0002_value_constraints`.
> - **The CHECK constraints had to be rescued.** 0005/0006 added them as hand-written SQL, so
>   they are not in `schema.prisma` and did **not** survive regeneration. Without
>   `0002_value_constraints` PROD-1 would have silently dropped validation that was explicitly
>   verified. Confirmed restored at the database level: a raw
>   `UPDATE "User" SET "userType" = 'CONTRACTOR'` fails with
>   `violates check constraint "User_userType_check"`.
> - **F5 confirmed and fixed.** On this Postgres, `contains: "implement"` returned **0** rows
>   where SQLite returned 1 — search would have silently found nothing. `mode: "insensitive"`
>   added to **41 of 44** `contains` sites across 7 files. The other **3** were left exact on
>   purpose: they match application-written JSON such as `'"severity":"CRITICAL"'`, where the
>   case is ours, not the user's.
> - Live acceptance **22/22**: auth, core reads, writes (create/update/delete), the three pages,
>   and case-insensitive search proved in three casings across three different endpoints.
> - `migrate diff` against Postgres: **no difference**. tsc clean, jest 170/170, lint 0 errors.
> - The SQLite pragma block is gone from `src/lib/prisma.ts`; pool sizing moved to
>   `DATABASE_URL` (`connection_limit`), documented in `.env.example`.
> - CI now runs a `postgres:16-alpine` service with a healthcheck. **Running the suite on SQLite
>   while shipping Postgres is exactly how F5 stayed invisible**, so this matters more than it
>   looks.
> - `src/lib/backup.ts` now **refuses** instead of copying `prisma/dev.db`. It would have
>   reported success while producing a pre-migration snapshot — worse than having no backup
>   feature, because it is discovered during a restore. Real backup is PROD-9.
> - The boot guard treats a `file:` URL as an **error**, not a warning: it can no longer work.
>
> **Two decisions I made in the absence of an answer, both reversible.**
> 1. **Data was not migrated.** Postgres was seeded fresh. `prisma/dev.db` is untouched on disk
>    (2.28 MB), so nothing is lost — but rows created in SQLite after the last seed, including
>    issues CP-525..529, exist only there. Migrating them is an export/import job if wanted.
> 2. **Verification used a local embedded PostgreSQL 18** on port 54329, installed with
>    `npm install --no-save` so it is not a committed dependency. The migrations and code are
>    Postgres-generic, so choosing a managed provider does not change any of this work — only
>    `DATABASE_URL`.

**Why**: SQLite has a single writer lock and is file-local. In a multi-tenant SaaS this means
concurrent writes from different tenants serialize and then fail under load, and you cannot run
more than one app instance against the same database. `DEPLOYMENT.md` already flags SQLite as
unsuitable beyond ~10 concurrent writers — that ceiling is below a real customer base. The
application's own boot banner says the same thing.

> **WAL does not change this.** On 2026-09-18 the database was switched to `journal_mode=WAL`
> ([`src/lib/prisma.ts`](src/lib/prisma.ts)), which stopped writers blocking readers and cut the
> concurrency-10 write penalty from ~200 ms to ~40 ms. That is a real single-instance win and it
> is why task open is now fast — but WAL still permits exactly **one writer** and is still a
> local file. The multi-instance ceiling is unchanged. Do not let the improved latency read as
> progress against this task.

When PROD-1 lands, delete the SQLite pragma block in `src/lib/prisma.ts`; Postgres rejects those
statements, and they are guarded by a `file:` check that must be removed with them.

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
| **Status** | ✅ **DONE 2026-09-18** |
| **Depends on** | PROD-1 (done) |
| **Files** | `src/lib/rate-limit-store.ts` (new), `src/lib/rate-limit.ts`, `src/lib/session-token.ts` (new), `src/middleware.ts`, `src/instrumentation.ts`, `prisma/migrations/0003_rate_limit_counter`, `.env.example` |

**Why it mattered**: both limiters were a process-local `Map`. With N instances behind a load
balancer an attacker got **N × the configured limit**, and every deploy reset every counter. The
code read correctly and the tests passed — the limiter was accurate about the one process it could
see. That is what made it a blocker rather than a nit.

**What was done**

1. **A shared store** — [`src/lib/rate-limit-store.ts`](src/lib/rate-limit-store.ts), backed by a
   new `RateLimitCounter` table (migration `0003_rate_limit_counter`).
2. **Atomic increments.** The window read, the window reset and the increment are a single
   `INSERT … ON CONFLICT DO UPDATE … RETURNING`. A read-then-write races precisely under the load
   a limiter exists to handle: two requests both read 99, both decide they are under 100, both
   write 100. The window boundary is evaluated by the **database** clock, not the instance's,
   because with several instances theirs disagree.
3. **Both limiters moved** (B14) — the middleware limit and the login/account limiter in
   `rate-limit.ts`. Migrating only one would have left the general API limit process-local.
4. **Re-keyed off raw IP** (B11). Authenticated traffic is keyed per user; unauthenticated traffic
   keeps IP keying, where it is the only identifier available. A token that fails verification
   counts as unauthenticated, so a forged cookie cannot mint a private budget.
5. **A per-IP backstop** the roadmap did not ask for. Per-user keying alone means an attacker
   holding many valid sessions gets a fresh budget per account. A second, much looser ceiling
   (600 reads / 200 mutations per minute per address) bounds that, while sitting far above what a
   shared office NAT ever reaches. Both ceilings are charged in **one** round-trip via a multi-row
   upsert, with keys sorted so that concurrent statements cannot deadlock by taking row locks in
   opposite orders.
6. **Fails closed.** If the store is unreachable, requests are denied. This differs from the usual
   Redis advice — failing open is defensible when Redis being down does not mean the app is down —
   because here the store *is* the application's Postgres. If it is unreachable, every route that
   touches the database is already failing, so denying costs nothing that was working, while
   failing open would remove the brute-force ceiling on login and password reset during exactly
   the incident that caused it.
7. **A per-process store cannot reach production.** `RATE_LIMIT_STORE=memory` exists for local
   development without a database; `assertProductionRateLimitStore()` makes the process refuse to
   start with it in production.

**Why Postgres and not Redis**: the roadmap named Redis. What the acceptance criteria actually
require is a store that is *shared* and increments *atomically*, and Postgres is both. No managed
Redis has been chosen — that decision is still open — so a Redis limiter could have been written
but not run, and an unverified security control is worse than a verified one with a slower store.
Postgres is already a hard dependency after PROD-1, so this adds no new infrastructure, failure
domain or secret. The cost is one round-trip per API request, **measured at p50 1.2 ms / p95
1.8 ms / p99 2.0 ms** over 300 iterations. `RateLimitStore` is the seam if that ever becomes
material: implement `hit`/`hitMany`/`reset` against Redis and change `resolveStore()`. Nothing
else in the codebase knows which store it is talking to.

**One dependency worth recording**: the middleware now runs on the **Node** runtime
(`export const runtime = "nodejs"` plus `experimental.nodeMiddleware`), because Prisma cannot run
on the edge. That flag is experimental in Next 15.5 — the build prints `Unrecognized key(s) in
object: nodeMiddleware` and enables it anyway — and **stable in Next 16**, which PROD-19 already
plans. It is a step towards that upgrade, not a bet against it. If the flag were ever dropped, the
build fails on the Prisma import rather than silently falling back to edge, and `isNodeRuntime()`
in the middleware refuses to serve if it somehow does.

> **A trap worth documenting.** Middleware must not import `@/lib/auth`: that module imports
> `next/headers`, and pulling it into the middleware module graph makes **every** response a bare
> 500 — with the middleware itself running to completion, setting its headers, and logging
> nothing. It cost a debugging cycle here. The JWT primitives were therefore split into
> [`src/lib/session-token.ts`](src/lib/session-token.ts), which has no framework imports;
> `auth.ts` re-exports them, so no caller changed.

**Deviation from the plan**: the roadmap's criterion "public call signatures unchanged; no route
edits required" could not be met. A shared store is a network round-trip, so `checkRateLimit` and
`resetRateLimit` are now `async`, and the 11 call sites in `src/app/api/auth/*` gained an `await`.
A synchronous shim was rejected: it would be a fast path that answers confidently from the wrong
data.

**Acceptance criteria**
- [x] No process-local `Map` backing **either** limiter — enforced by a test that greps both sources
- [x] Limit enforced *in aggregate* across ≥2 concurrently running instances — live T1
- [x] Counter increments are atomic (no read-then-write) — single-statement upsert
- [x] Store unavailable → deny, documented behaviour — live T7 (503) and a unit test
- [x] Authenticated traffic keyed per user/session, not per IP — live T2
- [x] Two users behind one IP do not consume each other's budget — live T2
- [ ] Public call signatures unchanged; no route edits required — **not met**, see Deviation above

**Verified live, 2026-09-18** — two instances (ports 3111/3112) plus a third against a dead
database, all sharing one Postgres. 10 checks, **10 passed, 0 failed**:

| Test | Result |
|---|---|
| T1 mutation ceiling of 30 enforced across both instances, alternating | first 429 at request **#31**; one shared row held `count=32` |
| T1 the first 30 were not refused | all 404 (reached the route) |
| T2 user A exhausted; user B on the **same IP** still allowed | A 429, B 404 |
| T3 unauthenticated IP limit enforced in aggregate | first 429 at **#31** |
| T4 forged token does not mint a private budget | 429, charged to the spent IP bucket |
| T5 read bucket unaffected by a spent mutation budget | GET 404 |
| T6 a second process sees the spent budget (no per-deploy reset) | 429 |
| T7 store unreachable → denied, not waved through | **503** |
| Second limiter (`forgot-password`, limit 5) across both instances | 5 allowed, **6th refused** |

Unit coverage: 12 tests in
[`src/lib/__tests__/rate-limit.test.ts`](src/lib/__tests__/rate-limit.test.ts), including the
fail-closed path and a structural guard against the `Map` returning.

**Re-verify with**: start two instances against one database, script `limit + 1` requests across
both, and confirm the last is rejected. A per-process store would let 2 × limit through.

---

### PROD-3 — Move the PBAC store to the database (and the cache finding)

| | |
|---|---|
| **Severity** | Blocker |
| **Status** | ✅ **DONE 2026-09-19** |
| **Depends on** | PROD-1, PROD-2 (both done) |
| **Files** | `src/lib/pbac-store.ts` (new), `src/lib/pbac-engine.ts`, `src/lib/cache-manager.ts`, `scripts/migrate-pbac-store.mjs` (new), `prisma/migrations/0004_pbac_store_to_database` |

**Why it mattered**: the engine held roles and assignments in in-memory `Map`s *and* persisted them
to `.data/pbac-store.json` on the local disk. Two instances therefore held two divergent copies of
the authorization model itself, each writing its own file. This was never a stale-cache problem: a
role created on instance A did not exist on instance B, `invalidateUserCache()` evicted only the
calling process, and the whole model was rewritten on every mutation, so two instances saving
concurrently discarded one another's changes.

**What was done**

1. **The model moved to Postgres** — `PbacRole`, `PbacUserRoleAssignment`, `PbacAuditRecord`,
   `PbacOrgState` (migration `0004_pbac_store_to_database`). All persistence is owned by
   [`src/lib/pbac-store.ts`](src/lib/pbac-store.ts); the engine's `Map`s are now a read-through
   cache.
2. **Writes are per entity, not whole-model.** This is the point of the rewrite rather than an
   optimisation: a whole-model write from instance A would undo a role instance B created a moment
   earlier — the same class of bug in a new location.
3. **Cross-instance consistency via a version counter.** `PbacOrgState.version` is bumped on every
   mutation, by the *database* (`increment`), so two concurrent bumps cannot lose one another.
   Readers re-check it at most every 2 s and reload when it moves. The version is also stamped into
   capability-cache keys, so a change makes every previously computed answer unreachable with no
   sweep to get wrong.
4. **The version check runs before the derived-cache lookup.** Checking afterwards would return a
   cached answer without the version ever being consulted, so a permission revoked elsewhere would
   survive the full 5 s TTL on every repeat call.
5. **The admin "refresh cache" action now reaches other instances.** It called
   `pbacEngine.invalidateUserCache()`, which clears only the process that served the click — so it
   purged one instance and reported a full system purge. It now bumps the shared version.
6. **The existing store was migrated, not dropped** —
   [`scripts/migrate-pbac-store.mjs`](scripts/migrate-pbac-store.mjs), run live: **18 roles, 136
   assignments, 157 audit records, 3 organizations**. The script is idempotent, reports what it
   skips rather than discarding it quietly, and deliberately does **not** delete its own input.
7. **Audit records became durable.** They were a 2000-entry ring inside the JSON file, so the record
   of who changed permissions was both lossy and per-instance; a restart erased it. They are now
   rows, and the reader queries them instead of this process's buffer.

**A cross-tenant bug found and fixed on the way**: `assignRolesToUser` replaced a user's *entire*
role set across every organization, so assigning roles in org A silently dropped their grants in
org B. That was invisible while the store was one flat JSON blob; persisting per organization made
it visible. Both the database write and the in-memory mutation are now scoped to the organization.

**The cache half — a finding rather than a fix.** `SystemCacheManager` is **not currently a cache**:
`set()` is never called anywhere in the application, so the store is always empty, `getMetrics()`
reports on nothing, and the "6 cache tiers" in the refresh checklist describe tiers that hold no
data. Its only consumers are the two `/api/admin/cache` endpoints. Moving an unused `Map` to Redis
would have satisfied the letter of B3 and changed nothing real, so it was not done; the genuine
cross-instance defect in that file was the invalidation path, which is item 5 above. The file now
says all of this at the top. If real caching is introduced later, that is the seam, and Redis is
the right backing store for it — a cache is read on nearly every request and tolerates being lost,
which is the opposite trade-off to PROD-2's limiter.

**The honest limitation**: propagation is by polling, so a permission revoked on one instance can
still be honoured on another for up to **2 seconds**. That is a documented bound replacing
"indefinitely", and the acceptance criterion asks for exactly that ("within its documented TTL").
Push invalidation needs a pub/sub channel; PROD-4 has to introduce one for SSE fan-out, and this
should move onto it then.

**Acceptance criteria**
- [x] Cache reads/writes hit the shared store — for PBAC, the actual state; see the cache finding above
- [x] A role change on instance A is reflected on instance B within its documented TTL — live T1–T3
- [x] `cacheManager` public API unchanged
- [x] PBAC invalidation still fires on role/permission mutation — plus it now reaches other instances
- [x] **No authorization state in `.data/pbac-store.json`** — guarded by a test; the engine no longer imports `fs`
- [x] A role created on instance A exists on instance B — live T1
- [x] Existing `.data/pbac-store.json` contents migrated, not silently dropped — 18/136/157/3, verified by read-back

**Verified live, 2026-09-19** — two Next instances (3111/3112) against one Postgres, driven over
HTTP so the engine's own load/reload path is what is exercised. **8 passed, 0 failed**:

| Test | Result |
|---|---|
| T1 role created on A | HTTP 200; **instance B lists it** |
| T2 permission added on A | B sees `["issues:view","issues:edit"]` |
| T3 permission revoked on A | B sees `["issues:view"]` — the revocation propagated |
| T4 role deleted on A | gone from B's listing |
| T5 the JSON store was not written during any of it | last written 5485 s earlier |
| T6 migrated model intact | 18 roles / 136 assignments / 157 audit records |

The fixture (one organization, one user, one session) was created by the test and removed
afterwards; counts returned to exactly 18/136/157/3, with no leftovers. Unit coverage: 9 structural
tests in [`src/lib/__tests__/pbac-store.test.ts`](src/lib/__tests__/pbac-store.test.ts).

**Re-verify with**: two instances against one database; create a role via A, list roles via B.

---

### PROD-4 — Make SSE fan-out cross-instance

| | |
|---|---|
| **Severity** | Blocker |
| **Status** | ✅ **DONE 2026-09-19** |
| **Depends on** | PROD-1, PROD-2, PROD-3 (all done) |
| **Files** | `src/lib/sync-bus.ts` (new), `src/lib/delegation-dates.ts` (new), `src/lib/sync-engine.ts`, `src/lib/delegation-engine.ts`, 5 client components, `prisma/migrations/0005_sync_event_outbox` |

**Why it mattered**: `syncEngine.clients` is a per-process `Map`, so an event published on instance
A never reached a browser connected to instance B. Real-time collaboration would appear to
"randomly not work" depending on which instance each user landed on — and it works perfectly in
single-instance testing, so it would not have been caught before launch.

**What was done**

1. **A relay** — [`src/lib/sync-bus.ts`](src/lib/sync-bus.ts). Publishing inserts a row into
   `SyncEventOutbox` and issues `NOTIFY sync_events` with the row id; every instance holds one
   `LISTEN` connection, fetches the row and relays to its own clients.
2. **The local `Map` stays**, and is still the right structure: a connection belongs to the
   process holding the socket. Only the fan-out was missing.
3. **The payload rides in a row, not on the notification.** `NOTIFY` payloads are capped at 8000
   bytes and sync payloads can exceed that. A durable row also makes reconnect replay possible
   later.
4. **An instance ignores the echo of its own publishes** (`originId`). The publisher already
   delivered locally and synchronously; relaying its own event back would double-deliver it.
   Verified live.
5. **The relay re-applies subscription rules rather than trusting the sender.** An event arriving
   over the bus is data, not permission: project events still reach only subscribers of that
   project (plus Superadmin observers, never personal streams), and personal notifications still
   require an exact user match.
6. **Fan-out cannot fail a mutation.** Publishing is fire-and-forget and logged; a write must not
   fail because another instance could not be reached.
7. **It degrades rather than breaking.** If the listener cannot be established or drops, the bus
   polls the outbox every second and keeps trying to restore push delivery. The failure is logged,
   because "real-time silently became single-instance again" is the exact bug this prevents.
8. **Outbox rows are swept** after 5 minutes, so the relay table cannot grow without bound.

**Why Postgres `LISTEN/NOTIFY` and not Redis**: same reasoning as PROD-2 — no managed Redis has
been chosen, so a Redis implementation could be written but not run, and an unverified fan-out is
indistinguishable from a broken one. The usual objection to `LISTEN/NOTIFY` is a connection per
listener; here it is **one connection per instance**, not per client, which is a fixed and small
cost. `publish()`/`subscribe()` are the seam if event volume ever justifies Redis.

**A build failure that exposed a real problem.** Adding the `pg` driver broke `next build`:
`pg` requires `fs`, which does not exist in a browser. The cause was that five client components
(`ListView`, `KanbanBoardView`, `TimelineGanttView`, `WorkloadView`, `IssueDetailModal`) imported
`isDelegationActive` — a pure date function — from `delegation-engine.ts`, which also imports
Prisma and the sync engine. The browser bundle had been carrying the entire server-side engine all
along; `pg` merely made it announce itself. The fix was to split rather than to teach the bundler
to ignore it: the pure helpers moved to
[`src/lib/delegation-dates.ts`](src/lib/delegation-dates.ts), and `delegation-engine.ts` re-exports
them so server callers are unaffected. **Measured side effect: `/projects/[id]` First Load JS fell
from 316 kB to 296 kB** (page chunk 128 kB → 107 kB), which is progress against B7/PROD-12.

**Acceptance criteria**
- [x] Event published on instance A is received by a client connected to instance B — live, same `eventId`
- [x] Disconnect removes the local client and its subscription — there is no per-client subscription to leak: one listener per instance, and the existing `unregisterClient` cleanup on `cancel`/`abort` is unchanged
- [x] No unbounded growth in subscriptions over a soak run — subscriptions are fixed at one per instance by construction; outbox rows are swept after 5 minutes
- [x] Documented streaming-timeout behaviour for the target host — `X-Accel-Buffering: no` was already set on the SSE response; see the note below

**Streaming behaviour to check on your host**: the response already sets `X-Accel-Buffering: no`
(nginx) and the route is `dynamic = 'force-dynamic'` on the Node runtime. What still needs
confirming per platform is the idle-connection timeout — many managed hosts cut streaming
responses at 30–300 s. The client already reconnects and sets `refreshRequired`, so a cut is
recoverable, but the limit should be recorded in the runbook (PROD-20).

**Verified live, 2026-09-19** — two Next instances against one Postgres, one SSE client held open
against **each**, mutation made through instance A's HTTP API. **8 passed, 0 failed**:

| Test | Result |
|---|---|
| Both clients connected | A and B both received `CONNECTED` |
| Instance A accepted the mutation | HTTP 200 |
| Client on A received the event (local delivery unchanged) | `ISSUE_UPDATED` |
| **Client on B received the event published on A** | `ISSUE_UPDATED` |
| Same event, not a duplicate | identical `eventId` on both |
| Publisher did not double-deliver | exactly 1 copy on A |
| Events recorded in the outbox | 2 rows |
| Disconnecting B's client left A's stream intact | A still streaming |

Both instances logged `SYNC_BUS_LISTENING`, so this was **push delivery, not the polling
fallback**; the relay on B was logged in the same millisecond the event was created. The fixture
(organization, workspace, project, issue, user, session) was created by the test and removed
afterwards. Unit coverage: 10 structural tests in
[`src/lib/__tests__/sync-bus.test.ts`](src/lib/__tests__/sync-bus.test.ts).

**Re-verify with**: two instances, an SSE client on each, mutate an issue via A, assert B's client
receives it.

---

### PROD-5 — Tenant-isolation integration tests

| | |
|---|---|
| **Severity** | Blocker (highest risk item in this doc) |
| **Status** | ✅ **DONE 2026-09-19** |
| **Depends on** | PROD-1 (done) |
| **Files** | `__tests__/integration/{harness,fixture,tenant-isolation.test}.ts` (new), `jest.integration.config.js` (new), `scripts/run-integration-tests.mjs` (new), `scripts/dev-postgres.mjs` (new), `src/lib/__tests__/integration-harness.test.ts` (new), `.github/workflows/ci.yml` |

**Why it mattered**: for a multi-tenant product the catastrophic failure is one tenant reading
another's data, and the audit records that a cross-tenant bug already existed once
(TENANT-1/DATA-1). Nothing would have caught its return: every test was library-level, and no test
exercised `assertProjectAccess` or `assertOrgAccess` through a route.

**It found a real one on its first complete run.** `GET /api/teams/[id]/members` authenticated the
caller and then queried by team id with no tenant check at all, returning every member's id,
**email**, name and avatar. Any authenticated user of any organization could enumerate any other
organization's team membership. Reproduced live (HTTP 200 carrying org B's addresses to an org A
admin), then fixed by moving the guard into `src/lib/tenant.ts` as `assertTeamAccess`. That is the
whole argument for this suite.

**What was built**

1. **Real HTTP against a real build.** Calling `assertProjectAccess` directly would test the guard
   while assuming the route calls it — which is precisely the assumption that breaks. The suite
   speaks HTTP to a production server, so middleware, auth, guard and database are all in the path.
2. **A two-tenant fixture**: two organizations, each with a workspace, project, team, workflow,
   issue and one user per role, plus a super admin and a user who belongs to nothing. Created and
   destroyed per run, scoped by a run prefix rather than by truncating tables.
3. **Strict refusal semantics.** `expectDenied` accepts only 401/403/404. It rejects 429 and 500 as
   well as 200: a rate-limited or crashing request proves nothing about isolation, and counting
   either as a pass is how a suite quietly stops testing what it claims to.
4. **Control cases.** Every denial is paired with the same request made by a legitimate member,
   which passes. Without that, a suite passes when the route is broken for everyone.
5. **Coverage**: IDOR on project/issue/org/workspace/team, nested project and issue resources,
   query-parameter scope overrides, bulk endpoints, the SSE subscription handshake, a user who
   belongs to nothing, unauthenticated access, and listing/search leakage. Write attempts are
   followed by a **database** assertion that the other tenant's row is untouched, because a route
   can refuse after having already written.
6. **It cannot run against the wrong database.** The runner refuses any `INTEGRATION_DATABASE_URL`
   whose database name does not contain "test". The suite deletes rows; getting that wrong once
   would be worse than having no isolation tests.
7. **Required in CI**, after the build, with its own Postgres database.

**An audit of the suite, and what it found in my own work.** A five-lens review of the suite
against the route inventory produced 33 candidate gaps. Its verification stage died on session
limits, so those remain **unverified claims** rather than findings — but several were obviously
right on inspection and were fixed:

- **Six tests asserted nothing.** They were wrapped in `if (res.status === 200) { ...check... }`
  with no `else`, so any other status made the body empty and the test passed — on 400, 429, 500,
  or a route that does not exist. Replaced with `expectFilteredOrDenied`, which demands either a
  filtered 200 or an explicit refusal and fails on anything else.
- **The `?orgId=` probe hit routes that ignore `orgId`.** `/api/teams` requires `projectId` or
  `workspaceId` and answered 400 — so the test passed while proving nothing. Each route is now
  probed with the parameter it actually reads.
- **The fixture was too thin to detect a leak.** Several listing routes scope by
  `workspace.members.some({ userId })`; with no `WorkspaceMember` rows every such listing returned
  `[]` for everyone, so the probe would have passed whether the guard worked or not. The fixture
  now creates workspace membership and teams, and the control case proves the probe reaches live
  code.

The remaining unverified claims — untested route families (workflows, webhooks, PBAC `?orgId=`,
project export/report egress, leaf-resource ids), and body-parameter attacks where the path is the
caller's own resource but a foreign id rides in the payload — are recorded as follow-up work below
rather than silently dropped.

**Acceptance criteria**
- [x] Two-org fixture, seeded and isolated per test run
- [x] Cross-tenant denial tests for the resource-scoped families the suite covers — **not** every
      family; see the follow-up list
- [x] IDOR, query-override and bulk paths covered
- [x] Runs in CI and fails the build on regression
- [x] Proof the tests can fail — see below

**"A test suite that cannot fail is not a test suite."** The planned proof was to break
`assertProjectAccess` deliberately and watch the suite go red. That edit was refused by a safety
classifier, correctly — it is a request to weaken a security control. The proof arrived by itself
instead, and is stronger: the suite **failed on a real defect** (the team-members leak, HTTP 200
with another tenant's email addresses), and went green only after the guard was added. It also
failed on three genuine weaknesses in its own assertions. Separately,
[`src/lib/__tests__/integration-harness.test.ts`](src/lib/__tests__/integration-harness.test.ts)
pins the assertion helpers themselves — that `expectDenied` rejects 200, 429, 500 and a redirect,
that `expectAllowed` rejects 403, that `expectBodyExcludes` finds a needle however deeply nested,
and that the database guard refuses the development URL. Those run on every `npm test`.

**Verified 2026-09-19**: `npm run test:integration` → **40 passed, 40 total**. Unit suite 219/219,
tsc 0, lint 0 errors.

**Re-verify with**:
```
INTEGRATION_DATABASE_URL=postgresql://…/something_test npm run test:integration
```

**Follow-up (unverified audit claims, worth triaging before launch)**
- Route families with no denial test: workflows/[id] and its statuses/transitions, webhooks,
  PBAC routes taking `?orgId=`, project `export` / `reports/download` / `import`, and the
  leaf-resource ids (epics/[id], components/[id], custom-fields/[id], automations/[id],
  subtasks/[id], comments/[id], attachments/[id]).
- Body-parameter attacks: `PATCH /api/issues/[id]` accepting a foreign `sprintId`/`epicId`/
  `teamId`; `PUT /api/sprints` reordering by body ids after authorizing on a different project;
  `POST /api/admin/cache/refresh` taking an arbitrary `orgId`.
- `GET /api/users/delegations?issueId=` was claimed to drop tenant scoping.
- `DELETE /api/issues/bulk` is untested while the PATCH sibling is covered.

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

Also note: the slowness reported during development was **not** a load problem. Confirm that
class of fan-out/N+1 bug is gone before load testing, or you will just be measuring application
bugs at scale.

> **Correction (2026-09-18)** — an earlier revision of this section stated the task-open
> waterfall was "fixed 2026-09-17". It was not. On 2026-09-18 opening a task still issued **ten**
> requests and cost **744 ms**; the 2026-09-17 work had added a client-side context cache, which
> hid the cost on repeat opens without removing it. The actual causes were write contention and
> duplicated auth, fixed in `9a899e4`. Recording this because it is the same over-claim pattern
> §8 warns about, and because it is the second time a performance item has been marked done
> while the underlying cost remained.

**Before load testing, do a data-volume pass instead** — it is cheaper and, at your current
scale, more likely to find something. The whole database is 460 rows, so nothing here has met
real data. Seed 10k–50k issues with proportionate comments and activity, then re-profile. The
specific prediction to test is B10: `GET /api/issues/[id]` has no `take` on `activityLogs`,
`comments`, `timeEntries` or `attachments`, so a long-lived issue's payload grows without bound.
Concurrency is not required to trigger that, and it will re-slow task open for a completely
different reason than the one just fixed.

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
| **Severity** | Medium → **raise to High if PROD-0 shipped without its CI check** |
| **Status** | PENDING |
| **Depends on** | PROD-1; PROD-0 lands the drift half of this |
| **Files** | `.github/workflows/ci.yml`, `DEPLOYMENT.md` |

**Why**: CI currently builds and tests but never proves a migration applies cleanly to a
**populated** database. Migrations are the highest-risk deploy step: they are hard to reverse and
they run against real customer data.

B9 is the proof that this gap is not theoretical: migrations drifted from the schema and no
check caught it, so the defect reached the point where it would have failed a production launch.
PROD-0 adds the drift check; this task adds the rest — applying to a *populated* database, and
the rollback policy.

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

### PROD-18 — Bound the unbounded relation loads

| | |
|---|---|
| **Severity** | High |
| **Status** | PENDING |
| **Depends on** | nothing, but only measurable with volume data (see PROD-8) |
| **Files** | `src/app/api/issues/[id]/route.ts`, `src/components/issues/IssueDetailModal.tsx` |
| **Found** | 2026-09-18 |

**Why** (B10): `GET /api/issues/[id]` loads `activityLogs`, `comments`, `timeEntries` and
`attachments` with **no `take`**. Today that is 19 activity rows and a 9.4 KB payload, so it does
not register. On an issue open for a year it is every row ever written, on the request that gates
the task modal opening.

This was deliberately **not** fixed during the 2026-09-18 performance work: adding a `take`
silently truncates visible history, which is a product decision, not an optimisation. It needs a
UI answer first.

**Do this**:
1. Decide the product behaviour per relation — most likely: newest N inline plus an explicit
   "load older" affordance. Comments and activity probably differ; attachments probably do not
   need paging at all.
2. Add `take` to match that decision, keeping the existing `orderBy` so "newest N" is what
   callers actually get.
3. Add the paging endpoint or cursor the UI needs, and use it — a `take` with no way to reach the
   rest is data loss from the user's point of view.
4. Re-profile against the volume dataset and record the payload size.

**Acceptance criteria**:
- [ ] No unbounded relation include remains in the issue-detail route
- [ ] Every truncated list is reachable in full through the UI
- [ ] Payload size measured on an issue with ≥1,000 activity rows, recorded here
- [ ] No feature regression in the task modal's activity, comments, time or attachment panels

**Verify**: seed an issue with 1,000+ activity rows; confirm bounded payload and that older
entries are still reachable.

---

### PROD-19 — Resolve the dependency CVEs

| | |
|---|---|
| **Severity** | High |
| **Status** | PENDING |
| **Depends on** | nothing, but schedule it away from Gate 0 work |
| **Files** | `package.json`, `package-lock.json` |

**Why** (B12): `npm audit --omit=dev` reports 1 high and 1 moderate, both postcss reached through
Next. The advisory range covers the installed version, and the only clean remedy is a **Next
major upgrade** (`next@16`), which also carries the React and build-pipeline changes that come
with it. This is why it has been deferred rather than patched.

**Do this**: upgrade Next deliberately on its own branch, not bundled with Gate 0 changes. Read
the Next 16 upgrade guide; expect churn in `next.config.ts` (the security headers and CSP block),
middleware, and any `params`/`searchParams` awaiting. Re-run the full gate set plus a manual pass
over the four flows in §2's performance baseline.

**Acceptance criteria**:
- [ ] `npm audit --omit=dev` reports 0 high and 0 moderate
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` all clean
- [ ] CSP and security headers verified still present on a response
- [ ] Sign-in, task open, Super Admin, sign-out re-tested manually

**Verify**: `npm audit --omit=dev && npm run build && npm test`

---

### PROD-20 — Production configuration and deployment runbook

| | |
|---|---|
| **Severity** | High |
| **Status** | PENDING |
| **Depends on** | PROD-1 (the DB URL changes), PROD-10 (secret source) |
| **Files** | `.env.example`, `DEPLOYMENT.md` |

**Why**: the boot guard in [`src/instrumentation.ts`](src/instrumentation.ts) currently reports
**2 settings that would fail a production boot** — `FIELD_ENCRYPTION_KEY` and `BASE_URL` — plus
the SQLite warning. That guard working is good news and needs no code change; what is missing is
the operational side. No environment has been stood up with a complete, valid configuration, so
the first real production boot would be the first time the full set is exercised.

Note `FIELD_ENCRYPTION_KEY` is not merely a missing string: setting it *after* data exists means
deciding what happens to already-unencrypted rows. Settle that before launch, not during it.

**Do this**: produce a complete production env matrix; stand up a staging environment that boots
with zero config warnings; document the `FIELD_ENCRYPTION_KEY` initialisation and rotation
procedure including existing-data handling; record the deploy and rollback steps.

**Acceptance criteria**:
- [ ] Staging boots with **no** entries in the "would FAIL a production boot" list and no warnings
- [ ] Every required variable documented in `.env.example` with generation instructions
- [ ] `FIELD_ENCRYPTION_KEY` initialisation *and* rotation documented, incl. existing rows
- [ ] Deploy + rollback runbook in `DEPLOYMENT.md`, walked through once end to end

**Verify**: boot staging, confirm the config banner is clean.

---

## Gate 2 — Post-Launch / Maintainability

These do not block launch. They are the cost of changing the system safely later.

| ID | Task | Why | Files |
|---|---|---|---|
| **PROD-13** | Decompose `IssueDetailModal` | 4,466 lines in one component — every change risks the whole task UI, and it resisted a simple dropdown edit in practice | `src/components/issues/IssueDetailModal.tsx` |
| **PROD-14** | Upgrade Prisma 5.22 → 6.x | Staying current on the data layer; do it deliberately, not under pressure | `package.json`, `prisma/` |
| **PROD-15** | Service layer between routes and Prisma | Already filed as ARCH-3 and explicitly deferred. Revisit only after Gate 0/1 — it touches all 121 routes | `src/lib/`, `src/app/api/` |
| **PROD-16** | Coverage thresholds in CI | Stops coverage silently decaying once PROD-5/6 exist | `jest.config.js`, CI |
| **PROD-17** | Decompose remaining large views | `AnalyticsChartsView`, `ScrumBacklogView`, `CalendarView`, `WorkloadView` are all >2,400 lines | `src/components/views/` |
| **PROD-21** | Delete or adopt `design-system.ts` | 241 lines with **zero importers** — written during the white-theme work and never wired up. Its light-only tokens are also the last remaining hits in the dark-theme audit, so leaving it invites someone to apply it and regress the dark theme | `src/components/admin/design-system.ts` |
| **PROD-22** | Consolidate the duplicated default lists | `DEFAULT_PRIORITIES` exists in `src/lib/designSystem.ts` and `src/components/views/ListView.tsx` as well as the new single source in `src/lib/project-context.ts`. The issue-type/priority lists have already drifted across copies once and caused a user-visible bug | `src/lib/project-context.ts`, `src/lib/designSystem.ts`, `src/components/views/ListView.tsx` |
| **PROD-23** | Generate the inert notification preference types | 7 of 10 notification preference types are never produced by any code path, so the settings UI offers toggles that do nothing | `src/lib/notifications*`, notification preference UI |

---

## 7. Task Dependency Order

Do them in this order. Parallel tracks are marked.

```
PROD-0  Migration drift .............. DONE 2026-09-18 (0007_repair_schema_drift)
   │
PROD-1  Postgres ..................... DONE 2026-09-18
   │
PROD-5  Tenant-isolation tests ....... START HERE now (highest risk reduction)
PROD-1  Postgres ..................... then this (unblocks almost everything)
   │
   ├── PROD-2  Shared rate limiting  (both limiters; re-key off raw IP)
   │      ├── PROD-3  Shared cache + move PBAC store into the DB
   │      └── PROD-4  Cross-instance SSE fan-out
   │
   ├── PROD-5  Tenant-isolation tests   (highest risk-reduction per hour)
   │      └── PROD-6  PBAC / authz tests
   │
   ├── PROD-9  Backup + restore drill
   └── PROD-11 Migration safety in CI   (PROD-0 lands the drift check; this adds the rest)

PROD-7  Monitoring ................... parallel, no dependencies
PROD-10 Secrets ...................... parallel, no dependencies
PROD-12 Bundle budget ................ parallel, no dependencies
PROD-19 Dependency CVEs .............. parallel, but on its own branch

────────── Gate 0 complete ⇒ multi-tenant production is viable ──────────

PROD-18 Bound relation loads ......... needs volume data
PROD-8  Load testing ................. ONLY after PROD-1/2/3/4, and after PROD-18
PROD-20 Prod config + runbook ........ after PROD-1/PROD-10

PROD-13..17, 21..23 .................. after launch
```

**If you only have time for one thing**: PROD-0. It is the cheapest item here and the only one
that breaks a deployment before it serves its first request.

**If you have time for three**: PROD-0, then PROD-1 (Postgres) and PROD-5 (tenant-isolation
tests). The first removes the hard scaling ceiling; the second protects against the failure that
would actually end the business.

### Rough sequencing for multi-tenant paid production

Order is firm; the durations are planning estimates, not commitments — PROD-1 and PROD-5 in
particular depend on how much SQLite-ism the schema turns out to hold.

| Stage | Items | Gets you |
|---|---|---|
| ~~1~~ | ~~PROD-0~~ ✅ **done 2026-09-18** | a deployable build |
| 2 | PROD-1 | a database that can back more than one instance |
| 3 | PROD-2, 3, 4 | correctness with >1 instance running |
| 4 | PROD-5, 6 | protection against cross-tenant and privilege-escalation regressions |
| 5 | PROD-7, 10, 20 | the ability to operate it and see failures |
| 6 | PROD-18, 8, 9, 11, 12, 19 | evidence it holds under real data and traffic |

Stages 1–4 are Gate 0 and are not negotiable for paid multi-tenant use. Stage 5 is what makes the
difference between running a service and guessing. Stage 6 is where a load test finally means
something — see PROD-8 on why it is last and not first.

---

## 8. Verification Protocol

Because the trackers have over-claimed before, verify rather than trust. Cheap checks:

```bash
# Do the migrations actually reproduce the schema? (PROD-0)
# `migrate status` does NOT answer this -- it only checks the local DB. Use diff:
npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "file:./_shadow.db"   # must report no difference

# Is it really Postgres yet?
grep -A2 'datasource' prisma/schema.prisma

# Is state really shared, or still a process-local Map?
grep -rn 'new Map(' src/lib/rate-limit.ts src/lib/cache-manager.ts \
  src/lib/sync-engine.ts src/lib/pbac-engine.ts src/middleware.ts

# Is authorization state still on one instance's disk? (B13)
ls -la .data/pbac-store.json 2>/dev/null && echo "PBAC still file-backed"

# Is there an external store at all?
grep -rn 'redis\|ioredis\|upstash' package.json src/lib/

# Do authorization tests actually exist?
grep -rln 'assertProjectAccess\|assertOrgAccess\|crossTenant' __tests__ src/lib/__tests__

# What do the tests really cover?
npx jest --listTests

# Are the relation loads still unbounded? (B10)
grep -c 'take:' 'src/app/api/issues/[id]/route.ts'

# Known CVEs
npm audit --omit=dev

# Baseline gates
npx tsc --noEmit && npm run lint && npm test
```

> **On green status commands**: PROD-0 exists because `prisma migrate status` printed
> "Database schema is up to date!" while the migrations were missing two tables the app needs at
> runtime. The command was not lying — it answers a narrower question than it appears to. When a
> check passes, confirm it is checking the thing you care about.

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
4. **Follow existing patterns.** Keep public function signatures stable so the 121 routes need no
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
| 2026-09-18 | Claude Opus 5 (1M context) | Re-baselined for multi-tenant paid production. **Added PROD-0** (migration drift — migrations omit `OtpCode`/`Invitation`, breaking OTP login and invitations on any fresh database; found via `migrate diff`, verified). Added PROD-18 (unbounded relation loads), PROD-19 (dependency CVEs), PROD-20 (production config + runbook), and PROD-21..23 to Gate 2. Added measured problems B9–B14. Added a performance baseline for the four flows and a readiness estimate. **Corrected PROD-8**: the task-open waterfall it recorded as fixed on 2026-09-17 was still costing 744 ms on 2026-09-18 — the earlier work cached the cost rather than removing it. Sharpened PROD-1 (WAL does not lift the multi-instance ceiling), PROD-2 (two limiters; per-IP keying breaks teams behind NAT), PROD-3 (PBAC is file-backed split-brain, not a cache problem). Gate 0 is now **8 items, 0 complete**. |
| 2026-09-18 | Claude Opus 5 (1M context) | **PROD-0 CLOSED** — `prisma/migrations/0007_repair_schema_drift`. `migrate diff` now reports "No difference detected", and a database built only by `migrate deploy` contains `OtpCode`, `Invitation` and their indexes. Both previously-broken features were exercised against that migrations-only database (**12/12**: OTP issue/verify/single-use, invitation create/lookup-by-token-hash/unique-hash/accept/orgId FK, plus the data-retention queries). Nothing destructive — the `SystemEmailConfig` rebuild exists only because its `senderName` default changed at the rebrand, and the `INSERT...SELECT` copies every column. Added two CI steps: a schema-drift check, **proved able to fail** (a throwaway model makes `migrate diff --exit-code` exit 2; a clean tree exits 0), and a `migrate deploy` onto a **seeded** database, because applying to an empty one proves less. Gate 0 is now **1 of 8**. |
