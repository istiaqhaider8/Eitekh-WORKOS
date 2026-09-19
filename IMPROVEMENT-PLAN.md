# Eitekh WorkOS — Improvement Implementation Plan

**Written 2026-09-19.** Supersedes nothing: `PRODUCTION-ROADMAP.md` remains the ten-phase
architectural plan and `PRODUCTION-READINESS.md` remains the gate tracker. This document is
narrower and more immediate — it is the ordered list of work between *"Gate 0 is done"* and
*"this can carry paying customers at a Jira-class standard"*.

Every finding below was **verified against the code on 2026-09-19**, not inherited from an earlier
document. Where a claim comes from an unverified source it says so.

---

## How to read this

Each item carries:

- **Evidence** — what was actually observed, so the next person can re-check rather than trust.
- **Why it matters** — the failure in business terms, not in code terms.
- **Tasks** — the work.
- **Depends on** — what must land first.
- **Size** — S (≤1 day), M (2–4 days), L (1–2 weeks), XL (3+ weeks). Rough, and deliberately not
  given false precision.
- **Done when** — the acceptance test. If it cannot fail, it is not an acceptance test.

---

## Where things stand

| | Status |
|---|---|
| Gate 0 (launch blockers) | **8 / 8 complete** |
| Gate 1 (pre-launch hardening) | **5 / 8** — Phase A complete 2026-09-19 |
| Multi-tenant paid production | ~88% (was ~80%) |
| Jira-class functional parity | ~55% — unchanged; Phase A was operational, not functional |
| Verified 2026-09-19 | tsc 0 · unit 271/271 · integration 80/80 · lint 0 errors · **0 CVEs** |
| Outstanding | files stored in the database · no optimistic locking · workflow unenforced · 125 API routes, 2 integration suites |

The infrastructure is in good shape and now has a safety net. **The product underneath it still has
holes**, and they are what the rest of this plan is about.

---

## The sequencing argument

Do not work this list top-to-bottom by priority label. Work it by **what would hurt most if it
happened tomorrow**. The first three are now done:

1. ~~**You have no backups.**~~ ✅ A1 — and the restore drill runs in CI.
2. ~~**You do not know what breaks under load.**~~ ✅ A2 — baselines recorded, knee identified.
3. ~~**Two known CVEs.**~~ ✅ A3 — audit clean, and the middleware runtime is no longer
   experimental.
4. **Now: the correctness holes** — silent data loss on concurrent edits (B1), unenforced workflow
   (B2), and files sitting in the primary database (B3).
5. **Then**: delivery guarantees and search quality.

B1 and B2 touch the same update path; do them together. B4 (finishing isolation coverage) should
land before B3 adds a file-download surface.

---

# Phase A — Operational safety (Gate 1) — ✅ **COMPLETE 2026-09-19**

*Nothing here changes what the product does. All of it changes whether you survive a bad day.*

| Item | Status | Outcome |
|---|---|---|
| A1 backups | ✅ `1d7cfb0` | dump + restore + verifier; the drill runs in CI on every build |
| A2 load/soak | ✅ `fb7d1a6` | baselines recorded; **the connection pool is the ceiling**, not the app |
| A3 Next 16 / CVEs | ✅ `33b8e53` | **0 vulnerabilities**; Node middleware no longer experimental |
| A4 unbounded loads | ✅ `20eba11` | **689 KB → 54 KB**, 48 ms → 19 ms |
| A5 secrets + runbook | ✅ | rotation is executable and rehearsed; deploy/rollback/incident runbook written |

**What Phase A did not and could not do**: choose your managed Postgres, provision object storage,
or point telemetry at a destination. Those remain open decisions, listed at the end of this
document. Everything that was code is done.

Three findings emerged from doing the work, and they change what comes next:

1. **Files are stored base64-encoded inside the database** (found while measuring A4). This is not
   "attachments are missing" as B3 originally framed it — they work, and they are in the worst
   possible place, inflating the database, every backup and replication. B3 is now more urgent and
   differently shaped: *get files out of the database*.
2. **The connection pool, not the application, is the capacity ceiling** — and it is implicit,
   defaulting to `num_cpus * 2 + 1`. Set it explicitly before launch.
3. **The alert thresholds were calibrated on guesses.** The database-latency one was two orders of
   magnitude too loose. It is now measured. The rest still need production traffic.

## A1 · Backup and restore, rehearsed — ✅ DONE (`1d7cfb0`)

**Evidence**: `src/lib/backup.ts` deliberately refuses — it was written to copy a SQLite file and
now returns `{ success: false }` rather than produce something that looks like a backup and is not
one. So there is **no backup mechanism at all**, by design, pending this work.

**Why it matters**: this is the only item on this list that can end the company. Everything else
degrades; this one deletes.

**Tasks**
1. Decide the mechanism with the managed Postgres choice: provider PITR, or scheduled `pg_dump`
   to off-host object storage. Prefer PITR — a nightly dump means up to 24h of lost work.
2. Encrypt at rest and in transit; the dump contains every tenant's data.
3. Retention policy, written down, with a cost figure attached.
4. **Rehearse a restore into a scratch database and record how long it took.** An unrehearsed
   backup is a hypothesis.
5. Restore runbook in `DEPLOYMENT.md`: who, what command, what to check afterwards.
6. Either delete `backup.ts` or repoint it at the real mechanism. A refusing stub is honest today
   and becomes confusing once real backups exist.

**Depends on**: choosing the managed Postgres (still open).

**Done when**: a restore has actually been performed from a backup taken by the scheduled job, the
elapsed time is written down, and the row counts match.

---

## A2 · Load and soak testing — ✅ DONE (`fb7d1a6`)

**Evidence**: no load test exists in the repository. The A3 volume dataset (20k issues) exists and
is seeded by `prisma/seed-volume.js`, but it has only ever been used for single-request timing.

**Why it matters**: every performance fix so far was measured one request at a time. Connection
pool sizing, the rate limiter's per-request round-trip, the PBAC version poll and the SSE relay are
all *untested under concurrency*. The pool maths in `.env.example` is arithmetic, not a measurement.

**Tasks**
1. Pick a tool (k6 or Artillery) and script the four real journeys: board load, issue open, issue
   update, search.
2. Run against the 20k dataset with a realistic mix, ramping to the concurrency you expect at
   launch and then past it, to find the knee.
3. **Two-hour soak** watching for: memory growth, connection-pool exhaustion, SSE connection leak,
   `RateLimitCounter` table growth, outbox growth.
4. Record p50/p95/p99 per journey as the baseline the alert thresholds get tuned against.
5. Write the numbers into `PRODUCTION-READINESS.md`. Unrecorded benchmarks get re-argued.

**Depends on**: A1 conceptually (do not load-test a system you cannot restore), PROD-7's counters
(already in place) for observing the run.

**Done when**: the knee is identified, the soak is flat, and the alert thresholds in
`DEPLOYMENT.md` have been revised against real numbers rather than guesses.

---

## A3 · Next 16 upgrade and CVE resolution — ✅ DONE (`33b8e53`)

**Evidence**: `npm audit --omit=dev` reports 1 high, 1 moderate (postcss via Next).

**Why it matters**: two birds. The CVEs close, **and** `experimental.nodeMiddleware` — which the
entire shared rate limiter depends on, and which currently prints
`Unrecognized key(s) in object: 'nodeMiddleware'` on every build — becomes stable. Today a Next
patch release could in principle drop that flag.

**Tasks**
1. Own branch. This is a major upgrade and will touch React/type surfaces.
2. Remove `experimental.nodeMiddleware`; confirm `export const runtime = "nodejs"` alone is
   honoured, and that the CI assertion on `functions-config-manifest.json` still passes.
3. Re-run both integration suites — they are the regression net for this.
4. `npm audit` clean, or every remaining advisory explicitly accepted in writing.

**Depends on**: nothing. Runs in parallel.

**Done when**: audit clean, both suites green, and the build no longer warns about an unrecognised
config key.

---

## A4 · Bound the unbounded loads — ✅ DONE (`20eba11`)

**Evidence**: `GET /api/issues/[id]` contains **zero `take:` clauses** (verified by count) while
including `comments`, `timeEntries`, `activityLogs` and `attachments`. Previously measured at
682 KB for a single issue.

**Why it matters**: the payload grows with the age of the issue. It is fine today and unbounded
tomorrow, and the failure arrives on your busiest tenant's oldest ticket.

**Tasks**
1. `take` + ordering on all four relations, with a documented default.
2. Paginated sub-endpoints for the full history the UI can call on demand.
3. Sweep for the same shape elsewhere: any `include` of a growing relation without a bound.
4. A test asserting the response size is independent of relation count.

**Depends on**: nothing.

**Done when**: issue payload size is flat as comment/activity count grows, proven with the A3
dataset.

---

## A5 · Secrets, runbook and deployment config — ✅ DONE (code and docs; the secret-manager and telemetry destinations are deployment decisions)

**Evidence**: secrets are environment variables; `DEPLOYMENT.md` documents configuration but has no
rollback or incident procedure.

**Tasks**
1. Move secrets into the platform's secret manager; rotate anything that has been in a shell
   history or a `.env` on a laptop.
2. Rotation procedure for `JWT_SECRET` and `FIELD_ENCRYPTION_KEY` — note that rotating the latter
   requires re-encrypting existing rows, which needs a written procedure, not improvisation.
3. Runbook: deploy, rollback, restore, on-call escalation, and what each of the five alerts means
   when it fires at 3am.
4. Set the telemetry destination (`TELEMETRY_ENDPOINT`, `ALERT_WEBHOOK_URL`, `ALERT_CHECK_SECRET`)
   and schedule the alert check. **Until this is done the application runs blind** — the pipeline
   is built and proven but has nowhere to send anything.

**Done when**: a new engineer can deploy and roll back from the runbook alone, and a deliberate
alert reaches a human.

---

# Phase B — Correctness holes

*These are not missing features. They are behaviours that are wrong today.*

## B1 · Optimistic locking on concurrent edits — **P0, size M**

**Evidence**: the `Issue` model has `updatedAt` but no version column, and the update path does not
compare one.

**Why it matters**: **silent data loss.** Two people editing the same issue — the normal case on a
busy team — and the second write wins with no warning. Jira shows a conflict; this shows nothing.
Users will not report it, because they will not know.

**Tasks**
1. Add a `version Int @default(0)` to `Issue` and the other multi-editor entities (Sprint, Epic,
   Project, Workflow).
2. Update with `where: { id, version }` and increment; zero rows affected means a conflict.
3. Return **409** with the current server state so the client can show a real diff.
4. Client-side conflict UI — at minimum "this changed while you were editing", at best a merge.
5. Integration test: two concurrent updates, one must lose loudly.

**Depends on**: nothing.

**Done when**: the concurrent-update test fails without the version check and passes with it.

---

## B2 · Enforce workflow transitions server-side — **P0, size M**

**Evidence**: no transition validation in the issue PATCH path. `WorkflowTransition` exists as a
model; the API does not consult it.

**Why it matters**: the workflow a project configures is decorative. Any client — or any script —
can move an issue to any status, skipping approval gates. For a customer who bought this *because*
it enforces their process, that is a correctness failure and possibly a compliance one.

**Tasks**
1. Validate the requested status against the allowed transitions for the current status.
2. Reject with 409 and name the allowed transitions in the response.
3. Decide and document who may override (project admin?) — and enforce *that* through PBAC.
4. Extend the authz integration suite: a role may not bypass a transition rule.

**Depends on**: B1 conceptually (both touch the same update path — do them together to avoid two
migrations and two rounds of client work).

---

## B3 · Get files OUT of the database — **P0, size L** — *reframed after A4*

**Evidence, corrected 2026-09-19**: attachments DO work, and that is the problem. The UI does
`reader.readAsDataURL(file)` and POSTs a base64 data URI as JSON; `attachmentSchema` explicitly
permits `data:image/`, `data:application/pdf` and `data:application/octet-stream` up to 5 MB; and
`Attachment.fileUrl` stores the whole thing in a Postgres column. In the volume dataset, 25
attachments are 5.8 MB of base64, the largest single row 389 KB.

My earlier assessment said "you cannot attach a file". That was wrong, and the truth is worse.

**Why it matters**: every byte of every uploaded file sits in the primary database. It inflates the
database, every backup, every restore and replication lag, and it is transferred by any query that
selects the column — which is how one unopened file became 380 KB of a 689 KB issue payload before
A4. The 5 MB cap plus base64 overhead means a single row can approach 7 MB of TEXT.

A4 already removed it from the read path: the issue payload is metadata only, and
`GET /api/attachments/[id]/content` serves the bytes on demand with an authorization check. That
endpoint is the seam — once objects live in S3 it becomes a redirect to a signed URL and nothing
else changes.

**Tasks**
1. Multipart upload endpoint with a size cap and a MIME allow-list.
2. Object storage (S3-compatible) with per-tenant key prefixes; **never** serve from the app.
3. Signed, expiring download URLs — and an authorization check before signing, or you have built a
   cross-tenant leak of exactly the kind the isolation suite just found twice.
4. Virus scanning, or an explicit written decision not to.
5. Thumbnails for images; an inline preview for PDFs if cheap.
6. Delete-on-issue-delete, and a reconciliation job for orphaned objects.
7. Migrate existing `fileUrl` rows, or mark them clearly as legacy links.

**Depends on**: object storage provisioned (a deployment decision, like the database).

**Done when**: a file can be uploaded, downloaded by an authorised member, **and refused to a
member of another tenant** — that last one added to the tenant-isolation suite.

---

## B4 · Finish the tenant-isolation coverage — **P0, size M**

**Evidence**: 125 API route files; **2 integration suites**. An audit of the isolation suite listed
further route families with no denial test. Those claims are **unverified** — the audit's
verification stage died on session limits.

**Why it matters**: the two families the tests reached first *both contained real vulnerabilities*
(the team-members email leak, the project-manager escalation). That is not a coincidence worth
betting against.

**Tasks**
1. Triage the untested families: workflows and their statuses/transitions, webhooks, PBAC routes
   taking `?orgId=`, project `export` / `reports/download` / `import`, and the leaf-resource ids
   (`epics/[id]`, `components/[id]`, `custom-fields/[id]`, `automations/[id]`, `subtasks/[id]`,
   `comments/[id]`, `attachments/[id]`).
2. Cover the attack shape the suite currently misses entirely: **the path is your own resource but
   a foreign id rides in the body** — `PATCH /api/issues/[id]` with another tenant's `sprintId`,
   `PUT /api/sprints` reordering by body ids, `POST /api/admin/cache/refresh` with an arbitrary
   `orgId`.
3. Add a CI guard: a new route file with no isolation test fails the build, or is explicitly
   allow-listed with a reason. Same pattern as `check-route-validation.mjs`.

**Done when**: every tenant-scoped route family has a denial test, or an allow-list entry
explaining why it does not need one.

---

# Phase C — Delivery guarantees

*Things that silently do not happen.*

## C1 · Webhook delivery — **P1, size M**

**Evidence**: `src/lib/webhooks.ts` has `isWebhookTargetAllowed` (SSRF guard), a timeout and
`redirect: "manual"` — good. It has **no HMAC signature, no retry, no dead-letter, no delivery
history**.

**Why it matters**: receivers cannot verify a payload came from you, and a transient 500 on their
side means the event is gone forever. Any customer building an integration will find this
immediately.

**Tasks**: HMAC-SHA256 signature with a per-endpoint secret and a timestamp (replay protection);
retry with exponential backoff; dead-letter after N attempts; delivery history visible to admins;
per-endpoint circuit breaker.

---

## C2 · Email reliability — **P1, size M**

**Evidence**: `src/lib/email.ts` exposes `sendEmail` with no retry, no outbox, no bounce handling.

**Why it matters**: invitations, password resets and OTP codes are the flows a locked-out user
cannot work around. A dropped send is a support ticket at best and a lost customer at worst.

**Tasks**: durable outbox table; retry with backoff; bounce/complaint webhook from the provider;
visible delivery status; SPF/DKIM/DMARC documented and **verified** for the sending domain.

---

## C3 · The inert notification types — **P2, size S**

**Evidence**: carried from the earlier audit as PROD-23; **not re-verified in this pass.** Verify
before acting.

**Why it matters**: a preference toggle that changes nothing is a lie to the user.

**Tasks**: either generate the missing notification types, or remove their toggles. Do not leave
controls that do nothing.

---

# Phase D — Scale and maintainability

## D1 · Full-text search — **P1, size M**

**Evidence**: `src/app/api/search/route.ts` uses `contains` with `mode: "insensitive"` — ILIKE.

**Why it matters**: it works and it will not scale. No ranking, no stemming, no phrase matching,
and a sequential scan as volume grows. Search is the feature people use most and judge fastest.

**Tasks**: Postgres `tsvector` column with a GIN index, ranked results, keep tenant scoping in the
query itself. Measure before and after on the A3 dataset.

---

## D2 · Front-end budget and the large components — **P2, size L**

**Evidence**: `/projects/[id]` is at 296 kB First Load JS (down from 316 kB). Five component files
exceed 2,000 lines; `IssueDetailModal.tsx` is **4,432**.

**Why it matters**: the bundle is a user-facing cost on every first load. The file sizes are a
velocity cost on every change, and a correctness risk — a 4,400-line component is where bugs hide.

**Tasks**: CI bundle budget that fails the build; code-split the four heavy views; decompose
`IssueDetailModal` by tab/section, moving logic into hooks. Do this incrementally, behind the
integration tests.

---

## D3 · Accessibility baseline — **P2, size M**

**Evidence**: 14 of 44 component files use `aria-label`.

**Why it matters**: enterprise buyers ask for a VPAT. "We'll get to it" loses deals, and
retrofitting a11y is far more expensive than building it in.

**Tasks**: keyboard navigation for every interactive control, focus management in modals, labels on
form controls, contrast audit in both themes, `axe` in CI.

---

## D4 · Internationalisation — **P3, size L**

**Evidence**: no i18n directory or library.

Only worth starting when a customer requires it — but note that retrofitting i18n across 44
components after the fact is roughly D2-sized again. Decide deliberately rather than by default.

---

# Suggested order

| Wave | Items | Rationale |
|---|---|---|
| **1** | A1, A5 (telemetry destination only) | You cannot safely operate without backups or observability. A5's config half is an hour's work |
| **2** | A2, A3 | Load testing needs a restorable system; the Next upgrade is parallel and unblocks the middleware flag |
| **3** | B1 + B2 together, A4 | Same update path, one migration, one round of client work |
| **4** | B4, B3 | Finish isolation coverage *before* adding a file-download surface that could leak across tenants |
| **5** | C1, C2, D1 | Integration and search quality — what customers notice next |
| **6** | D2, D3, C3 | Sustained investment; no deadline pressure |

**Wave 1 is small and urgent. Waves 3 and 4 are where the real engineering is.**

---

## What I would deliberately *not* do

- **Do not start D4 (i18n) or a custom workflow designer** to chase Jira feature-for-feature.
  Parity with Jira is not the goal; being correct and trustworthy is. A tracker that loses edits
  silently is worse than one missing a feature.
- **Do not tune the alert thresholds** before A2. They are guesses until there are real numbers,
  and tuning against guesses produces confident wrong numbers.
- **Do not refactor `IssueDetailModal` before B4.** Change that file with the isolation and authz
  suites in place, not before.
- **Do not add more features before B1 and B2.** Silent data loss and an unenforced workflow
  undermine every feature already shipped.

---

## Open decisions blocking this plan

These are yours, and several items above cannot start without them:

1. **Which managed Postgres** — blocks A1, and the `dev.db` data migration (CP-525–529 exist only
   there).
2. **Object storage provider** — blocks B3.
3. **Telemetry and alert destinations** — blocks the useful half of A5.
4. **Redis: yes or no** — not required by anything above. PROD-2/3/4 all run on Postgres
   deliberately. Redis becomes worthwhile if D1's search load or a real cache layer justifies it.
