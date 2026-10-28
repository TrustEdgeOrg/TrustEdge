# API reference

FastAPI backend. Interactive OpenAPI: local `http://127.0.0.1:8000/docs`, or production API host `/docs`.

| Auth | Header | Used by |
|------|--------|---------|
| Admin | `Authorization: Bearer <ADMIN_API_TOKEN>` | Dashboard / operator reads (when token is set) |
| Ingest | `Authorization: Bearer <TRUSTEDGE_INGEST_TOKEN>` | Agent-API upsert, detection-engine, flow ingest, behavior observe |

See [ENV_SETUP.md](ENV_SETUP.md). This table is a curated map — prefer live OpenAPI for schemas.

---

## Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health` | — | Health check |

---

## Agents

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/agents` | Admin | List registered agents (Postgres) |
| `GET` | `/agents/{agent_id}` | Admin | Agent detail |
| `POST` | `/internal/agents/upsert` | Ingest | Upsert from Agent-API |

---

## Security observability

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/security/alerts` | Admin | Detection alerts |
| `POST` | `/security/alerts/explain` | Admin | Explain alert via Ollama |
| `POST` | `/security/alerts/ingest` | Ingest | Alert ingest from detection-engine |
| `GET` | `/security/agents` | Admin | Live agent presence (Redis twin) |
| `GET` | `/security/agents/{device_id}` | Admin | Live agent detail |
| `GET` | `/security/agents/{device_id}/events` | Admin | Recent twin events |
| `GET` | `/security/agents/{device_id}/ai-software` | Admin | AI tools inventory |
| `GET` | `/security/agents/{device_id}/baseline` | Admin | Behavior baseline |
| `DELETE` | `/security/agents/{device_id}/baseline` | Admin | Clear / flush baseline learning |
| `GET` | `/security/agents/{device_id}/ai-sessions` | Admin | AI activity sessions |
| `GET` | `/security/ai-sessions/{session_id}` | Admin | Session detail |
| `GET` | `/security/ai-sessions/{session_id}/graph` | Admin | Session graph |
| `GET` | `/security/ai-sessions/{session_id}/timeline` | Admin | Session timeline |
| `GET` | `/security/ai-sessions/{session_id}/chain` | Admin | Session activity chain |
| `GET` | `/security/ai-processes/{process_id}` | Admin | AI process lookup |

---

## Behaviors

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/behaviors` | Admin | Device behavior observations |
| `GET` | `/internal/behaviors` | Ingest | Hydrate detection-engine RAM from Postgres |
| `POST` | `/internal/behaviors/observe` | Ingest | Increment a behavior counter (write-behind) |
| `DELETE` | `/internal/behaviors/{device_id}` | Ingest | Clear durable baseline for a device |

---

## Network flows

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/network-flows/bulk` | Ingest | Conntrack flow samples |
| `POST` | `/network-flows/dns-resolutions/bulk` | Ingest | Name → IP mappings |
| `GET` | `/network-flows/live` | Admin | Recent L4 flows |

---

## Dashboard

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/dashboard/network-overview` | Admin | Network overview / review summary |
