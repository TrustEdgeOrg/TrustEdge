from __future__ import annotations

from typing import Optional

from rules.constants import ALERT_NOVEL_PROCESS, TYPE_PROCESS_START
from rules.process_profile import (
    KIND_PROCESS_COMM,
    novel_process_alert,
    profile_keys_from_event,
)
from rules.state import StateStore


def _process_start(
    *,
    device_id: str = "dev_1",
    event_id: str = "evt_1",
    pid: int = 200,
    ppid: int = 100,
    comm: str = "curl",
    executable: str = "/usr/bin/curl",
    parent_comm: Optional[str] = None,
    ts: str = "2026-07-30T12:00:00Z",
) -> dict:
    payload = {
        "pid": pid,
        "ppid": ppid,
        "comm": comm,
        "executable": executable,
    }
    if parent_comm is not None:
        payload["parent_comm"] = parent_comm
    return {
        "device_id": device_id,
        "event_id": event_id,
        "type": TYPE_PROCESS_START,
        "ts": ts,
        "payload": payload,
    }


def test_profile_keys_comm_only_no_chain():
    store = StateStore()
    event = _process_start(parent_comm="zsh")
    store.record_event(event)

    keys = profile_keys_from_event(event, store)
    assert len(keys) == 1
    kind, key, meta = keys[0]
    assert kind == KIND_PROCESS_COMM
    assert key == "curl"
    assert meta["comm"] == "curl"
    assert not any(k == "process_chain" for k, _key, _meta in keys)


def test_profile_keys_ignore_parent_resolution():
    store = StateStore()
    parent = _process_start(
        event_id="evt_parent",
        pid=100,
        ppid=1,
        comm="bash",
        executable="/bin/bash",
        ts="2026-07-30T11:59:00Z",
    )
    child = _process_start(
        event_id="evt_child",
        pid=200,
        ppid=100,
        comm="wget",
        executable="/usr/bin/wget",
        ts="2026-07-30T12:00:00Z",
    )
    store.record_event(parent)
    store.record_event(child)

    keys = {k: key for k, key, _meta in profile_keys_from_event(child, store)}
    assert keys == {KIND_PROCESS_COMM: "wget"}


def test_profile_keys_skip_non_process_events():
    store = StateStore()
    event = {
        "device_id": "dev_1",
        "type": "network_summary",
        "ts": "2026-07-30T12:00:00Z",
        "payload": {"public_ip": "1.2.3.4"},
    }
    assert profile_keys_from_event(event, store) == []


def test_novel_process_alert_shape():
    event = _process_start(comm="evil", executable="/tmp/evil", parent_comm="bash")
    alert = novel_process_alert(
        event,
        behavior_key="evil",
        meta={"comm": "evil", "executable": "/tmp/evil"},
    )
    assert alert is not None
    assert alert.alert_type == ALERT_NOVEL_PROCESS
    assert alert.severity == "medium"
    assert "evil" in alert.message
    assert alert.event_type == TYPE_PROCESS_START
    assert '"behavior_key":"evil"' in (alert.detail or "")


def test_novel_process_skips_apple_system_paths():
    event = _process_start(
        comm="voicebankingd",
        executable="/System/Library/PrivateFrameworks/VoiceBanking.framework/Versions/A/XPCServices/voicebankingd.xpc/Contents/MacOS/voicebankingd",
    )
    alert = novel_process_alert(
        event,
        behavior_key="voicebankingd",
        meta={
            "comm": "voicebankingd",
            "executable": "/system/library/privateframeworks/voicebanking.framework/versions/a/xpcservices/voicebankingd.xpc/contents/macos/voicebankingd",
        },
    )
    assert alert is None


def test_profile_keys_keep_full_executable_path():
    store = StateStore()
    event = _process_start(executable="/usr/bin/curl")
    kind, key, meta = profile_keys_from_event(event, store)[0]
    assert kind == KIND_PROCESS_COMM
    assert key == "curl"
    assert meta["executable"] == "/usr/bin/curl"
