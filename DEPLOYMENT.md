# Eitekh WorkOS — Deployment Guide

This guide covers production deployment of Eitekh WorkOS on a Linux VPS or cloud provider.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20 LTS or newer |
| npm | 10+ (ships with Node 20) |
| Git | any recent version |
| OS | Ubuntu 22.04 LTS (recommended) |
| RAM | 1 GB minimum, 2 GB recommended |
| Disk | 10 GB minimum (SQLite database grows over time) |

> **SQLite vs PostgreSQL**: The default database is SQLite (file-based). For production workloads exceeding ~10 concurrent writers or ~100 GB data, migrate to PostgreSQL by changing `DATABASE_URL` in `.env` and running `prisma migrate deploy`.

---

## 1. Clone & install

```bash
git clone https://github.com/istiaqhaider8/Eitekh-WORKOS.git
cd Eitekh-WORKOS
npm ci --omit=dev
```

---

## 2. Environment variables

Copy the template and fill in every value:

```bash
cp .env.example .env
nano .env
```

### Required variables

| Variable | Description | How to generate |
|---|---|---|
| `JWT_SECRET` | 32+ char random string for signing JWTs | `openssl rand -base64 48` |
| `FIELD_ENCRYPTION_KEY` | 64-char hex key for field-level encryption | `openssl rand -hex 32` |
| `DATABASE_URL` | SQLite path or PostgreSQL DSN | `file:./data/prod.db` |
| `NODE_ENV` | Must be `production` | literal |
| `NEXTAUTH_URL` / `BASE_URL` | Public URL of the app | e.g. `https://workos.mycompany.com` |

### Optional but recommended

| Variable | Description |
|---|---|
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | SMTP relay for email (password resets, invites) |
| `EMAIL_FROM` | Sender address (default: `noreply@eitekh.com`) |
| `FORCE_HTTPS` | Set to `true` if TLS is terminated by a reverse proxy |

---

## 3. Database setup

```bash
# Generate Prisma client
npx prisma generate

# Apply all migrations (safe for production — does not wipe data)
npx prisma migrate deploy

# (Optional) Seed with demo data
node prisma/seed.js
```

Ensure the SQLite database file directory is writable by the process user and **is backed by full-disk encryption** (e.g. LUKS on Linux). The backup utility at `GET /api/super-admin/backup` can also produce on-demand snapshots.

---

## 4. Build

```bash
npm run build
```

The build output lives in `.next/`. The build must complete without errors before proceeding.

---

## 5. Run

### Systemd service (recommended)

Create `/etc/systemd/system/workos.service`:

```ini
[Unit]
Description=Eitekh WorkOS
After=network.target

[Service]
Type=simple
User=workos
WorkingDirectory=/opt/workos
ExecStart=/usr/bin/node_modules/.bin/next start -p 3000
Restart=always
RestartSec=5
EnvironmentFile=/opt/workos/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now workos
sudo journalctl -fu workos   # tail logs
```

### PM2 alternative

```bash
npm install -g pm2
pm2 start npm --name workos -- start
pm2 save && pm2 startup
```

---

## 5b. Container (Phase 2)

`next.config.mjs` sets `output: "standalone"`, so the build emits a
self-contained server in `.next/standalone` that runs with `node server.js`
and nothing else — no repository, no `npm ci` on the target, no network at
deploy time.

```bash
docker build -t eitekh-workos .
docker run --rm -p 3000:3000 --env-file .env.production eitekh-workos
```

The image is multi-stage: the build needs the full dependency tree, the Prisma
CLI and the source; the runtime needs none of them. It runs as a non-root user
and carries a `HEALTHCHECK` against `/api/health`, which checks the database
too — so an unhealthy container is one that cannot do its job, not merely one
whose process is alive.

### Two things that bite the first time

**Static assets are not traced into `standalone`.** `.next/static` and
`public/` must be copied alongside it, which the Dockerfile does explicitly.
Miss them and the app boots, serves HTML, and every script, style and font
404s.

**Check what ends up in the image.** The first standalone build here was
**766 MB** and had copied the entire project root — including `storage/`,
where local-fs attachments live. A layer is readable by anyone who can pull
the image, and deleting a file in a later instruction does **not** remove it
from the layer that added it. `outputFileTracingExcludes` now keeps user
data, backups, tests and build-only tooling out, and `.dockerignore` is the
second line of defence.

After that: **106 MB**, with no user data in it.

### If `node_modules` looks enormous

On Windows, a `prisma generate` that fails with `EPERM` — which happens when
a running process holds the query engine — leaves a 19 MB
`query_engine-*.tmpNNNNN` behind, every time. Thirty-six of them had
accumulated here: **684 MB** in `node_modules/.prisma` alone.

```bash
find node_modules/.prisma -name "*.tmp*" -delete
```

Stop anything holding the engine first (the dev server, a load test, a
migration script), or the next generate leaks another one.

---

## 6. Reverse proxy (Nginx + TLS)

Install Nginx and Certbot, then create `/etc/nginx/sites-available/workos`:

```nginx
server {
    listen 80;
    server_name workos.mycompany.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name workos.mycompany.com;

    ssl_certificate     /etc/letsencrypt/live/workos.mycompany.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/workos.mycompany.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    # Proxy to Next.js
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;  # needed for SSE connections
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/workos /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d workos.mycompany.com
```

Set `FORCE_HTTPS=true` in `.env` after enabling TLS.

---

### Trusting the client address (REQUIRED)

`TRUSTED_PROXY_HOPS` must be set, and the server refuses to start without it.
It is the number of proxies between the internet and the app — `1` for the
Nginx configuration above.

`X-Forwarded-For` is a chain the **client** starts and each proxy appends to,
so the leftmost entry is whatever the caller typed. The rate limiter used to
read it, which meant any caller could get a fresh per-IP budget by rotating the
header. That was demonstrated against a running server:

```
X-Forwarded-For: 203.0.113.10   ->  remaining 99, 98, 97
X-Forwarded-For: 198.51.100.77  ->  remaining 99, 98, 97   <- a new budget
```

The per-IP ceiling is what stands in front of the unauthenticated routes, so
that was a bypass of login throttling. The chain is now read from the right,
by the configured hop count.

### Proving the proxy path

```bash
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 1 -nodes   -subj "//CN=localhost" -addext "subjectAltName=IP:127.0.0.1"

node scripts/proxy-drill.mjs --app http://127.0.0.1:3000 --cert cert.pem --key key.pem
```

It stands a TLS terminator in front of the running app that appends to
`X-Forwarded-For` exactly as `proxy_add_x_forwarded_for` does, then asserts
the things a misconfigured proxy silently breaks:

| Check | Why it matters |
|---|---|
| A caller **cannot** change its rate-limit bucket by rewriting `X-Forwarded-For` | the login-throttle bypass |
| HSTS, CSP and `X-Frame-Options` survive the proxy | a proxy can drop response headers |
| A mutating request from a foreign `Origin` is refused | a proxy rewrites `Host`; get it wrong and everything looks same-origin |
| **The app port is not reachable off-host** | the residual below |

Measured here: **9/9**, with the bucket holding steady across three different
claimed client addresses.

> **The application port must not be reachable except through the proxy.**
> With one trusted hop, a request that skipped Nginx carries a chain
> indistinguishable from a genuine one, and no application code can tell them
> apart. Bind the app to `127.0.0.1` (or a private interface) and let only
> the proxy reach it. This is a requirement, not a hardening tip.

---

## 7. Security checklist before going live

- [ ] `NODE_ENV=production` — enables secure cookies, strict error handling
- [ ] `JWT_SECRET` is unique and at least 32 characters
- [ ] `FIELD_ENCRYPTION_KEY` is set (64 hex chars, generated with `openssl rand -hex 32`)
- [ ] SQLite database file is on an encrypted volume (LUKS / dm-crypt)
- [ ] TLS is enabled on the public endpoint (no plain HTTP)
- [ ] Firewall blocks all ports except 80 and 443 (app binds on 3000, only accessible via Nginx)
- [ ] Automated SQLite backups scheduled (cron calling `POST /api/super-admin/backup`)
- [ ] **Recurring tasks scheduled** — see "Scheduled work" below. Without this they never run.
- [ ] **Data retention scheduled** — see "Scheduled work" below.
- [ ] Health check monitored: `GET /api/health`
- [ ] SMTP credentials are app-specific passwords, not primary account passwords
- [ ] `BASE_URL` set to the public URL (email links use it; unset means links point at localhost)
- [ ] `NEXT_PUBLIC_APP_URL` matches `BASE_URL`
- [ ] **Mail authentication verified** — `npm run check:email-dns` exits 0 (see below)

---

## 6b. Accessibility (D3)

Three checks run in CI. Two are ratchets on existing debt; one is an absolute
gate that is currently at zero.

| Command | What it does | Current |
|---|---|---|
| `npm run check:a11y` | static scan of JSX; fails if any file gets worse | 450 known, ratcheted |
| `npm run test:a11y` | **axe in a real browser, both themes** | **0 critical, 0 serious** |
| (same command) | focus-behaviour checks axe cannot perform | **8/8 passing** |

### The axe audit

`npm run test:a11y` boots a server against a scratch database, seeds a project
if the database has none, signs a session, and drives Chrome through eight
pages in **both light and dark**, running axe against `wcag2a`, `wcag2aa`,
`wcag21a` and `wcag21aa`.

It uses the machine's own Chrome through `playwright-core` rather than a
bundled browser. A check that costs a 150 MB download per CI run is a check
that gets disabled.

Critical and serious violations fail against `axe-baseline.json`, which is
currently **0 across all 16 page/theme combinations**. Moderate and minor are
reported and do not fail — not because they do not matter, but because failing
on all four levels at once means the baseline never gets smaller.

**Checking both themes is not optional.** Raising muted text from `slate-400`
to `slate-500` fixed the light theme and broke the dark one wherever an element
had no `dark:` override — `settings/profile [dark]` went from 5 violations to
12. A light-only audit would have reported an unambiguous improvement.

### The focus checks

axe inspects a static snapshot, and focus behaviour only exists while keys are
being pressed. `scripts/check-focus.mjs` drives the real issue dialog and
asserts: focus moves in on open, Tab and Shift+Tab wrap inside it, Escape
closes, and focus returns to whatever opened it.

`aria-modal="true"` is a promise the markup makes and only the behaviour keeps.
Twelve components made it; nothing enforced it until `src/hooks/useFocusTrap.ts`.

### What the static ratchet still covers

`a11y-baseline.json` holds 450 known findings — unnamed icon buttons, and
`onClick` handlers on non-focusable elements. It may go down freely and cannot
go up. These are the ones that need a human to say what each control does; a
mechanical rewrite would produce labels that pass the check and tell a user
nothing.

### What is still not verified

- **Only eight pages are audited.** The super-admin surface, the other project
  views (list, calendar, timeline, workload, analytics) and most modals are
  not. Add them to `PAGES` in `scripts/check-axe.mjs`.
- **Moderate and minor axe violations** are recorded but not enforced.
- **Screen-reader testing with an actual screen reader.** Passing axe is not
  the same as being usable with NVDA or VoiceOver, and no substitute for
  trying it.

> A VPAT could now be started for the audited surface. It could not be
> completed, because most of the app has not been audited.

---

## 6a. Mail authentication (C2) — SPF, DKIM, DMARC

**Run `npm run check:email-dns` against the real sending domain before launch,
and again whenever the domain or the mail provider changes.**

```bash
npm run check:email-dns -- --domain eitekh.com
# or, if your DKIM selector is unusual:
npm run check:email-dns -- --domain eitekh.com --selector mySelector
```

### Why this is a launch blocker and not a nicety

Without these records mail is still *accepted* by the provider and *delivered
to spam* by the recipient. The application reports success in both cases —
`sendEmail` returns SENT, the outbox row says SENT, the log says SENT. There is
no signal anywhere in the system that anything is wrong.

The flows this breaks are the ones a locked-out user cannot work around:
password reset, OTP, invitation. "Check your spam folder" is a poor answer to a
customer who cannot get in, and a worse one to a prospect evaluating you.

### What each record does

| Record | Answers | Failure if missing |
|---|---|---|
| **SPF** | which servers may send as this domain | receivers cannot distinguish you from a spoofer |
| **DKIM** | was this message signed by the domain owner | the message cannot be shown to be unmodified |
| **DMARC** | what to do when SPF and DKIM fail, and where to report | receivers decide for themselves, usually unfavourably |

### Getting them right

1. **SPF** — exactly ONE `v=spf1` TXT record on the apex. Two records is a
   permanent error (RFC 7208) and worse than having none. End with `~all` or
   `-all`; `+all` authorises the entire internet and is equivalent to no SPF.
2. **DKIM** — published by your provider at `<selector>._domainkey.<domain>`.
   Note that an *empty* `p=` means the key is **revoked**, and looks identical
   to a working record in a DNS lookup. The checker flags this specifically.
3. **DMARC** — a `_dmarc.<domain>` TXT record. Start at `p=none` with a `rua=`
   address to collect reports without affecting delivery, read the reports for
   a couple of weeks, then move to `quarantine` and `reject`. Without `rua=`
   you will never see the reports, which defeats the point of starting at
   `none`.

### What the checker cannot tell you

That the records are correct *for your provider*. A DKIM selector left over
from a provider you no longer use parses exactly like a working one. After the
checker passes, **send a real message to a Gmail account and read the
`Authentication-Results` header** — it will say `spf=pass dkim=pass
dmarc=pass`, or tell you which one does not. There is no substitute for that
step and the checker says so on success.

> **Status at time of writing:** NOT VERIFIED for this deployment. There is no
> public sending domain yet, so there is nothing to check. The verification is
> executable and is a checklist item above rather than a claim.

---

## 7a. Scheduled work (REQUIRED — nothing schedules itself)

The application has **no internal scheduler**. Anything time-based must be driven by an external
cron, systemd timer, or platform scheduler. If you skip this section the features below are
silently inert — they will appear configured in the UI and simply never execute.

| What | Endpoint | Suggested cadence |
|---|---|---|
| Recurring tasks | `POST /api/recurring-tasks/trigger` | every 15 min, or hourly |
| Data retention purge | `POST /api/super-admin/jobs` (retention job) | daily, off-peak |
| Database backup | `POST /api/super-admin/backup` | daily |

**Recurring tasks are authenticated by a SECRET, not a session** (changed; see below).
The others still authenticate as a super-admin, so use a dedicated service account for them.

```cron
*/15 * * * * curl -fsS -X POST https://your-domain/api/recurring-tasks/trigger -H "x-cron-secret: $RECURRING_TASKS_SECRET" >> /var/log/eitekh-cron.log 2>&1
15 3   * * * curl -fsS -X POST https://your-domain/api/super-admin/backup      -H "Cookie: token=$SERVICE_TOKEN"              >> /var/log/eitekh-cron.log 2>&1
```

> **BREAKING as of H5.** `POST /api/recurring-tasks/trigger` previously accepted any
> authenticated session. It processes **every tenant's** due tasks, so that meant any user
> who could log in could fire every other organization's schedule, create issues in projects
> they cannot see, and have their own name recorded as the reporter on them. It now requires
> `RECURRING_TASKS_SECRET` in the `x-cron-secret` header (or as a Bearer token), the same
> shape as `/api/internal/alerts/check`. **With the variable unset the route returns 503 and
> creates nothing** — set it, or recurring tasks stop running. A crontab still sending a
> session cookie will get 403.

> **Changed: recurring tasks now keep the schedule they were given.** Until this release every
> cadence fired **daily** — `getNextCronDate` ignored its argument — so WEEKLY tasks ran seven
> times and MONTHLY tasks about thirty times more often than configured. `scheduleCron` accepts
> `DAILY`, `WEEKLY` or `MONTHLY`; a row holding anything else keeps firing daily and now logs
> `RECURRING_TASK_UNKNOWN_SCHEDULE` naming the task.
>
> **Expect volume to drop after you deploy this.** That is the fix working, not tasks failing.

> **Known gaps as of 2026-09-18** — see [`PRE-PRODUCTION-VERIFICATION.md`](PRE-PRODUCTION-VERIFICATION.md):
> **automation rules** and **webhooks** have CRUD endpoints and UI but **no execution engine at
> all**, so no schedule will make them fire. Do not promise those features to customers yet.

---

## 8. Updating

```bash
git pull origin main
npm ci --omit=dev
npx prisma migrate deploy
npm run build
sudo systemctl restart workos
```

---

## 9. Rollback

```bash
git checkout <previous-tag>
npm ci --omit=dev
npm run build
sudo systemctl restart workos
# Prisma down migrations are not supported for SQLite — restore from backup if needed.
```

---

## 10. API documentation

The OpenAPI 3.0 spec is served at `/api/docs`. View it with any Swagger UI:

```
https://editor.swagger.io/?url=https://workos.mycompany.com/api/docs
```

---

## Support

Open an issue at [github.com/istiaqhaider8/Eitekh-WORKOS/issues](https://github.com/istiaqhaider8/Eitekh-WORKOS/issues).

---

## Monitoring and alerting (PROD-7)

### Proving an alert reaches a human

```bash
node scripts/alert-drill.mjs --app http://127.0.0.1:3000 --secret "$ALERT_CHECK_SECRET"
```

The app must be running with `ALERT_CHECK_SECRET` and `ALERT_WEBHOOK_URL`
pointing at the drill's receiver. It induces 30 failed logins from distinct
source addresses, calls the evaluation endpoint the way cron does, and waits
for the webhook. **11/11** here, with a real payload delivered.

> **These alerts had never fired, and could not have.** Four separate faults,
> each one hiding the next, so each was only findable once the one above it
> was fixed:
>
> 1. `auth-failure-spike` watched `LOGIN_FAILED`, `AUTH_FAILED` and
>    `RATE_LIMIT_EXCEEDED` — **names nothing in the codebase emits**.
> 2. The closest real event, `AUTH_LOGIN_FAILED`, was written by
>    `logAuditEvent`, which persists a row to Postgres and does **not** touch
>    the process counters the rules read. Audit and telemetry are different
>    systems; the login route used only the first.
> 3. Counters incremented in **middleware never reached the evaluation at
>    all**. Next bundles middleware separately from route handlers, so the
>    counters singleton was duplicated — verified by logging
>    `AUTH_RATE_LIMITED` four times from middleware and watching `/api/health`
>    report it **absent**.
> 4. The login route has its **own** limiter, tighter than the middleware's,
>    and both of its refusal paths called `logAuditEvent` and nothing else. So
>    the first and strictest line of defence — the one a real attack actually
>    meets — was still silent.

All four are fixed: (3) by pinning the counter store to `globalThis`, the way
`prisma.ts` and `sync-engine.ts` already pin theirs, and (4) by emitting
`logger.security` alongside the audit row on both throttle paths.

The difference (4) makes, measured on this host — 40 failed attempts from one
address against one account, before and after:

| counter | before | after |
| --- | --- | --- |
| `action.AUTH_LOGIN_FAILED` | 8 | 8 |
| `action.AUTH_RATE_LIMITED` | 10 | 30 |
| `action.AUTH_ACCOUNT_LOCKED` | — | 2 |
| **total the rule sees** | **18** | **40** |

The threshold is 25. Before the fix, forty consecutive attempts on one account
summed to eighteen and **the alert stayed silent** — the 22 refusals the route
itself issued were counted by nothing. `action.AUTH_ACCOUNT_LOCKED` is now one
of the rule's keys because it is the signal a **distributed** attack produces:
the per-IP ceiling is evaded by spreading the source, the per-account one is
not.

`shared-store-unavailable` was also structurally unable to fire, for reason
(3) — it watches `RATE_LIMIT_UNAVAILABLE`, which only middleware emits. The
`globalThis` fix repairs that rule too.

> **Re-running the drill needs a quiet process.** The drill's own baseline call
> is a real evaluation, so if the server has already accumulated auth failures
> that call fires the rule and consumes its fifteen-minute cooldown. The
> induced spike is then correctly suppressed, and the drill reports two
> failures that look exactly like a broken alert. It now detects this and says
> so; restart the server for a clean run.

### Scheduled endpoints and CSRF

```
curl -X POST https://host/api/internal/alerts/check -H "x-alert-secret: …"
-> 403 Forbidden: missing Origin header      (before this release)
```

Every mutating request required an `Origin` header and cron sends none —
so **none of the three scheduled jobs in §7a could run at all**, as documented.
Supplying one did not help either, because the allow-list is the app's public
URL and a scheduler on the same host calls `127.0.0.1`.

Secret-authenticated endpoints are now exempt from the Origin check. That is
safe because CSRF exists to stop a browser attaching a victim's **cookies**
automatically; these routes ignore cookies entirely and authenticate on a
header a cross-origin page cannot set without a preflight. Session-authenticated
endpoints — including `/api/super-admin/backup` — still require `Origin`, so a
crontab calling those must send `-H "Origin: https://your-domain"`.

### The scheduler itself

Fixing the 403 made the endpoints reachable. It did not make anything call
them — and an alert rule nobody evaluates is not a safety net, it is a belief.

Ready-to-install units are in [`deploy/`](deploy/): systemd timers and services
in [`deploy/systemd/`](deploy/systemd/), an `/etc/cron.d` equivalent in
[`deploy/cron/eitekh.crontab`](deploy/cron/eitekh.crontab), and the install and
verification steps in [`deploy/README.md`](deploy/README.md). They cover alert
evaluation (every 5 minutes), recurring-task generation (hourly) and the
nightly encrypted backup.

Three things in there are load-bearing and easy to get wrong:

- **`curl --fail`.** Without it curl exits 0 on any response it received, so a
  permanently rejected alert check (403, wrong secret) looks identical to a
  permanently healthy one. With it, the unit fails and you can see it.
- **Secrets in `/etc/eitekh/alerts.env`, mode 0600** — not in the unit file
  (world-readable, so `systemctl cat` prints them) and not on the cron command
  line (visible in `ps` for the duration of every run).
- **Point `APP_URL` at one instance, not a load balancer.** Alert state — the
  previous counter sample and the per-rule cooldowns — is per-process. Spread
  round-robin, every call lands on a process that has never sampled, so every
  window reads as an enormous delta and the cooldown never applies.

**Status: written, not executed.** This host is Windows; there is no systemd
and no cron here, so the units have not been loaded, have not been seen to
fire, and `systemd-analyze verify` has not been run. What *is* verified is the
endpoint they call, end to end, by `scripts/alert-drill.mjs` — the schedule
around it is the unproven part. That is why the install instructions end with a
manual `systemctl start` and a look at the journal.


Before this section existed, `logger.ts` wrote to `console.*` and nowhere else: no sink, no
aggregation, no alerting. You would have learned about production incidents from customers.

> A note on history: OPS-3 ("No monitoring or alerting") was once marked COMPLETED with the
> justification *"health endpoint + logging"*. A health endpoint tells you the process is alive.
> It does not tell you that 4% of requests are failing, or that someone is brute-forcing a login.
> Do not re-close this on the same reasoning.

### What ships in the codebase

| Piece | Where | What it does |
|---|---|---|
| Telemetry seam | [`src/lib/telemetry.ts`](src/lib/telemetry.ts) | One place every error and structured log passes through, with a pluggable transport |
| Scrubbing | same file | Removes secrets and PII **before** anything leaves the process |
| Logger integration | [`src/lib/logger.ts`](src/lib/logger.ts) | Every `logger.*` call ships, including `SECURITY` and `AUDIT` |
| Unhandled errors | `onRequestError` in [`src/instrumentation.ts`](src/instrumentation.ts) | Catches server errors that never reach a `try/catch`, including in Server Components |
| Counters | `/api/health` | The numbers the alerts below threshold on |

### Required configuration

```bash
# Where events are shipped. Unset means console-only: nothing is aggregated and
# nothing can alert. The app logs a loud startup warning in production if unset.
TELEMETRY_ENDPOINT="https://<your-collector>/ingest"

# Optional; sent as `Authorization: Bearer <key>` when present.
TELEMETRY_API_KEY="..."

# Optional but strongly recommended: lets a stack trace be mapped to a build.
RELEASE_SHA="$(git rev-parse HEAD)"
```

The transport posts JSON and is deliberately vendor-neutral. Sentry, Datadog, Axiom, Grafana Loki
and an OTLP collector all accept a JSON POST; pointing at a specific one is an adapter implementing
`TelemetryTransport`, not a refactor.

### What is scrubbed, and verified

Scrubbing runs on every event, over every string however deeply nested, including error messages
and stack frames — which is where secrets usually hide, since there is no key to match on.

Removed: database URLs with inline passwords, JWTs, `Bearer` tokens, `sk_/pk_/rk_` provider keys,
GitHub tokens, 64-hex values (the shape of `FIELD_ENCRYPTION_KEY`), the session cookie, and email
addresses. Key-based redaction (`password`, `token`, `secret`, `mfaSecret`, …) runs first.

Verified by 17 tests in [`src/lib/__tests__/telemetry.test.ts`](src/lib/__tests__/telemetry.test.ts),
including the acceptance criterion's deliberate error carrying a fake token and a customer email.

### Client-side errors

Browser errors are reported to `POST /api/telemetry/client` and flow through the same scrubbing
seam. Three sources are covered: React error boundaries (`error.tsx` and `global-error.tsx`),
`window.onerror`, and unhandled promise rejections — the last two matter because a boundary sees
none of them.

The endpoint is deliberately **unauthenticated**: the errors most worth having happen on the login,
registration and password-reset pages, where there is no session. It is bounded by a strict schema,
short length caps, no response body, and the middleware's mutation rate limit.

### The five alerts

They are implemented in [`src/lib/alerts.ts`](src/lib/alerts.ts) and evaluated by
`POST /api/internal/alerts/check`. **Call that on a schedule** — a platform cron, an external
uptime checker, or a Kubernetes CronJob:

```bash
# every minute
curl -fsS -X POST https://<host>/api/internal/alerts/check   -H "x-alert-secret: $ALERT_CHECK_SECRET"
```

```bash
ALERT_CHECK_SECRET="<a long random string>"   # required; the route refuses without it
ALERT_WEBHOOK_URL="https://hooks.slack.com/..." # Slack, PagerDuty, Opsgenie or any JSON receiver
```

Each rule compares the change since the previous call, not a running total, and has a 15-minute
cooldown — an alert that repeats every cycle is one people mute. Firings with no webhook configured
are still logged locally, so an operator without one is slower rather than blind.

> Alert state is per process. With several instances each evaluates its own counters, so the same
> condition can page once per instance. Deduplicate in the receiver, or point the schedule at one
> instance.

Thresholds below are what the code ships with.

| Alert | Signal | Suggested threshold |
|---|---|---|
| **5xx rate** | `counters["events.error"]` growth vs request volume | > 1% of requests over 5 min, or any sustained increase after a deploy |
| **Auth-failure spike** | `counters["action.LOGIN_FAILED"]`, `action.RATE_LIMIT_*` | > 5× the trailing hour's baseline over 5 min |
| **DB pool exhaustion** | `db.latencyMs` climbing, `health.db_unreachable` > 0, `status: "error"` | **> 50 ms sustained** (measured baseline is 1–2 ms under a 6-minute soak, so 500 ms was two orders of magnitude too loose to be an early warning), or any `db_unreachable` |
| **Store unavailable** | `counters["RATE_LIMIT_UNAVAILABLE"]`, `counters["SYNC_BUS_LISTEN_FAILED"]` | any occurrence — the limiter fails **closed**, so this is user-visible |
| **SSE connection count** | `realtime.openConnections` | flat-lining at 0 with live traffic, or unbounded growth over a soak |

`SYNC_BUS_LISTEN_FAILED` deserves a word: real-time fan-out degrades to polling rather than
breaking, so nothing looks wrong from outside. Without an alert, "real-time quietly became
single-instance again" is invisible — which is the failure PROD-4 exists to prevent.

### Verifying it before you trust it

`scripts/telemetry-collector.mjs` is a local receiver that speaks the same JSON POST a real
collector does. Use it to prove the pipeline end to end without sending anything off the machine:

```bash
node scripts/telemetry-collector.mjs --port 4318 --out events.jsonl

TELEMETRY_ENDPOINT=http://127.0.0.1:4318/ingest ALERT_WEBHOOK_URL=http://127.0.0.1:4318/alerts ALERT_CHECK_SECRET=local-verification RELEASE_SHA=$(git rev-parse --short HEAD) npm start
```

Then trigger a deliberate error and inspect `events.jsonl`. This was run against the production
build on 2026-09-19: an error carrying a fake API key, a customer email address, a database
password inside a stack frame, and a token in a query string arrived with **all four redacted** and
the event still useful, and the error-rate alert fired and was delivered.

### What is NOT done

**No error-tracking vendor is provisioned, so nothing is shipped anywhere until you set
`TELEMETRY_ENDPOINT`.** The pipeline is built and proven against a local collector; choosing the
destination is a deployment decision, not a code change.

Source maps are not uploaded anywhere, so production stack traces will be minified until a vendor
is chosen and a map-upload step is added to the build.

These thresholds have now been checked against measured baselines (see "Load and soak results"
below) — the database-latency one was two orders of magnitude too loose and has been tightened.

They have still never seen PRODUCTION traffic, on production hardware, through a load balancer.
Re-check them once there is real traffic; a threshold calibrated on a developer machine with a
local database will be wrong in the direction of not firing.


---

## Attachment storage (B3)

**`STORAGE_DRIVER` is required in production and the server refuses to start without it.**

Without a store, uploaded files are kept base64-encoded in a Postgres column. One upload then
inflates four things at once — the table, every backup (and so the restore time, and so your
RTO), replication, and server memory, because a base64 column is read whole and there is no
streaming part of a text value. On a public host it is also amplification: one request from the
uploader, paid for by you on every backup thereafter.

### Choosing a backend

```bash
STORAGE_DRIVER="s3"
S3_BUCKET="eitekh-attachments"
S3_REGION="eu-west-2"
S3_ACCESS_KEY_ID="…"
S3_SECRET_ACCESS_KEY="…"
S3_ENDPOINT="https://<account>.r2.cloudflarestorage.com"   # omit for AWS
S3_SIGNED_URL_TTL_SECONDS="600"                            # 30–3600
```

This speaks plain S3, so AWS, Cloudflare R2, Backblaze B2, DigitalOcean Spaces and MinIO all
work. Downloads are served as a short-lived **presigned URL**: the bytes go from the store to
the browser and never through the application. The URL is minted only after the project access
check, and expires quickly so one copied out of a network tab is useless by the time it is
pasted.

A directory is also supported, and is the right choice for development:

```bash
STORAGE_DRIVER="local-fs"
STORAGE_FS_ROOT="/var/lib/eitekh/attachments"
STORAGE_FS_SHARED="1"     # ONLY if this is genuinely a shared volume
```

> **The boot guard refuses `local-fs` in production unless `STORAGE_FS_SHARED=1`.** A local
> directory is not visible to other instances, so an attachment uploaded through one would be a
> 404 through another — intermittently, depending on which instance the load balancer picked,
> which is the worst way for a fault to present. Set it only for NFS/EFS or a single instance
> by design.

### Verifying your store

Before migrating anything, prove the credentials and the bucket actually work:

```bash
node scripts/storage-drill.mjs
```

It round-trips binary content, **redeems a presigned URL with no credentials**
(which is what a browser does), checks the URL expires and carries the right
filename, and confirms traversal keys are refused. Presigning is where an S3
misconfiguration hides: a wrong region, a clock skew or path-style addressing
all surface as one opaque `SignatureDoesNotMatch`.

Measured locally against MinIO: **12/12**.

### What moving attachments out actually buys

Measured on this codebase — 400 attachments, 200 MB of files:

| | Attachment table | Backup |
|---|---|---|
| base64 in the database | **277.4 MB** | carries all of it |
| after migration, both copies | 277.4 MB | — |
| after dropping `fileUrl` | **0.2 MB** | **0.17 MB** |

The 277 MB from 200 MB of files is base64's 4/3 inflation. Note the middle row:
immediately after the backfill the database is **not** smaller, because both
copies exist deliberately. The space returns when `fileUrl` is dropped, which
is a separate migration to run once the object store has a backup of its own.

Backup drill with the files in the store: **16/16**, dump 0.17 MB.

### Migrating existing attachments

```bash
node scripts/migrate-attachments.mjs --dry-run     # report only
node scripts/migrate-attachments.mjs               # move them
```

Safe to run while the application serves traffic, and safe to re-run. For each file it writes to
the store, **reads it back and compares a hash**, and only then records `storageKey`. A crash
at any point leaves a row still served from `fileUrl`; the worst case is an orphaned object,
which costs storage rather than data.

`fileUrl` is **not** cleared. Dropping the old copy is a separate migration, to be written once
the object store has a backup of its own. One irreversible step at a time.

Three states coexist during the migration and all three are served: `storageKey` set, an
`http(s)` `fileUrl`, and a legacy `data:` `fileUrl`. That is what makes this a background
job rather than a deployment step.

---

## Backup and restore (A1)

> Read this before you need it. The restore is the half that decides whether the backups were
> worth taking, and it is the half nobody rehearses.

### What the application does and does not do

The app **does not take backups**. There is no "create backup" button, and that is deliberate:
triggering a database-wide dump from an HTTP request would mean the web process holds
bulk-export credentials and writes every tenant's data to local disk, and one admin's click
could fill the disk the database runs on.

`GET /api/super-admin/backups` reports only what it can see. An empty list there is **not** a
statement that backups are missing — it usually means they are correctly stored off-host.

### Choose one of these two

| | Recovery point | Effort | Use when |
|---|---|---|---|
| **Provider PITR** (recommended) | seconds | configuration | Your managed Postgres offers it — RDS, Cloud SQL, Neon, Supabase all do |
| **Scheduled `pg_dump`** | up to one interval | a cron job | PITR is unavailable, or you want a second copy under your own control |

**Prefer PITR.** A nightly dump means a bad afternoon costs a day of everyone's work. Use the
dump as a *second* line, not the only one.

### Taking a dump

```bash
DATABASE_URL="postgresql://..." node scripts/db-backup.mjs --label nightly
```

It refuses rather than improvising if `pg_dump` is missing, deletes any partial file on failure,
and treats a suspiciously small dump as a failure. Output is `--format=custom`, so `pg_restore`
can work selectively and in parallel — which matters when the restore is what stands between you
and being down.

**Copy it off-host.** A backup on the same disk as the database does not survive the failure it
exists for. `BACKUP_RETAIN` only controls local pruning.

### Restoring — the part to rehearse

```bash
# 1. Always restore into a scratch database first, never straight over production.
node scripts/db-restore.mjs \
  --file backups/<dump> \
  --url "postgresql://.../eitekh_restore_drill" \
  --verify "postgresql://.../eitekh_production"
```

The script refuses a target that looks like production, and refuses any database that already
holds rows, unless given `--force`. Both guards exist because this gets run by tired people.

**`pg_restore` exiting 0 is not proof.** It can finish having skipped rows. `--verify` runs
`scripts/db-verify-restore.mjs`, which compares row counts *and* primary-key checksums table by
table — the second catches the case a row count misses: same number of rows, different contents.

```bash
# Verify independently at any time:
node scripts/db-verify-restore.mjs <source-url> <restored-url>
```

Exit 0 means every table matched. It refuses to compare a database with itself, and fails if the
source is empty, because both would pass while proving nothing.

### This drill runs in CI

`.github/workflows/ci.yml` performs a full dump → restore → verify against the seeded database on
**every run**. A drill that depends on someone remembering to do it is a drill that stops
happening.

That covers the mechanism. It does **not** cover your production data volume, so once there is
real data, run the drill against a production-sized copy and record the timing.

### Record these, and keep them current

| Fact | Value |
|---|---|
| Mechanism (PITR / dump / both) | _decide and record_ |
| Where dumps are stored off-host | _record_ |
| Retention, and its monthly cost | _record_ |
| Last rehearsed restore | _date_ |
| **How long a full restore took** | _seconds — this is your RTO_ |
| Who to call if it fails | _record_ |

The restore duration is the number people guess at and get badly wrong. `db-restore.mjs` prints
it as `RECORD THIS:` — put it in the table.

### If you are restoring for real, right now

1. **Stop writes.** Put the app in maintenance or scale it to zero, or you will restore into a
   moving target and lose whatever lands in between.
2. Restore into a **scratch** database and verify it.
3. Only then decide whether to promote it, or to repoint `DATABASE_URL` at the scratch database
   — often faster and always less destructive than restoring over the original.
4. Keep the damaged database. It is evidence, and it may hold rows the backup does not.
5. After service is back: write down what happened while it is fresh.

### Known gaps

- **The `pg_dump` path has not been rehearsed on a developer machine**, because no PostgreSQL
  client binaries are installed there. It is exercised in CI on every run. Rehearse it on the
  host that will actually run it before relying on it.
- **Dumps are not encrypted at rest by this script.** If your storage does not encrypt by
  default, encrypt before upload — the dump contains every tenant's data.
- **`prisma/dev.db` still holds pre-migration data** (CP-525–529 exist only there) and is not
  covered by any of this.


---

## Load and soak results (A2)

Measured 2026-09-19 against the production build and the 20,000-issue volume dataset, using
[`scripts/loadtest.mjs`](scripts/loadtest.mjs). Before this, every performance decision in the
codebase had been made one request at a time.

### Baselines — 40 concurrent users, 6-minute soak

13,699 requests, 37.9 req/s, 96.6% success.

| Journey | p50 | p95 | p99 | max |
|---|---|---|---|---|
| Board load | 37 ms | 74 ms | 125 ms | 224 ms |
| Issue open | 40 ms | 79 ms | 117 ms | 219 ms |
| Issue update | 46 ms | 103 ms | 176 ms | 319 ms |
| Search | 44 ms | 83 ms | 132 ms | 362 ms |

Comfortably inside the 500 ms p95 target. Latency did not drift over the run, database latency
stayed at 1–2 ms, and nothing leaked.

The 3.4% non-2xx is legitimate: 403s where the acting user holds a project role that may not edit,
and 400s from validation. Those are the application working.

### The knee — and it is the connection pool

| Users | Board p95 | Issue open p95 | Issue update p95 | req/s |
|---|---|---|---|---|
| 40 | 74 ms | 79 ms | 103 ms | 37.9 |
| 80 | 312 ms | 308 ms | **466 ms** | 71.2 |

Throughput roughly doubles; latency roughly quadruples. At 80 users, issue update is at 466 ms
against a 500 ms target — that is the knee.

**The constraint is the Prisma connection pool, not the application.** `DATABASE_URL` sets no
`connection_limit`, so Prisma defaults to `num_cpus * 2 + 1` — 25 on the 12-core machine used
here, which is exactly where observed connections pinned at both 40 and 80 users.

So before launch:

1. Set `connection_limit` explicitly rather than inheriting it from whatever the host's CPU count
   happens to be. A container with a different core count silently gets a different pool.
2. Respect `N_instances × connection_limit < max_connections`, which `.env.example` already
   states — now with a measured reason to care.
3. Re-run this at the chosen pool size. The knee moves with it.

### Two things this measurement taught about measuring

Both cost a run, and both are the kind of thing that makes a load test report confident nonsense:

- **With no think time, the rate limiter is what you measure.** Five workers at full speed produced
  455 req/s and a **7% success ratio** — 93% of the run was 429s, and the latency numbers described
  refusals rather than work. Authenticated traffic is limited per user, so capacity here is
  modelled by adding users, not by making each one faster.
- **All load from one host looks like one client.** The per-IP backstop (600 reads/min) fired on
  40% of a run until each worker was given its own source address. Either distribute the generator
  or set `x-forwarded-for` per worker, as the harness now does.

The harness fails the run when success drops below 95%, so a repeat of either mistake is loud
rather than silent.

### What this does NOT establish

- **The soak was 6 minutes, not the 2 hours the plan called for.** Nothing drifted in that window,
  which is evidence against a fast leak and says nothing about a slow one. Run the full soak on the
  target host.
- **No SSE leak was proven.** No journey opens a real-time stream, so `openConnections` stayed at 0
  throughout. The check is wired and reported; it has not been exercised. Add a streaming journey
  before trusting it.
- **This is a single Node process driving load**, not a real generator. It becomes the bottleneck
  before k6 would, so treat the p95s as a floor on latency rather than a ceiling on capacity, and
  re-measure with k6 or Artillery before quoting a number to anyone.
- **One host, one instance, local Postgres.** No network latency, no load balancer, no replication
  lag. Real numbers will be worse.


---

## Secrets (A5)

### Where they must live

Not in `.env` on a server, and not in a shell history. Use the platform's secret manager — AWS
Secrets Manager, GCP Secret Manager, Vault, or your host's encrypted environment settings — and
inject at process start.

The application already refuses to boot in production without `JWT_SECRET`,
`FIELD_ENCRYPTION_KEY`, `DATABASE_URL`, SMTP credentials and a non-local `BASE_URL`
([`src/instrumentation.ts`](src/instrumentation.ts)), so a missing secret is a failed deploy rather
than a runtime surprise. It cannot tell whether the value came from a secret manager or a text
file, so that part is on you.

### Rotate anything that has been exposed

Before first production traffic, rotate every secret that has ever sat in a developer `.env`, a
shell history, a CI log or a chat message. Assume all of them have.

| Secret | Effect of rotating | Procedure |
|---|---|---|
| `JWT_SECRET` | **Every session ends.** All users sign in again | Replace and restart. No migration |
| `FIELD_ENCRYPTION_KEY` | **Existing encrypted rows become unreadable** unless re-encrypted first | Use the script below. Do not skip it |
| `DATABASE_URL` password | Connections drop until restart | Rotate in the provider, then redeploy |
| SMTP credentials | Mail stops until updated | Replace and restart |
| `ALERT_CHECK_SECRET` | The alert cron 403s until updated | Update both sides together |
| `TELEMETRY_API_KEY` | Events are rejected until updated | Replace and restart |

### Rotating FIELD_ENCRYPTION_KEY

This is the one with teeth. `Webhook.secret` and `User.mfaSecret` are encrypted at rest with it, so
swapping the key without re-encrypting makes them **permanently unreadable** — and you discover it
when a customer's integration stops firing, not at deploy time.

```bash
# 1. Back up first. This rewrites rows.
node scripts/db-backup.mjs --label pre-key-rotation

# 2. Dry run. Reports what it would do and writes nothing.
OLD_FIELD_ENCRYPTION_KEY="$CURRENT" FIELD_ENCRYPTION_KEY="$NEW" \
  node scripts/rotate-encryption-key.mjs --dry-run

# 3. Re-encrypt.
OLD_FIELD_ENCRYPTION_KEY="$CURRENT" FIELD_ENCRYPTION_KEY="$NEW" \
  node scripts/rotate-encryption-key.mjs

# 4. Only now deploy the new key.
```

The script self-tests its own understanding of the encryption envelope before touching a row, and
**refuses to write anything if the old key cannot decrypt a value** — that means the old key is
wrong, or a row was written with a third key, and writing would destroy it. Every re-encrypted
value is verified by decrypting it again before the update is issued.

Verified 2026-09-19 against a throwaway encrypted webhook: a wrong old key produced a failure and
no writes; the real rotation preserved the plaintext exactly, and the old key could no longer read
the row afterwards.

`User.recoveryCodes` is **hashed, not encrypted**, and is deliberately untouched.

---

## Deploy and rollback (A5)

### Deploying

```bash
# 1. Migrations first, and they must be backwards compatible with the running
#    version — during a rolling deploy both versions serve traffic at once.
npx prisma migrate deploy

# 2. Then the application.
npm run build && npm start   # or your platform's deploy
```

The boot guard validates configuration before serving. If it refuses, read the message: it names
every invalid setting rather than failing on the first.

### Watch these for the first ten minutes

- `/api/health` — `status`, `db.latencyMs` (baseline **1–2 ms**; > 50 ms sustained is the alert),
  `telemetry.configured`
- `counters["events.error"]` — a step change after a deploy is the deploy
- `realtime.openConnections` — should climb back as clients reconnect. Flat at zero with live
  traffic means SSE is broken
- The five alerts in the monitoring section. If none can fire, you are not watching, you are hoping

### Rolling back

```bash
# Application only — the common case, and always try this first.
<deploy the previous image/commit>
```

**Do not roll back a migration by default.** Most schema changes here are additive and the previous
application version tolerates them. A migration rollback is a data-loss operation; reach for it
only when the migration itself is the fault, and take a backup first.

If a migration must be undone:

1. Take a backup (`node scripts/db-backup.mjs --label pre-rollback`).
2. Write the reversing SQL by hand and review it. There is no `migrate down`.
3. Apply it, then `npx prisma migrate resolve --rolled-back <name>` so the history matches reality.
4. Run the drift check: `npx prisma migrate diff --from-migrations prisma/migrations
   --to-schema-datamodel prisma/schema.prisma --exit-code`. A non-empty diff means the database and
   the schema disagree, which is how PROD-0 happened.

### If the application will not start

The boot guard names the problem. The usual causes, in order:

1. A missing or placeholder secret — it says which.
2. `DATABASE_URL` unreachable, or pointing at a `file:` URL (SQLite support was removed in PROD-1).
3. `BASE_URL` set to localhost — rejected, because every link in outgoing email would be
   unreachable for the recipient.
4. `RATE_LIMIT_STORE=memory` in production — refused, because a per-process limiter silently grants
   N × the configured limit once there is more than one instance.

### Incident escalation

| | |
|---|---|
| On-call | _record_ |
| Escalation after | _record — 15 minutes is a reasonable default_ |
| Database provider support | _record, with the account/contract reference_ |
| Status page / customer comms owner | _record_ |

Fill these in. An escalation path discovered during an incident is not an escalation path.

