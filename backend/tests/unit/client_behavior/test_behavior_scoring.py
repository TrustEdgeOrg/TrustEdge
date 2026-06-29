"""Unit tests for behavior scoring auto-block domain selection."""

from datetime import datetime, timezone
from types import SimpleNamespace

from app.features.client_behavior.services.behavior_scoring_service import BehaviorScoringService


def test_should_recompute_baseline_accepts_naive_updated_at():
    service = BehaviorScoringService(db=None)  # type: ignore[arg-type]
    profile = SimpleNamespace(
        baseline_json=None,
        updated_at=datetime(2026, 1, 1, 0, 0, 0),
    )
    assert service._should_recompute_baseline(profile) is True


def test_should_recompute_baseline_accepts_aware_updated_at():
    service = BehaviorScoringService(db=None)  # type: ignore[arg-type]
    profile = SimpleNamespace(
        baseline_json=None,
        updated_at=datetime.now(timezone.utc),
    )
    assert service._should_recompute_baseline(profile) is False


def test_domains_for_auto_block_prioritizes_suspicious():
    service = BehaviorScoringService(db=None)  # type: ignore[arg-type]
    entries = [
        ("10.0.0.2", "safe.example.com", "example.com"),
        ("10.0.0.2", "malware.evil.ru", "evil.ru"),
        ("10.0.0.2", "cdn.other.net", "other.net"),
    ]
    domains = service._domains_for_auto_block(entries)
    assert domains[0] == "malware.evil.ru"
    assert "safe.example.com" in domains or "cdn.other.net" in domains


def test_domains_for_auto_block_skips_whitelisted_roots():
    service = BehaviorScoringService(db=None)  # type: ignore[arg-type]
    entries = [
        ("10.0.0.2", "clients1.google.com", "google.com"),
        ("10.0.0.2", "tracker.bad.xyz", "bad.xyz"),
    ]
    domains = service._domains_for_auto_block(entries)
    assert all("google.com" not in d for d in domains)
    assert "tracker.bad.xyz" in domains
