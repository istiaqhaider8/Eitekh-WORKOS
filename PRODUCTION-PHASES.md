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
| 7 | Security soak | Done | `scripts/security-soak.mjs` 14/14; 111,830 cross-tenant and 178,928 escalation probes, 0 leaks |

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

### The run

900 s at concurrency 8, against the standalone build on the volume database
(121 users, 3 orgs, 50 projects, 20,000 issues), `TRUSTED_PROXY_HOPS=1`.

```
14 passed, 0 failed

cross-tenant attempts    111,830 (22,366 rounds)   leaks 0
privilege escalation     178,928 attempts          reached an admin route 0
rateLimitCounter keys    244 -> 14 over 30 samples (peak 244)
sessions                 3 -> 3
account ceiling          17/25 refused, 17 audit rows written (1:1)
limiter across windows   6/6 passes reached the ceiling
auth-failure-spike       FIRED, then suppressed by its own cooldown
alerts/check during a burst  200 -> 200
```

The rate-limit table is the one worth looking at twice: 244 keys down to 14
across the run, peaking at 244. The probabilistic sweep (1 in 500 requests)
drains it, so it holds a plateau rather than climbing — which is what the
"unbounded growth" question was asked to settle.

Two numbers are reported rather than asserted, and both are residuals that
were already understood: rotating `X-Forwarded-For` still gets 40/40 logins
past the per-IP ceiling at `hops >= 1` (the per-account ceiling is what holds
there, and it did), and `ALERT_WEBHOOK_URL` is unset on this target, so a
firing evaluates correctly and then goes nowhere.

### What it found

**A credential-stuffing run can silence the alert that detects it — at
`TRUSTED_PROXY_HOPS=0`.** `/api/internal/alerts/check` sits behind the same
generic read backstop as public traffic, and with no trusted proxy every
unauthenticated request shares one bucket. Measured both ways:

```
hops=0   120 failed logins -> alerts/check 429   (detector starved)
hops=1   120 failed logins -> alerts/check 200   (unaffected)
```

Mitigated by the production proxy setting, so it is a configuration hazard
rather than a defect — but the boot warning described `0` as "safe but blunt",
which undersells a reproducible loss of detection. Written up in
`DEPLOYMENT.md` under *Trusting the client address*, and now asserted by the
soak whenever it runs against a target with `hops >= 1`.

**A muted alert was indistinguishable from a broken one.** The soak reported
`auth-failure-spike` as failing to fire. It was not broken: it had fired
legitimately minutes earlier during unrelated testing and was inside its
15-minute cooldown, and a suppressed rule left no trace anywhere. That is a
false alarm on a critical control, which is the kind of result that teaches
people to ignore a drill.

`evaluateAlerts()` now records rules that crossed their threshold while
cooling, `/api/internal/alerts/check` returns them as `suppressed`, and the
soak reports that case as **inconclusive** rather than failed — an unexercised
control is not a passing one. The same field answers the question asked after
an incident: why did this not page anyone?

Verified on a clean process afterwards: 30 failed logins →
`fired: auth-failure-spike, value 30, threshold 25`.

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
