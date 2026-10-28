"""Build process frequency profile keys from process_start events.

Behavioral profile stores process_comm only (not parent>child chains).
"""

from __future__ import annotations

from typing import Any, Final, Optional

from rules.alerts import SecurityAlert
from rules.chain import DeviceChain, payload_int, payload_str, ts_iso
from rules.constants import (
    ALERT_NOVEL_PROCESS,
    SEVERITY_MEDIUM,
    TYPE_PROCESS_START,
)
from rules.state import StateStore

KIND_PROCESS_COMM = "process_comm"

# Still learned into the baseline, but never raised as novel_process.
_SYSTEM_EXECUTABLE_PREFIXES: Final = (
    "/system/",
    "/usr/libexec/",
    "/usr/sbin/",
    "/sbin/",
    "/library/apple/",
    "/library/systemexperienceagent/",
    "/platform/",
)


def _norm(value: Any) -> str:
    text = str(value or "").strip().lower()
    if "/" in text:
        text = text.rsplit("/", 1)[-1]
    return text


def is_system_process_noise(*, comm: str = "", executable: str = "") -> bool:
    """True for Apple/OS helpers that flood first-seen alerts on macOS."""
    del comm  # reserved for future name-based filters
    exe = str(executable or "").strip().lower()
    if not exe:
        return False
    if any(exe.startswith(prefix) for prefix in _SYSTEM_EXECUTABLE_PREFIXES):
        return True
    if "/system/library/" in exe:
        return True
    # Apple XPC services outside /Applications are almost always OS noise.
    if "/contents/xpcservices/" in exe and "/applications/" not in exe:
        return True
    return False


def _comm_from_payload(payload: dict[str, Any]) -> str:
    raw = payload_str(payload.get("comm")) or payload_str(payload.get("executable"))
    return _norm(raw)


def _executable_from_payload(payload: dict[str, Any]) -> str:
    """Full lowercase path (not basename) so system-prefix filters work."""
    return str(payload_str(payload.get("executable") or "") or "").strip().lower()


def profile_keys_from_event(
    event: dict[str, Any],
    store: StateStore,
) -> list[tuple[str, str, dict[str, Any]]]:
    """Return [(kind, key, meta), ...] for process_start profile learning.

    Only process_comm is persisted — no parent>child process_chain keys.
    """
    del store  # retained for call-site compatibility; chain lookup not used
    if payload_str(event.get("type")) != TYPE_PROCESS_START:
        return []
    device_id = payload_str(event.get("device_id"))
    if not device_id:
        return []
    raw_payload = event.get("payload") or {}
    if not isinstance(raw_payload, dict):
        raw_payload = {}

    comm = _comm_from_payload(raw_payload)
    if not comm:
        return []

    exe = _executable_from_payload(raw_payload)
    meta: dict[str, Any] = {"comm": comm}
    if exe:
        meta["executable"] = exe

    return [(KIND_PROCESS_COMM, comm, meta)]


def novel_process_alert(
    event: dict[str, Any],
    *,
    behavior_key: str,
    meta: dict[str, Any],
) -> Optional[SecurityAlert]:
    """Build a medium-severity novel_process alert for a first-seen process identity."""
    device_id = payload_str(event.get("device_id"))
    if not device_id:
        return None
    raw_payload = event.get("payload") or {}
    if not isinstance(raw_payload, dict):
        raw_payload = {}
    comm = _norm(meta.get("comm")) or _comm_from_payload(raw_payload)
    if not comm:
        return None
    executable = str(meta.get("executable") or _executable_from_payload(raw_payload) or "")
    if is_system_process_noise(comm=comm, executable=executable):
        return None

    detail = {
        "behavior_kind": KIND_PROCESS_COMM,
        "behavior_key": behavior_key,
        "comm": comm,
        **{k: v for k, v in meta.items() if k not in ("comm",)},
    }
    cmdline = payload_str(raw_payload.get("cmdline"))
    if cmdline:
        detail["cmdline"] = cmdline
    pid = payload_int(raw_payload.get("pid"))
    if pid:
        detail["pid"] = pid

    return SecurityAlert(
        timestamp=ts_iso(
            __import__("rules.chain", fromlist=["parse_ts"]).parse_ts(event.get("ts"))
        ),
        device_id=device_id,
        event_id=payload_str(event.get("event_id")) or None,
        event_type=TYPE_PROCESS_START,
        alert_type=ALERT_NOVEL_PROCESS,
        severity=SEVERITY_MEDIUM,
        message=f"Novel process for this device: {comm}",
        detail=DeviceChain.detail_json(detail),
    )
