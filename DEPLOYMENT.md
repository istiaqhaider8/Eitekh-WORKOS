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

Example crontab (authenticate as a super-admin; use a dedicated service account):

```cron
*/15 * * * * curl -fsS -X POST https://your-domain/api/recurring-tasks/trigger -H "Cookie: token=$SERVICE_TOKEN" >> /var/log/eitekh-cron.log 2>&1
15 3   * * * curl -fsS -X POST https://your-domain/api/super-admin/backup      -H "Cookie: token=$SERVICE_TOKEN" >> /var/log/eitekh-cron.log 2>&1
```

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
| **DB pool exhaustion** | `db.latencyMs` climbing, `health.db_unreachable` > 0, `status: "error"` | latency p95 > 500 ms for 5 min, or any `db_unreachable` |
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

These thresholds are starting points written against the signals that exist. They have not been
tuned against production traffic, because there is none yet. Revisit after PROD-8 (load testing)
gives real baselines.


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

