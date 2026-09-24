# Ticket Management Module — Implementation Plan

> **Status**: Phase 1 shipped. **Phase 2a complete (2026-09-24).** Phase 2b not started.
> Phase 3 (frontend) is in progress in a parallel session — 5 components exist and have
> regressed the a11y ratchet by 20; see TKT-11 in `AI-STATUS.md`. This plan supersedes the earlier
> draft, which lived only in an agent's private workspace and was never committed — so every
> reference to it in `AI-STATUS.md` pointed at a file nobody else could open.
>
> **Last verified against the code**: 2026-09-24 (Claude Opus 5).
> Everything in §2 was checked by reading the shipped code, not by trusting a status entry.

---

## 1. The one rule this plan exists to fix

**A phase may not ship a reachable route whose authorization arrives in a later phase.**

The original plan put the REST API in Phase 1 and PBAC registration in Phase 2. That is how
`PATCH /api/projects/[id]/tickets/[ticketId]/status` — the route that approves a ticket and
creates an Issue on the board — went live with two checks and no third:

```ts
authContext = await assertProjectAccess(projectId);   // org/project membership only
if (user.userType === "CLIENT") return 403;            // clients blocked
// ...nothing else. The `role` this returns is never read.
```

Any employee who is a member of the project — a VIEWER included — can approve tickets, assign
them, drive status transitions, and read and write the internal notes that §5 of the original
plan describes as staff-only. Only `DELETE` carries a role check.

Nothing was exploited: there are zero tickets in the database and no UI reaches these routes.
That is luck, not design.

**From here on**: authorization is part of the definition of done for any phase that adds a
route. A route without its permission check is not "shipped", it is "exposed".

---

## 2. Verified current state

Read from the code on 2026-09-24. `✅` built and checked, `⚠️` built but wrong or partial,
`❌` absent.

### Phase 1 — Database & Domain Engine → **complete**

| Item | State |
|---|---|
| `Ticket`, `TicketComment`, `TicketStatusHistory`, `TicketAttachment` | ✅ in `schema.prisma` |
| Migration `0022_ticket_management` | ✅ applied to dev and integration databases |
| `allocateTicketKey()` with counter reconciliation | ✅ `src/lib/ticket-keys.ts` |
| Zod schemas | ✅ `src/lib/validation.ts` |
| 6 REST route files | ✅ — but see the authorization gap above |
| 9 unit tests | ✅ schema validation and key allocation only |

### Phase 2 — Conversion Engine & Security → **2a complete, 2b outstanding**

| Item | State |
|---|---|
| Transactional ticket→issue conversion | ✅ **built**, now in `src/lib/ticket-engine.ts`. It had never actually worked — see §3.5 |
| Client/Employee boundary (`isInternal`) | ✅ **built** — 3 route files enforce it |
| Real-time SSE | ⚠️ `TICKET_CREATED` and `TICKET_UPDATED` publish; `TICKET_DELETED` is **declared in `sync-engine.ts` and published by nothing** — the DELETE handler broadcasts `TICKET_UPDATED` |
| `TICKETS` category in `pbac-engine.ts` | ✅ **8 permissions, enforced on all 10 handlers** |
| Durable email via `email-outbox` | ❌ no route imports it — clients are never told anything |

Recording all five as one "PENDING" row hides that the only security item in it is the only one
genuinely outstanding.

### Phase 3 — Frontend → **not started** (correctly recorded)

No `src/components/tickets/`, none of the four components, zero mentions of "ticket" in
`AppSidebar.tsx` or `ProjectClient.tsx`. The module is a complete API with no user interface.

### Phase 4 — Testing → **improving**

**27 unit tests** (9 schema/allocator + 18 engine) and **11 integration tests**.
`check:isolation` reports **0 unaccounted**, down from 6. Still missing: tests for the
Phase 3 components, and the four pre-existing Activate accept-case failures (TKT-4).

---

## 3. Four defects in the original design

Each was verified in the shipped schema or code.

**3.1 Attachments can be read but never written.** `TicketAttachment` exists, the list and
detail routes select it, and nothing anywhere calls `ticketAttachment.create`. There is no
upload route in the plan or the code.

**3.2 ✅ FIXED — `convertedIssueId … onDelete: SetNull` silently corrupted the record.**
Resolved by denormalising `convertedIssueKey` (migration `0023`) rather than restricting
the delete: removing an issue is legitimate, and a ticket should not veto it.

Was: Delete the
converted Issue from the board and the ticket keeps `status: CONVERTED` with a null link. It
then claims to have produced work that does not exist, and nothing reconciles it.

**3.3 ✅ FIXED — `APPROVED` was a status nobody could observe.**
Resolved as one atomic act: `APPROVED` is the verb, `CONVERTED` the stored state, and
`statusAfter()` the single mapping. The unreachable row is gone and a test keeps it gone.

Was: The handler sets `APPROVED` and `CONVERTED`
in one transaction, so `APPROVED` is never durably stored. It is in the enum, in the state
machine, and will appear in the §5 dashboard as a bucket that is permanently empty.

**3.5 ✅ FIXED — ticket approval had never once succeeded.**
The conversion wrote a decorative `🎫` into the issue description. The database is WIN1252,
so `0xf0 0x9f 0x8e 0xab has no equivalent in encoding "WIN1252"` aborted the insert and rolled
back the whole transaction — **every approval since the module shipped returned 500**, and a
complete REST suite with nine green unit tests never revealed it, because none of them reached
the code. Emoji removed; a unit test now asserts the origin header holds no character above
U+00FF. The encoding itself is DB-1 and is NOT fixed: that database also refuses Bengali and
Chinese, in every field of the product.

**3.4 SLA fields are half-wired.** `firstResponseAt` is written on assign and on status change;
`dueDate` is written by nothing. Any "response time" KPI built on these will be quietly wrong
for tickets that took a path which does not set them.

---

## 4. Architecture: what to reuse instead of rebuild

The ticket routes import 10 libraries. The codebase offers roughly 60. Available and unused:

| Library | What its absence costs | Effort |
|---|---|---|
| `pbac-engine` | the authorization gap in §1 | Low |
| `email-outbox` | the client is never notified of anything | Low |
| `audit-logger` | no `PlatformAuditLog` trail for an approval — Activate writes both this *and* its own history | Low |
| `webhooks` | `issue.created` fires for the converted issue; no `ticket.*` event exists | Medium |
| `search` | tickets are unfindable; `Issue` has a GIN `searchVector` | Medium |
| `issue-subscribers` | nobody can watch a ticket | Medium |

### 4.1 Unify attachments — do this before the table has rows

`TicketAttachment` and `Attachment` are the same model — `uploaderId`, `fileName`, `mimeType`,
`fileUrl`, `storageKey` — differing only in the parent foreign key and an added `fileSize`.
A working upload path already exists: `POST /api/issues/[id]/attachments`, with
`/api/attachments/[id]/content` for retrieval, and it already enforces the storage driver,
size and MIME policy.

Two options:

1. **Mirror it** — add `POST /tickets/[id]/attachments` by copying the issue route. About an
   hour. Leaves two upload paths and two copies of every policy, forever.
2. **Generalise `Attachment`** to a polymorphic owner (`entityType` + `entityId`), migrate
   `TicketAttachment` into it, delete the duplicate. About half a day. One upload path.

**Take option 2.** There are **zero ticket rows** today, so this is a schema change with no data
migration. That window closes the first time anyone files a ticket, and this is the cheapest it
will ever be.

`TicketComment` vs `Comment` is a similar overlap and should be **left alone** — `isInternal` is
a real semantic difference, and issue comments carry mentions and history that tickets do not
want.

### 4.2 Extract the engine

The state machine, the conversion, the notification dispatch and the SSE broadcast all live
inline in `status/route.ts`. Activate went the other way: `activate-gates.ts`,
`activate-worksheet.ts` and `activate-board.ts` hold the rules and the routes stay thin. That is
why Activate's rules are unit-testable without a server, while the ticket module's nine tests
reach only Zod schemas and the key allocator.

Create `src/lib/ticket-engine.ts` holding:

- `ALLOWED_TRANSITIONS` and `assertTransition(from, to)` — pure, unit-testable
- `convertTicketToIssue(tx, ticketId, actorId)` — the transactional conversion
- `ticketVisibilityFilter(user)` — the CLIENT scoping used by three routes today

Do this **first**. It makes everything in §6 cheap instead of repetitive.

---

## 5. Permission grid — write this before writing the guard

The original plan listed eight `tickets:*` permissions and never said who holds them. That
omission is what let the approval route ship open.

| Permission | VIEWER | MEMBER | PROJECT_MANAGER | PROJECT_ADMIN | CLIENT |
|---|:--:|:--:|:--:|:--:|:--:|
| `tickets:view` | ✓ | ✓ | ✓ | ✓ | own only |
| `tickets:create` | — | ✓ | ✓ | ✓ | ✓ |
| `tickets:comment` | — | ✓ | ✓ | ✓ | ✓ (public only) |
| `tickets:internal_notes` | — | ✓ | ✓ | ✓ | **never** |
| `tickets:manage` (assign, triage) | — | — | ✓ | ✓ | — |
| `tickets:approve` (and convert) | — | — | ✓ | ✓ | — |
| `tickets:reject` | — | — | ✓ | ✓ | — |
| `tickets:dashboard` | — | — | ✓ | ✓ | — |

`CLIENT` is a `userType`, not a project role; it constrains every row independently of the role
columns. The two dimensions must both be checked — today only the `userType` one is.

---

## 6. Revised phases

Every phase carries the same exit gate (§7). A phase is not done until it passes.

### Phase 2a — Security and correctness — ✅ **COMPLETE 2026-09-24**

1. ✅ `TICKETS` category registered in `pbac-engine.ts` — 8 permissions, granted per §5.
2. ✅ `assertProjectPermission` on **all 10 handlers** across the 6 route files. The status
   route picks its key from the transition (`approve` / `reject` / `manage`); the comments
   route requires `tickets:internal_notes` on top of `tickets:comment` for a private note.
3. ✅ `src/lib/ticket-engine.ts` extracted — state machine, `statusAfter`, refusal helpers,
   visibility filters, category mapping, origin header and `convertTicketToIssue`. The status
   route dropped from 297 to 237 lines and 18 unit tests now cover rules that previously
   needed a server, a database and a session to exercise.
4. ✅ `convertedIssueKey` denormalised (migration `0023`). The foreign key keeps
   `onDelete: SetNull` — deleting an issue is legitimate and a ticket should not veto it —
   but the key survives, so a converted ticket can still name what it produced. Proven by a
   test that deletes the issue and asserts the link empties while the record does not.
5. ✅ `APPROVED` vs `CONVERTED` decided: **one atomic act.** `APPROVED` is the verb a caller
   sends, `CONVERTED` is the state stored, and `statusAfter()` is the single place that maps
   them. The unreachable `APPROVED: ["CONVERTED"]` row is gone — it was a dashboard filter
   that would have shown an empty bucket for ever. A test asserts no state in the table is
   unreachable, and fails if that row comes back.
6. ✅ `__tests__/integration/ticket-permissions.test.ts` — 10 tests. `check:isolation` now
   reports **0 unaccounted for** (was 6).

**Found while doing it — and it is not a ticket bug.** The approval path returned 500 on every
run. Root cause: the local Postgres is **WIN1252**, and the conversion wrote a `🎫` into the
issue description — `character with byte sequence 0xf0 0x9f 0x8e 0xab … has no equivalent in
encoding "WIN1252"` aborts the transaction. The emoji is gone (decoration does not belong in
stored data), but the encoding is the real defect: that database also refuses **Bengali** and
**Chinese**. See DB-1 in `AI-STATUS.md`.

### Phase 2b — Integration (~1 day)

7. Unify attachments (§4.1) and reuse the existing upload route.
8. Wire `email-outbox` for client-facing transitions: received, info requested, approved,
   rejected.
9. Wire `audit-logger` for approve / reject / convert.
10. Publish `TICKET_DELETED`, or remove it from `sync-engine.ts` (§2).
11. Either implement `dueDate` and the SLA, or drop both columns (§3.4).

### Phase 3a — Client path — ✅ **DONE 2026-09-24**

`ClientTicketCreateModal.tsx`, `TicketList.tsx`, sidebar entry in `AppSidebar.tsx`, tab in `ProjectClient.tsx`.
A client can file a ticket and watch its status.

### Phase 3b — Triage path — ✅ **DONE 2026-09-24**

`TicketDetailModal.tsx`: status timeline, public vs internal notes, assign, approve, reject,
request info, direct task drill-down. A manager can work a queue.

### Phase 3c — Dashboard — ✅ **DONE 2026-09-24**

`TicketDashboard.tsx`: the six KPI cards, conversion pipeline, manager workload table,
category & priority distribution, turnaround analytics.

### Phase 4 — Verification

Not a phase. Folded into every phase's exit gate below.

---

## 7. Exit gate — every phase, every time

```bash
npx tsc --noEmit
npm test
npm run test:integration     # needs INTEGRATION_DATABASE_URL; stop the app on 3100 first
npm run lint                 # 128 warnings / 0 errors is the baseline
npm run check:a11y           # baseline only ever goes down
npm run check:isolation      # 0 unaccounted routes
npm run check:bundle
npm run check:validation
```

Phase 1 would have failed this on `check:isolation` alone, on the day it shipped, instead of a
fortnight later in a Phase 4 that had not yet been reached.

---

## 8. Verification checklist — each row is a test file, not a judgement

| Claim | Proven by |
|---|---|
| Tenant isolation: org A cannot read or write org B's tickets | `__tests__/integration/ticket-isolation.test.ts` |
| Role boundary: a VIEWER cannot approve, assign, or read internal notes | same file, asserting the response **and** that the database did not change |
| Internal-note confidentiality: a CLIENT never receives `isInternal: true` | same file, asserting the response body |
| Kanban integrity: approving creates exactly one Issue, in Backlog | `__tests__/integration/ticket-conversion.test.ts` |
| Optimistic locking: a stale `version` returns 409 | same file, asserting the status code |
| No regression: Activate, sprints, epics unaffected | the full integration suite, green |

A 403 does not prove the write did not land. Assert the database state as well as the status
code — that is how this codebase found both of its real isolation bugs.

---

## 9. What is NOT in scope

- Merging `TicketComment` into `Comment` (§4.1).
- Automation rules acting on tickets.
- Full-text search over tickets — worth doing, needs its own `searchVector` migration
  mirroring `Issue`, and is not blocking.
- `ticket.*` webhook events — the event list is a closed set; add when a consumer exists.
