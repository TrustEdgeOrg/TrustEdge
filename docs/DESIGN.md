# TrustEdge Design Guide

This document describes how TrustEdge is designed: product goals, system topology, domain concepts, UI conventions, and backend patterns. Use it when adding features, reviewing PRs, or onboarding.

For setup and deployment, see the [main README](../README.md). For environment variables, see [ENV_SETUP.md](ENV_SETUP.md).

---

## Product goals

TrustEdge is a **self-hosted network digital twin** (VPN + live telemetry + behavior baselines + optional enforcement) for teams, branch sites, and operators who want SASE-style visibility without enterprise complexity. The core promise:

1. **Live mirror** — Clients enroll on WireGuard; DNS, apps, and connectivity are mirrored in real time (network map, client map, telemetry feed).
2. **What-if before apply** — Policy pack changes can be simulated against recent DNS activity before syncing to dnsmasq.
3. **Policy as desired state** — Domains are controlled via policy packs, device profiles, schedules, geo rules, and behavior scoring — not ad-hoc block lists in the UI.
4. **Behavior-aware drift** — Per-device baselines and abnormal scores surface drift; rules-based scoring, not LLM judgment.
5. **AI-assisted explanations** *(optional)* — OpenAI or Ollama can summarize network overview and per-device behavior for operators; falls back to templates when AI is off or unavailable.
6. **Enforcement as actuator** — Admin actions (quarantine, per-device blocks, policy apply) propagate to host networking (iptables, dnsmasq) when operators choose to remediate.

---

## Digital twin model

| Layer | Source | Dashboard |
|-------|--------|-----------|
| Connectivity | WireGuard peers, usage samples | Client map, live throughput |
| Application | Foreground app reports (TrustEdgeClient) | Network map |
| DNS telemetry | dnsmasq log ingest + `domain_first_seen` recency | Live feed, simulation lookback |
| Desired state | Policy profiles and packs in RDS | Policy page (+ preview) |
| Drift | Behavior baselines vs live scoring | Client profiles |

Simulation (`POST /twin/simulate/pack-toggle`) compares **proposed policy** against **observed DNS roots** (last 24h) without writing to RDS or reloading dnsmasq.

---

## Design principles

| Principle | What it means in practice |
|-----------|---------------------------|
| **Host vs container boundary** | The FastAPI backend runs in Docker and owns policy state in PostgreSQL. WireGuard peer updates, iptables drops, and dnsmasq reloads run on the EC2 host via `trustedge-wg-agent` and `dns-sync`. |
| **Single source of truth** | Policy and device state live in RDS. dnsmasq config files are **generated artifacts**, never edited manually in production. |
| **Selective persistence** | By default only **blocked** DNS queries are stored in PostgreSQL. Full query logging is opt-in (`PERSIST_ALL_DNS=true`). |
| **Feature modules** | Both frontend and backend are organized by domain feature (`policy`, `devices`, `dns_queries`, etc.), not by technical layer alone. |
| **Dark-first UI** | The dashboard defaults to dark mode. Light mode is supported; navigation chrome adapts per mode. |
| **Pragmatic layering** | Backend layering (route → controller → service → repository) is encouraged but not uniform. Mature paths (`dns_queries`, `devices`) use controllers and Protocols; newer paths may call services directly from routes. |

---

## System topology

```
┌──────────────┐     WireGuard      ┌─────────────────────────────────────────┐
│ Site clients │◄──────────────────►│ EC2 host                                 │
│ + router     │     DNS → VPN      │  dnsmasq · WireGuard · iptables         │
└──────────────┘                    │  trustedge-wg-agent (systemd)            │
                                    │  trustedge-log-watcher (systemd)         │
                                    │  ┌─────────────────────────────────┐    │
                                    │  │ Docker: FastAPI backend :8000   │    │
                                    │  │ Docker: dns-sync (on demand)    │    │
                                    │  └──────────────┬──────────────────┘    │
                                    └─────────────────┼───────────────────────┘
                                                      │
                    ┌─────────────────────────────────┼─────────────────────┐
                    ▼                                 ▼                     ▼
             CloudFront + S3                   AWS RDS PostgreSQL      Redis (usage)
             React dashboard                   policy + devices + DNS
             WebSocket live feed
```

### Runtime responsibilities

| Component | Runs where | Responsibility |
|-----------|------------|----------------|
| **React dashboard** | S3 + CloudFront | Admin UI, live DNS feed, policy/device management |
| **FastAPI backend** | Docker on EC2 | REST + WebSocket API, policy computation, ingest pipeline |
| **dns-sync** | Docker (triggered) | Pull `/policy/dns-sync` → write dnsmasq conf → reload |
| **dns_log_watcher** | systemd on host | Tail dnsmasq log → batch POST to API |
| **trustedge-wg-agent** | systemd on host | Apply WG peers, iptables block/unblock, trigger `run-sync.sh` |
| **dnsmasq** | host | Authoritative DNS for VPN clients; serves block rules |
| **WireGuard** | host | VPN tunnel; all client traffic routed through EC2 |

See [host-agent/README.md](../host-agent/README.md) for the block → DNS sync flow.

---

## Domain concepts

### Digital twin graph

- **Twin graph engine** — Canonical entity/dependency model for impact analysis, blast radius, RCA, and policy simulation. See [GRAPH_ENGINE.md](GRAPH_ENGINE.md).

### Policy

- **Policy pack** — A reusable bundle of DNS block rules (e.g. adult content, gambling).
- **Policy profile** — Assigns packs and settings to a device or device group.
- **Schedule** — Time windows when packs are active.
- **Geo policy** — Country-based access rules evaluated at DNS ingest time.
- **Effective DNS sync** — `GET /policy/dns-sync` returns the merged block list per device (packs + schedules + per-device blocks + quarantine deny rules).

### Devices & clients

- **Device** — A network client identified by MAC, IP lease, VPN pubkey, and optional user label.
- **Behavior profile** — Rolling baseline of DNS activity; abnormal scores can trigger auto-blocks.
- **Per-device domain block** — Temporary DNS deny for specific domains on one device.
- **Quarantine** — Full-network block: iptables drop on VPN traffic + DNS deny-all for the device IP.

### DNS ingest

1. dnsmasq logs a query.
2. `dns_log_watcher` parses and batches it to `POST /dns-queries/bulk`.
3. Backend runs the ingest pipeline: noise filter → geo check → behavior scoring → optional RDS persist.
4. Blocked queries are broadcast on WebSocket (`/dns-queries/ws`) and stored (by default).

### VPN

- Clients enroll via `POST /v1/enroll` and receive a WireGuard config.
- Usage samples (`POST /v1/usage`) feed live throughput charts (Redis-backed).
- Peer `allowed-ips` are applied by the host agent after enroll.

---

## Policy enforcement pipeline

Admin or automated changes follow the same pattern:

```
Dashboard action (quarantine, policy apply, client block)
    → Backend writes DB state
    → notify_policy_changed (sync queue)
    → Host agent: iptables block/unblock (quarantine only)
    → Host agent: POST /v1/sync-dns-policy → run-sync.sh
         → docker compose run dns-sync
         → GET /policy/dns-sync
         → write /etc/dnsmasq.d/*.conf
         → systemctl reload dnsmasq
```

**Why the split?** Docker containers cannot safely mutate host `wg0`, `iptables`, or reload host `dnsmasq`. The backend orchestrates; the host agent executes.

---

## Security model

| Token | Used by | Protects |
|-------|---------|----------|
| `ADMIN_API_TOKEN` | Dashboard, admin scripts | Policy CRUD, device management, quarantine |
| `DNS_INGEST_TOKEN` | dns_log_watcher, dns-sync | Bulk DNS ingest, policy DNS sync read |
| `WG_AGENT_TOKEN` | Backend → host agent | Peer apply, block/unblock, DNS sync trigger |
| Device enroll token | TrustEdge client | `POST /v1/enroll` bootstrap |

- Admin auth is **disabled when `ADMIN_API_TOKEN` is empty** — always set this in production.
- The host agent binds to the Docker bridge IP (`172.17.0.1`) — not the public interface.
- CloudFront terminates HTTPS for the dashboard and proxies API requests to the backend.

---

## Frontend design

### Visual language

| Aspect | Choice |
|--------|--------|
| **Framework** | React 19 + TypeScript |
| **Component library** | Material UI 7 (CSS variables, color schemes) |
| **Charts** | MUI X Charts (dashboard feature overrides) |
| **Font** | Inter |
| **Default mode** | Dark (`InitColorSchemeScript defaultMode="dark"`) |
| **Border radius** | 8px (theme `shape.borderRadius`) |
| **Primary accent** | Blue `hsl(210, 98%, 48%)` (brand palette) |

### Color & chrome

Palette tokens live in `frontend/src/shared/theme/themePrimitives.ts`:

- **brand** — primary actions, selected nav accent
- **gray** — backgrounds, text, dividers
- **green / orange / red** — success, warning, error

Navigation chrome (`shared/theme/navigationChrome.ts`):

- **Dark mode** — neutral sidebar and navbar; primary blue for selected nav indicator
- **Light mode** — Azure-style navbar (`#0078d4`); white icon buttons on top bar
- Selected nav items show a **3px left accent bar** and tinted background

Reusable sx helpers:

- `sidebarNavItemSx` / `sidebarSectionButtonSx` — nav list items
- `navbarIconButtonSx` — top bar icon buttons
- `chromelessIconButtonSx` — inline help icons without bordered chrome

### Layout shell

Every route is wrapped in `shared/components/Layout.tsx`:

```
AppTheme (+ chart customizations)
  ├─ SideMenu          (collapsible: 220px ↔ 64px)
  ├─ AppNavbar         (48px top bar; mobile drawer trigger)
  └─ main
       └─ Header (breadcrumbs) + page content
```

Shell components live under `features/dashboard/components/` (SideMenu, AppNavbar, Header, MenuContent) even though Layout is in `shared/`.

### Navigation structure

Defined in `features/dashboard/components/MenuContent.tsx`:

| Section | Items |
|---------|-------|
| **Home** | Dashboard (`/`) |
| **My network** | Policy, Country access, Client map |
| **Analytics** | Client profiles, Blocked clients |

Routes are declared in `frontend/src/routes/index.tsx`. Pages in `pages/` are thin entry points; feature UI lives in `features/`.

### Feature folder convention

```
features/<name>/
├── components/     # UI scoped to this domain
├── hooks/          # useXxx data hooks
├── config/         # api.ts — fetch wrappers (xxxApi objects)
├── types/          # TypeScript models
├── utils/          # Pure helpers (optional)
└── theme/          # Feature-specific MUI overrides (optional)
```

**API pattern** — each feature's `config/api.ts` uses `shared/config/apiBaseUrl.ts` and `shared/utils/authHeaders.ts`:

```typescript
// Typical shape
export const devicesApi = {
  list: () => apiFetch<Device[]>('/devices'),
  quarantine: (id: number, hours: number) => apiFetch(...),
};
```

**Cross-feature imports are allowed** — e.g. dashboard `useLiveClients` composes devices + dns-queries hooks.

### Page patterns

| Style | Example | Pattern |
|-------|---------|---------|
| Thin page | `ClientProfilesPage` | `return <ClientProfiles />` |
| Composed page | `PolicyPage` | Page owns layout; imports feature components + hooks |

Supporting features without their own route (e.g. `dns-queries`) expose hooks and types consumed by dashboard components.

---

## Backend design

### Layout

```
backend/app/
├── main.py                 # App factory, middleware, router registration
├── shared/                 # DB, config, auth, errors, logging, Redis, WebSocket
└── features/               # Vertical domain modules
    ├── policy/
    ├── devices/
    ├── dns_queries/
    ├── vpn/
    ├── dashboard/
    └── client_behavior/    # No routes; used by devices + dns_queries
```

### Layered architecture (pragmatic)

```
Route (FastAPI endpoint, Depends auth + DB)
  └── Controller (optional — HTTP mapping, WebSocket side effects)
       └── Service (business logic, cross-feature orchestration)
            └── Repository (SQLAlchemy CRUD)
                 └── Model (ORM)
```

| Pattern | Features | Notes |
|---------|----------|-------|
| Full stack | `dns_queries`, `devices` (CRUD) | Controller + `Protocol` interface |
| Thin routes | `policy`, `vpn`, `dashboard` | Route calls service directly |
| Mixed | `devices` (extended routes) | Behavior/quarantine endpoints inline |

**Reference implementation:** `dns_queries` — route → `DnsQueryController` → `DnsQueryService` (implements `IDnsQueryService`) → `DnsQueryRepository`.

### Dependency injection

- **Shared:** `get_db()` generator in `shared/dependencies.py`
- **Feature factories:** `features/<name>/dependencies.py` for stateless services
- **Inline factories:** DB-scoped services created in route modules (`get_policy_service(db)`)
- **Auth:** composable `Depends(verify_admin_api_token)`, `verify_dns_ingest_service`, `verify_enroll_bootstrap`

### Schemas & models

- **ORM models** in `features/<name>/models/` — inherit `Base` from `shared/database.py`
- **API schemas** in `features/<name>/schemas/` — Pydantic v2 with `model_validate` / `from_attributes`
- Services map ORM → response DTOs at the boundary

### Error handling

Three styles coexist (prefer domain exceptions + controller mapping for new code):

1. **Domain exceptions** — `DeviceNotFoundError` raised in service, mapped to 404 in controller
2. **HTTPException in service** — used in `PolicyService` for not-found cases
3. **Route try/except** — VPN enroll catches `ValueError` at the route layer

Shared base: `shared/errors/` (`DomainError`, `NotFoundError`, `ConflictError`, `ValidationError`).

### Cross-feature orchestration

No global event bus. Services import peer services explicitly:

- `DnsQueryService` calls `ForbiddenCountryService`, `ClientBehaviorAggregator`, `BehaviorScoringService`
- `PolicyDnsService` merges client_behavior blocked domains into effective DNS rules
- `device_route.py` aggregates devices, behavior, policy, and VPN usage endpoints

---

## Data persistence

| Data | Store | Notes |
|------|-------|-------|
| Policy, devices, blocks | PostgreSQL (RDS) | Source of truth |
| DNS queries (blocked) | PostgreSQL | Default; full logging opt-in |
| Live VPN usage | Redis | Real-time throughput charts |
| dnsmasq config | Host filesystem | Generated by dns-sync |
| Log watcher offset | `/var/lib/trustedge/log_parser_state` | Host state file |

---

## Infrastructure & deployment

| Environment | Trigger | Target |
|-------------|---------|--------|
| `develop` / `main` push | GitHub Actions | EC2 backend (ECR), S3/CloudFront frontend |

Host systemd services on EC2:

- `trustedge-wg-agent` — peer apply, block/unblock, DNS sync trigger
- `trustedge-log-watcher` — DNS log tail → API
- `dnsmasq` — DNS resolver
- `wg-quick@wg0` — WireGuard

---

## Adding a new feature

### Frontend

1. Create `frontend/src/features/<name>/` with `components/`, `hooks/`, `config/api.ts`, `types/`.
2. Add a page in `pages/<Name>Page.tsx` (thin wrapper).
3. Register the route in `routes/index.tsx` wrapped in `<Layout>`.
4. Add a nav item in `MenuContent.tsx` under the appropriate section.
5. Reuse theme tokens and `navigationChrome` sx helpers — avoid one-off colors.

### Backend

1. Create `backend/app/features/<name>/` with `routes/`, `services/`, `repositories/`, `models/`, `schemas/`.
2. Register the router in `main.py`.
3. Add Alembic migration for new tables.
4. Prefer: service raises domain errors, controller maps to HTTP status.
5. Add tests under `backend/tests/unit/<name>/` and `backend/tests/integration/<name>/`.

### DNS-blocking features

If the feature affects what dnsmasq serves:

1. Extend `PolicyDnsService.build_dns_sync()` (or the relevant merge path).
2. Call `notify_policy_changed` and trigger host DNS sync via `_run_host_dns_sync`.
3. Verify `dns-sync/sync.py` writes the expected conf format.

---

## Related docs

| Document | Contents |
|----------|----------|
| [docs/README.md](README.md) | Documentation index |
| [README.md](../README.md) | Overview, quick start, API table |
| [API.md](API.md) | REST and WebSocket endpoints |
| [DEPLOY.md](DEPLOY.md) | Production deployment |
| [ENV_SETUP.md](ENV_SETUP.md) | Environment variables |
| [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) | Architecture diagram and data flows |
| [host-agent/README.md](../host-agent/README.md) | Host agent install and block flow |
| [CLOUDWATCH_LOGGING.md](CLOUDWATCH_LOGGING.md) | Production logging |
