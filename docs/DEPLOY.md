# Production deployment

TrustEdge production runs on **AWS** with **GitHub Actions** CI/CD.

**See also:** [ENV_SETUP.md](ENV_SETUP.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [aws/README.md](../aws/README.md)

---

## Infrastructure

<p align="center">
  <img width="100%" alt="TrustEdge AWS production architecture" src="assets/aws-architecture.svg" />
</p>

| AWS service | Role |
|-------------|------|
| **EC2** | Docker Compose — backend, detection-engine, Redpanda, Redis; optional Agent-API + Ollama |
| **RDS** | PostgreSQL — agents, alerts, behaviors (credentials via Secrets Manager) |
| **S3 + CloudFront** | React dashboard (static) + HTTPS |
| **CloudFront (API)** | HTTPS origin in front of EC2 `:8000` (avoids mixed content from the UI) |
| **ECR** | `trustedge-backend`, `trustedge-agent-api` images |
| **Redis** (on EC2) | Live agent / twin state |

---

## CI/CD

| Workflow | File | Trigger | Actions |
|----------|------|---------|---------|
| Build and Deploy Backend | `deploy-backend.yml` | Push to `main` / `develop` | pytest → (ECR push on **main** only) → SSH to EC2 → sync env → Compose up → Alembic |
| Build and Deploy Frontend | `deploy-frontend.yml` | Push to `main` / `develop` | npm build → S3 sync → CloudFront invalidation |
| CI | `deploy-develop.yml` | Push / PR to `main` / `develop` | Backend pytest + coverage |

Frontend build embeds `REACT_APP_API_BASE_URL` as the **HTTPS API CloudFront** origin (see workflow `BACKEND_API_URL`) and `REACT_APP_ADMIN_API_TOKEN` from GitHub secret `ADMIN_API_TOKEN`.

Optional AWS bootstrap: [aws/README.md](../aws/README.md) (`setup-trustedge-ci.sh`, ECR/S3/IAM helpers).

---

## EC2 host

| Path / artifact | Purpose |
|-----------------|---------|
| `~/trustedge` | Git checkout used by deploy |
| `/etc/trustedge/backend.env` | Backend secrets (survives deploys; synced by `scripts/ec2-sync-backend-env.sh`) |
| `/etc/trustedge/agent-enroll.token` | Agent enrollment (Agent-API profile) |

Compose file: [`docker-compose.yml`](../docker-compose.yml).

| Service | Notes |
|---------|--------|
| `backend` | FastAPI; env from `/etc/trustedge/backend.env`; `DETECTION_ENGINE_URL` → detection-engine |
| `detection-engine` | Consumes Kafka; may proxy alerts / AI session APIs |
| `redpanda` | Kafka-compatible broker (`trustedge.agent.events`) |
| `redpanda-console` | Optional `console` profile; loopback-only Kafka UI, access via SSH tunnel |
| `redis` | Twin / live presence (fail-open) |
| `trustedge-agent-api` | Profile `agent` — image from ECR when available; device creds via dedicated Postgres (`TRUSTEDGE_AGENT_DEVICE_CREDS_DATABASE_URL`, not control-plane RDS) |
| `ollama` | Profile `ai` — optional local LLM for alert / overview explain |

See [ENV_SETUP.md](ENV_SETUP.md) for variables.

### Redpanda Console

On the EC2 host, start the optional Console service:

```bash
cd ~/trustedge
COMPOSE_PROFILES=console docker compose up -d redpanda-console
```

The UI binds to `127.0.0.1:8081` on the host; it is not exposed publicly. From your workstation, open an SSH tunnel:

```bash
ssh -L 8081:127.0.0.1:8081 ec2-user@<instance-hostname>
```

Then open `http://localhost:8081`. Keep the tunnel open while using the UI. If you also need another optional Compose profile, include it in the comma-separated `COMPOSE_PROFILES` value.

### Useful host scripts

| Script | Purpose |
|--------|---------|
| `scripts/ec2-sync-backend-env.sh` | Merge RDS `DB_URL` into `backend.env` |
| `scripts/ec2-sync-service-tokens.sh` | Align ingest tokens across Compose |
| `scripts/ec2-resolve-agent-api.sh` | Pull Agent-API image / enable `agent` profile |
| `scripts/ec2-sync-agent-api.sh` | Wire enroll + ingest token for Agent-API |
| `scripts/ec2-setup-cloudwatch.sh` | CloudWatch Agent + JSON logging |
| `scripts/ec2-setup-ollama.sh` | Enable `ai` profile + Ollama |

---

## CloudWatch logging

Structured JSON logs go to stdout. On EC2, the **CloudWatch Agent** forwards Docker logs to CloudWatch Logs.

| Log group | Source | Retention |
|-----------|--------|-----------|
| `/trustedge/prod/backend` | Docker `trustedge-api` | 30 days |

Detection alerts live in PostgreSQL / the dashboard — not as CloudWatch application events.

### Backend env

```env
LOG_JSON=1
LOG_LEVEL=INFO
LOG_TO_FILE=0
LOG_SERVICE=backend
PYTHONUNBUFFERED=1
```

Each HTTP request gets `X-Request-ID` and `request_id` on log lines (`event=http_request`, except `/health`).

### One-time EC2 setup

EC2 instance role needs CloudWatch Logs permissions (`CreateLogGroup`, `CreateLogStream`, `PutLogEvents`, `DescribeLogStreams`, `PutRetentionPolicy`).

```bash
cd ~/trustedge
sudo bash scripts/ec2-setup-cloudwatch.sh
```

Applies [`scripts/cloudwatch/amazon-cloudwatch-agent.json`](../scripts/cloudwatch/amazon-cloudwatch-agent.json) and enables `LOG_JSON` in `backend.env`.

### Insights examples

**Recent errors:**

```
fields @timestamp, level, service, event, message, request_id
| filter level = "ERROR"
| sort @timestamp desc
| limit 50
```

**Slow API requests (>500ms):**

```
fields @timestamp, http_method, http_path, status_code, duration_ms
| filter event = "http_request" and duration_ms > 500
| sort duration_ms desc
```

### Do not log

- Tokens, secrets, device tokens
- Full alert / event payloads that may contain sensitive endpoint detail

---

## Stack

| Layer | Stack |
|-------|-------|
| Frontend | React 19, TypeScript, MUI 7 |
| Backend | Python 3.11, FastAPI, SQLAlchemy 2, Alembic |
| Data | PostgreSQL 16 (RDS), Redis 7 |
| Stream / detect | Redpanda, `detection-engine` |
| Ops | Docker Compose, CloudWatch structured logs |
