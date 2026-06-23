# TrustEdge WireGuard host agent

This is a tiny HTTP service that runs **on the EC2 host as root** and applies:

`wg set <iface> peer <client_pubkey> allowed-ips <ip>/32`

It exists because the `trustedge-api` container cannot safely mutate the host `wg0` interface or host `iptables`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness |
| `GET` | `/v1/peers` | List WireGuard peers (`wg show dump`) |
| `POST` | `/v1/apply-peer` | Set peer `allowed-ips` after enroll |
| `POST` | `/v1/block-client` | Drop all forwarded VPN traffic for a client IP |
| `POST` | `/v1/unblock-client` | Remove iptables drops for a client IP |
| `POST` | `/v1/sync-dns-policy` | Run `run-sync.sh` (pull API → dnsmasq reload) |

## How block triggers `run-sync.sh`

```
Dashboard  →  POST /devices/{id}/quarantine  →  Backend (Docker)
    →  save device_quarantines row
    →  POST http://172.17.0.1:9109/v1/block-client   (iptables)
    →  POST http://172.17.0.1:9109/v1/sync-dns-policy  (bash run-sync.sh on host)
         →  docker compose run dns-sync  →  GET /policy/dns-sync
         →  write /etc/dnsmasq.d/trustedge-devices/te-device-*.conf
         →  systemctl reload dnsmasq
```

The backend container cannot reload host dnsmasq; the host agent runs as **root** on EC2.

Set `TRUSTEDGE_DNS_SYNC_SCRIPT=/home/ubuntu/trustedge/dns-sync/run-sync.sh` in the agent service.

## Install (EC2)

1) Copy files to `/opt/trustedge/`:

- `trustedge-wg-agent.py`
- `trustedge-wg-agent.service`

2) Set a strong token (must match backend `WG_AGENT_TOKEN`):

Edit `/etc/systemd/system/trustedge-wg-agent.service` (or use a drop-in) and replace `CHANGE_ME`.

3) Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now trustedge-wg-agent
sudo systemctl status trustedge-wg-agent --no-pager
```

4) Smoke test from the host:

```bash
curl -sS http://172.17.0.1:9109/health
```

## Backend configuration

The backend container should call:

- `WG_AGENT_URL=http://172.17.0.1:9109` (default)
- `WG_AGENT_TOKEN=<same token as TRUSTEDGE_WG_AGENT_TOKEN>`

Set these on EC2:

- **`/etc/trustedge/backend.env`** (loaded into the backend container via `env_file:`; survives CI/CD deploys)
- **Repo root** `.env` (for docker compose `${WG_AGENT_TOKEN}` interpolation): synced by deploy from `/etc/trustedge/wg-agent.token`

First-time: `sudo cp backend/.env.production.example /etc/trustedge/backend.env && sudo chown root:docker /etc/trustedge/backend.env && sudo chmod 640 /etc/trustedge/backend.env` (ubuntu must be in the `docker` group so compose can read the file)

## Security notes

- The agent binds to the Docker bridge IP by default (`172.17.0.1`) so it is not exposed on the public interface.
- Use a long random bearer token.
