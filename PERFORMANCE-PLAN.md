# Eitekh WorkOS — Performance & Full-System Audit

> **Purpose**: Measured performance findings and the fix plan. Written for AI sessions to execute.
>
> **Audit date**: 2026-09-17 · **By**: Claude Opus 5 (1M context)
> **Branch**: `security/phase-1-critical-fixes`
> **Companion docs**: [`PRODUCTION-READINESS.md`](PRODUCTION-READINESS.md) · [`AI-STATUS.md`](AI-STATUS.md) · [`SECURITY-AUDIT.md`](SECURITY-AUDIT.md)

---

## ⛔ STOP — READ THIS FIRST

This audit was looking for slowness. It found a **Critical security vulnerability** instead, in the
same code path that causes the slowness. **Fix PERF-0 before anything else in this document.**

---

## Table of Contents

1. [Findings Summary](#1-findings-summary)
2. [PERF-0 — Critical: secrets leaked to the browser](#perf-0--critical-password-hashes-and-mfa-secrets-sent-to-the-browser)
3. [Gate A — Make it fast (P0)](#gate-a--make-it-fast-p0)
4. [Gate B — Keep it fast (P1)](#gate-b--keep-it-fast-p1)
5. [Gate C — Polish (P2)](#gate-c--polish-p2)
6. [What is already good](#6-what-is-already-good)
7. [Execution order](#7-execution-order)
8. [How to measure](#8-how-to-measure)

---

## 1. Findings Summary

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| **PERF-0** | 🔴 **CRITICAL (security)** | `passwordHash`, `mfaSecret`, `recoveryCodes` of every project member serialized into the browser payload | `src/app/projects/[id]/page.tsx:49` |
| **PERF-P1** | 🔴 Blocker | Project page loads **every issue** with **9 nested relations**, no pagination — cost grows linearly with project size, forever | `src/app/projects/[id]/page.tsx:33-46` |
| **PERF-P2** | 🟠 High | Analytics route loads all issues into memory, then ~20 sequential `.filter()` passes in JS instead of DB aggregation | `src/app/api/projects/[id]/analytics/route.ts:69,127+` |
| **PERF-P3** | 🟠 High | **65 of 93** `findMany` calls have no `take:` — unbounded result sets | `grep -rn findMany src/app/api` |
| **PERF-P4** | 🟠 High | `/projects/[id]` ships **310 kB** First Load JS; four view components >2,400 lines each, all eagerly bundled | `npm run build` output |
| **PERF-P5** | 🟡 Medium | Aggressive polling: super-admin every **15 s**, notifications every **30 s** site-wide, relative-time timers every **5 s** | `src/app/super-admin/page.tsx:260`, `AppHeader.tsx:133` |
| **PERF-P6** | 🟡 Medium | N+1 write loops: `await` inside `for` loops | `orgs/[id]/members/route.ts:89`, `projects/[id]/issues/route.ts:363`, `issues/[id]/comments/route.ts:60` |
| **PERF-P7** | 🟡 Medium | Server-side over-fetch: full `user: true` includes for notification fan-out that only needs `id`/`email` | `issues/[id]/route.ts:345`, `projects/[id]/issues/route.ts:298`, `reports/download/route.ts:38` |
| ✅ DONE | — | Task-open waterfall: 11 serial requests, ~780 ms → parallel + cached | Fixed 2026-09-17, see `AI-STATUS.md` Session 13 |
| ✅ GOOD | — | DB indexes: 96 `@@index` across 45 models; `Issue` has 20 including composites | `prisma/schema.prisma` |

### Root cause

The dominant pattern is **unbounded fetching**: the system was built and tested with ~5 issues per
project, where "just load everything" is indistinguishable from a correct design. Every finding
above except PERF-P5 is the same mistake in a different place. The app will feel fine in demos and
degrade steadily in production as data accumulates — which is exactly the failure mode that gets
noticed only after customers are on it.

---

## PERF-0 — CRITICAL: password hashes and MFA secrets sent to the browser

| | |
|---|---|
| **Severity** | 🔴 Critical — credential disclosure + 2FA bypass |
| **Status** | PENDING — **fix before anything else** |
| **File** | [`src/app/projects/[id]/page.tsx:47-51`](src/app/projects/[id]/page.tsx) |

### What the code does

```ts
// src/app/projects/[id]/page.tsx:14
const project = await prisma.project.findUnique({
  include: {
    members: {
      include: {
        user: true,        // ← line 49: ALL User scalar fields
      },
    },
  },
});

// line 148 — passed straight into a "use client" component
return <ProjectClient project={project} ... />;
```

### Why it is critical

1. Prisma's `include: { user: true }` selects **every scalar column** on `User`.
2. The `User` model contains `passwordHash`, `mfaSecret`, and `recoveryCodes`
   (`prisma/schema.prisma`, verified).
3. `ProjectClient` is a **client component** (`"use client"` on line 1), so Next.js serializes the
   entire `project` prop into the RSC/flight payload delivered to the browser.

**Result**: any user who can open a project page can read, from page source, every project
member's bcrypt password hash, MFA secret, and hashed recovery codes.

Impact:
- **Offline password cracking** of every colleague's hash, at the attacker's leisure
- **`mfaSecret` is the TOTP seed** — an attacker can generate valid 2FA codes, defeating MFA entirely
- A low-privilege `VIEWER` is enough; no privilege escalation needed

This sits outside the 73-finding audit. It is not a variant of a known issue — it is new.

### The fix

Replace the blanket include with an explicit `select`, matching the pattern
`getCurrentUser()` in [`src/lib/auth.ts:140`](src/lib/auth.ts) already uses correctly:

```ts
members: {
  include: {
    user: {
      select: {
        id: true, email: true, firstName: true, lastName: true,
        avatarUrl: true, jobTitle: true, status: true,
      },
    },
  },
},
```

Then audit the other three `user: true` sites (PERF-P7). Those are server-only (notification
fan-out, report generation) so they are over-fetching rather than leaking — but they should be
narrowed too, and confirmed never to reach a response body.

### Acceptance criteria

- [ ] No `include: { user: true }` anywhere a result crosses a client boundary or response body
- [ ] `passwordHash`, `mfaSecret`, `recoveryCodes` absent from the project page payload
- [ ] A repo-wide grep for `user: true` returns only explicitly-reviewed server-only uses
- [ ] Regression test asserting the serialized payload contains no secret field names
- [ ] `npx tsc --noEmit` clean

### Verify

```bash
# 1. No blanket includes remain
grep -rn "user: true" src/app src/lib

# 2. Load a project page as a logged-in user and search the payload
#    (browser devtools → Network → the document → Response)
#    Search for: passwordHash, mfaSecret, recoveryCodes  → must be ZERO hits
```

> **Note**: this must be verified against the **rendered payload**, not just the source. The whole
> point of the bug is that data reaches the client invisibly.

---

## Gate A — Make it fast (P0)

### PERF-P1 — Paginate the project page

| | |
|---|---|
| **Severity** | Blocker |
| **Status** | PENDING |
| **Depends on** | PERF-0 (same file — do them together) |
| **File** | `src/app/projects/[id]/page.tsx:33-46`, `ProjectClient.tsx` |

**Why**: the server component loads **all** project issues, each with 9 nested relations
(`status`, `assignee`, `epic`, `sprint`, `component`, `subtasks`, `labels→label`, `team`,
`_count`), with **no `take:`**. Every one of those rows is then serialized into the HTML payload.
At 5 issues this is invisible; at 5,000 it is tens of megabytes of JSON and a multi-second
server render. This is the single largest cause of the app feeling slow, and it gets worse every
day the product is used.

The irony: [`/api/projects/[id]/issues`](src/app/api/projects/[id]/issues/route.ts) **already
implements `page`/`limit` pagination correctly** (lines 26, 81-91). The server page bypasses its
own paginated API and re-queries Prisma directly.

**Do this**:
1. In `page.tsx`, load only what the first paint needs: project metadata, workflows + statuses,
   members, epics, sprints — and the **first page** of issues (e.g. `take: 50`) with a
   `_count` for the total.
2. Trim the per-issue includes to fields the board/list actually renders. `subtasks: true` fetches
   full subtask rows when `_count.subtasks` is already selected — drop the former.
3. Have `ProjectClient` fetch subsequent pages from the existing paginated API.
4. Keep `orderBy: [{ position: "asc" }, { createdAt: "desc" }]` — it is index-backed.

**Acceptance criteria**:
- [ ] `page.tsx` issue query has an explicit `take:`
- [ ] Per-issue includes reduced to rendered fields only; no duplicate `subtasks` + `_count`
- [ ] Further pages load via the existing API
- [ ] Project page TTFB roughly flat between a 50-issue and a 5,000-issue project
- [ ] No functional regression in board/list/backlog views

**Verify**: seed a project with 5,000 issues; compare TTFB and payload size against a small
project. The gap should be small and roughly constant.

---

### PERF-P2 — Push analytics aggregation into the database

| | |
|---|---|
| **Severity** | High |
| **Status** | PENDING |
| **File** | `src/app/api/projects/[id]/analytics/route.ts` |

**Why**: the route does `findMany` with **no `take:`** (line 69) and then runs roughly 20
sequential `.filter()`/`.reduce()` passes over the full array in JavaScript (lines 127-290+). That
is the entire issue table pulled into app memory and scanned ~20 times per request. Some analytics
views poll on a timer, multiplying the cost.

**Do this**:
1. Replace the count/group aggregations with `prisma.issue.groupBy` and `count` — the DB already
   has the composite indexes to serve them (`[projectId, statusId]`, `[projectId, priority]`,
   `[projectId, issueType]`, `[projectId, dueDate]`, `[projectId, assigneeId]`).
2. Where a single pass over rows is genuinely needed, do **one** pass building all accumulators,
   not 20 passes.
3. Cache the computed result per project with a short TTL (use the cache from
   `PRODUCTION-READINESS.md` PROD-3 once it is shared).

**Acceptance criteria**:
- [ ] No unbounded `findMany` in the analytics path
- [ ] Counts/distributions computed by `groupBy`/`count`, not JS filters
- [ ] At most one full-row pass where unavoidable
- [ ] Response time roughly flat as issue count grows
- [ ] Output values identical to today's (snapshot the response before refactoring)

---

### PERF-P3 — Bound every list query

| | |
|---|---|
| **Severity** | High |
| **Status** | PENDING |
| **Files** | ~65 route files under `src/app/api/` |

**Why**: 93 `findMany` calls, only 28 with `take:`. An unbounded query is a latent outage — it
works until one tenant has enough rows, then it exhausts memory or times out. PERF-4 ("no
pagination on several list endpoints") was marked COMPLETED, but the ratio says the work was
partial. Worst offenders by count: `super-admin/search`, `super-admin/analytics`, `search`
(6 unbounded `findMany` each).

**Do this**:
1. Audit all 93 call sites. Every one either takes a `take:` with a sane default cap, or has a
   written justification (e.g. "at most 6 workflow statuses per project").
2. Prioritize the search routes — user-facing, and unbounded search is trivially abusable.
3. Follow the pagination shape already established in
   `projects/[id]/issues/route.ts` (`page`/`limit`) rather than inventing a second convention.

**Acceptance criteria**:
- [ ] Every `findMany` has `take:` or a comment justifying why it is bounded by nature
- [ ] Search endpoints capped and paginated
- [ ] A hard maximum `limit` enforced server-side (a client cannot request `limit=999999`)

---

### PERF-P4 — Code-split the project page

| | |
|---|---|
| **Severity** | High |
| **Status** | PENDING (reopens PERF-8) |
| **Files** | `src/app/projects/[id]/ProjectClient.tsx`, `src/components/views/*` |

**Why**: `/projects/[id]` ships **310 kB** First Load JS (123 kB page chunk). It is the main
screen of the product, and it is painful on mobile or poor connections. Every view is bundled
eagerly even though a user sees one at a time:

| Component | Lines |
|---|---|
| `AnalyticsChartsView.tsx` | 2,891 |
| `ScrumBacklogView.tsx` | 2,872 |
| `CalendarView.tsx` | 2,709 |
| `WorkloadView.tsx` | 2,469 |
| `IssueDetailModal.tsx` | 4,466 |

**Do this**: `next/dynamic` the non-default views and the detail modal, with a loading fallback
matching the existing `loading.tsx` style; set a CI bundle budget so this cannot regress.

**Acceptance criteria**:
- [ ] `/projects/[id]` First Load JS < 200 kB
- [ ] Non-default views and the modal are separate chunks, loaded on demand
- [ ] CI fails if the budget is exceeded
- [ ] View switching still works, with no visible flash of empty layout

---

## Gate B — Keep it fast (P1)

### PERF-P5 — Right-size polling

| | |
|---|---|
| **Severity** | Medium |
| **Status** | PENDING |
| **Files** | `src/app/super-admin/page.tsx:260`, `src/components/layout/AppHeader.tsx:133`, `src/components/admin/*`, `DashboardView.tsx`, `AnalyticsChartsView.tsx` |

**Why**: constant background load from timers, independent of user activity:

| Location | Interval | Note |
|---|---|---|
| `super-admin/page.tsx` | **15 s** | reloads *all* super-admin data |
| `AppHeader.tsx` | 30 s | notifications — **site-wide, every page, every user** |
| 4× `admin/*` views | 30 s | health, threats, sync, governance |
| `DashboardView`, `AnalyticsChartsView` | 5 s | relative-time re-render |

The notification poll is the expensive one: it multiplies by every logged-in user. And the app
**already has SSE** (`/api/sync/events`) — polling for notifications duplicates infrastructure
that exists.

**Do this**:
1. Move notifications onto the existing SSE channel; drop the 30 s poll.
2. Raise the super-admin interval (15 s → 60 s) and pause polling when the tab is hidden
   (`document.visibilityState`) — this alone removes most wasted requests.
3. The 5 s relative-time timers need no network; just confirm they re-render a small subtree, not
   a 2,900-line view.

**Acceptance criteria**:
- [ ] Notifications delivered via SSE; the 30 s poll removed
- [ ] All polling pauses on hidden tabs
- [ ] Super-admin interval ≥ 60 s
- [ ] Measured: requests/minute from an idle open tab drops substantially

---

### PERF-P6 — Batch the N+1 write loops

| | |
|---|---|
| **Severity** | Medium |
| **Status** | PENDING |
| **Files** | `orgs/[id]/members/route.ts:89`, `projects/[id]/issues/route.ts:363`, `issues/[id]/comments/route.ts:60` |

**Why**: sequential `await` inside `for` loops — one round-trip per element:
- `orgs/[id]/members`: `projectMember.upsert` per project → adding a member to 20 projects = 20 round-trips
- `projects/[id]/issues`: `label.upsert` per label
- `issues/[id]/comments`: `user.findFirst` per `@mention`

**Do this**: resolve mentions with a single `findMany({ where: { username: { in: [...] } } })`;
batch label/member writes with `createMany`/`deleteMany` inside the existing transaction, or
`Promise.all` where upsert semantics are required and order does not matter.

**Acceptance criteria**:
- [ ] No `await` on a DB call inside a `for`/`forEach` loop in these routes
- [ ] Query count independent of input array length
- [ ] Existing transaction boundaries preserved

---

### PERF-P7 — Narrow server-side over-fetches

| | |
|---|---|
| **Severity** | Medium |
| **Status** | PENDING |
| **Depends on** | PERF-0 |
| **Files** | `issues/[id]/route.ts:345`, `projects/[id]/issues/route.ts:298`, `reports/download/route.ts:38` |

**Why**: three `include: { user: true }` sites pull every User column (including secrets) to use
one or two fields for notification fan-out and report generation. These are server-only — verified
not returned to clients — so this is over-fetching, not disclosure. But it is the same pattern as
PERF-0, and the next refactor could easily push one of them into a response.

**Do this**: replace each with an explicit `select` of only the fields used
(typically `id`, `email`, `firstName`).

**Acceptance criteria**:
- [ ] All three narrowed to explicit `select`
- [ ] Zero `include: { user: true }` remaining in the codebase
- [ ] Notification and report behaviour unchanged

---

## Gate C — Polish (P2)

| ID | Task | Why |
|---|---|---|
| **PERF-P8** | Decompose `IssueDetailModal.tsx` (4,466 lines) | Also `PRODUCTION-READINESS.md` PROD-13. It resisted a one-line dropdown edit in practice |
| **PERF-P9** | Decompose the four >2,400-line view components | Also PROD-17 |
| **PERF-P10** | React render profiling of `ProjectClient` (2,186 lines) | Check for missing `useMemo`/`React.memo` causing full-tree re-renders on every keystroke |
| **PERF-P11** | Add `loading.tsx` skeletons per view | Perceived speed — the page already has one at the route level |

---

## 6. What is already good

Do not "fix" these — they were done properly:

| Area | Evidence |
|---|---|
| **Database indexes** | 96 `@@index` across 45 models; `Issue` alone has 20, including the composites analytics needs. PERF-2 was genuine work. |
| **Issues API pagination** | `projects/[id]/issues/route.ts` implements `page`/`limit` correctly — reuse this shape, don't invent another |
| **Auth field selection** | `getCurrentUser()` uses an explicit `select` and leaks nothing — this is the pattern PERF-0 should copy |
| **Task-open latency** | Fixed 2026-09-17: waterfall → parallel + project-context cache |
| **Build/typecheck/tests** | Production build passes, `tsc --noEmit` clean, 74 tests green, CI enforces all three |

---

## 7. Execution order

```
PERF-0   Secrets leak ................ 🔴 DO FIRST (security, ~10 min fix)
   │
PERF-P1  Paginate project page ....... same file as PERF-0 — do together
   │
   ├── PERF-P2  Analytics → groupBy
   ├── PERF-P3  Bound all findMany
   └── PERF-P4  Code-split views
   │
──────── Gate A done ⇒ the app stops getting slower as data grows ────────
   │
   ├── PERF-P5  Polling / SSE
   ├── PERF-P6  N+1 write loops
   └── PERF-P7  Narrow over-fetches
   │
──────── Gate B done ⇒ steady-state load is proportionate ────────
   │
PERF-P8..11  Decomposition + render profiling (post-launch)
```

**Highest value per hour**: PERF-0 (a ~10-minute fix for a Critical vulnerability) then PERF-P1
(the main cause of the slowness, in the same file).

**Relationship to `PRODUCTION-READINESS.md`**: that document covers *infrastructure* blockers
(Postgres, Redis, tests, monitoring). This one covers *application* performance. They are
independent — Gate A here can be done before, after, or alongside Gate 0 there. Do **PERF-0
before either**.

---

## 8. How to measure

Do not optimize on intuition. Establish a baseline first.

```bash
# Bundle sizes (STOP THE DEV SERVER FIRST — see PRODUCTION-READINESS.md §2)
npm run build            # read the Route table: page size + First Load JS

# Per-request server timing: the dev server logs every request with a duration
npm run dev              # then watch the console while using the app

# Query-level visibility — set in .env to log every SQL statement
# DEBUG="prisma:query"

# Baseline gates (must stay green)
npx tsc --noEmit && npm test
```

### Seeding realistic data

Every finding here is invisible at current data volume (5 issues, 3 users). **You cannot validate
any fix in this document without a realistic dataset.** Before starting Gate A, extend
`prisma/seed.js` to generate ~5,000 issues across ~3 projects with assignees, labels, subtasks and
comments — then measure before and after. A fix that cannot be measured cannot be verified, and
an unverified performance fix is indistinguishable from a no-op.

### Recording results

Append measurements to the table below so the next session can see movement.

| Date | Metric | Before | After | By |
|---|---|---|---|---|
| 2026-09-17 | Task-open (warm, repeat) | ~780 ms, 11 serial requests | near-instant, 1 request | Claude Opus 5 (1M) |
| 2026-09-17 | `/projects/[id]` First Load JS | 310 kB | — (PERF-P4 pending) | — |

---

## Change Log

| Date | Who | Change |
|---|---|---|
| 2026-09-17 | Claude Opus 5 (1M context) | Created. Full-system audit: 1 Critical security finding (PERF-0), 11 performance findings across 3 gates, all verified against the repo. |
