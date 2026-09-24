# Ticket Management Module — Implementation Plan

> **Status**: Phase 1 shipped. Phase 2 partially shipped. This plan supersedes the earlier
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

### Phase 2 — Conversion Engine & Security → **~60% shipped, recorded as PENDING**

| Item | State |
|---|---|
| Transactional ticket→issue conversion | ✅ **built** — inline in `status/route.ts`, not the `ticket-conversion.ts` the plan named |
| Client/Employee boundary (`isInternal`) | ✅ **built** — 3 route files enforce it |
| Real-time SSE | ⚠️ `TICKET_CREATED` and `TICKET_UPDATED` publish; `TICKET_DELETED` is **declared in `sync-engine.ts` and published by nothing** — the DELETE handler broadcasts `TICKET_UPDATED` |
| `TICKETS` category in `pbac-engine.ts` | ❌ **zero `tickets:*` permissions exist** |
| Durable email via `email-outbox` | ❌ no route imports it — clients are never told anything |

Recording all five as one "PENDING" row hides that the only security item in it is the only one
genuinely outstanding.

### Phase 3 — Frontend → **not started** (correctly recorded)

No `src/components/tickets/`, none of the four components, zero mentions of "ticket" in
`AppSidebar.tsx` or `ProjectClient.tsx`. The module is a complete API with no user interface.

### Phase 4 — Testing → **partial**

9 unit tests. **Zero integration tests** — which is why all six ticket routes are reported as
"unaccounted for" by `npm run check:isolation`.

---

## 3. Four defects in the original design

Each was verified in the shipped schema or code.

**3.1 Attachments can be read but never written.** `TicketAttachment` exists, the list and
detail routes select it, and nothing anywhere calls `ticketAttachment.create`. There is no
upload route in the plan or the code.

**3.2 `convertedIssueId … onDelete: SetNull` silently corrupts the record.** Delete the
converted Issue from the board and the ticket keeps `status: CONVERTED` with a null link. It
then claims to have produced work that does not exist, and nothing reconciles it.

**3.3 `APPROVED` is a status nobody can observe.** The handler sets `APPROVED` and `CONVERTED`
in one transaction, so `APPROVED` is never durably stored. It is in the enum, in the state
machine, and will appear in the §5 dashboard as a bucket that is permanently empty.

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

### Phase 2a — Security and correctness — ✅ **DONE 2026-09-24**

1. ✅ `TICKETS` category registered in `pbac-engine.ts` — 8 permissions, granted per §5.
2. ✅ `assertProjectPermission` on **all 10 handlers** across the 6 route files. The status
   route picks its key from the transition (`approve` / `reject` / `manage`); the comments
   route requires `tickets:internal_notes` on top of `tickets:comment` for a private note.
3. ⬜ Extract `src/lib/ticket-engine.ts` — still to do.
4. ⬜ `onDelete: SetNull` → `Restrict` — still to do.
5. ⬜ Decide `APPROVED` vs `CONVERTED` — still to do.
6. ✅ `__tests__/integration/ticket-permissions.test.ts` — 10 tests. `check:isolation` now
   reports **0 unaccounted for** (was 6).

**Found while doing it — and it is not a ticket bug.** The approval path returned 500 on every
run. Root cause: the local Postgres is **WIN1252**, and the conversion wrote a `🎫` into the
issue description — `character with byte sequence 0xf0 0x9f 0x8e 0xab … has no equivalent in
encoding "WIN1252"` aborts the transaction. The emoji is gone (decoration does not belong in
stored data), but the encoding is the real defect: that database also refuses **Bengali** and
**Chinese**. See DB-1 in `AI-STATUS.md`.

### Phase 2a — remaining

1. Register the `TICKETS` category in `pbac-engine.ts` with the §5 grid.
2. Add `assertProjectPermission` to the five unguarded routes.
3. Extract `src/lib/ticket-engine.ts` (§4.2).
4. Fix `onDelete: SetNull` → `Restrict`, or denormalise `convertedIssueKey` (§3.2).
5. Decide `APPROVED` vs `CONVERTED` (§3.3). Recommended: make conversion a **separate
   deliberate action**, not a side effect of approval — it makes the permission boundary
   meaningful and gives the dashboard a real "approved, awaiting conversion" bucket.
6. Write the six isolation tests. **This is the gate item** — `check:isolation` must report 0
   unaccounted routes.

### Phase 2b — Integration (~1 day)

7. Unify attachments (§4.1) and reuse the existing upload route.
8. Wire `email-outbox` for client-facing transitions: received, info requested, approved,
   rejected.
9. Wire `audit-logger` for approve / reject / convert.
10. Publish `TICKET_DELETED`, or remove it from `sync-engine.ts` (§2).
11. Either implement `dueDate` and the SLA, or drop both columns (§3.4).

### Phase 3a — Client path (~2 days)

`ClientTicketCreateModal.tsx`, `TicketList.tsx`, sidebar entry, tab in `ProjectClient.tsx`.
A client can file a ticket and watch its status. Independently shippable.

### Phase 3b — Triage path (~2 days)

`TicketDetailModal.tsx`: status timeline, public vs internal notes, assign, approve, reject,
request info. A manager can work a queue. Independently shippable.

### Phase 3c — Dashboard (~2 days)

`TicketDashboard.tsx`: the six KPI cards, conversion pipeline, manager workload table. Last
because it is the part you can most afford to defer, and it is meaningless until 3a and 3b have
produced data.

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
