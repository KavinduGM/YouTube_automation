# YouTube Automation

End-to-end automation for scheduling YouTube long videos and Shorts across three channels (OAP / OAG / Nursing). Editors drop files into a Drive folder using a strict filename convention; the system matches them to pre-filled metadata, emails an approver, and on approval uploads to YouTube with `publishAt` scheduling. Status flows back to the team's monthly Google Sheet.

Targets US audience — all schedule times are stored UTC and rendered in **America/New_York**.

## Architecture

```
┌──────────────────┐     ┌──────────────┐     ┌──────────────────┐
│ Editor uploads   │     │  Approver    │     │ YouTube channels │
│ to Google Drive  │     │  (browser)   │     │ (OAP/OAG/NUR)    │
└────────┬─────────┘     └──────┬───────┘     └─────────▲────────┘
         │ poll every 2 min     │                       │
         │                      ▼                       │
         │              ┌────────────────┐              │
         │              │ Next.js        │              │
         │              │ Dashboard      │              │
         │              │ (port 3000)    │              │
         │              └───────┬────────┘              │
         │                      │ HTTP                  │
         │                      ▼                       │
         │              ┌────────────────┐              │
         └─────────────▶│ Fastify API    │              │
                        │ (port 4000)    │              │
                        └───────┬────────┘              │
                                │                       │
                ┌───────────────┴───────────────┐       │
                ▼                               ▼       │
        ┌──────────────┐                ┌────────────────┐
        │  PostgreSQL  │                │ Worker (cron)  │
        │  (5432)      │                │ - drive watch  │
        └──────────────┘                │ - scheduler    │──┘
                                        │ - confirmer    │
                                        └────────────────┘
```

Three Node processes (API, Worker, Dashboard), one Postgres database, served behind nginx.

## Filename convention

Drive files **must** be named:

```
{CHANNEL}_{YYYY-MM-DD or YYYY-MM-Wn}_{TYPE}_{SLOT}[_{TAG}].{ext}
```

| Field   | Values                                  |
|---------|-----------------------------------------|
| CHANNEL | `OAP` `OAG` `NUR`                       |
| date    | `2026-05-16` (daily) or `2026-05-W3` (weekly long videos) |
| TYPE    | `long` `short` `post`                   |
| SLOT    | integer (`1`, `2`) — per-day index      |
| TAG     | optional, e.g. `D330` for exam-coded long videos |
| ext     | `mp4` `mov` `m4v` `webm` (videos), `jpg`/`png` (thumbnail) |

Examples:
- `OAP_2026-05-16_short_1.mp4` + `OAP_2026-05-16_short_1.jpg`
- `OAG_2026-05-W3_long_D330.mp4`
- `NUR_2026-05-16_short_2.mp4`

The thumbnail must share the **same base name** as the video; the watcher pairs them automatically.

## Quickstart with Docker (recommended)

The whole stack — Postgres, API, Worker, Dashboard, plus a Caddy reverse proxy
that auto-provisions free Let's Encrypt TLS — runs from a single
`docker compose up`. You only need:

- A VPS with Docker + Docker Compose v2 installed
- Two DNS A records pointing at the VPS:
  - `dashboard.yourdomain.com`
  - `api.yourdomain.com`
- A Google Cloud OAuth client (see [Google OAuth setup](#google-oauth-setup))
- A Resend API key

### One-time

```bash
# 1. Install Docker (Ubuntu)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# 2. Clone
git clone https://github.com/KavinduGM/YouTube_automation.git
cd YouTube_automation

# 3. Configure
cp .env.example .env
# Generate two 64-char hex secrets:
echo "SESSION_SECRET=$(openssl rand -hex 32)"
echo "TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)"
nano .env   # paste those + fill the rest (see below)
```

In `.env`, set:
- `DASHBOARD_DOMAIN` and `API_DOMAIN` to your two subdomains
- `DASHBOARD_URL=https://<DASHBOARD_DOMAIN>`
- `GOOGLE_OAUTH_REDIRECT_URI=https://<API_DOMAIN>/oauth/google/callback`
- `ACME_EMAIL` for Let's Encrypt notifications
- `POSTGRES_PASSWORD` (any strong string) — and update `DATABASE_URL` to match
- `ALLOWED_APPROVER_EMAILS`, `GOOGLE_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `RESEND_FROM`
- Leave `API_URL=http://api:4000` (internal Docker hostname; the dashboard uses this server-side)

### Bring it up

```bash
docker compose up -d --build
```

That's it. On first run the `migrator` service syncs the DB schema and exits;
Caddy fetches certs (give it ~30s after DNS is in place); API/Worker/Dashboard come online.

```bash
docker compose ps              # all services healthy?
docker compose logs -f         # tail everything
docker compose logs -f worker  # tail one
```

### Updating

```bash
git pull
docker compose up -d --build
```

The migrator runs again automatically; it's a no-op if the schema is current.

### Without a domain (testing)

If you don't have DNS set up yet, comment out the `caddy:` service in
`docker-compose.yml` and add port mappings to `dashboard:` and `api:`:
```yaml
dashboard:
  ports: ["3000:3000"]
api:
  ports: ["4000:4000"]
```
Then set `DASHBOARD_URL=http://YOUR.VPS.IP:3000` and the OAuth redirect to
`http://YOUR.VPS.IP:4000/oauth/google/callback` (and add it in Google Cloud Console).

---

## Local development (without Docker)

### Prerequisites
- Node.js 20+
- Docker (for Postgres) — or a local Postgres install
- Google Cloud project with: YouTube Data API v3, Drive API, Sheets API enabled
- Resend account + verified sending domain

### Setup
```bash
# 1. Postgres only (for dev — full stack uses the same compose file)
docker compose up -d postgres

# 2. Env
cp .env.example .env
# Generate secrets:
openssl rand -hex 32   # → SESSION_SECRET
openssl rand -hex 32   # → TOKEN_ENCRYPTION_KEY
# Fill in GOOGLE_*, RESEND_*, ALLOWED_APPROVER_EMAILS

# 3. Install + DB
npm install
npm run prisma:generate
npx prisma migrate dev --name init

# 4. Run (3 terminals)
npm run dev:api
npm run dev:worker
npm run dev:dashboard
```

Dashboard: http://localhost:3000 — sign in with an email listed in `ALLOWED_APPROVER_EMAILS`.

### Google OAuth setup
1. In Google Cloud Console, create an **OAuth 2.0 Client** (Web application).
2. Add authorized redirect URI: `http://localhost:4000/oauth/google/callback` (and your prod URL).
3. Add scopes during the consent screen config: `youtube.upload`, `youtube`, `drive.readonly`, `spreadsheets`.
4. Add yourself as a Test User if the app is in Testing.
5. Copy Client ID / Secret into `.env`.
6. In the dashboard → Channels:
   - First, connect **Drive + Sheets** (one-time, single Google account).
   - Then, for each channel, click **Connect YouTube** and consent with that channel's Google account.
7. Paste the monthly Drive folder ID into each channel.

### YouTube API quota
Per-project default is 10,000 units/day; each upload costs 1,600. With 2–3 videos/day total this is fine. If you ever scale up: file the YouTube Audit form for a quota increase.

## Production deploy (Hostinger KVM 2) — manual / non-Docker

> **The Docker quickstart above is the recommended path.** This section is
> kept for reference if you want to run the services bare on the VPS with
> PM2 + nginx instead.

Assumes Ubuntu 22.04+. Run as a non-root sudo user.

```bash
# System packages
sudo apt update && sudo apt install -y nginx postgresql certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# Postgres
sudo -u postgres psql -c "CREATE USER yt WITH PASSWORD 'CHANGE_ME';"
sudo -u postgres psql -c "CREATE DATABASE yt OWNER yt;"

# App
sudo mkdir -p /opt/youtube-automation && sudo chown $USER /opt/youtube-automation
cd /opt/youtube-automation
git clone <your repo> .   # or rsync from local
cp .env.example .env && nano .env   # fill in production values

npm install
npm run prisma:generate
npx prisma migrate deploy
npm run build

# PM2
sudo npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # follow the printed command

# Nginx (replace dashboard.yourdomain.com)
sudo tee /etc/nginx/sites-available/yt <<'EOF'
server {
    listen 80;
    server_name dashboard.yourdomain.com api.yourdomain.com;
    client_max_body_size 50M;

    location / {
        # Will be split per-server-name after certbot
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
sudo ln -s /etc/nginx/sites-available/yt /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# TLS — adjust server blocks afterwards: dashboard → :3000, api → :4000
sudo certbot --nginx -d dashboard.yourdomain.com -d api.yourdomain.com
```

Update `.env` so `DASHBOARD_URL=https://dashboard.yourdomain.com`, `API_URL=https://api.yourdomain.com`, and add the production redirect URI to your Google OAuth client.

### Backups
```bash
# crontab -e
0 3 * * * pg_dump -U yt yt | gzip > /var/backups/yt-$(date +\%F).sql.gz
```

## Workflow

1. **Pre-month**: in the dashboard, create one item per upcoming video. Fill in title, description, tags, scheduled NY time, and the expected filename (the form builds it for you).
2. **Editing**: editor drops the video (and optional thumbnail) into the channel's Drive folder, named exactly as per the convention.
3. **Detection** (within ~2 min): worker matches the file → item moves to `pending_approval` → email to all approvers.
4. **Approval**: open the item in the dashboard, edit metadata if needed, click **Approve**.
5. **Scheduling**: worker downloads the file, uploads to YouTube with `publishAt = scheduledPublishAt`, sets thumbnail.
6. **Sheet write-back**: status, YouTube URL, etc. written into the row of the linked Google Sheet (matched by `filename` column).
7. **Confirmation**: after the publish time passes, confirmer marks the item `published`.

## Status lifecycle

```
planned ──(file appears)──▶ pending_approval ──▶ approved ──▶ scheduling ──▶ scheduled ──▶ published
                                  │                              │
                                  ▼                              ▼
                              rejected                        failed (retryable)
```

## Project layout

```
.
├── prisma/schema.prisma        # data model
├── packages/shared/            # DB client, env, crypto, Google + Resend
├── apps/api/                   # Fastify REST
├── apps/worker/                # cron loops
└── apps/dashboard/             # Next.js
```

## Operational notes

- All times stored UTC; rendered America/New_York. The dashboard's datetime-local inputs treat the value as NY local and convert correctly.
- OAuth refresh tokens are encrypted at rest with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`). Lose this key → re-auth all channels.
- The scheduler retries up to 3 times with the failure recorded on the item; after that it's marked `failed` and an alert email is sent. Use the **Retry** button to reset.
- If a scheduled time has already passed when the worker picks the item up, it publishes immediately rather than failing.
- The Drive watcher is read-only; it never moves or modifies files.
- Community posts are not in v1 — YouTube's official API doesn't support creating them.
