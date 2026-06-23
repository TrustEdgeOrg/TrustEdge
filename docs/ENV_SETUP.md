# Environment Variables Setup Guide

How to configure TrustEdge for production.

**Canonical references:** [backend/.env.production.example](../backend/.env.production.example), [backend/.env.example](../backend/.env.example), and [frontend/.env.example](../frontend/.env.example).

## Overview

| Environment | Backend file | Frontend file |
|-------------|--------------|---------------|
| Production (EC2 host) | `/etc/trustedge/backend.env` | Built into S3 deploy via CI |
| Production (Docker) | `backend/.env.production` | `frontend/.env.production` |

`.env` files are gitignored. Copy from `.env.example` / `.env.production.example` templates.

## Backend (production)

On EC2 the live file is `/etc/trustedge/backend.env` (see [DEPLOY.md](DEPLOY.md)). Minimum required groups:

```env
DB_URL=postgresql+psycopg2://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require

LOG_JSON=1
LOG_LEVEL=INFO
ENVIRONMENT=production

ADMIN_API_TOKEN=REPLACE_WITH_LONG_RANDOM_SECRET
DNS_INGEST_TOKEN=REPLACE_WITH_LONG_RANDOM_SECRET
DEVICE_TOKEN_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
WG_AGENT_TOKEN=REPLACE_WITH_LONG_RANDOM_SECRET

VPN_ENDPOINT=your-ec2-ip:51820
VPN_SERVER_PUBLIC_KEY=REPLACE_WITH_wg0_PUBLIC_KEY
WG_AGENT_URL=http://172.17.0.1:9109
```

Full catalog: [backend/.env.production.example](../backend/.env.production.example).

## Frontend (production)

Set at build time in CI or `frontend/.env.production`:

```env
REACT_APP_API_BASE_URL=http://your-ec2-ip:8000
REACT_APP_ADMIN_API_TOKEN=REPLACE_WITH_LONG_RANDOM_SECRET
REACT_APP_ENVIRONMENT=production
GENERATE_SOURCEMAP=false
```

`REACT_APP_API_BASE_URL` must be the **FastAPI origin** (EC2 `:8000`), not the CloudFront dashboard URL.

## Docker Compose

`docker-compose.yml` loads `/etc/trustedge/backend.env` on EC2. See [DEPLOY.md](DEPLOY.md).

## Important notes

1. **Never commit `.env` files** — they are in `.gitignore`
2. **Set all security tokens** in production — empty `ADMIN_API_TOKEN` disables admin auth
3. **Match tokens** across backend, frontend (`REACT_APP_ADMIN_API_TOKEN`), dns-sync, log-watcher, and host agent
4. **Use strong random secrets** — store in `/etc/trustedge/backend.env` with `chmod 640`

## Environment variable reference

### Core (backend)

| Variable | Description | Production |
|----------|-------------|------------|
| `DB_URL` | PostgreSQL connection string | RDS URL with `sslmode=require` |
| `ENVIRONMENT` | Environment name | `production` |
| `LOG_LEVEL` | Logging verbosity | `INFO` |
| `LOG_JSON` | Structured JSON logs | `1` (see [CLOUDWATCH_LOGGING.md](CLOUDWATCH_LOGGING.md)) |
| `PERSIST_ALL_DNS` | Store all DNS queries in RDS | `false` |

### Security tokens (backend)

| Variable | Used by | Notes |
|----------|---------|-------|
| `ADMIN_API_TOKEN` | Dashboard, policy/device admin APIs | **Required** in production |
| `DNS_INGEST_TOKEN` | `dns_log_watcher`, `dns-sync` | Required for ingest and policy pull |
| `WG_AGENT_TOKEN` | Backend → `trustedge-wg-agent` | Must match host agent token |
| `DEVICE_TOKEN_SECRET` | VPN client device tokens | Signs tokens issued at enroll |
| `ENROLL_BOOTSTRAP_TOKEN` | `POST /v1/enroll` (optional) | TrustEdgeClient `--api-token` |

Frontend: set `REACT_APP_ADMIN_API_TOKEN` to the same value as `ADMIN_API_TOKEN`.

Host agent: set `TRUSTEDGE_WG_AGENT_TOKEN` in the systemd unit — see [host-agent/README.md](../host-agent/README.md).

### VPN & host agent (backend)

| Variable | Description |
|----------|-------------|
| `VPN_ENDPOINT` | Public `host:51820` returned in enroll config |
| `VPN_SERVER_PUBLIC_KEY` | WireGuard server public key |
| `WG_AGENT_URL` | Host agent URL from Docker (`http://172.17.0.1:9109`) |

### Real-time usage (backend)

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis for live throughput | `redis://redis:6379/0` |
| `USAGE_REDIS_ENABLED` | Enable Redis usage window | `true` |
| `USAGE_HISTORY_MINUTES` | Chart history window | `60` |
| `BANDWIDTH_ALERT_MIB_PER_SEC` | Throughput alert threshold | `50` |

### Behavior & policy (backend)

Key tuning variables — full list in [backend/.env.example](../backend/.env.example):

| Variable | Description |
|----------|-------------|
| `BEHAVIOR_ALERT_THRESHOLD` | Score above which alerts fire |
| `BEHAVIOR_AUTO_BLOCK_THRESHOLD` | Score above which auto-blocks trigger |
| `POLICY_PACK_FETCH_ENABLED` | Fetch upstream block lists on startup |
| `FORBIDDEN_COUNTRY_ENABLED` | Geo DNS blocking rules |
| `NETWORK_REVIEW_MODE` | Dashboard AI review: `template` \| `openai` \| `ollama` |

### Frontend

| Variable | Description | Production |
|----------|-------------|------------|
| `REACT_APP_API_BASE_URL` | FastAPI origin (not CloudFront UI URL) | `http://<ec2-ip>:8000` |
| `REACT_APP_ADMIN_API_TOKEN` | Admin bearer token | **required** |
| `REACT_APP_ENVIRONMENT` | Environment label | `production` |
| `GENERATE_SOURCEMAP` | Source maps | `false` |

## Troubleshooting

### Environment variables not loading

1. On EC2, verify `/etc/trustedge/backend.env` exists and is readable by Docker
2. Restart containers after changing env files:
   ```bash
   docker compose down
   docker compose up -d
   ```

### Frontend variables not working

- React requires variables to start with `REACT_APP_`
- Rebuild and redeploy the frontend after changing production env

### Admin API returns 401

- Set `ADMIN_API_TOKEN` in backend and `REACT_APP_ADMIN_API_TOKEN` in frontend to the same value
- Redeploy frontend after changing build-time env

### Policy blocks not reaching dnsmasq (EC2)

- Verify `DNS_INGEST_TOKEN` is set and matches dns-sync / log-watcher config
- Verify `WG_AGENT_TOKEN` matches `trustedge-wg-agent` — see [host-agent/README.md](../host-agent/README.md)
