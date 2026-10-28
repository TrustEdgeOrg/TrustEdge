"""Tests for MCP governance correlation (Phases 7–9)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from ai_activity.governance import (
    FINDING_SENSITIVE_THEN_UNGOVERNED_EGRESS,
    GovernanceConfig,
    GovernanceStore,
    correlate_ungoverned_egress,
    handle_ai_agent_action,
    is_external_destination,
)


def _mcp_event(ts: datetime, *, corr: str = "corr-1") -> dict:
    return {
        "event_id": "e1",
        "device_id": "dev-1",
        "type": "ai_agent_action",
        "ts": ts.isoformat(),
        "payload": {
            "agent_type": "claude_code",
            "channel": "MCP",
            "server": "customer-db",
            "tool": "query_customers",
            "decision": "allowed",
            "sensitivity": "sensitive",
            "classification": "sensitive_read",
            "governed": True,
            "correlation_id": corr,
            "timestamp": ts.isoformat(),
        },
    }


def test_sensitive_then_ungoverned_egress_alerts():
    store = GovernanceStore(cfg=GovernanceConfig(correlation_window_sec=120))
    t0 = datetime(2026, 8, 24, 20, 1, 0, tzinfo=timezone.utc)
    handle_ai_agent_action(_mcp_event(t0), store)

    t1 = t0 + timedelta(seconds=12)
    alert = correlate_ungoverned_egress(
        device_id="dev-1",
        agent_type="claude_code",
        destination="unknown-site.example",
        process_name="curl",
        evidence=["claude -> bash -> curl"],
        confidence="HIGH",
        timestamp=t1.isoformat(),
        event_id="e2",
        store=store,
        governed=False,
    )
    assert alert is not None
    assert alert.alert_type == FINDING_SENSITIVE_THEN_UNGOVERNED_EGRESS
    assert "Potential sensitive-data exfiltration path" in alert.message
    assert "not proof" in alert.message.lower()
    detail = json.loads(alert.detail)
    assert detail["not_claimed"] == "content_exfiltration"


def test_demo_a_no_alert_without_egress():
    store = GovernanceStore(cfg=GovernanceConfig())
    t0 = datetime(2026, 8, 24, 20, 1, 0, tzinfo=timezone.utc)
    assert handle_ai_agent_action(_mcp_event(t0), store) == []
    assert store.recent_sensitive("dev-1", "claude_code", t0)


def test_localhost_not_external():
    cfg = GovernanceConfig()
    assert not is_external_destination("127.0.0.1", cfg)
    assert not is_external_destination("localhost", cfg)
    assert is_external_destination("unknown-site.example", cfg)


def test_approved_destination_suppresses():
    store = GovernanceStore(
        cfg=GovernanceConfig(approved_destinations={"safe.example"})
    )
    t0 = datetime(2026, 8, 24, 20, 1, 0, tzinfo=timezone.utc)
    handle_ai_agent_action(_mcp_event(t0), store)
    alert = correlate_ungoverned_egress(
        device_id="dev-1",
        agent_type="claude_code",
        destination="safe.example",
        process_name="curl",
        evidence=["claude -> bash -> curl"],
        confidence="HIGH",
        timestamp=(t0 + timedelta(seconds=5)).isoformat(),
        event_id="e2",
        store=store,
    )
    assert alert is None


def test_dedupe_same_fingerprint():
    store = GovernanceStore(cfg=GovernanceConfig())
    t0 = datetime(2026, 8, 24, 20, 1, 0, tzinfo=timezone.utc)
    handle_ai_agent_action(_mcp_event(t0), store)
    kwargs = dict(
        device_id="dev-1",
        agent_type="claude_code",
        destination="evil.example",
        process_name="curl",
        evidence=["claude -> bash -> curl"],
        confidence="HIGH",
        timestamp=(t0 + timedelta(seconds=5)).isoformat(),
        event_id="e2",
        store=store,
    )
    assert correlate_ungoverned_egress(**kwargs) is not None
    assert correlate_ungoverned_egress(**kwargs) is None


def test_low_confidence_suppressed():
    store = GovernanceStore(
        cfg=GovernanceConfig(min_attribution_confidence="HIGH")
    )
    t0 = datetime(2026, 8, 24, 20, 1, 0, tzinfo=timezone.utc)
    handle_ai_agent_action(_mcp_event(t0), store)
    alert = correlate_ungoverned_egress(
        device_id="dev-1",
        agent_type="claude_code",
        destination="evil.example",
        process_name="curl",
        evidence=["weak"],
        confidence="LOW",
        timestamp=(t0 + timedelta(seconds=5)).isoformat(),
        event_id="e2",
        store=store,
    )
    assert alert is None
