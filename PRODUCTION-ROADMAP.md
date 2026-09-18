# Eitekh WorkOS — Production Roadmap to a Jira-Class Standard

> **Status**: **PLAN ONLY — AWAITING APPROVAL. No code has been changed for this document.**
> **Created**: 2026-09-18 by Claude Opus 5 (1M context)
> **Audience**: engineers and AI sessions who will execute the work, task by task.
> **Branch**: `security/phase-1-critical-fixes`

---

## Table of Contents

- [0. How to read this](#0-how-to-read-this)
- [Which document owns what](#which-document-owns-what)
- [Audit findings behind this plan](#audit-findings-behind-this-plan)
- [Priority definitions](#priority-definitions)
- [Phase 1 — System Audit](#phase-1--system-audit)
- [Phase 2 — Security](#phase-2--security)
- [Phase 3 — Core Functionality](#phase-3--core-functionality)
- [Phase 4 — Communication](#phase-4--communication)
- [Phase 5 — Performance](#phase-5--performance)
- [Phase 6 — Reliability](#phase-6--reliability)
- [Phase 7 — Productivity](#phase-7--productivity)
- [Phase 8 — UX / Polish](#phase-8--ux--polish)
- [Phase 9 — Testing](#phase-9--testing)
- [Phase 10 — Production Readiness](#phase-10--production-readiness)
- [Cross-phase dependency graph](#cross-phase-dependency-graph)
- [Recommended execution order](#recommended-execution-order)
- [What I need decided before starting](#what-i-need-decided-before-starting)

---

## 0. How to read this

"Jira-class professional standard" is read here as four distinct claims, because they fail
independently and are fixed by different work:

1. **It does not lose or leak data.** Tenant isolation, authorization, concurrency, durability.
2. **It stays correct and fast as data grows.** Not "fast on 5 issues" — fast on 50,000.
3. **It has the features a team actually reaches for daily.** Saved filters, bulk edit, search
   that finds things, keyboard-first navigation, releases.
4. **It can be operated.** Deployed repeatably, observed, backed up, restored.

The product is already feature-rich: **45 data models**, **121 API routes**, 8 view surfaces,
workflows with transitions, PBAC, automation rules, webhooks, SSE, custom fields, delegation and
leave management. This roadmap is mostly *not* about adding features. It is about the four
claims above — and the largest single gap is (2) and (4), not (3).

**Nothing in this document has been implemented.** Items marked as already fixed are cited only
to avoid re-doing them.

---

## Which document owns what

Six planning documents already exist. This one is the **master sequencing plan**; it does not
duplicate the others, it points into them. Where an item already has a full spec elsewhere, the
task here references the ID rather than restating it.

| Document | Owns | Relationship to this roadmap |
|---|---|---|
| [`PRODUCTION-ROADMAP.md`](PRODUCTION-ROADMAP.md) *(this file)* | End-to-end phased plan to a Jira-class standard | Master. Sequences everything below. |
| [`PRODUCTION-READINESS.md`](PRODUCTION-READINESS.md) | Infrastructure blockers: PROD-0…23, Gates 0/1/2 | **Authoritative** for those IDs. Phases 1, 2, 5, 9, 10 reference them. |
| [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md) | 73 security findings, point-in-time | Phase 2 sources from it. |
| [`PERFORMANCE-PLAN.md`](PERFORMANCE-PLAN.md) | PERF-P1…P7, Gate A | Phase 5 sources from it. |
| [`AI-STATUS.md`](AI-STATUS.md) | Live task queue + session log | Update as work lands. Queue order follows this roadmap. |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Deploy steps | Phase 10 rewrites it. |

> **Do not** open a new tracker. Seven documents is already past the point where they drift —
> and they have drifted before (see `PRODUCTION-READINESS.md` §1, and the PROD-8 correction).

---

## Audit findings behind this plan

Inspected 2026-09-18 by reading the repo and querying the live system. **F-numbers are new
findings from this audit**; `B`/`PROD`/`PERF` IDs already exist in the other documents.

### New findings

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| **F1** | **P0** | **Attachments are stored as base64 data URLs inside the database.** There is no upload endpoint and no object storage. The client `FileReader`s the file and POSTs a `data:` URL, which is written to `Attachment.fileUrl`. A 15 MB file becomes ~20 MB of base64 in a DB column. Worse, `GET /api/issues/[id]` includes `attachments` with **no `take` and no field exclusion**, so **every** task open re-downloads every attachment in full. A handful of screenshots makes task open catastrophic, and can exceed request/response body limits. | `fileUrl: base64Data` at [`IssueDetailModal.tsx:1255`](src/components/issues/IssueDetailModal.tsx); `model Attachment { fileUrl String }` in `prisma/schema.prisma`; no `formData()`/multipart handler anywhere under `src/app/api`; 15 MB client-side cap only |
| **F2** | **P0** | **No optimistic locking on `Issue`.** The model has `updatedAt` but no version column, and no route compares a client-supplied version before writing. Two users editing the same issue silently overwrite each other — last write wins, no warning, no conflict. Jira has had this since forever; for a collaboration tool it is data loss. | `sed -n '/^model Issue/,/^}/p' prisma/schema.prisma` → no `version`; no `If-Match`/version check in any route |
| **F3** | **P1** | **Saved filters do not exist.** No `SavedFilter` model, no API, no UI. Explicitly requested in Phase 7 scope. | no `model SavedFilter` in schema; no route family under `src/app/api` |
| **F4** | **P1** | **Search is `contains`-only across 3 entity types.** No query language, no field scoping, no ranking, no index, no pagination beyond a `limit`. Adequate for 5 issues; not a search feature. | [`src/app/api/search/route.ts`](src/app/api/search/route.ts) — `title/description/issueKey: { contains: q }` |
| **F5** | **P1** | **Case-insensitive search will silently break on the Postgres migration.** It works *today* only because SQLite's `LIKE` is ASCII-case-insensitive — verified live: `contains "Implement"`, `"implement"` and `"IMPLEMENT"` all return the same hit. Prisma on Postgres is case-**sensitive** unless `mode: "insensitive"` is set, which SQLite does not support. So PROD-1 turns working search into broken search with no error and no failing test. | live probe against `prisma/dev.db`; Prisma SQLite connector does not accept `mode` |
| **F6** | **P1** | **No `Version` / `Release` model.** No fix-versions, no release grouping, no "unreleased/released" reporting. A standard Jira concept and a common reason teams cannot adopt a tracker. | absent from the 45-model inventory |
| **F7** | **P1** | **8 mutating routes have no input validation.** 82 of 121 routes use the `parseBody`/`parseJsonBody`/`parseQuery` helpers; 8 routes with `POST`/`PATCH`/`PUT` use none. | `for f in $(grep -rl 'export async function \(POST\|PATCH\|PUT\)' src/app/api --include=route.ts); do grep -q 'parseBody\|parseJsonBody\|safeParse' "$f" \|\| echo "$f"; done` |
| **F8** | **P2** | **Dashboards and boards are not entities.** `DashboardView` (1,921 lines) renders a fixed layout; there is no per-user configurable dashboard, no gadget model, no multiple boards per project with their own filters/columns. | no `model Dashboard` / `model Board` |
| **F9** | **P2** | **Accessibility is thin and unmeasured.** 93 `aria-*` attributes and 40 `role=` across a ~15,600-line view layer plus the admin surface. No automated a11y check in CI. A keyboard-shortcut surface exists (`CommandPalette`) but there is no discoverable shortcut help. | `grep -rho 'aria-[a-z]*' src --include=*.tsx \| wc -l` → 93 |
| **F10** | **P2** | **Desktop-first responsive posture, unverified on mobile.** Breakpoint usage skews hard to `sm:` (274) over `lg:` (64), and no viewport testing exists. The main work surfaces are dense tables and boards. | breakpoint counts across `src/**/*.tsx` |
| **F11** | **P2** | **Only two error boundaries** (`src/app/error.tsx`, `src/app/projects/[id]/error.tsx`) and no `global-error.tsx`. A render error in a view takes out the page with no recovery path. | `find src/app -name 'error.tsx' -o -name 'global-error.tsx'` |

### Inherited findings this roadmap sequences

Full specs live in `PRODUCTION-READINESS.md`. Summarised here only so the phases below read
coherently.

| ID | Severity | One line |
|---|---|---|
| PROD-0 / B9 | **P0** | Migrations do not reproduce the schema — a fresh `migrate deploy` omits `OtpCode` and `Invitation`; OTP login and invitations fail on any new database. |
| PROD-1 / B1 | **P0** | SQLite: one writer, file-local. Cannot back more than one instance. |
| PROD-2 / B2, B11, B14 | **P0** | Two in-process rate limiters; general limit keyed per IP, so one NAT shares a 100/min budget. |
| PROD-3 / B3, B13 | **P0** | Cache in-process; **PBAC roles and assignments live in `.data/pbac-store.json` on one instance's disk** — split-brain authorization across instances. |
| PROD-4 / B4 | **P0** | SSE registry in-process: an event on instance A never reaches a client on instance B. |
| PROD-5, PROD-6 / B5 | **P0** | **Zero** tenant-isolation or authorization tests. All 74 tests are library-level. |
| PROD-7 / B6 | **P0** | Logs go to `console.*` only. No sink, no alerting. |
| PROD-18 / B10 | **P1** | `GET /api/issues/[id]` has no `take` on `activityLogs`, `comments`, `timeEntries`, `attachments`. |
| PROD-19 / B12 | **P1** | 1 high + 1 moderate CVE (postcss via Next); needs a Next major upgrade. |
| PERF-P1…P6 | **P1** | Project page loads every issue (capped at 200) with nested relations; analytics filters in JS; 65 of 93 `findMany` lack `take`; 310 kB First Load JS; polling; N+1 write loops. |

### What is genuinely solid — do not "fix" these

Verified this session: TypeScript clean · lint 0 errors · 74/74 tests · task open ~90 ms after
`9a899e4` · session revocation enforced on every request · CSRF origin check · login rate
limiting · SSRF guard on webhooks · security headers + CSP · boot-time config guard that refuses
a bad production start · `@dnd-kit` drag-and-drop on Kanban/Backlog/Calendar/Workload ·
workflows with transitions · automation engine with cascade-depth limits · PBAC engine.

---

## Priority definitions

| Priority | Meaning | Rule |
|---|---|---|
| **P0** | Data loss, data leakage, or cannot deploy | Blocks any paid multi-tenant launch. No exceptions. |
| **P1** | Breaks at real scale, or a daily-use gap a Jira-class buyer will reject | Blocks general availability. |
| **P2** | Quality, polish, operability improvement | Post-GA, scheduled. |
| **P3** | Nice to have | Backlog. |

A phase is **not complete** until every P0 and P1 in it meets its acceptance criteria *and* the
verification command was run. Follow the "Rules for marking a task COMPLETED" in
`PRODUCTION-READINESS.md` §8 — in particular, multi-instance items must be tested with two
instances actually running, and test tasks must be proven able to fail.

---

## Phase 1 — System Audit

**Priority: P0 (gate for everything else) · Dependencies: none**

Most of this audit is done — this roadmap is its output. What remains is the part that cannot be
answered by reading code.

### Problems to investigate

- **Does the schema survive translation to Postgres?** Audit all 45 models for SQLite-isms:
  `String` columns used as enums, missing `@db.Text` on long fields, `DateTime` precision, and
  every `$queryRaw`/`$executeRaw` for SQLite-only syntax (the WAL pragma block in
  [`src/lib/prisma.ts`](src/lib/prisma.ts) is one, and must be deleted with PROD-1).
- **Which of the 121 routes are actually reachable and used?** Route families are lopsided:
  24 under `super-admin` vs 9 under `issues`. Identify dead endpoints before securing and
  testing them — testing dead code is waste.
- **What is the real data-volume profile?** The entire database is 460 rows. Nothing here has
  met production data, so no performance claim is currently meaningful.
- **Where does authorization actually get enforced?** 57 routes call `getCurrentUser()` *and* a
  tenant assert; confirm no route relies on only one, and that none relies on client-supplied
  `orgId`/`projectId` without an assert.
- **F5 class of risk**: what else silently depends on SQLite semantics? Case-insensitive `LIKE`
  is one confirmed instance. Look for others (collation, `ORDER BY` on mixed case, integer
  division, date handling).

### Implementation tasks

1. **A1** — Schema portability audit. Produce a per-model list of required changes for Postgres.
2. **A2** — Route inventory: path, methods, auth gate, validation status, last-used. Mark dead
   routes for deletion.
3. **A3** — Seed a realistic dataset: 3 orgs, ~50 projects, 20k–50k issues with proportionate
   comments, activity, attachments, sprints. **This is a prerequisite for Phases 5 and 9** — make
   it a committed, repeatable script, not a one-off.
4. **A4** — Dependency review: 18 production dependencies. Confirm each is maintained, and record
   the Next 16 upgrade blast radius (PROD-19).
5. **A5** — Data-flow map for the four critical paths: auth, issue read/write, realtime fan-out,
   email send. One diagram each, checked into the repo.
6. **A6** — SQLite-semantics dependency list (F5 and siblings), each with the Postgres equivalent.

### Testing / acceptance criteria

- [ ] A2 inventory covers all 121 routes; every route classified `keep` / `delete` / `needs-auth` / `needs-validation`
- [ ] A3 seed script runs from empty to 20k+ issues reproducibly, and is committed
- [ ] A1 lists every model needing change, with the specific change
- [ ] A6 lists every SQLite-semantics dependency with its Postgres replacement, F5 included
- [ ] Baseline re-measured on the A3 dataset and recorded in `PRODUCTION-READINESS.md` §2

### Expected outcome

A complete, evidence-backed picture of what ships, what is dead, and what breaks on Postgres —
plus the volume dataset every later phase depends on. **No behaviour changes in this phase.**

---

## Phase 2 — Security

**Priority: P0 · Dependencies: Phase 1 (A2 route inventory); PROD-1 for the test harness**

### Problems to investigate

- **PBAC split-brain (B13).** Roles and assignments are in-memory `Map`s persisted to
  `.data/pbac-store.json`. Two instances hold two divergent authorization models, each writing
  its own file. This is not a caching problem — a role created on instance A may not exist on
  instance B. It must move into the database.
- **Zero authorization tests (B5).** `pbac-engine.ts` is ~2,254 lines with no tests. A privilege
  escalation bug (PBAC-1) and a stale-cache bug (PBAC-2) were both filed and fixed; nothing would
  catch their return.
- **Cross-tenant reachability.** Which routes accept a caller-supplied id and resolve it without
  an org check? Priorities: direct-ID (IDOR) access, `?projectId=` overrides, bulk endpoints
  (`/api/issues/bulk`, `/api/projects/[id]/members/bulk`), nested resources.
- **Unvalidated mutating routes (F7).** 8 routes take a body with no schema. Each is an injection
  and type-confusion surface.
- **Rate limiting as a security control (B11/B14).** Per-IP keying means an office NAT shares one
  budget; two separate in-process stores mean N instances give N× the limit.
- **Attachment content (F1).** Base64 blobs in the DB are stored and re-served with no virus
  scan, no content sniffing beyond a MIME allowlist, and rendered via `src={att.fileUrl}` — audit
  the stored-XSS surface for `image/svg+xml` and `text/html` MIME values.

### Implementation tasks

1. **S1 (P0)** — Move the PBAC store into the database; keep the in-memory `Map` as a
   read-through cache with global invalidation. Migrate existing `.data/pbac-store.json` contents;
   do not drop them. *(= PROD-3, PBAC half)*
2. **S2 (P0)** — Tenant-isolation integration tests: two-org fixture; for every resource-scoped
   route family, assert User A requesting an Org B resource gets 403/404 and never Org B's data.
   Cover IDOR, query-override and bulk paths. *(= PROD-5)*
3. **S3 (P0)** — Authorization/PBAC route tests: one user per role; assert the hierarchy holds
   and no role can assume a level above itself; `VIEWER` denied on all mutating routes; cache
   invalidation timing asserted. *(= PROD-6)*
4. **S4 (P0)** — Add Zod schemas to the 8 unvalidated mutating routes (F7); add a CI check that
   fails when a mutating route has no schema, so this cannot regress.
5. **S5 (P0)** — Shared, atomic rate limiting; re-key authenticated traffic per user/session and
   keep IP keying only for unauthenticated routes. Fail **closed** for auth routes. *(= PROD-2)*
6. **S6 (P1)** — Attachment content security, with Phase 3 **C1**: enforce the MIME allowlist
   server-side, serve from object storage with `Content-Disposition: attachment` and a
   non-executing origin, and reject SVG/HTML or sanitise them.
7. **S7 (P1)** — Re-verify the `SECURITY-AUDIT.md` findings marked resolved. That tracker has
   over-claimed before; spot-check at least every Critical and High.

### Testing / acceptance criteria

- [ ] No authorization state in `.data/pbac-store.json`; a role created on instance A exists on instance B
- [ ] Cross-tenant suite covers every resource-scoped route family and **fails** when `assertProjectAccess` is deliberately broken
- [ ] Escalation denied for every role pair; `VIEWER` denied on all mutating routes
- [ ] 0 mutating routes without a validation schema; CI enforces it
- [ ] Two instances share one rate-limit budget; two users behind one IP do not consume each other's
- [ ] An uploaded SVG containing a script does not execute when previewed or downloaded
- [ ] Both suites run in CI as required jobs

### Expected outcome

Authorization is consistent across instances, enforced in the database, and **provably** correct
— the cross-tenant and escalation failures become test failures instead of incidents.

---

## Phase 3 — Core Functionality

**Priority: P0 for F1/F2, P1–P2 for parity gaps · Dependencies: Phase 1 (A3 dataset); PROD-1 for storage/schema work**

The feature surface is broad already: issues, subtasks, dependencies, epics, sprints, components,
labels, custom fields, watchers, comments, time entries, activity log, workflows with transitions,
plus Kanban, List, Backlog, Timeline, Calendar, Workload, Dashboard and Analytics views. The gaps
are in **durability and collaboration correctness**, not breadth.

### Problems to investigate

- **F1 — attachments as base64 in the database.** The single worst data-layer decision in the
  codebase. It inflates every row, defeats caching, re-downloads every attachment on every task
  open, and has no path to a CDN. Needs real object storage and a true upload endpoint.
- **F2 — no optimistic locking.** Two users editing one issue silently overwrite each other. Also
  check the same exposure on comments, sprints, workflow edits and custom-field option lists.
- **F6 — no `Version`/`Release`.** No fix-version field, no release view, no
  released/unreleased reporting.
- **F8 — dashboards and boards are not entities.** One fixed dashboard layout; one implicit board
  per project. Jira-class teams expect several boards per project with independent filters and
  columns, and a dashboard they can arrange.
- **Workflow enforcement.** `WorkflowTransition` exists — is it *enforced* on status change, or
  is any status reachable from any status? If unenforced, the workflow feature is decorative.
- **View correctness at volume.** All 8 views were built against 5 issues. Verify List sorting
  and column config, Kanban column limits, Backlog ordering stability, Timeline date maths across
  DST and timezones, Calendar recurrence.
- **Issue keys under concurrency.** How is `keyNumber` allocated? Two simultaneous creates in one
  project must not collide — check for a race and a unique constraint.

### Implementation tasks

1. **C1 (P0)** — Real attachment storage. Add a multipart upload endpoint; store objects in S3 or
   equivalent; keep only metadata plus a key in `Attachment`; serve via signed, expiring URLs;
   enforce size and MIME server-side; write a migration for existing base64 rows. Pair with
   **S6** and **PROD-18**.
2. **C2 (P0)** — Optimistic locking on `Issue` (and the entities in the investigation list): add
   a version column, return it on read, require it on write, respond `409` with both versions on
   mismatch, and surface a real conflict UI — not a silent reload.
3. **C3 (P1)** — Enforce workflow transitions server-side; reject an illegal status change with a
   clear error naming the allowed targets.
4. **C4 (P1)** — Verify/fix issue-key allocation under concurrent creates; add a unique
   constraint on `(projectId, keyNumber)` and a concurrency test.
5. **C5 (P1)** — `Version`/`Release`: model, fix-version field on issues, release view,
   released/unreleased reporting, and release notes generation from issues.
6. **C6 (P1)** — Harden all 8 views against the A3 dataset: server-side pagination, sorting and
   filtering; stable ordering; no client-side full-dataset passes.
7. **C7 (P2)** — Multiple boards per project (`Board` model: filter, column mapping, swimlanes).
8. **C8 (P2)** — Configurable dashboards (`Dashboard` + gadget models, per-user layout).
9. **C9 (P2)** — Collaboration polish: issue cloning, move between projects, bulk transition,
   richer issue-link types beyond the current dependency pair.

### Testing / acceptance criteria

- [ ] No `data:` URL is ever written to the database; existing rows migrated; task open payload independent of attachment count and size
- [ ] Two concurrent edits to one issue: the second gets `409`, no field is silently lost, and the UI offers a real resolution
- [ ] An illegal workflow transition is rejected server-side
- [ ] 100 concurrent issue creates in one project produce 100 distinct keys
- [ ] Every view renders and paginates correctly on the 20k-issue dataset, with no full-table client scan
- [ ] A release can be created, issues assigned, and released/unreleased reported
- [ ] Full regression pass over issues, projects, sprints and all 8 views

### Expected outcome

Collaboration stops losing work: attachments live in real storage, concurrent edits are detected
rather than silently dropped, workflows are enforced, and every view behaves at production
volume.

---

## Phase 4 — Communication

**Priority: P1 (P0 for the multi-instance SSE defect) · Dependencies: PROD-4; Phase 10 for deliverability**

### Problems to investigate

- **SSE is single-instance (B4/PROD-4).** `syncEngine.clients` is a process-local `Map`. Behind a
  load balancer, realtime silently works or does not depending on which instance each user
  landed on — and it will look perfect in single-instance testing.
- **Do proxies survive SSE?** Many hosts buffer or time out streaming responses. Unverified for
  the target platform.
- **Email deliverability.** Transport is `nodemailer` over SMTP with credentials from
  `SystemEmailConfig`/env. Nothing establishes SPF/DKIM/DMARC, bounce handling, retry with
  backoff, or suppression. `EmailLog` exists; failures are recorded — is anything alerted?
- **Notification completeness.** Earlier work recorded that **7 of 10 notification preference
  types are never generated** — the settings UI offers toggles that do nothing. Confirm and close.
- **Notification fan-out cost.** `publishUserEvent` matches an exact `userId`; check that a
  watcher list of hundreds does not produce an N+1 write storm per issue update.
- **Digests and noise control.** No batching or digest option; a busy project will generate
  unacceptable email volume and get the domain marked as spam.

### Implementation tasks

1. **M1 (P0)** — Cross-instance SSE via Redis pub/sub; keep the local `Map` as the per-instance
   registry; ensure disconnect tears down both. *(= PROD-4)*
2. **M2 (P1)** — Document and test streaming behaviour on the target host; set
   `X-Accel-Buffering: no` where relevant; implement client reconnect with backoff and
   missed-event catch-up.
3. **M3 (P1)** — Generate the 7 inert notification types, or remove their toggles. A control that
   does nothing is worse than an absent one. *(= PROD-23)*
4. **M4 (P1)** — Email reliability: retry with exponential backoff, a durable outbox, bounce and
   complaint handling, suppression list, and alerting on failure rate. Build on `EmailLog`.
5. **M5 (P1)** — Deliverability: SPF, DKIM, DMARC documented and verified for the sending domain;
   sender identity separated from SMTP credentials.
6. **M6 (P2)** — Notification batching and digests; per-project mute; `@mention`-only mode.
7. **M7 (P2)** — Verify every email template renders in the major clients, in both themes, with a
   plain-text alternative.

### Testing / acceptance criteria

- [ ] Event published on instance A reaches a client connected to instance B
- [ ] SSE survives ≥30 min through the production proxy; client reconnects and catches up after a forced drop
- [ ] No unbounded subscription growth over a 2-hour soak
- [ ] All 10 notification types either generate or have their toggle removed
- [ ] A forced SMTP failure retries, lands in the outbox, and alerts; a bounce adds to the suppression list
- [ ] SPF/DKIM/DMARC pass an external check
- [ ] An issue with 200 watchers produces one notification each, without an N+1 write storm

### Expected outcome

Realtime works regardless of instance count, and email is a reliable, deliverable, observable
channel rather than a best-effort `sendMail` call.

---

## Phase 5 — Performance

**Priority: P1 (P0 for PROD-1) · Dependencies: Phase 1 A3 dataset — mandatory**

> **Do not start this phase without the A3 dataset.** The database is 460 rows. The 2026-09-18
> work already demonstrated the trap: the 20-relation issue-detail query runs in **10 ms**, so
> every "slow query" hypothesis was wrong and the real causes were write contention and request
> fan-out. At 5 issues, *every* finding in `PERFORMANCE-PLAN.md` is invisible.

### Problems to investigate

- **PROD-18 / B10** — `GET /api/issues/[id]` has no `take` on `activityLogs`, `comments`,
  `timeEntries`, `attachments`. Deliberately not fixed on 2026-09-18 because capping truncates
  visible history — it needs the UI decision in **C1/PROD-18**, not a blind limit.
- **PERF-P1** — the project page loads up to 200 issues with nested relations server-side while
  its own paginated API exists and is bypassed.
- **PERF-P3** — 65 of 93 `findMany` calls have no `take`.
- **PERF-P2** — analytics loads all issues into memory then makes ~20 JS `.filter()` passes;
  should be `groupBy`/`count`.
- **PERF-P4** — `/projects/[id]` ships 310 kB First Load JS; the four heavy views are 2,400–2,990
  lines each and all load eagerly.
- **PERF-P5** — polling: super-admin every 15 s, notifications every 30 s site-wide, neither
  paused on hidden tabs. (The per-tick payload dropped ~68% on 2026-09-18; the intervals are
  unchanged.)
- **PERF-P6** — N+1 write loops (`await` inside `for`).
- **Index coverage** — verify indexes against the *actual* query shapes once the A3 dataset
  exists, rather than guessing.
- **Connection pool** — `N_instances × pool_size` must stay under Postgres `max_connections`. A
  common and avoidable outage.

### Implementation tasks

1. **P1 (P0)** — PostgreSQL migration. *(= PROD-1)* Includes deleting the SQLite pragma block in
   `src/lib/prisma.ts` and fixing every item on the Phase 1 A6 list — **F5 in particular, or
   search regresses to case-sensitive silently.**
2. **P2 (P1)** — Bound every unbounded relation load and `findMany`, with pagination the UI
   actually uses. *(= PROD-18, PERF-P3)*
3. **P3 (P1)** — Move the project page onto its own paginated API; stop loading issues in the
   server component. *(= PERF-P1)*
4. **P4 (P1)** — Push analytics aggregation into SQL. *(= PERF-P2)*
5. **P5 (P1)** — Code-split the four heavy views; set a CI bundle budget. *(= PERF-P4, PROD-12)*
6. **P6 (P2)** — Replace polling with the existing SSE; pause on hidden tabs. *(= PERF-P5)*
7. **P7 (P2)** — Batch the N+1 write loops. *(= PERF-P6)*
8. **P8 (P1)** — Index review against real query shapes; document the pool maths.
9. **P9 (P1)** — Load and soak testing — **last, not first**. *(= PROD-8)*

### Testing / acceptance criteria

- [ ] All targets measured on the 20k-issue dataset, before and after, recorded
- [ ] Task-open payload independent of attachment count, comment count and issue age
- [ ] p95 < 500 ms for board load, issue CRUD, search and analytics at the agreed concurrency
- [ ] `/projects/[id]` First Load JS < 200 kB, enforced in CI
- [ ] 2-hour soak: flat memory, no connection-pool exhaustion, no SSE leak
- [ ] **Search is still case-insensitive after the Postgres migration** — regression test for F5
- [ ] Pool maths documented against `max_connections`

### Expected outcome

Performance is characterised on production-like data with a known ceiling, and the scaling
ceiling itself is removed. No more optimising against a 460-row database.

---

## Phase 6 — Reliability

**Priority: P1 · Dependencies: Phase 3 C2 (locking); PROD-7 for error visibility**

### Problems to investigate

- **Automation engine.** `runAutomations` has `MAX_CASCADE_DEPTH = 3` and a fired-rule set, which
  is good. Open questions: what happens when an action fails mid-rule — partial application? Are
  runs idempotent under retry? Is there an execution log an admin can inspect?
- **Webhooks.** `isWebhookTargetAllowed` (SSRF guard), a 10 s timeout and `redirect: "manual"`
  are in place. Missing: retry with backoff, a dead-letter path, delivery history, HMAC
  signatures so receivers can verify authenticity, and per-endpoint circuit breaking.
- **Concurrency beyond F2.** Sprint start/complete, bulk operations and workflow edits are
  multi-step; are they transactional? A failure halfway through a bulk import or sprint close
  must not leave a half-applied state.
- **Validation (F7).** 8 mutating routes unguarded; and beyond presence, are error responses
  consistent enough for a client to act on?
- **Error handling (F11).** Two error boundaries, no `global-error.tsx`. Many routes return
  `error.message` directly — check nothing leaks internals, and that status codes are not derived
  from string matching (several routes branch on `message.includes("Unauthorized")`, which is
  fragile: reword a message and the status silently changes).
- **Background work.** `RecurringTask` and data retention need a scheduler. What runs them in
  production, and what happens if two instances run them simultaneously?

### Implementation tasks

1. **R1 (P1)** — Wrap multi-step operations in transactions: bulk import, sprint start/complete,
   workflow edits, member bulk assign. Each is all-or-nothing with a clear partial-failure report.
2. **R2 (P1)** — Webhook delivery guarantees: HMAC signature, retry with backoff, dead-letter
   queue, delivery history visible to admins, per-endpoint circuit breaker.
3. **R3 (P1)** — Automation reliability: per-rule execution log, idempotency keys, explicit
   partial-failure semantics, and an admin-visible run history with failure reasons.
4. **R4 (P1)** — Replace string-matched status codes with typed errors
   (`AuthzError`/`NotFoundError`/`ValidationError` → status), and a single error shape for all 121
   routes. Ensure no internal detail or stack reaches a client.
5. **R5 (P1)** — Error boundaries per major surface plus `global-error.tsx`, each with a real
   recovery action, wired to the Phase 10 error tracker.
6. **R6 (P1)** — A real scheduler for recurring tasks and retention, with leader election or
   locking so N instances do not duplicate work.
7. **R7 (P2)** — Idempotency keys on create endpoints so a retried POST cannot double-create.

### Testing / acceptance criteria

- [ ] A forced mid-operation failure in each multi-step flow leaves no partial state
- [ ] Webhook: a failing endpoint retries, then dead-letters, and delivery history shows both; receiver can verify the HMAC
- [ ] An automation whose action fails is logged with a reason and does not cascade past depth 3
- [ ] Every route returns the shared error shape; status codes derive from types, not message text
- [ ] No response body contains a stack trace or internal path
- [ ] Two instances running the scheduler execute each recurring task exactly once
- [ ] A render error in any view is contained by a boundary and reported

### Expected outcome

Failures are contained, observable and retryable rather than silent and partial — the difference
between a tool a team trusts and one they work around.

---

## Phase 7 — Productivity

**Priority: P1 · Dependencies: Phase 5 P1 (Postgres, for full-text search); Phase 1 A3**

This is the phase that most determines whether the product *feels* Jira-class in daily use.

### Problems to investigate

- **F4 — search is `contains` across three entity types.** No field scoping, no ranking, no
  pagination beyond `limit`, no index. The route also resolves the caller's accessible project ids
  up front and filters by them, which is correct for isolation but will not scale as a strategy.
- **F5 — case-insensitivity is accidental** and will break on Postgres.
- **F3 — saved filters do not exist.** No model, no API, no UI. For Jira-class use this is
  table stakes: named filters, sharing, subscriptions, and use as a board/dashboard source.
- **Filtering depth.** What does the current filter UI support — field coverage, combinators,
  negation, relative dates ("due in the next 7 days"), empty/non-empty? Is filter state in the
  URL, so a filtered view can be shared or bookmarked?
- **Bulk actions.** `/api/issues/bulk` exists — which fields, what limits, is it transactional
  (see R1), is there any undo, and does it enforce PBAC per issue rather than once per request?
- **Keyboard support.** A `CommandPalette` exists, and several views handle `keydown`. There is no
  discoverable shortcut help, and no audit of whether the core flows are reachable without a
  mouse.

### Implementation tasks

1. **Q1 (P1)** — Proper search on Postgres full-text: indexed, ranked, field-scoped
   (`assignee:`, `status:`, `project:`, `label:`, date ranges), paginated, with tenant filtering
   pushed into the query. Include the **F5 case-insensitivity regression test**.
2. **Q2 (P1)** — `SavedFilter`: model, CRUD API, private/shared scopes with PBAC, UI to save and
   manage, and reuse as a source for boards and dashboards.
3. **Q3 (P1)** — Advanced filter builder: full field coverage, AND/OR/NOT, relative dates,
   empty/non-empty, and **filter state encoded in the URL** so views are shareable.
4. **Q4 (P1)** — Bulk actions: edit, transition, assign, label, move, delete, with per-issue PBAC
   enforcement, a transactional apply, a progress/result report, and an undo where feasible.
5. **Q5 (P1)** — Keyboard-first pass: audit the core flows for mouse-free completion, add a `?`
   shortcut-help overlay, and make the command palette reach every primary action.
6. **Q6 (P2)** — Personal work surfaces: "My open issues", recently viewed, starred projects.
7. **Q7 (P2)** — Filter subscriptions (scheduled digest of a saved filter) — depends on M4/M6.

### Testing / acceptance criteria

- [ ] Search returns ranked, correct results on the 20k dataset in < 300 ms p95, and **never** returns another tenant's data
- [ ] Case-insensitive search verified on Postgres (F5 regression test in CI)
- [ ] A saved filter can be created, shared, used as a board source, and is PBAC-scoped
- [ ] A filtered view's URL reproduces that exact view for another permitted user
- [ ] A bulk action on 500 issues applies atomically, reports per-issue results, and skips issues the caller lacks permission on
- [ ] Every core flow completable by keyboard; `?` shows the shortcut help
- [ ] Cross-tenant test: a saved filter cannot be used to read another org's issues

### Expected outcome

Daily work stops being click-heavy: users find things, save how they found them, act in bulk, and
navigate by keyboard — the features whose absence makes a tracker feel unfinished.

---

## Phase 8 — UX / Polish

**Priority: P2 (P1 for the a11y baseline) · Dependencies: Phase 3 view work; runs parallel to Phase 7**

### Problems to investigate

- **F9 — accessibility is thin and unmeasured**: 93 `aria-*` and 40 `role=` across the whole
  front end, and no automated check. Dense tables, boards and drag-and-drop are exactly the
  patterns that need explicit semantics. `@dnd-kit` supports keyboard sensors — are they wired?
- **F10 — desktop-first and unverified on mobile**: breakpoint usage skews to `sm:` (274) over
  `lg:` (64), and the primary surfaces are dense tables and Kanban columns.
- **F11 — two error boundaries** and no `global-error.tsx`.
- **Theme and branding consistency.** Two consecutive sessions were spent repairing theme
  regressions: a white-theme pass broke the dark theme (263 fixes), and
  `src/components/admin/design-system.ts` is 241 lines with **zero importers** — a design system
  that was written and never adopted. There is no single source of design tokens, and no guard
  against the next theme regression.
- **Empty, loading and error states.** Are they consistent across the 8 views, or ad hoc per view?

### Implementation tasks

1. **U1 (P1)** — Accessibility baseline: keyboard reachability and visible focus for every
   interactive element; correct roles and labels on tables, boards, dialogs and menus; `@dnd-kit`
   keyboard sensors enabled with announcements; colour contrast verified in **both** themes. Add
   automated a11y checks (axe) to CI as a gate.
2. **U2 (P1)** — Resolve the design-system situation: either adopt
   `design-system.ts` across the admin surface or delete it, then define one token source used by
   both themes. *(= PROD-21)* Add a CI lint that fails on a light-only utility with no `dark:`
   counterpart — the exact defect class that caused the 263 fixes.
3. **U3 (P2)** — Responsive pass over the primary surfaces at phone and tablet widths, with a
   real interaction pattern for board and table on small screens.
4. **U4 (P2)** — Consistent empty, loading, error and skeleton states across all 8 views, from
   shared components.
5. **U5 (P2)** — Branding consistency: one logo, type scale, spacing scale, radius and shadow
   scale, applied and documented.
6. **U6 (P3)** — Motion and density: `prefers-reduced-motion` respected, and a compact mode for
   dense tables.

### Testing / acceptance criteria

- [ ] axe reports 0 critical/serious violations on the primary surfaces, enforced in CI
- [ ] Every interactive element reachable by keyboard with a visible focus indicator, in both themes
- [ ] Kanban drag-and-drop fully operable by keyboard, with screen-reader announcements
- [ ] Contrast meets WCAG AA in light **and** dark themes (automated)
- [ ] Primary surfaces usable at 375 px with no horizontal page scroll
- [ ] `design-system.ts` either imported or deleted — not both states
- [ ] CI fails on a new light-only utility lacking a `dark:` counterpart

### Expected outcome

The product is usable by keyboard and screen reader, correct in both themes by construction
rather than by audit, and visually consistent — with CI preventing the theme regressions that
have already cost two sessions.

---

## Phase 9 — Testing

**Priority: P0 · Dependencies: Phase 1 A3; PROD-1 for a real engine; feeds every other phase**

Current coverage is the single biggest risk multiplier: **6 suites, 74 tests, all library-level**
(encryption, sanitisation, validation, retention, DI). **Zero** tests touch a route, tenant
isolation, authorization, realtime or performance. 121 routes have no integration coverage.

### Problems to investigate

- What is the minimum harness that makes route testing cheap? Without it, every later phase
  reverts to manual verification — which is how the over-claims in `AI-STATUS.md` happened.
- How are ephemeral databases provisioned per test run, in CI and locally?
- How is realtime tested at all — SSE needs a client that holds a connection while another
  instance publishes.
- What is the regression suite for the four flows already fixed (sign-in, task open, super admin,
  sign-out), so `9a899e4` cannot silently regress?

### Implementation tasks

1. **T1 (P0)** — Integration harness: ephemeral Postgres per run, two-org fixture, authenticated
   request helpers, deterministic seeding. Everything below depends on this.
2. **T2 (P0)** — Security suites: cross-tenant isolation and PBAC/authorization.
   *(= S2/S3 = PROD-5/PROD-6)*
3. **T3 (P1)** — API contract tests across all 121 routes: auth required, validation enforced,
   error shape, status codes. Generated from the Phase 1 A2 inventory so new routes are covered
   by default.
4. **T4 (P1)** — Realtime tests: two instances, client on each, assert cross-instance delivery,
   reconnect and catch-up.
5. **T5 (P1)** — Performance regression tests on the A3 dataset with recorded budgets, failing CI
   on regression. Include the four flows from `9a899e4` and the F5 search-case test.
6. **T6 (P1)** — Concurrency tests: simultaneous issue edits (F2), concurrent key allocation
   (C4), parallel bulk operations, scheduler double-run (R6).
7. **T7 (P1)** — Full regression pass over all 10 phases before launch, recorded.
8. **T8 (P2)** — Coverage thresholds in CI once T1–T3 exist. *(= PROD-16)*

### Testing / acceptance criteria

- [ ] Harness provisions and tears down a database per run, in CI and locally
- [ ] Every suite is **proven able to fail** by deliberately breaking what it guards — a suite that cannot fail is not a suite
- [ ] All 121 routes covered by contract tests; a new route without auth or validation fails CI
- [ ] Realtime test genuinely runs two instances
- [ ] Performance budgets enforced in CI on the A3 dataset
- [ ] Concurrency suite reproduces each race before its fix, and passes after
- [ ] All suites required in CI; the build fails on regression

### Expected outcome

Correctness becomes a property CI enforces rather than something a session claims. This is what
makes every other phase's "COMPLETED" trustworthy.

---

## Phase 10 — Production Readiness

**Priority: P0 · Dependencies: all prior phases for the final verification; PROD-0 first and immediately**

### Problems to investigate

- **PROD-0 — migration drift.** Proven on a clean database: `migrate deploy` prints *"All
  migrations have been successfully applied"* and produces a database with **no `OtpCode` and no
  `Invitation` table**. Both are used at runtime, so OTP/MFA login and invitations fail on first
  use. The current environment works only because it was built with `db push`. **This blocks every
  deployment, including a pilot, and is the cheapest item in this roadmap.**
- **Configuration.** The boot guard currently reports **two settings that would fail a production
  boot** (`FIELD_ENCRYPTION_KEY`, `BASE_URL`) plus the SQLite warning. The guard working is good;
  what is missing is an environment that has ever booted clean.
- **`FIELD_ENCRYPTION_KEY` is not just a missing string** — setting it after data exists means
  deciding what happens to already-unencrypted rows. Settle that before launch, not during.
- **Observability.** `logger.ts` writes to `console.*` only. No sink, no aggregation, no alerting.
- **Backup.** `backup.ts` copies a SQLite file and is obsolete after PROD-1. An untested backup is
  not a backup.
- **Deploy mechanics.** Zero-downtime strategy, migration ordering relative to deploy, rollback
  stance for destructive changes, and how N instances behave during a rolling deploy.

### Implementation tasks

1. **D1 (P0)** — **Repair the migration drift.** Generate the missing migration, verify from
   empty, confirm the affected features work against a freshly migrated database, and add the
   drift check to CI. *(= PROD-0 — do this before anything else in this roadmap)*
2. **D2 (P0)** — Error tracking, structured log shipping and alerting on: 5xx rate, auth-failure
   spikes, pool exhaustion, Redis unavailability, SSE connection count, email failure rate. PII
   and secrets scrubbed before anything leaves the process. *(= PROD-7)*
3. **D3 (P0)** — Secrets from a platform secret manager; boot fails on missing, weak or default
   values; rotation documented including `FIELD_ENCRYPTION_KEY` re-encryption. *(= PROD-10)*
4. **D4 (P1)** — Production configuration and runbook: complete env matrix, a staging environment
   that boots with **zero** config warnings, deploy and rollback steps walked through once.
   *(= PROD-20)*
5. **D5 (P1)** — Postgres-native backup with PITR or scheduled `pg_dump` off-host; documented RPO
   and RTO; **an actually performed and verified restore**, with the date recorded. Delete the
   obsolete SQLite file-copy code. *(= PROD-9)*
6. **D6 (P1)** — Migration safety in CI: apply migrations to a **populated** database, drift
   detection, expand-contract policy for destructive changes. *(= PROD-11)*
7. **D7 (P1)** — Health, readiness and liveness endpoints that reflect real dependency state
   (database, Redis, SMTP) — not a static 200.
8. **D8 (P1)** — Final verification: full regression (T7), security re-verification (S7), the
   measured performance baseline, and a go/no-go checklist.

### Testing / acceptance criteria

- [ ] A database built **only** by `migrate deploy` contains every model in `schema.prisma`; `migrate diff` reports no difference; OTP request and invitation creation both succeed against it
- [ ] Staging boots with no "would FAIL a production boot" entries and no warnings
- [ ] A deliberate error appears in the tracker, scrubbed, and the alert routes to a real destination
- [ ] All five alert conditions fire in a test
- [ ] A restore has been performed into a scratch environment and data integrity verified, with the date recorded
- [ ] CI applies migrations to a populated database and fails on drift
- [ ] Health endpoint reports degraded when a dependency is actually down
- [ ] Rollback performed once in staging
- [ ] Go/no-go checklist complete, with every P0 and P1 closed and verified

### Expected outcome

The system can be deployed repeatably, observed while running, recovered when it breaks, and its
readiness is demonstrated by evidence rather than asserted.

---

## Cross-phase dependency graph

```
D1  PROD-0 migration drift ........... FIRST. Hours, not days. Blocks every deploy.
 │
A3  Realistic dataset (20k+ issues) ... Prerequisite for Phases 5, 7, 9. Nothing is
 │                                      measurable without it.
 ├── P1  PostgreSQL (PROD-1)
 │    │   └── must carry the A6 SQLite-semantics list -- F5 or search breaks silently
 │    │
 │    ├── S1/PROD-3  PBAC into the DB + shared cache
 │    ├── S5/PROD-2  Shared, atomic, per-user rate limiting
 │    ├── M1/PROD-4  Cross-instance SSE
 │    ├── T1         Integration harness
 │    │    └── T2 = S2/S3  Tenant isolation + PBAC tests
 │    └── Q1         Full-text search  ──> Q2 saved filters ──> Q3 filter builder
 │
 ├── C1  Attachments to object storage (with S6, PROD-18)
 ├── C2  Optimistic locking ──> T6 concurrency tests
 └── P2..P8  Bound queries, paginate, code-split, index review
              └── P9/PROD-8  Load + soak testing  ....... LAST

D2/PROD-7 Monitoring ................. parallel, no dependencies
D3/PROD-10 Secrets ................... parallel, no dependencies
S4/F7 Validate the 8 open routes ..... parallel, small, do early
R4 Typed errors ...................... parallel, touches all 121 routes -- schedule deliberately
U1 a11y baseline ..................... parallel with Phase 7
PROD-19 Next 16 / CVEs ............... parallel, own branch, away from Gate 0 work

────── P0s closed ⇒ multi-tenant paid launch viable ──────

C7/C8 Boards + dashboards, U3..U6, Q6/Q7, R7, T8, PROD-13..17, 21..23
```

---

## Recommended execution order

Order is firm. Durations are deliberately omitted — Phase 1 exists to produce them, and the two
largest items (P1 Postgres, T1/T2 test harness) depend on what the schema audit finds.

| Stage | Work | Gets you |
|---|---|---|
| **0** | D1 (PROD-0) | a deployable build — today it is not |
| **1** | Phase 1 audit, A3 dataset, S4, D2, D3 | ability to measure, see failures, and hold secrets safely |
| **2** | P1 Postgres (carrying A6/F5) | a database that can back more than one instance |
| **3** | S1, S5, M1 | correctness with more than one instance running |
| **4** | T1, T2 (= S2, S3) | cross-tenant and escalation regressions become test failures |
| **5** | C1, C2, C3, C4 | collaboration stops losing data |
| **6** | P2–P8, T5 | correct and fast on production-like volume |
| **7** | Q1–Q5, U1, U2 | feels Jira-class in daily use, and is accessible |
| **8** | R1–R6, M2–M5 | failures contained, observable, retryable |
| **9** | D4–D8, P9, T7 | operable, recoverable, verified |
| **10** | Everything P2/P3 | polish and maintainability |

**Stages 0–5 are non-negotiable for paid multi-tenant use.** Stage 0 is a matter of hours and
should not wait for approval of the rest.

### If the timeline is compressed

Cut from **Stage 10, then 7's P2 items, then 8's P2 items** — in that order. Do **not** cut
Stage 4 (the test harness) to save time: without it every later "done" is an assertion, and this
project already has a documented history of assertions that were wrong (`PRODUCTION-READINESS.md`
§1 on ARCH-2, and the PROD-8 correction where a performance item was closed while the cost
remained).

---

## What I need decided before starting

These are product and infrastructure decisions I should not make unilaterally; several change the
shape of the work substantially.

1. **Scale target.** Concurrent users, tenants, issues per project. Everything in Phase 5 and the
   load-test acceptance criteria are unfalsifiable without a number.
2. **Hosting and infrastructure.** Which Postgres, which Redis, which object store (C1), which
   error tracker (D2), which secret manager (D3). Phases 2–5 all branch on these.
3. **Pilot data.** Is the existing SQLite data migrated to Postgres, or discarded? PROD-1 needs an
   explicit answer, written down.
4. **Attachment storage (C1).** S3-compatible is the assumption. Confirm, and confirm the
   retention and size policy — the current effective policy is "15 MB, base64, forever, in the
   database".
5. **`FIELD_ENCRYPTION_KEY` (D3).** Which fields are encrypted, and what happens to rows written
   before the key existed?
6. **Jira-parity scope.** Are `Version`/`Release` (C5), multiple boards (C7) and configurable
   dashboards (C8) in scope for launch, or post-launch? I have them at P1/P2/P2; a buyer
   comparison may disagree.
7. **Conflict UX (C2).** On a concurrent-edit conflict: reject with a diff, auto-merge
   non-overlapping fields, or field-level last-write-wins with a warning? This is a product call.
8. **Email sending domain (M5).** Needed for SPF/DKIM/DMARC, and it gates M4/M6.

---

## Change Log

| Date | Who | Change |
|---|---|---|
| 2026-09-18 | Claude Opus 5 (1M context) | Created. 10 phases, P0–P3, sequenced. New audit findings F1–F11, of which F1 (attachments as base64 in the database) and F2 (no optimistic locking) are P0 and were not previously tracked anywhere. Inherited items reference `PRODUCTION-READINESS.md` rather than being restated. **Plan only — nothing implemented.** |
