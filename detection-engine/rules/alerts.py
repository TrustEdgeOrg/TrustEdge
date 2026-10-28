from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from rules.constants import ALERT_NOVEL_PROCESS, COOLDOWN_SECONDS, ALERT_AI_NOVEL_CURSOR_TOOL

__all__ = ["SecurityAlert", "alert_fingerprint"]


def _parse_ts(raw: str) -> datetime:
    text = (raw or "").strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        dt = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _novel_process_identity(detail: str | None) -> str | None:
    """Stable per-process identity for novel_process dedupe."""
    if not detail:
        return None
    try:
        import json

        data = json.loads(detail)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    key = str(data.get("behavior_key") or data.get("comm") or "").strip().lower()
    return key or None


def _novel_cursor_tool_identity(detail: str | None) -> str | None:
    """Stable per-tool identity for ai_novel_cursor_tool dedupe."""
    if not detail:
        return None
    try:
        import json

        data = json.loads(detail)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    key = str(data.get("behavior_key") or "").strip().lower()
    return key or None


def alert_fingerprint(
    *,
    device_id: str,
    alert_type: str,
    timestamp: str,
    event_id: str | None = None,
    identity: str | None = None,
) -> str:
    """Stable identity for dedupe / cooldown.

    Point-in-time alerts (e.g. shell→curl) key on event_id.
    Windowed alerts key on a time bucket matching the rule window.
    novel_process keys on process identity (behavior_key), not a shared time bucket.
    """
    if identity:
        anchor = f"id:{identity}"
    else:
        cooldown = COOLDOWN_SECONDS.get(alert_type)
        if cooldown:
            epoch = int(_parse_ts(timestamp).timestamp())
            bucket = epoch // cooldown
            anchor = f"bucket:{bucket}"
        else:
            anchor = event_id or timestamp
    raw = f"{device_id}|{alert_type}|{anchor}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


@dataclass
class SecurityAlert:
    timestamp: str
    device_id: str
    alert_type: str
    severity: str
    message: str
    event_id: str | None = None
    event_type: str | None = None
    detail: str | None = None
    score: int | None = None
    engines: list[dict[str, Any]] | None = None

    def fingerprint(self) -> str:
        identity = None
        if self.alert_type == ALERT_NOVEL_PROCESS:
            identity = _novel_process_identity(self.detail)
        elif self.alert_type == ALERT_AI_NOVEL_CURSOR_TOOL:
            identity = _novel_cursor_tool_identity(self.detail)
        return alert_fingerprint(
            device_id=self.device_id,
            alert_type=self.alert_type,
            timestamp=self.timestamp,
            event_id=self.event_id,
            identity=identity,
        )

    def to_api(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "timestamp": self.timestamp,
            "device_id": self.device_id,
            "alert_type": self.alert_type,
            "severity": self.severity,
            "message": self.message,
            "fingerprint": self.fingerprint(),
        }
        if self.event_id:
            out["event_id"] = self.event_id
        if self.event_type:
            out["event_type"] = self.event_type
        if self.detail:
            out["detail"] = self.detail
        if self.score is not None:
            out["score"] = self.score
        if self.engines:
            out["engines"] = self.engines
        return out
