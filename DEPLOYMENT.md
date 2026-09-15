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
- [ ] Health check monitored: `GET /api/health`
- [ ] SMTP credentials are app-specific passwords, not primary account passwords

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
