"""MCP / agent-action governance correlation (governed vs ungoverned).

Cross-layer detection establishes correlation and risk, not proof that
sensitive data was transmitted. Alert wording must not claim exfiltration
of content without data-flow evidence.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Final

from ai_activity.catalog import ENGINE_AI_ACTIVITY
from rules.alerts import SecurityAlert
from rules.chain import parse_ts, payload_str
from rules.constants import SEVERITY_HIGH, SEVERITY_SCORE

FINDING_SENSITIVE_THEN_UNGOVERNED_EGRESS: Final = "ai_sensitive_mcp_ungoverned_egress"

DEFAULT_CORRELATION_WINDOW_SEC = 120
DEFAULT_MIN_CONFIDENCE = "MEDIUM"

TYPE_AI_AGENT_ACTION: Final = "ai_agent_action"


def _env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        v = int(raw)
        return v if v >= 0 else default
    except ValueError:
        return default


def _env_csv(name: str) -> set[str]:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return set()
    return {p.strip().lower() for p in raw.split(",") if p.strip()}


@dataclass
class SensitiveMCPAccess:
    agent_type: str
    server: str
    tool: str
    correlation_id: str
    timestamp: datetime
    sensitivity: str
    decision: str
    device_id: str


@dataclass
class GovernanceConfig:
    correlation_window_sec: int = DEFAULT_CORRELATION_WINDOW_SEC
    approved_destinations: set[str] = field(default_factory=set)
    approved_child_processes: set[str] = field(default_factory=set)
    trusted_mcp_servers: set[str] = field(default_factory=set)
    trusted_tools: set[str] = field(default_factory=set)
    min_attribution_confidence: str = DEFAULT_MIN_CONFIDENCE
    private_destination_markers: set[str] = field(
        default_factory=lambda: {
            "localhost",
            "127.0.0.1",
            "::1",
            ".local",
            ".internal",
        }
    )

    @classmethod
    def from_env(cls) -> "GovernanceConfig":
        return cls(
            correlation_window_sec=_env_int(
                "TRUSTEDGE_GOVERNANCE_CORRELATION_WINDOW_SEC",
                DEFAULT_CORRELATION_WINDOW_SEC,
            ),
            approved_destinations=_env_csv("TRUSTEDGE_GOVERNANCE_APPROVED_DESTINATIONS"),
            approved_child_processes=_env_csv("TRUSTEDGE_GOVERNANCE_APPROVED_PROCESSES"),
            trusted_mcp_servers=_env_csv("TRUSTEDGE_GOVERNANCE_TRUSTED_MCP_SERVERS"),
            trusted_tools=_env_csv("TRUSTEDGE_GOVERNANCE_TRUSTED_TOOLS"),
            min_attribution_confidence=(
                os.environ.get("TRUSTEDGE_GOVERNANCE_MIN_CONFIDENCE") or DEFAULT_MIN_CONFIDENCE
            )
            .strip()
            .upper()
            or DEFAULT_MIN_CONFIDENCE,
        )


_CONF_RANK = {"UNKNOWN": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3, "VERIFIED": 4}


@dataclass
class GovernanceStore:
    by_device: dict[str, list[SensitiveMCPAccess]] = field(default_factory=dict)
    alerted: set[str] = field(default_factory=set)
    cfg: GovernanceConfig = field(default_factory=GovernanceConfig.from_env)

    def record_mcp(self, access: SensitiveMCPAccess) -> None:
        lst = self.by_device.setdefault(access.device_id, [])
        lst.append(access)
        if len(lst) > 200:
            del lst[:-100]

    def recent_sensitive(
        self, device_id: str, agent_type: str, now: datetime
    ) -> list[SensitiveMCPAccess]:
        window = timedelta(seconds=self.cfg.correlation_window_sec)
        out: list[SensitiveMCPAccess] = []
        for a in self.by_device.get(device_id, []):
            if a.agent_type and agent_type and not _agent_match(a.agent_type, agent_type):
                continue
            if now - a.timestamp <= window:
                out.append(a)
        return out


def _agent_match(a: str, b: str) -> bool:
    a = (a or "").lower().replace("-", "_")
    b = (b or "").lower().replace("-", "_")
    if a == b:
        return True
    if a.replace("_code", "") == b.replace("_code", ""):
        return True
    if a.startswith(b) or b.startswith(a):
        return True
    return False


def is_external_destination(dest: str, cfg: GovernanceConfig) -> bool:
    d = (dest or "").strip().lower()
    if not d:
        return False
    if d in cfg.approved_destinations:
        return False
    if d.startswith("10.") or d.startswith("192.168.") or d.startswith("127."):
        return False
    if d.startswith("172."):
        parts = d.split(".")
        if len(parts) >= 2 and parts[1].isdigit() and 16 <= int(parts[1]) <= 31:
            return False
    for m in cfg.private_destination_markers:
        if m.startswith("."):
            if d.endswith(m):
                return False
        elif d == m:
            return False
    return True


def handle_ai_agent_action(
    event: dict[str, Any],
    store: GovernanceStore,
) -> list[SecurityAlert]:
    """Record governed sensitive MCP accesses for later correlation."""
    et = str(event.get("type") or event.get("event_type") or "").strip()
    if et != TYPE_AI_AGENT_ACTION:
        return []
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    device_id = str(event.get("device_id") or "").strip()
    channel = payload_str(payload.get("channel")).upper()
    governed = payload.get("governed")
    decision = payload_str(payload.get("decision")).lower()
    sensitivity = payload_str(payload.get("sensitivity")).lower()
    server = payload_str(payload.get("server")).lower()
    tool = payload_str(payload.get("tool")).lower()
    clas = payload_str(payload.get("classification")).lower()

    if channel != "MCP" or governed is not True:
        return []
    if server in store.cfg.trusted_mcp_servers or tool in store.cfg.trusted_tools:
        return []
    if decision not in ("allowed", "allow"):
        return []
    sensitive = sensitivity == "sensitive" or clas in (
        "sensitive_read",
        "potentially_sensitive_read",
    )
    if not sensitive:
        return []

    ts = parse_ts(payload.get("timestamp") or event.get("ts"))
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)

    store.record_mcp(
        SensitiveMCPAccess(
            agent_type=payload_str(payload.get("agent_type")) or "unknown",
            server=server,
            tool=tool,
            correlation_id=payload_str(payload.get("correlation_id")),
            timestamp=ts,
            sensitivity="sensitive",
            decision=decision,
            device_id=device_id,
        )
    )
    return []


def correlate_ungoverned_egress(
    *,
    device_id: str,
    agent_type: str,
    destination: str,
    process_name: str,
    evidence: list[str],
    confidence: str,
    timestamp: str,
    event_id: str | None,
    store: GovernanceStore,
    governed: bool = False,
) -> SecurityAlert | None:
    if governed:
        return None
    cfg = store.cfg
    if not is_external_destination(destination, cfg):
        return None
    if (process_name or "").strip().lower() in cfg.approved_child_processes:
        return None
    conf = (confidence or "UNKNOWN").upper()
    if _CONF_RANK.get(conf, 0) < _CONF_RANK.get(cfg.min_attribution_confidence, 2):
        return None

    now = parse_ts(timestamp)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    recent = store.recent_sensitive(device_id, agent_type, now)
    if not recent:
        return None

    mcp = recent[-1]
    fp = f"{device_id}|{mcp.correlation_id}|{destination}|{FINDING_SENSITIVE_THEN_UNGOVERNED_EGRESS}"
    if fp in store.alerted:
        return None
    store.alerted.add(fp)

    detail = {
        "finding_type": FINDING_SENSITIVE_THEN_UNGOVERNED_EGRESS,
        "engine": ENGINE_AI_ACTIVITY,
        "governed_mcp": {
            "server": mcp.server,
            "tool": mcp.tool,
            "correlation_id": mcp.correlation_id,
            "sensitivity": mcp.sensitivity,
        },
        "ungoverned_runtime": {
            "destination": destination,
            "process": process_name,
            "evidence": evidence,
            "confidence": confidence,
            "governed": False,
        },
        "claim": "correlation_risk_path",
        "not_claimed": "content_exfiltration",
    }

    return SecurityAlert(
        timestamp=timestamp,
        device_id=device_id,
        alert_type=FINDING_SENSITIVE_THEN_UNGOVERNED_EGRESS,
        severity=SEVERITY_HIGH,
        message=(
            "Sensitive access followed by ungoverned egress: "
            f"AI agent ({agent_type}) accessed sensitive information through an approved "
            f"MCP tool ({mcp.server}/{mcp.tool}) and subsequently initiated ungoverned "
            f"external communication to {destination}. "
            "Potential sensitive-data exfiltration path "
            "(correlation, not proof of data transfer)."
        ),
        event_id=event_id or "",
        event_type=TYPE_AI_AGENT_ACTION,
        detail=json.dumps(detail, separators=(",", ":")),
        score=SEVERITY_SCORE[SEVERITY_HIGH],
        engines=[
            {
                "engine": ENGINE_AI_ACTIVITY,
                "alert_type": FINDING_SENSITIVE_THEN_UNGOVERNED_EGRESS,
            }
        ],
    )
