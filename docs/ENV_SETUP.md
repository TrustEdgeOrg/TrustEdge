# Environment variables

Operator configuration for TrustEdge.

**Canonical catalogs:** [backend/.env.production.example](../backend/.env.production.example) · [backend/.env.example](../backend/.env.example) · [frontend/.env.example](../frontend/.env.example)

---

## Overview

| Environment | Backend file | Frontend |
|-------------|--------------|----------|
| Production (EC2) | `/etc/trustedge/backend.env` | Built in CI (`REACT_APP_*` secrets / workflow env) |
| Local / Docker | `backend/.env` or compose env | `frontend/.env` / `.env.development` |

`.env` files are gitignored. Copy from the example templates. On EC2, prefer `/etc/trustedge/backend.env` — deploy merges `DB_URL` via `scripts/ec2-sync-backend-env.sh`.

---

## Backend (production)

```env
DB_URL=postgresql+psycopg2://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require

LOG_TO_FILE=0
LOG_JSON=1
LOG_LEVEL=INFO
LOG_SERVICE=backend
PYTHONUNBUFFERED=1

ADMIN_API_TOKEN=REPLACE_WITH_LONG_RANDOM_SECRET
TRUSTEDGE_INGEST_TOKEN=REPLACE_WITH_LONG_RANDOM_SECRET
REDIS_URL=redis://redis:6379/0

# Compose sets this by default; override only if needed
# DETECTION_ENGINE_URL=http://detection-engine:9090

NETWORK_REVIEW_MODE=template
NETWORK_REVIEW_CACHE_TTL_SEC=90
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=llama3.2:3b
LLM_TIMEOUT_SEC=180
```

Full list: [backend/.env.production.example](../backend/.env.production.example).

---

## Frontend (production)

Set at **build time** in CI (or `frontend/.env.production`):

```env
# Must be the FastAPI origin. When the UI is on CloudFront HTTPS, use the HTTPS API CloudFront URL
# (browsers block mixed content to plain http://EC2:8000).
REACT_APP_API_BASE_URL=https://your-api-cloudfront.example
REACT_APP_ADMIN_API_TOKEN=REPLACE_WITH_LONG_RANDOM_SECRET
REACT_APP_ENVIRONMENT=production
GENERATE_SOURCEMAP=false
```

Do **not** point `REACT_APP_API_BASE_URL` at the dashboard CloudFront URL — only the API origin.

---

## Important notes

1. Never commit `.env` files
2. Empty `ADMIN_API_TOKEN` disables admin auth — always set in production
3. Match `ADMIN_API_TOKEN` and `REACT_APP_ADMIN_API_TOKEN` (GitHub secret `ADMIN_API_TOKEN` for frontend CI)
4. Match `TRUSTEDGE_INGEST_TOKEN` across backend, Agent-API, and detection-engine (`scripts/ec2-sync-service-tokens.sh`)
5. `chmod 640` on `/etc/trustedge/backend.env` (`root:docker`)

---

## Reference

### Core

| Variable | Description | Production |
|----------|-------------|------------|
| `DB_URL` | PostgreSQL URL | RDS with `sslmode=require` |
| `LOG_LEVEL` | Verbosity | `INFO` |
| `LOG_JSON` | Structured JSON logs | `1` (see [DEPLOY.md](DEPLOY.md#cloudwatch-logging)) |
| `LOG_SERVICE` | Log field `service` | `backend` |
| `DETECTION_ENGINE_URL` | detection-engine HTTP base | Compose default `http://detection-engine:9090` |
| `TRUSTEDGE_POST_ALERTS_TO_BACKEND` | Detection posts alerts to Postgres via backend ingest | `1` in compose (write-through to `security_alerts`) |
| `TRUSTEDGE_POST_BEHAVIORS_TO_BACKEND` | Detection hydrates/persists behavior baseline to Postgres | `1` in compose (`device_behaviors`; RAM stays the hot path) |
| `CORS_ORIGINS` | Extra allowed origins (CSV) | Add dashboard CloudFront if needed |

### Security

| Variable | Used by | Notes |
|----------|---------|-------|
| `ADMIN_API_TOKEN` | Dashboard / admin APIs | **Required** in production |
| `TRUSTEDGE_INGEST_TOKEN` | Agent-API upsert, alert ingest, behavior observe, flow ingest | Shared service bearer |

### Redis

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Live twin / agent state (fail-open) | `redis://redis:6379/0` |

### Agent-API device credentials (DB-per-service)

| Variable | Description | Default |
|----------|-------------|---------|
| `TRUSTEDGE_AGENT_DEVICE_CREDS_DATABASE_URL` | **Agent-API-owned** Postgres for `token_hash → device_id` (not the control-plane DB) | Dev compose: `postgres-agent-api` / `trustedge_agent_api`. Prod: separate RDS DB (or second database on the same instance). |
| `TRUSTEDGE_AGENT_DEVICE_CREDS_REDIS_URL` | Optional auth-cache Redis (advanced; empty = Postgres-only) | _(empty)_ |
| `TRUSTEDGE_AGENT_DEVICE_CREDS_CACHE_TTL_SEC` | Auth cache TTL when Redis URL is set | `300` |

**Cutover:** if an existing env already has rows in a shared control-plane `agent_device_credentials` table, `pg_dump`/`COPY` that table into the Agent-API database before pointing `TRUSTEDGE_AGENT_DEVICE_CREDS_DATABASE_URL` at the new DB.

### Network review / LLM

| Variable | Description |
|----------|-------------|
| `NETWORK_REVIEW_MODE` | `template` \| `openai` \| `ollama` |
| `NETWORK_REVIEW_CACHE_TTL_SEC` | Overview review cache TTL |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | Local explain path |
| `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL` | OpenAI path |
| `LLM_TIMEOUT_SEC` | LLM call timeout |

### Network flows (optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `NETWORK_FLOWS_ENABLED` | Enable flow ingest | `true` |
| `NETWORK_FLOWS_MAX_AGE_SEC` | Drop older samples | `300` |
| `NETWORK_FLOWS_DNS_RESOLUTION_TTL_SEC` | Name → IP TTL | `600` |
| `NETWORK_FLOWS_MAP_LIMIT` | Cap for map payloads | `80` |

Requires `conntrack` on the host when flow watching is enabled.

### Frontend

| Variable | Description | Production |
|----------|-------------|------------|
| `REACT_APP_API_BASE_URL` | FastAPI origin (HTTPS if UI is HTTPS) | API CloudFront or EC2 |
| `REACT_APP_ADMIN_API_TOKEN` | Admin bearer | **required** |
| `REACT_APP_ENVIRONMENT` | Label | `production` |
| `GENERATE_SOURCEMAP` | Source maps | `false` |

---

## Troubleshooting

### Env not loading

1. Verify `/etc/trustedge/backend.env` exists and is readable by Docker
2. Restart: `docker compose down && docker compose up -d`

### Frontend env unchanged

- Variables must start with `REACT_APP_`
- Rebuild and redeploy after changing production build env / GitHub secrets

### Admin API 401

- Align backend `ADMIN_API_TOKEN` and frontend `REACT_APP_ADMIN_API_TOKEN`
- Redeploy frontend after changing the build-time secret

### Mixed content / blocked API

- UI on CloudFront HTTPS cannot call `http://…:8000` — use the HTTPS API CloudFront distribution
