"""Build Cursor agent-tool baseline keys from ai_agent_action events."""

from __future__ import annotations

from typing import Any, Final, Optional

from rules.alerts import SecurityAlert
from rules.chain import payload_str, ts_iso
from rules.constants import (
    ALERT_AI_NOVEL_CURSOR_TOOL,
    SEVERITY_MEDIUM,
)

TYPE_AI_AGENT_ACTION: Final = "ai_agent_action"
KIND_CURSOR_TOOL: Final = "cursor_tool"
AGENT_TYPE_CURSOR: Final = "cursor"
TOOL_PROMPT: Final = "prompt"

# Runtime corroboration channels — not user-invoked tools.
_SKIP_CHANNELS: Final = frozenset({"NETWORK", "PROCESS"})


def _norm(value: Any) -> str:
    return str(value or "").strip()


def _norm_lower(value: Any) -> str:
    return _norm(value).lower()


def is_cursor_agent(agent_type: str) -> bool:
    normalized = _norm_lower(agent_type).replace("-", "_")
    return normalized == AGENT_TYPE_CURSOR or normalized.startswith("cursor_")


def cursor_tool_keys_from_event(event: dict[str, Any]) -> list[tuple[str, str, dict[str, Any]]]:
    """Return [(kind, key, meta), ...] for Cursor tool baseline learning."""
    if payload_str(event.get("type")) != TYPE_AI_AGENT_ACTION:
        return []
    device_id = payload_str(event.get("device_id"))
    if not device_id:
        return []

    raw_payload = event.get("payload") or {}
    if not isinstance(raw_payload, dict):
        raw_payload = {}

    agent_type = payload_str(raw_payload.get("agent_type"))
    if not is_cursor_agent(agent_type):
        return []

    channel = _norm(raw_payload.get("channel")).upper()
    if channel in _SKIP_CHANNELS:
        return []

    tool = _norm(raw_payload.get("tool"))
    if not tool or _norm_lower(tool) == TOOL_PROMPT:
        return []

    server = _norm_lower(raw_payload.get("server"))
    if channel == "MCP":
        if not server:
            return []
        key = f"MCP|{server}|{_norm_lower(tool)}"
    else:
        key = f"{channel}|{tool}"

    meta: dict[str, Any] = {
        "agent_type": agent_type,
        "channel": channel,
        "tool": tool,
    }
    if server:
        meta["server"] = server
    operation = _norm(raw_payload.get("operation"))
    if operation:
        meta["operation"] = operation
    correlation_id = _norm(raw_payload.get("correlation_id"))
    if correlation_id:
        meta["correlation_id"] = correlation_id
    turn_id = _norm(raw_payload.get("turn_id"))
    if turn_id:
        meta["turn_id"] = turn_id

    return [(KIND_CURSOR_TOOL, key, meta)]


def novel_cursor_tool_alert(
    event: dict[str, Any],
    *,
    behavior_key: str,
    meta: dict[str, Any],
) -> Optional[SecurityAlert]:
    """Build a medium-severity alert for a first-seen Cursor tool on this device."""
    device_id = payload_str(event.get("device_id"))
    if not device_id:
        return None

    channel = _norm(meta.get("channel")).upper()
    tool = _norm(meta.get("tool"))
    server = _norm(meta.get("server"))
    if not tool:
        return None

    if channel == "MCP" and server:
        label = f"{server}/{tool}"
    else:
        label = f"{channel}/{tool}" if channel else tool

    detail = {
        "behavior_kind": KIND_CURSOR_TOOL,
        "behavior_key": behavior_key,
        "agent_type": meta.get("agent_type") or AGENT_TYPE_CURSOR,
        "channel": channel,
        "tool": tool,
        **{k: v for k, v in meta.items() if k not in ("agent_type", "channel", "tool")},
    }

    return SecurityAlert(
        timestamp=ts_iso(
            __import__("rules.chain", fromlist=["parse_ts"]).parse_ts(event.get("ts"))
        ),
        device_id=device_id,
        event_id=payload_str(event.get("event_id")) or None,
        event_type=TYPE_AI_AGENT_ACTION,
        alert_type=ALERT_AI_NOVEL_CURSOR_TOOL,
        severity=SEVERITY_MEDIUM,
        message=f"Novel Cursor tool for this device: {label}",
        detail=__import__("rules.chain", fromlist=["DeviceChain"]).DeviceChain.detail_json(detail),
    )
