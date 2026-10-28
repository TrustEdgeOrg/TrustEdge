"""Cursor tool baseline (ai_agent_action → device_behaviors)."""

from __future__ import annotations

from pipeline.baseline_store import BaselineStore
from pipeline.behavioral import BehavioralEngine
from rules.constants import ALERT_AI_NOVEL_CURSOR_TOOL
from rules.cursor_tool_profile import cursor_tool_keys_from_event
from rules.state import StateStore


def _cursor_tool_event(
    *,
    device_id: str = "dev_cursor",
    channel: str = "SHELL",
    tool: str = "Shell",
    server: str = "",
    event_id: str = "e1",
) -> dict:
    payload: dict = {
        "agent_type": "cursor",
        "channel": channel,
        "tool": tool,
        "operation": "execute",
        "correlation_id": "corr-1",
        "timestamp": "2026-08-28T12:00:00Z",
    }
    if server:
        payload["server"] = server
    return {
        "device_id": device_id,
        "event_id": event_id,
        "type": "ai_agent_action",
        "ts": "2026-08-28T12:00:00Z",
        "payload": payload,
    }


def test_cursor_tool_key_mcp():
    keys = cursor_tool_keys_from_event(
        _cursor_tool_event(channel="MCP", tool="list_issues", server="github")
    )
    assert keys == [
        (
            "cursor_tool",
            "MCP|github|list_issues",
            {
                "agent_type": "cursor",
                "channel": "MCP",
                "tool": "list_issues",
                "server": "github",
                "operation": "execute",
                "correlation_id": "corr-1",
            },
        )
    ]


def test_cursor_tool_key_shell():
    keys = cursor_tool_keys_from_event(_cursor_tool_event(channel="SHELL", tool="Shell"))
    assert keys[0][1] == "SHELL|Shell"


def test_cursor_tool_skips_prompt_and_non_cursor():
    assert cursor_tool_keys_from_event(_cursor_tool_event(tool="prompt")) == []
    event = _cursor_tool_event()
    event["payload"]["agent_type"] = "claude_code"
    assert cursor_tool_keys_from_event(event) == []


def test_novel_cursor_tool_when_profile_warm():
    baseline = BaselineStore(suppress_count=20, profile_min_keys=2)
    engine = BehavioralEngine(baseline)
    store = StateStore()
    baseline.observe("dev_cursor", "cursor_tool", "SHELL|Read", now=1_000_000.0)
    baseline.observe("dev_cursor", "cursor_tool", "FILE|Write", now=1_000_000.0)

    event = _cursor_tool_event(tool="Grep")
    beh, kept = engine.evaluate(event, [], store)
    assert kept == []
    assert len(beh) == 1
    assert beh[0].alert_type == ALERT_AI_NOVEL_CURSOR_TOOL
    assert "Grep" in beh[0].message


def test_no_novel_cursor_tool_when_cold():
    baseline = BaselineStore(suppress_count=20, profile_min_keys=30)
    engine = BehavioralEngine(baseline)
    store = StateStore()
    beh, _ = engine.evaluate(_cursor_tool_event(tool="Grep"), [], store)
    assert beh == []


def test_cursor_tool_debounce():
    baseline = BaselineStore(suppress_count=20, profile_min_keys=1)
    engine = BehavioralEngine(baseline)
    store = StateStore()
    baseline.observe("dev_cursor", "cursor_tool", "SHELL|Read", now=1_000_000.0)
    event = _cursor_tool_event(tool="Grep")
    first, _ = engine.evaluate(event, [], store)
    second, _ = engine.evaluate(event, [], store)
    assert len(first) == 1
    assert second == []
