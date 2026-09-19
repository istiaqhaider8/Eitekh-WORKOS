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

### The five alerts

Threshold these against `/api/health`, which is unauthenticated and contains no tenant data.

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

### What is NOT done

No error-tracking vendor is provisioned for this deployment, so nothing is currently being shipped
anywhere. **Set `TELEMETRY_ENDPOINT` and confirm events arrive before taking paid traffic.** The
seam, the scrubbing and the counters are in place and tested; the destination is a deployment
decision.

Likewise, these alert thresholds are starting points written against the signals that exist. They
have not been tuned against production traffic, because there is none yet. Revisit after PROD-8
(load testing) gives real baselines.

