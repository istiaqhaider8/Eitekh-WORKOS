# Eitekh WorkOS — Live System Pre-Production Verification

> **Stage 1 report: inspection and measurement only. Nothing was fixed.**
>
> **Date**: 2026-09-18 · **By**: Claude Opus 5 (1M context)
> **Target**: live dev instance on `http://localhost:64500`, commit `1aba0c7`
> **Companion docs**: [`PRODUCTION-READINESS.md`](PRODUCTION-READINESS.md) · [`PERFORMANCE-PLAN.md`](PERFORMANCE-PLAN.md) · [`AI-STATUS.md`](AI-STATUS.md)

---

## 0. Method, and how much to trust this

Every claim below was produced by running something against the **live system** — HTTP requests
with real sessions, or read-only Prisma queries — not by reading code and inferring.

**Four times during this audit an initially alarming result turned out to be my own testing
error.** They are recorded in §L because they are the most useful part of this report for the
next session: they show exactly how this codebase misleads a careless auditor.

| Coverage | Status |
|---|---|
| Authorization / privilege escalation | probed live, multiple roles |
| Session & JWT security | probed live |
| Data integrity | full read-only sweep of all relations |
| Performance | measured, warm + cold separated |
| Email pipeline | analysed 111 real delivery rows + code path |
| Feature execution (automation/webhook/recurring) | traced call-graph, confirmed by grep |
| Realtime SSE | verified earlier this session, end-to-end, 2 users |
| Config | live `.env` inspected (secrets masked) |
| **Not covered** | UI rendering (no browser tool), cross-tenant isolation with a 2nd org (only 1 org exists), import/export authz, load/soak testing |

A 25-agent parallel audit was attempted first and **failed entirely** — all agents hit the
account session limit. This report is the result of direct solo inspection instead, so it is
narrower than intended. The gaps above are real and unclosed.

### Live data safety

- `DATABASE_URL = file:./dev.db`. Scale confirms **dev/seed data**, not production:
  5 users, 1 org, 1 workspace, 1 team, 1 project, 5 issues.
- Backed up to `../db-backups/dev.db.PREINSPECTION-20260918-005920` before anything ran.
- **Email is live** — SMTP points at a real Gmail account and 2 of 5 users are real humans
  (`cocofbd@gmail.com`, `istiaqhaider8@gmail.com`). No test email was sent to either.
- Post-inspection state verified **identical to baseline**. One permission field was changed
  during a test and restored (§L-1). One test issue was created and deleted. No leftover
  `ZZTEST` data, no modified source files.

---

## A. SYSTEM STATUS — what actually works

This system is **more solid than its tracker suggests**. Verified working against the live app:

| Area | Evidence |
|---|---|
| **Super-admin authorization** | All **14** `/api/super-admin/*` routes return **403** to a regular user |
| **Privilege escalation blocked** | A true `MEMBER` (marcus) failed 4 escalation attempts (org role, project role, remove a member, delete project); DB verified unchanged afterwards |
| **CSRF protection** | Mutation without an `Origin` header → **403** |
| **Session invalidation** | After logout the same cookie gets **401** on protected endpoints |
| **JWT integrity** | Tampered/garbage token → treated as unauthenticated |
| **No user enumeration** | Real vs fake email produce byte-identical errors |
| **Input validation** | 8 of 9 malformed payloads → **400** (Zod is doing real work); no internals leaked in any error body |
| **Bulk endpoint** | Fabricated issue ids → **404**, not a blind mass update |
| **Data integrity** | **Zero** orphans, duplicates, cross-project references, or lingering expired sessions |
| **Rate limiting** | Applied on all **9** auth routes |
| **Realtime SSE** | Verified earlier with 2 users: per-user delivery, correct isolation, clean disconnect |
| **Warm API latency** | 76–280 ms across 13 endpoints |

---

## B. CRITICAL ISSUES (P0/P1)

### B-1 (P1) — Email reports success when it never sent anything

**The single most dangerous finding.** [`src/lib/email.ts:483-512`](src/lib/email.ts):

```ts
} else {
  console.warn(`[Email] SMTP not configured (no smtpPass)...`);
  status = "MOCKED";            // logged as MOCKED
}
...
return { success: status !== "FAILED", ... }   // MOCKED counts as SUCCESS
```

- **Measured**: of 111 rows in `emailLog`, **77 are `MOCKED`** — never sent — and **0 are
  `FAILED`**. Not one delivery failure has ever been recorded.
- If `SMTP_PASS` or `SMTP_HOST` is absent in production, **every email silently vanishes** —
  password resets, OTP verification, invitations — while callers are told it succeeded.
- OTP gates login, so this is a **silent total lockout of registration and password reset**,
  with nothing in logs above a `console.warn` and no alert.
- There is no startup validation requiring SMTP in production.
- Compounding it, the `emailLog` write is wrapped in `catch (e) { /* Ignore logging errors */ }`,
  so even the audit trail fails silently.

**Fix**: fail closed in production — if SMTP is unconfigured, `success: false` and a loud error.
Never let `MOCKED` satisfy a caller. Validate SMTP at boot. Alert on `FAILED`/`MOCKED` volume.

### B-2 (P1) — Webhooks never fire

`dispatchWebhook()` is the **only** export of [`src/lib/webhooks.ts`](src/lib/webhooks.ts), and
**nothing in the codebase imports it**. Webhook CRUD works; delivery does not exist. A customer
can register a webhook and will never receive a single event.

### B-3 (P1) — Automation rules never execute

`AutomationRule` appears only in its CRUD routes and read-only admin reporting. `triggerType`
exists solely in `automations/route.ts` and `validation.ts`. **There is no evaluation engine** —
nothing consults automation rules when an issue changes. Rules can be created and will never run.

### B-4 (P1) — Project page payload grows without bound (now quantified)

Measured: `GET /projects/<id>` returns a **139 KB** payload for a project containing **5 issues**
— roughly **28 KB per issue**, and the query has no `take:`. Straight-line extrapolation:
500 issues ≈ 14 MB, 5,000 issues ≈ 140 MB, on every page load.

This is `PERF-P1` in `PERFORMANCE-PLAN.md`, now with a number attached. Warm page time is
already 361 ms vs 78 ms for `/login` at trivial data volume.

---

## C. SECURITY ISSUES

No P0 security finding. All escalation, CSRF, session and JWT probes passed (§A).

### C-1 (P2) — Login rate limit is permissive and IP-only

[`login/route.ts:11`](src/app/api/auth/login/route.ts) uses `limit: 60, windowSeconds: 60`.

- **60 attempts/minute/IP = 3,600/hour** from a single IP. I fired 20 consecutive failures
  without a single `429`.
- Keyed **only by IP**, so a distributed attack on one account is unconstrained.
- **No account lockout** exists.
- The store is a process-local `Map`, so with N instances the real limit is **60 × N**.

### C-2 (P2) — `FIELD_ENCRYPTION_KEY` is not set

`.env.example` states it is **required in production**, with a development fallback to
`JWT_SECRET`. It is absent from the live `.env`, so field-level encryption (MFA secrets, webhook
secrets) currently rests on the dev fallback. Nothing fails loudly about this.

### C-3 (P3) — XSS payloads stored raw

`<img src=x onerror=alert(1)>` as an issue title was accepted (**201**) and stored verbatim.
**Not exploitable in the app**: there is zero `dangerouslySetInnerHTML` and React escapes on
render. But storage is raw, so any **non-React consumer is a live vector** — I did **not**
verify CSV/PDF export or HTML email rendering of these fields. Treat as unverified there.

---

## D. DATA ISSUES

**Data integrity is clean.** Full sweep found zero of: orphan comments/subtasks/attachments/
watchers, orphan notification user/actor refs, duplicate org or project memberships, duplicate
`issueKey` within a project, cross-project sprint/epic references, projects with more than one
`ACTIVE` sprint, expired sessions left in the table.

| ID | Sev | Issue |
|---|---|---|
| D-1 | P3 | **10 OTP codes, all expired, still in the table.** `data-retention.ts` does not cover `OtpCode`. Expired one-time secrets should not persist. |
| D-2 | P3 | The `ACTIVE` sprint has `plannedPoints = null`. The snapshot is only taken when a sprint transitions to ACTIVE **through the API**; this one was seeded directly. Velocity therefore has no baseline. Affects seed data, but reveals that any out-of-band status change skips the snapshot. |

---

## E. PERFORMANCE ISSUES (measured)

Warm, second-hit timings — dev-mode first-hit compilation excluded (it inflates cold numbers by
seconds and is **not** a production signal).

| Endpoint | Warm | Payload |
|---|---|---|
| `/api/auth/me` | 76 ms | 3.7 KB |
| `/api/projects/[id]` | 158 ms | 1.7 KB |
| `/api/projects/[id]/analytics` | 166 ms | **20.5 KB** |
| `/api/projects/[id]/members` | 281 ms | 1.2 KB |
| `/api/projects/[id]/issues?limit=50` | 201 ms | 7.8 KB |
| `/api/sprints`, `/epics`, `/teams`, `/custom-fields`, `/notifications`, `/search` | 111–154 ms | < 2.6 KB |
| **`/projects/[id]` (page)** | **362 ms** | **139 KB** |
| `/login` (page) | 78 ms | 19 KB |

**Interpretation — read this before optimizing.** Every number above was taken at **5 issues**.
They are a baseline, not a verdict: they say the app is *fast when empty*. The actionable signals
are the **ratios**, not the milliseconds:

- 139 KB for 5 issues on the main screen (B-4) — the growth curve is the problem
- 20.5 KB of analytics JSON derived from 5 issues
- The main working screen is already **4.6× slower** than a login page at zero scale

**Nothing here can be extrapolated to production, and no optimization should be declared
successful against this dataset.** `PERFORMANCE-PLAN.md` §8 is right: seed ~5,000 issues first.

---

## F. EMAIL ISSUES

The precise failure point, per the pipeline the brief asked for
(*event → recipient → preference → notification → email → provider → delivery → logging*):

| Stage | Status |
|---|---|
| event → recipient | works |
| preference check | works (`notificationPrefs`, defaults on) |
| notification row | works |
| **email → provider** | **breaks silently when SMTP is unconfigured — B-1** |
| delivery | currently real (newest row is `SENT`, 2026-09-17T18:21) |
| **logging** | `MOCKED` is logged but reported as success; log write failures swallowed |
| realtime/UI | works (verified end-to-end earlier) |

Measured: **`MOCKED` 77 / `SENT` 34 / `FAILED` 0** across 10 days.

Also present: rows addressed to `victim.org@example.com`, `vic2@example.com`, and
`sfec.dev1@eitekh.com` / subject `[SFEC] Assigned to you: SFEC-36`. This database carries email
history from **earlier security testing and an unrelated deployment** — worth knowing before
anyone treats `emailLog` as clean production evidence.

---

## G. REALTIME ISSUES

**No new issues.** Verified earlier this session end-to-end with two concurrent users:
`NOTIFICATION_CREATED` delivered only to the addressed user's stream; the actor's own stream
received nothing; payload carried the correct deep link and no secret fields; unauthenticated
access rejected on both scopes; client cleanup confirmed (connect/disconnect counts reconcile,
and a clean shutdown emitted proper `SYNC_CLIENT_DISCONNECTED` with `remainingActiveClients: 0`).

Pre-existing, already recorded: the client registry is process-local, so realtime breaks across
multiple instances (`PROD-4`).

---

## H. FEATURE ISSUES

| ID | Sev | Feature | Reality |
|---|---|---|---|
| B-2 | P1 | Webhooks | CRUD only — `dispatchWebhook()` is never called |
| B-3 | P1 | Automations | CRUD only — no evaluation engine |
| H-1 | P2 | Recurring tasks | Only run if something external POSTs `/api/recurring-tasks/trigger`. No scheduler, no `instrumentation.ts`. `DEPLOYMENT.md` documents cron **only for backups** — so a by-the-book deployment never runs them. |
| H-2 | P3 | Malformed JSON | Returns **500** instead of 400 (no internals leaked) |
| — | — | Notification types | Pre-existing: 7 of 10 configurable types are never generated |

**Cross-cutting theme:** three advertised features (webhooks, automations, recurring tasks) have
complete CRUD surfaces, database models, validation schemas and UI — and **no execution**. The
settings and API make promises the runtime cannot keep. This is the same shape as the
notification-preferences gap already on record.

---

## I. PRODUCTION CONFIGURATION

Live `.env` (values masked):

| Var | Value | Risk |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | SQLite — known blocker (`PROD-1`) |
| `JWT_SECRET` | set, 48 chars | adequate |
| `SMTP_HOST/USER/PASS` | set (real Gmail) | live sending from a personal account |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | **wrong — app serves on 64500** |
| `BASE_URL` | **not set** | falls back to `localhost:3000`; wrong links in email |
| `FIELD_ENCRYPTION_KEY` | **not set** | C-2 — dev fallback in use |
| `NODE_ENV` | not set | dev defaults apply |

Also: CI defaults `FIELD_ENCRYPTION_KEY` to an all-zeros value — that must be impossible to
reach outside CI. And `prisma/migrations` remains drifted from `schema.prisma`
(`SystemEmailConfig`, `OtpCode`, `Invitation`), so `migrate deploy` on a fresh database would
**not** reproduce the current schema — a genuine hazard for the Postgres migration.

---

## J. PRODUCTION READINESS GAP

**Nothing in this report blocks starting the Production Readiness work.** The security
fundamentals that would have blocked it — authorization, session handling, CSRF, tenant scoping
of queries, input validation, data integrity — are **working**.

Two items should be fixed *first* because they will otherwise corrupt the verification of
everything else:

1. **B-1 (email silent success).** Until email fails loudly, you cannot trust any test of
   invitations, password reset, OTP or notification delivery — including the tests `PROD-5`/
   `PROD-6` will add. A green test that proves nothing is worse than a red one.
2. **Seed a realistic dataset (~5,000 issues).** Every performance number in §E was taken at
   5 issues. Without this, `PROD-8` load testing and every `PERF-*` fix are unverifiable, and
   "optimized" would be an unfalsifiable claim.

Everything else can proceed in parallel with the existing Gate 0 plan.

---

## K. RECOMMENDED IMPLEMENTATION ORDER

Ordered so that each step makes the next one verifiable.

**Stage 0 — make verification trustworthy (do first)**
1. **B-1** — email fails closed; boot-time SMTP validation; alert on `FAILED`/`MOCKED`.
2. **Seed realistic data** (~5,000 issues) — the precondition for all performance work.
3. **Fix migration drift** — before Postgres, not after. `PROD-1` is unsafe on a drifted history.

**Stage 1 — truth in the product surface** *(cheap, prevents ongoing user confusion)*
4. **H-1** — document the cron requirement in `DEPLOYMENT.md`, or add a scheduler.
5. Hide or disable the UI for features that cannot execute (webhooks, automations, and the 7
   inert notification toggles) until they do.

**Stage 2 — the performance work, now measurable**
6. **B-4 / PERF-P1** — paginate the project page (largest single win; re-measure the 139 KB).
7. **PERF-P2** analytics aggregation → `groupBy`; **PERF-P3** bound all `findMany`.
8. **PERF-P4** code-split the 310 KB bundle.

**Stage 3 — security hardening**
9. **C-1** — tighten the login limiter, key it by account as well as IP, add lockout.
   *Do this after `PROD-2` (Redis), or it only works on one instance.*
10. **C-2** — require `FIELD_ENCRYPTION_KEY` in production; document rotation.
11. **I** — fix `BASE_URL`/`NEXT_PUBLIC_APP_URL`; make the CI zero-key unreachable in prod.

**Stage 4 — build the features that only exist as CRUD**
12. **B-2** webhook delivery, **B-3** automation engine — real features, scope them deliberately.

**Stage 5 — polish**
13. **H-2** malformed JSON → 400; **D-1** OTP retention; **D-2** sprint snapshot on any
    transition; **C-3** verify export/email paths escape stored HTML.

Then resume `PRODUCTION-READINESS.md` Gate 0 (Postgres, Redis, tenant-isolation tests,
monitoring) as written.

---

## L. WHERE I WAS WRONG — read this before trusting any probe

Four alarming results this audit turned out to be **my own errors**. This codebase has specific
traps that make careless probing produce false positives.

**L-1 — "Privilege escalation!" (wrong: bad test subject).**
`alex@acme.com` PATCHed himself to org `OWNER` and `PROJECT_ADMIN`, both returning `200`. But
`prisma/seed.js:109` shows **alex *is* the org owner**. An owner managing project members is
correct authority, not escalation. I had picked the most privileged non-superadmin as my
"regular user". Re-running with `marcus@acme.com` (MEMBER/MEMBER) — all attempts blocked.
*One field did change (`PROJECT_MANAGER` → `PROJECT_ADMIN`); it was reverted and verified.*

**L-2 — "Auth bypass!" (wrong: 200 with a null body).**
`/api/auth/me` returned `200` for a logged-out cookie **and** a garbage JWT. It returns
`{"user":null}`. Checking a protected endpoint instead gave the truth: **401**. Logout and JWT
verification both work correctly.

**L-3 — "No rate limiting on login!" (wrong: threshold not reached).**
20 failed logins produced no `429`. The limiter exists and is applied — it is just set to
`60/minute/IP`. The finding is a weak threshold (C-1), not an absence.

**L-4 — "Tenant isolation broken — row deleted!" (wrong: my script's bug).**
Earlier in the session a test reported a cross-user delete succeeding. The script had an `argv`
off-by-one and was querying the literal string `"x"`. The row was present and untouched.

**The lesson for the next session:** in this app, **an HTTP status code is not evidence**. Several
endpoints return `200` with empty or null payloads when unauthorized, and `updateMany`-based
handlers return success after matching zero rows. Always verify the **database state** and the
**response body** — and confirm your test subject actually lacks the privilege you are testing.

---

## Change Log

| Date | Who | Change |
|---|---|---|
| 2026-09-18 | Claude Opus 5 (1M context) | Created. Live inspection: 4 P1, 3 P2, 5 P3 confirmed; data integrity clean; 12 areas verified working; 4 self-corrections recorded. No fixes applied. |
