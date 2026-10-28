"""Tests for Cursor tool profile key extraction and alerts."""

from __future__ import annotations

from rules.constants import ALERT_AI_NOVEL_CURSOR_TOOL
from rules.cursor_tool_profile import (
    cursor_tool_keys_from_event,
    is_cursor_agent,
    novel_cursor_tool_alert,
)


def test_is_cursor_agent():
    assert is_cursor_agent("cursor")
    assert is_cursor_agent("Cursor")
    assert not is_cursor_agent("claude_code")


def test_novel_cursor_tool_alert_shape():
    event = {
        "device_id": "dev-1",
        "event_id": "e1",
        "type": "ai_agent_action",
        "ts": "2026-08-28T12:00:00Z",
        "payload": {
            "agent_type": "cursor",
            "channel": "MCP",
            "server": "github",
            "tool": "push_files",
        },
    }
    keys = cursor_tool_keys_from_event(event)
    assert len(keys) == 1
    kind, key, meta = keys[0]
    alert = novel_cursor_tool_alert(event, behavior_key=key, meta=meta)
    assert alert is not None
    assert alert.alert_type == ALERT_AI_NOVEL_CURSOR_TOOL
    assert "github/push_files" in alert.message
