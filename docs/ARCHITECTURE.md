# Architecture

Component topology, data flows, trust boundaries, and contributor patterns for TrustEdge.

Product overview and screenshots: [root README](../README.md). Deploy: [DEPLOY.md](DEPLOY.md). Env: [ENV_SETUP.md](ENV_SETUP.md). API map: [API.md](API.md).

---

## Stages

<p align="center">
  <img width="100%" alt="Delivery path" src="assets/pipeline.svg" />
</p>

<p align="center">
  <img width="100%" alt="TrustEdge architecture — Edge, Ingest, Stream, Detect, Operate" src="assets/architecture.svg" />
</p>

**Primary path:** Agent → HTTPS upload → Agent API → Kafka → detection-engine → alert ingest → FastAPI → React dashboard.

<p align="center">
  <img width="100%" alt="TrustEdge AWS production architecture" src="assets/aws-architecture.svg" />
</p>

AWS host layout and CI/CD: [DEPLOY.md](DEPLOY.md).

---

## Components

| Layer | Components | Role |
|-------|------------|------|
| **Endpoint** | TrustEdge Agent (Go) | Process, activity, network summary + connections, security lifecycle, AI tools inventory |
| **Ingest** | TrustEdge-Agent-API | Device auth, validate, zstd, Kafka publish, Redis twin, agents upsert |
| **Stream** | Kafka / Redpanda | `trustedge.agent.events` |
| **Detection** | `detection-engine` | YAML rules, behavior baselines / novelty, AI activity → alerts |
| **Control plane** | FastAPI + React | Alerts, agents, AI inventory, baselines, AI sessions, overview |
| **Data** | Control-plane Postgres (agents/alerts/behaviors); Agent-API Postgres (device creds); Redis twin | Durable control plane · durable device auth · live posture |
| **Hosting** | EC2 Compose, S3, CloudFront, ECR | Runtime, dashboard, images |

---

## Data flows

### Endpoint telemetry → detection → dashboard

```
TrustEdge Agent
  → POST /v1/events (HTTPS, device token)
  → Agent API (validate, optional zstd)
      → Kafka trustedge.agent.events
      → Redis twin (live posture)
      → POST /internal/agents/upsert (ingest token) → Postgres agents
  → detection-engine (consume Kafka)
      → rules + behavior + AI activity
      → in-memory hot alert window
      → POST /security/alerts/ingest (ingest token) → Postgres `security_alerts` (all severities, durable) → alerts UI
      → behavior: RAM BaselineStore (hot path) ← GET /internal/behaviors (hydrate on first device event)
                 → POST /internal/behaviors/observe (async write-behind) → Postgres `device_behaviors`
```

### Operator reads (admin token)

| Surface | Typical APIs |
|---------|----------------|
| Agents list / detail | `GET /agents`, `GET /agents/{id}` |
| Live twin + events | `GET /security/agents…`, `…/events` |
| AI tools inventory | `GET /security/agents/{id}/ai-software` |
| Behavior baseline | `GET` / `DELETE /security/agents/{id}/baseline` |
| AI sessions | `GET /security/agents/{id}/ai-sessions`, `…/ai-sessions/{id}/…` |
| Alerts | `GET /security/alerts`, `POST /security/alerts/explain` |
| Home overview | `GET /dashboard/network-overview` |

Full map: [API.md](API.md).

### Optional L4 flows

```
Host conntrack watcher → POST /network-flows/bulk → Redis window → GET /network-flows/live
```

---

## Product model

| Layer | Source | Dashboard |
|-------|--------|-----------|
| Endpoint posture | Agent telemetry + Redis twin | Agents · timeline |
| AI tools inventory | `known_ai_app` events | Agent detail |
| AI agent actions (MCP) | `ai_agent_action` events | Agent detail · AI agent actions |
| Sensitive MCP → ungoverned egress | `ai_sensitive_mcp_ungoverned_egress` | Alerts |
| Behavior | RAM baseline (hot) + Postgres `device_behaviors` (durable) | Agent detail · novel-process alerts |
| AI activity | detection-engine sessions | Agent detail (sessions / graph / chain) |
| Detection | Rules · behavior · AI activity | Alerts (+ optional Ollama explain) |
| L4 flows | Host conntrack (optional) | Live flow API (no map UI) |

### Detection engines

- **YAML attack/chain rules** — process, network, security lifecycle (+ correlation)
- **Behavioral engine** — per-device RAM baseline, Postgres hydrate/write-behind, novel-process, suppress known
- **AI activity engine** — agentic session reconstruction and AI-tool findings

Optional LLMs (Ollama / OpenAI / templates) explain alerts and network overview — they do not judge.

---

## Trust boundaries

| Boundary | Role |
|----------|------|
| CloudFront ↔ Backend | HTTPS for dashboard; API proxied to EC2 `:8000` |
| `ADMIN_API_TOKEN` | Dashboard / admin APIs (disabled when empty — set in production) |
| `TRUSTEDGE_INGEST_TOKEN` | Agent-API upsert, alert ingest, behavior observe, flow ingest |
| Device tokens | Agent ↔ Agent API |

---

## Design principles

| Principle | Practice |
|-----------|----------|
| **Endpoint-first** | Stable `agent_id` in Postgres; live posture in Redis twin |
| **Durable + live** | Registry/alerts/behaviors in RDS; twin presence in Redis |
| **Feature modules** | Frontend and backend by domain (`agents`, `twin`, `behaviors`, …) |
| **Pragmatic layering** | Route → service → repository; controllers optional |

---

## Frontend

| Aspect | Choice |
|--------|--------|
| Stack | React 19, TypeScript, Material UI 7 |
| Charts | MUI X Charts |
| Theme | Light and dark; brand blue accent |
| Layout | `Layout` + SideMenu + AppNavbar + Header |

### Routes

| Path | Page |
|------|------|
| `/` | Overview dashboard |
| `/agents` | Agents list |
| `/agents/:agentId` | Agent detail (twin, AI tools, baseline, sessions) |
| `/alerts` | Detection alerts |
| `/how-it-works` | Learn — agent pipeline |
| `/how-detection-works` | Learn — detection engine |
| `/settings` | Settings placeholder |

### Feature modules

`features/dashboard` · `features/agents` · `features/twin` · `features/learn`

Pages in `pages/` are thin wrappers; routes in `routes/index.tsx`.

---

## Backend

```
backend/app/
├── main.py
├── shared/                 # DB, config, auth, logging, Redis
└── features/
    ├── agents/             # Postgres registry
    ├── twin/               # Alerts, live agents, AI software/sessions, baseline proxy
    ├── behaviors/          # Behavior observations
    ├── dashboard/          # Network overview / LLM review
    └── network_flows/      # Optional L4 ingest
```

Prefer: service raises domain errors; route maps to HTTP. Shared errors in `shared/errors/`.

No global event bus — peers call explicitly (Agent-API upsert → agents; detection-engine → alert ingest / behavior observe).

---

## Adding a feature

### Frontend

1. Create `frontend/src/features/<name>/`
2. Thin page in `pages/`; route in `routes/index.tsx` inside `<Layout>`
3. Nav item in `MenuContent.tsx`
4. Reuse theme tokens

### Backend

1. Create `backend/app/features/<name>/` (routes, services, repositories, models, schemas)
2. Register router in `main.py`
3. Alembic migration for new tables
4. Tests under `backend/tests/unit/` and `backend/tests/integration/`

---

## Related

- [DEPLOY.md](DEPLOY.md) — AWS, CI/CD, CloudWatch
- [ENV_SETUP.md](ENV_SETUP.md) — configuration
- [API.md](API.md) — REST map (live OpenAPI at `/docs`)
- [TrustEdge-Agent](https://github.com/TrustEdgeOrg/TrustEdge-Agent) · [TrustEdge-Agent-API](https://github.com/TrustEdgeOrg/TrustEdge-Agent-API)
