# API reference

TrustEdge exposes a FastAPI backend. Interactive docs: `http://<ec2-ip>:8000/docs` on the production host.

Admin endpoints require `Authorization: Bearer <ADMIN_API_TOKEN>` when the token is configured. DNS ingest uses `DNS_INGEST_TOKEN`. See [ENV_SETUP.md](ENV_SETUP.md).

---

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| **Policy** | | |
| `GET` | `/policy/packs` | List policy packs |
| `GET` | `/policy/profiles` | List policy profiles |
| `GET` | `/policy/dns-sync` | Effective DNS block rules for dnsmasq |
| `POST` | `/policy/apply` | Queue policy sync to dnsmasq |
| **Devices** | | |
| `GET` | `/devices` | List devices |
| `GET` | `/devices/blocked-clients` | Devices with active quarantine or per-device DNS blocks |
| `GET` | `/devices/{id}/behavior-profile` | Client behavior profile |
| `GET` | `/devices/{id}/client-blocks` | Active per-device domain blocks |
| `POST` | `/devices/{id}/client-blocks` | Add a per-device domain block |
| `DELETE` | `/devices/{id}/client-blocks/{block_id}` | Revoke a per-device domain block |
| `POST` | `/devices/{id}/quarantine` | Full-network block (VPN iptables + DNS deny) |
| `DELETE` | `/devices/{id}/quarantine` | Release client from quarantine early |
| **VPN** | | |
| `GET` | `/v1/client-config` | Public client bootstrap (enroll token, API paths, defaults) |
| `POST` | `/v1/enroll` | WireGuard device enrollment |
| `POST` | `/v1/usage` | Report VPN usage samples |
| `GET` | `/vpn/topology` | VPN server and peer topology |
| **DNS Queries** | | |
| `GET` | `/dns-queries` | List DNS queries (paginated, filterable) |
| `POST` | `/dns-queries` | Log a single DNS query |
| `POST` | `/dns-queries/bulk` | Log multiple DNS queries |
| `GET` | `/dns-queries/stats` | Query statistics (total, blocked, top domains) |
| `GET` | `/dns-queries/alerts` | Anomaly alerts |
| `GET` | `/dns-queries/whois?domain=` | WHOIS/RDAP lookup for a domain |
| `GET` | `/dns-queries/sites` | Queries grouped by root domain |
| `WS` | `/dns-queries/ws` | Real-time WebSocket live feed |
| **Dashboard** | | |
| `GET` | `/dashboard/network-overview` | Network overview and review summary |

---

## Host agent (EC2)

The WireGuard host agent runs on the EC2 host, not inside Docker. See [host-agent/README.md](../host-agent/README.md).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness |
| `GET` | `/v1/peers` | List WireGuard peers |
| `POST` | `/v1/apply-peer` | Set peer `allowed-ips` after enroll |
| `POST` | `/v1/block-client` | Drop forwarded VPN traffic for a client IP |
| `POST` | `/v1/unblock-client` | Remove iptables drops |
| `POST` | `/v1/sync-dns-policy` | Run `run-sync.sh` (policy → dnsmasq) |
