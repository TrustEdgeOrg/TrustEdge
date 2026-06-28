# TrustEdge

**Self-hosted network digital twin** — live mirror of VPN clients, apps, and DNS activity, with what-if policy simulation, behavior baselines, and optional enforcement.

Built end-to-end: React dashboard, FastAPI backend, WireGuard enrollment client, host-level enforcement agents, and AWS production deployment with CI/CD.

**Organization:** [github.com/TrustEdge](https://github.com/TrustEdge) · **Platform:** [TrustEdge](https://github.com/TrustEdge/TrustEdge) · **Client:** [TrustEdgeClient](https://github.com/TrustEdge/TrustEdgeClient) · **Docs:** [docs/README.md](docs/README.md)

---

## Overview

Most network security tools are either enterprise appliances with heavy lock-in, or consumer DNS blockers with no real visibility. TrustEdge is a **self-hosted network digital twin**: it mirrors live client connectivity, application attribution, and DNS telemetry, and lets operators **preview policy impact** before applying changes.

Clients enroll over **WireGuard**. DNS flows through a central policy engine (dnsmasq + custom sync). The dashboard streams live queries over **WebSocket**, scores per-device behavior against baselines, and surfaces twin views (network map, client map). Enforcement (quarantine, DNS blocks) is available when needed. Optional **LLM summaries** (OpenAI or Ollama) explain network and device state — detection stays rules-based.

The system is deployed on **AWS** (EC2, RDS, S3, CloudFront, ECR) with GitHub Actions pipelines, structured CloudWatch logging, and a deliberate **container vs. host** split for WireGuard and dnsmasq operations.

---

## Platform at a glance

| Capability | Implementation |
|------------|----------------|
| Digital twin | Network map, client map, live telemetry, 24h DNS recency |
| What-if simulation | Preview global pack toggle impact before apply |
| Secure access | WireGuard VPN, device enrollment API, IP pool allocation |
| Desired-state policy | Policy packs, per-device profiles, schedules, geo/country rules |
| Behavior intelligence | Per-device baselines, drift scoring, optional auto-block |
| Enforcement (actuator) | Host agent (iptables quarantine), dns-sync → dnsmasq reload |
| AI operations | Network overview + behavior review (template / OpenAI / Ollama) |
| Production ops | Structured JSON logs → CloudWatch, Alembic migrations, ECR deploy |

---

## Screenshots

> More captures: [docs/images/README.md](docs/images/README.md) (recommended width ~1400px, dark theme).

### Dashboard & monitoring

![Network overview — AI summary, live stats, and alerts](docs/images/dashboard-home.png)

### Policy & clients

![Behavior baseline, score, and quarantine](docs/images/client-profiles.png)

### Operations

![Geographic client map](docs/images/client-map.png)

---

## Architecture

TrustEdge runs as a **control plane on EC2**. Application logic lives in Docker; network enforcement runs on the host — containers cannot safely mutate WireGuard, iptables, or dnsmasq.

<p align="center">
  <img width="90%" alt="TrustEdge system architecture" src="https://github.com/user-attachments/assets/bab37178-52c4-4f6d-b4ac-1500230d0af5" />
</p>

| Layer | Components | Responsibility |
|-------|------------|----------------|
| **Edge clients** | Laptops, phones, enrolled devices | DNS and traffic via WireGuard tunnel |
| **EC2 host** | WireGuard, dnsmasq, iptables | VPN termination, DNS resolution, quarantine |
| **Host agents** | `trustedge-wg-agent`, `trustedge-log-watcher` | Peer apply, block/unblock, log ingest, policy sync trigger |
| **Application** | FastAPI, dns-sync, React (S3/CloudFront) | Policy engine, REST + WebSocket API, admin UI |
| **Data** | PostgreSQL (RDS), Redis, ECR | Policy state, live usage windows, container images |

**Request flows**

```
DNS:     Client → WireGuard → dnsmasq → log_watcher → API → WebSocket → Dashboard
Policy:  Dashboard → API → RDS → wg-agent → dns-sync → dnsmasq reload
Enroll:  TrustEdgeClient → POST /v1/enroll → wg-agent → WireGuard config
```

**Design decisions worth noting**

- **Generated dnsmasq config** — RDS is source of truth; config files are never hand-edited in production.
- **Selective DNS persistence** — Only blocked queries stored by default; full logging is opt-in (`PERSIST_ALL_DNS`).
- **Rules-based security, LLM for explanation** — Scoring and blocking are deterministic; AI summarizes for operators.
- **Feature-module monorepo** — Backend and frontend organized by domain (`policy`, `devices`, `dns_queries`, `vpn`).

Full write-up: [docs/SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md) · [docs/DESIGN.md](docs/DESIGN.md)

---

## Tech stack

| Area | Technologies |
|------|----------------|
| Frontend | React 19, TypeScript, Material UI 7, MUI X Charts |
| Backend | Python 3.11, FastAPI, SQLAlchemy 2, Alembic, Pydantic 2 |
| Real-time | WebSocket, Redis |
| Data | PostgreSQL 16 (RDS) |
| Network | WireGuard, dnsmasq, iptables |
| Infrastructure | AWS EC2, RDS, S3, CloudFront, ECR |
| Observability | Structured JSON logging, CloudWatch Logs Insights |
| CI/CD | GitHub Actions (test → build → deploy) |
| Containers | Docker, Docker Compose |

---

## Quick start

Production deployment on AWS (EC2, RDS, S3, CloudFront):

```bash
git clone https://github.com/TrustEdge/TrustEdge.git
cd TrustEdge
```

Follow [docs/DEPLOY.md](docs/DEPLOY.md) for EC2 setup, secrets in `/etc/trustedge/backend.env`, and CI/CD.

Enroll a device with [TrustEdgeClient](https://github.com/TrustEdge/TrustEdgeClient).

**Configuration:** [docs/ENV_SETUP.md](docs/ENV_SETUP.md)

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/DESIGN.md](docs/DESIGN.md) | Architecture, domain model, code conventions |
| [docs/DEPLOY.md](docs/DEPLOY.md) | AWS production deployment |
| [docs/API.md](docs/API.md) | REST and WebSocket API reference |
| [docs/ENV_SETUP.md](docs/ENV_SETUP.md) | Environment variables and secrets |
| [host-agent/README.md](host-agent/README.md) | EC2 host agent (WireGuard + enforcement) |

---

## License

Portfolio and educational use. See repository for terms.
