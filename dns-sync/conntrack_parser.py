"""Parse Linux conntrack extended output into flow records."""

from __future__ import annotations

import ipaddress
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Optional


@dataclass(frozen=True)
class ParsedFlow:
    client_ip: str
    protocol: str
    src_port: Optional[int]
    dest_ip: str
    dest_port: Optional[int]
    state: str


_KV_RE = re.compile(r"(\w+)=([^\s]+)")
_PROTO_RE = re.compile(r"^\S+\s+\d+\s+(tcp|udp|icmp)\b", re.IGNORECASE)


def _first_fields(line: str) -> dict[str, str]:
    """Conntrack extended lines repeat src/dst/sport/dport for the reply tuple — keep originals."""
    fields: dict[str, str] = {}
    for key, value in _KV_RE.findall(line):
        fields.setdefault(key, value)
    return fields


def _parse_int(value: str) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_conntrack_line(line: str, *, vpn_cidr: str) -> Optional[ParsedFlow]:
    """Parse one `conntrack -L -o extended` line for an outbound VPN client flow."""
    text = line.strip()
    if not text or text.startswith("#"):
        return None

    try:
        network = ipaddress.ip_network(vpn_cidr, strict=False)
    except ValueError:
        return None

    fields = _first_fields(text)
    src = fields.get("src")
    dst = fields.get("dst")
    if not src or not dst:
        return None

    try:
        src_ip = ipaddress.ip_address(src)
    except ValueError:
        return None

    if src_ip not in network:
        return None

    try:
        dst_ip = ipaddress.ip_address(dst)
    except ValueError:
        return None

    if dst_ip in network:
        return None

    proto_match = _PROTO_RE.search(text)
    proto = (proto_match.group(1) if proto_match else fields.get("proto") or "tcp").lower()
    if proto not in {"tcp", "udp", "icmp"}:
        return None

    state = fields.get("state") or fields.get("status") or "UNKNOWN"
    return ParsedFlow(
        client_ip=str(src_ip),
        protocol=proto,
        src_port=_parse_int(fields.get("sport", "")),
        dest_ip=str(dst_ip),
        dest_port=_parse_int(fields.get("dport", "")),
        state=state.upper(),
    )


def list_conntrack_flows(vpn_cidr: str, *, command: Optional[list[str]] = None) -> list[ParsedFlow]:
    argv = command or ["conntrack", "-L", "-o", "extended"]
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=15, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return []

    if proc.returncode != 0:
        return []

    seen: set[tuple[str, str, str, int, int]] = set()
    flows: list[ParsedFlow] = []
    for line in proc.stdout.splitlines():
        parsed = parse_conntrack_line(line, vpn_cidr=vpn_cidr)
        if parsed is None:
            continue
        key = (
            parsed.client_ip,
            parsed.protocol,
            parsed.dest_ip,
            parsed.dest_port or 0,
            parsed.src_port or 0,
        )
        if key in seen:
            continue
        seen.add(key)
        flows.append(parsed)
    return flows


def flows_to_api_payload(flows: Iterable[ParsedFlow], *, observed_at: Optional[datetime] = None) -> list[dict]:
    ts = observed_at or datetime.now(timezone.utc)
    iso = ts.isoformat()
    out: list[dict] = []
    for flow in flows:
        out.append(
            {
                "observed_at": iso,
                "client_ip": flow.client_ip,
                "protocol": flow.protocol,
                "src_port": flow.src_port,
                "dest_ip": flow.dest_ip,
                "dest_port": flow.dest_port,
                "state": flow.state,
            }
        )
    return out


def run_conntrack_list() -> list[str]:
    proc = subprocess.run(
        ["conntrack", "-L", "-o", "extended"],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    if proc.returncode != 0:
        return []
    return [line for line in proc.stdout.splitlines() if line.strip()]
