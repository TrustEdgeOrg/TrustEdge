"""In-memory per-device behavior baseline (hot path).

Durable copy lives in Postgres via async write-behind; this map is what
evaluate() reads. Restart hydrates from Postgres, then continues in RAM.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return default


def _ts_iso(epoch: float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


KIND_PROCESS_COMM = "process_comm"
KIND_CURSOR_TOOL = "cursor_tool"


@dataclass
class BaselineEntry:
    count: int
    first_seen: float
    last_seen: float


@dataclass(frozen=True)
class ObserveDecision:
    count: int
    established: bool
    profile_warm: bool
    action: str  # suppress | emit

    def as_dict(self) -> dict[str, Any]:
        return {
            "count": self.count,
            "established": self.established,
            "profile_warm": self.profile_warm,
            "action": self.action,
        }


class BaselineStore:
    """Process-lifetime baseline keyed by device → (kind, key)."""

    def __init__(
        self,
        *,
        suppress_count: int | None = None,
        suppress_age_hours: int | None = None,
        profile_min_keys: int | None = None,
    ) -> None:
        self.suppress_count = suppress_count if suppress_count is not None else _env_int(
            "BEHAVIOR_SUPPRESS_COUNT", 20
        )
        # Age gate disabled for now; field kept on snapshots for API compatibility.
        del suppress_age_hours
        self.suppress_age_hours = 0
        self.profile_min_keys = (
            profile_min_keys
            if profile_min_keys is not None
            else _env_int("BEHAVIOR_PROFILE_MIN_KEYS", 30)
        )
        self._devices: dict[str, dict[tuple[str, str], BaselineEntry]] = {}

    def clear(self) -> None:
        self._devices.clear()

    def seed(
        self,
        device_id: str,
        behavior_kind: str,
        behavior_key: str,
        *,
        count: int,
        first_seen: float,
        last_seen: float,
    ) -> bool:
        """Load a durable row into RAM. Does not increment. Skips keys already present."""
        device = (device_id or "").strip()
        kind = (behavior_kind or "").strip()
        key = (behavior_key or "").strip()
        if not device or not kind or not key:
            return False
        by_key = self._devices.setdefault(device, {})
        if (kind, key) in by_key:
            return False
        n = int(count) if count else 1
        if n < 1:
            n = 1
        by_key[(kind, key)] = BaselineEntry(
            count=n,
            first_seen=float(first_seen),
            last_seen=float(last_seen) if last_seen else float(first_seen),
        )
        return True

    def clear_device(self, device_id: str) -> int:
        """Drop all learned keys for one device. Returns how many entries were removed."""
        device = (device_id or "").strip()
        if not device:
            return 0
        by_key = self._devices.pop(device, None)
        return len(by_key) if by_key else 0

    def snapshot(
        self,
        device_id: str,
        *,
        limit: int = 100,
        now: float | None = None,
    ) -> dict[str, Any]:
        """JSON-friendly baseline dump for one device."""
        device = (device_id or "").strip()
        del now  # age no longer used for established/warm
        by_key = self._devices.get(device) or {}
        items: list[dict[str, Any]] = []
        for (kind, key), entry in sorted(
            by_key.items(),
            key=lambda kv: (-kv[1].count, kv[0][0], kv[0][1]),
        ):
            items.append(
                {
                    "behavior_kind": kind,
                    "behavior_key": key,
                    "count": entry.count,
                    "first_seen_at": _ts_iso(entry.first_seen),
                    "last_seen_at": _ts_iso(entry.last_seen),
                    "established": self._is_established(entry),
                }
            )
            if len(items) >= max(1, limit):
                break
        return {
            "device_id": device,
            "profile_warm": self._profile_warm(device) if device else False,
            "total": len(by_key),
            "items": items,
            "suppress_count": self.suppress_count,
            "suppress_age_hours": self.suppress_age_hours,
            "profile_min_keys": self.profile_min_keys,
        }

    def observe(
        self,
        device_id: str,
        behavior_kind: str,
        behavior_key: str,
        *,
        now: float | None = None,
    ) -> ObserveDecision:
        device = (device_id or "").strip()
        kind = (behavior_kind or "").strip()
        key = (behavior_key or "").strip()
        ts = time.time() if now is None else now

        by_key = self._devices.setdefault(device, {})
        entry = by_key.get((kind, key))
        if entry is None:
            entry = BaselineEntry(count=1, first_seen=ts, last_seen=ts)
            by_key[(kind, key)] = entry
        else:
            entry.count += 1
            entry.last_seen = ts

        established = self._is_established(entry)
        return ObserveDecision(
            count=entry.count,
            established=established,
            profile_warm=self._profile_warm(device),
            action="suppress" if established else "emit",
        )

    def _is_established(self, entry: BaselineEntry) -> bool:
        """Established when seen often enough (no age requirement for now)."""
        return entry.count >= self.suppress_count

    def _profile_warm(self, device_id: str) -> bool:
        """Warm when enough distinct process_comm keys exist (no age fallback)."""
        by_key = self._devices.get(device_id) or {}
        comm_entries = [e for (kind, _key), e in by_key.items() if kind == KIND_PROCESS_COMM]
        return len(comm_entries) >= self.profile_min_keys

    def cursor_profile_warm(self, device_id: str) -> bool:
        """Warm when enough distinct cursor_tool keys exist (no age fallback)."""
        by_key = self._devices.get(device_id) or {}
        tool_entries = [e for (kind, _key), e in by_key.items() if kind == KIND_CURSOR_TOOL]
        return len(tool_entries) >= self.profile_min_keys
