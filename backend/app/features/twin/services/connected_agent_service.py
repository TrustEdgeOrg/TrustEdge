from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.features.twin.schemas.connected_agent import (
    AgentEventListResponse,
    AgentEventRead,
    ConnectedAgentListResponse,
    ConnectedAgentRead,
)
from app.features.twin.schemas.ai_software import AiSoftwareItem, AiSoftwareListResponse
from app.features.twin.services import trusttwin_store


def _as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_int_default(value: Any, default: int = 0) -> int:
    n = _as_int(value)
    return default if n is None else n


def _as_dict_list(value: Any) -> list[dict]:
    if not isinstance(value, list):
        return []
    out: list[dict] = []
    for item in value:
        if isinstance(item, dict):
            out.append(dict(item))
    return out


def _as_optional_bool(value: Any) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    return None


def _as_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        s = str(item).strip()
        if s:
            out.append(s)
    return out


def _as_str_map_list(value: Any) -> dict[str, list[str]]:
    if not isinstance(value, dict):
        return {}
    out: dict[str, list[str]] = {}
    for key, raw in value.items():
        server = str(key).strip()
        if not server:
            continue
        out[server] = _as_str_list(raw)
    return out


def _connected_agent_from_latest(
    row: trusttwin_store.TwinDeviceLatest,
    *,
    cutoff: datetime,
) -> ConnectedAgentRead:
    details = row.client_details or {}
    network = row.network_summary or {}
    action = row.action_summary or {}
    connected = bool(row.last_seen_at and row.last_seen_at >= cutoff)
    return ConnectedAgentRead(
        device_id=row.device_id,
        hostname=(details.get("hostname") or None),
        os=(details.get("os") or None),
        os_version=(details.get("os_version") or None),
        arch=(details.get("arch") or None),
        agent_version=(details.get("agent_version") or None),
        status=(details.get("status") or None),
        public_ip=(network.get("public_ip") or None),
        network_type=(network.get("network_type") or None),
        listening_count=_as_int(network.get("listening_count")),
        established_count=_as_int(network.get("established_count")),
        presence=(action.get("presence") or None),
        idle_sec=_as_int(action.get("idle_sec")),
        app_switches=_as_int(action.get("app_switches")),
        last_seen_at=row.last_seen_at,
        connected=connected,
        client_details=details,
        network_summary=network,
        action_summary=action,
    )


class ConnectedAgentService:
    def list_connected_agents(self, *, connected_within_sec: int = 300) -> ConnectedAgentListResponse:
        window = max(30, min(int(connected_within_sec), 86400))
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=window)

        items: list[ConnectedAgentRead] = [
            _connected_agent_from_latest(row, cutoff=cutoff) for row in trusttwin_store.list_latest()
        ]

        items.sort(
            key=lambda x: (
                0 if x.connected else 1,
                -(x.last_seen_at.timestamp()) if x.last_seen_at else float("-inf"),
            )
        )
        return ConnectedAgentListResponse(
            items=items,
            total=len(items),
            connected_within_sec=window,
        )

    def get_connected_agent(
        self,
        device_id: str,
        *,
        connected_within_sec: int = 300,
    ) -> ConnectedAgentRead | None:
        row = trusttwin_store.get_latest(device_id.strip())
        if row is None:
            return None
        window = max(30, min(int(connected_within_sec), 86400))
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=window)
        return _connected_agent_from_latest(row, cutoff=cutoff)

    def list_device_events(self, device_id: str, *, limit: int = 50) -> AgentEventListResponse:
        device_id = device_id.strip()
        raw_events = trusttwin_store.list_recent_events(device_id, limit=limit)
        items: list[AgentEventRead] = []
        for event in raw_events:
            payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
            items.append(
                AgentEventRead(
                    event_id=str(event.get("event_id") or ""),
                    device_id=str(event.get("device_id") or device_id),
                    type=str(event.get("type") or ""),
                    ts=str(event.get("ts") or "") or None,
                    payload=payload,
                )
            )
        return AgentEventListResponse(items=items, total=len(items), device_id=device_id)

    def list_ai_software(self, device_id: str) -> AiSoftwareListResponse:
        device_id = device_id.strip()
        row = trusttwin_store.get_latest(device_id)
        raw_apps = (row.known_ai_apps if row is not None else {}) or {}
        items: list[AiSoftwareItem] = []
        for app_id, payload in raw_apps.items():
            if not isinstance(payload, dict):
                continue
            item_id = str(payload.get("id") or app_id).strip()
            if not item_id:
                continue
            if payload.get("removed") is True:
                continue
            if not bool(payload.get("installed")):
                continue
            matched = payload.get("matched_evidence")
            failed = payload.get("failed_evidence")
            items.append(
                AiSoftwareItem(
                    id=item_id,
                    product_id=str(payload.get("product_id") or ""),
                    product_name=str(payload.get("product_name") or ""),
                    vendor=str(payload.get("vendor") or ""),
                    category=str(payload.get("category") or ""),
                    confidence=str(payload.get("confidence") or ""),
                    confidence_reason=str(payload.get("confidence_reason") or ""),
                    installed=bool(payload.get("installed")),
                    running=bool(payload.get("running")),
                    path=str(payload.get("path") or ""),
                    version=str(payload.get("version") or ""),
                    bundle_id=str(payload.get("bundle_id") or ""),
                    executable=str(payload.get("executable") or ""),
                    signing_id=str(payload.get("signing_id") or ""),
                    team_id=str(payload.get("team_id") or ""),
                    signature_valid=(
                        bool(payload["signature_valid"])
                        if "signature_valid" in payload and payload["signature_valid"] is not None
                        else None
                    ),
                    matched_evidence=[str(x) for x in matched] if isinstance(matched, list) else [],
                    failed_evidence=[str(x) for x in failed] if isinstance(failed, list) else [],
                    invocation_path=str(payload.get("invocation_path") or ""),
                    resolved_path=str(payload.get("resolved_path") or ""),
                    package_manager=str(payload.get("package_manager") or ""),
                    package_identifier=str(payload.get("package_identifier") or ""),
                    entry_point=str(payload.get("entry_point") or ""),
                    interpreter=str(payload.get("interpreter") or ""),
                    serving=bool(payload.get("serving")),
                    exposure=str(payload.get("exposure") or ""),
                    listeners=_as_dict_list(payload.get("listeners")),
                    models_available=_as_int_default(payload.get("models_available"), 0),
                    model_format=str(payload.get("model_format") or ""),
                    runtime_version=str(payload.get("runtime_version") or ""),
                    local_clients=_as_dict_list(payload.get("local_clients")),
                    extension_id=str(payload.get("extension_id") or ""),
                    host_ide_product_id=str(payload.get("host_ide_product_id") or ""),
                    host_ide_path=str(payload.get("host_ide_path") or ""),
                    profile=str(payload.get("profile") or ""),
                    enabled=_as_optional_bool(payload.get("enabled")),
                    active=_as_optional_bool(payload.get("active")),
                    mcp_configured=bool(payload.get("mcp_configured")),
                    mcp_servers=_as_str_list(payload.get("mcp_servers")),
                    mcp_server_tools=_as_str_map_list(payload.get("mcp_server_tools")),
                    local_model_product_id=str(payload.get("local_model_product_id") or ""),
                    skills=_as_dict_list(payload.get("skills")),
                )
            )
        items.sort(key=lambda x: (x.product_name or x.product_id or x.id).lower())
        return AiSoftwareListResponse(device_id=device_id, total=len(items), items=items)

