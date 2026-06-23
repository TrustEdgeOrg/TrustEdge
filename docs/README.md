# TrustEdge — Technical documentation

Engineering documentation for the [TrustEdge platform](https://github.com/TrustEdge/TrustEdge) ([organization](https://github.com/TrustEdge)). The [root README](../README.md) is the portfolio overview; this folder is for implementation detail.

---

## Documentation map

| Document | Audience | Contents |
|----------|----------|----------|
| [DESIGN.md](DESIGN.md) | Engineers | Domain model, system topology, frontend/backend patterns, extension guide |
| [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) | Engineers, reviewers | Architecture diagram, data flows, trust boundaries |
| [DEPLOY.md](DEPLOY.md) | Operators | AWS layout, CI/CD, EC2 host services |
| [ENV_SETUP.md](ENV_SETUP.md) | Operators | Environment variables, tokens, troubleshooting |
| [API.md](API.md) | Integrators | REST and WebSocket endpoint reference |
| [CLOUDWATCH_LOGGING.md](CLOUDWATCH_LOGGING.md) | Operators | Production logging, Insights queries |

---

## Repository layout

| Path | Role |
|------|------|
| `frontend/` | React 19 dashboard (feature-based modules) |
| `backend/` | FastAPI API, WebSocket, policy and ingest pipeline |
| `dns-sync/` | Policy → dnsmasq sync, DNS log watcher |
| `host-agent/` | EC2 host service — WireGuard peers, quarantine, sync trigger |
| `scripts/` | EC2 setup (CloudWatch, tokens, TLS) |
| `.github/workflows/` | CI test, ECR build, S3/EC2 deploy |

---

## Reading paths

**Interview / architecture review**

1. [../README.md](../README.md) — product scope and engineering highlights  
2. [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) — components and flows  
3. [DESIGN.md](DESIGN.md) — design principles and code structure  

**Production operations**

1. [DEPLOY.md](DEPLOY.md)  
2. [ENV_SETUP.md](ENV_SETUP.md)  
3. [../host-agent/README.md](../host-agent/README.md)  
4. [CLOUDWATCH_LOGGING.md](CLOUDWATCH_LOGGING.md)  

---

## External references

| Resource | Location |
|----------|----------|
| Backend env catalog | [backend/.env.example](../backend/.env.example) |
| Production backend env | [backend/.env.production.example](../backend/.env.production.example) |
| Frontend env catalog | [frontend/.env.example](../frontend/.env.example) |
| Screenshot assets | [images/README.md](images/README.md) |
| VPN enroll client | [TrustEdgeClient](https://github.com/TrustEdge/TrustEdgeClient) |
| GitHub organization | [TrustEdge](https://github.com/TrustEdge) |
