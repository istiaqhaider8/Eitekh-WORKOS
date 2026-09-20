# Production hosting phases

> **Why this file exists.** Three different phase numberings live in this
> repository — `PRODUCTION-ROADMAP.md` runs 1–10 by feature area (its Phase 7
> is *Productivity*), `SECURITY-AUDIT.md` and `CLAUDE-HANDOFF.md` run 1–6 by
> audit area, and the hosting programme below is a third. For several sessions
> the third existed only in conversation, so "Phase 7" meant different things
> depending on which document you had open. It is written down here so that
> stops being true.
>
> When a phase number is used without qualification in a commit message or a
> status report, it means **this** list.

| # | Phase | State | Evidence |
|---|---|---|---|
| 1 | Critical fixes | Done | — |
| 2 | Self-contained artifact | Done | Standalone build runs; 660 MB of build output that should never have shipped removed |
| 3 | Proxy path | Done | `scripts/proxy-drill.mjs` 9/9 |
| 4 | Alerting and scheduler | Done | `scripts/alert-drill.mjs` 11/11, real payload delivered; units in `deploy/` |
| 5 | Durability | Done | `scripts/pitr-drill.mjs` 9/9; RTO 3.2 s / 4.2 s measured |
| 6 | Capacity and soak | Done | 2 h at 98.3%; 45 min with 25 SSE streams at 100.0% |
| 7 | **Security soak** | **In progress** | `scripts/security-soak.mjs` |

Each phase's detail, numbers and — importantly — what it does **not**
establish, live in `DEPLOYMENT.md`. Nothing here supersedes those caveats.

---

## Phase 7 — security soak

### What it is, and why the other testing does not cover it

The repository already has point-in-time security testing, and it is good:
`__tests__/integration/` holds tenant-isolation, authz and leaf-resource
isolation suites, `check-isolation-coverage.mjs` fails the build when a
tenant-scoped route has no isolation test, and `check-route-validation.mjs`
fails it when a route does not validate its body.

All of that answers *"is this control present and correct right now?"*

A soak answers a different question: **"does it still hold after hours of
sustained pressure?"** The failures it is aimed at are the ones that need time
or repetition to appear —

- a rate limiter that holds for one window and drifts across fifty;
- a counter table that grows without bound because its sweep is probabilistic;
- a defence that can be walked around by rotating a header, which a single
  request cannot reveal;
- an alert that fires once and is then muted by its own cooldown for longer
  than anyone realised;
- a session that should have expired and did not;
- a cross-tenant race that only opens under concurrency.

None of those are visible to a test that makes one request and asserts one
status code.

### The rule this phase is held to

**A defence that is not exercised is not verified.** Phase 4 found five stacked
faults behind an alerting system that read as configured and had never fired
once. The same standard applies here: every control this phase claims to have
checked must have been *driven*, with the result recorded, including the
results that are uncomfortable.

### Scope

| Area | Question | Only answerable over time? |
|---|---|---|
| Rate limiting | Does the per-user and per-IP ceiling hold across many windows? | Yes |
| Header trust | Does rotating `X-Forwarded-For` grant fresh budget? | No, but the *size* of the gap needs volume |
| Credential stuffing | Does `auth-failure-spike` fire, and keep firing after its cooldown? | Yes |
| Tenant isolation | Does any cross-tenant probe ever return 200 under concurrency? | Yes |
| Authorization | Does a low-privilege session ever reach a high-privilege route? | Yes |
| Session lifecycle | Are expired and deleted sessions refused? | Partly |
| Audit integrity | Does every security event actually produce a row? | Yes |
| Unbounded growth | Do `RateLimitCounter`, `Session` or audit tables grow without limit? | Yes |

### What this phase will NOT claim

- **It is not a penetration test.** It drives known controls and watches them.
  It does not look for unknown vulnerability classes, and finding nothing here
  is not evidence that nothing is there.
- **It is not a statement about production.** It runs against a local build on
  one host with a local database. No network, no load balancer, no TLS
  termination, no real adversary.
- **A quiet run is weak evidence.** The controls tested are the ones already
  known about. The strongest findings this project has produced this year came
  from someone using the product, not from a drill.
