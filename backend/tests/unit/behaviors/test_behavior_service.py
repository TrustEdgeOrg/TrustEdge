from datetime import datetime, timedelta, timezone

from app.features.behaviors.schemas.behavior import BehaviorObserveRequest
from app.features.behaviors.services.behavior_service import BehaviorService


def test_observe_increments_and_lists(db_session, monkeypatch):
    monkeypatch.setenv("BEHAVIOR_SUPPRESS_COUNT", "3")
    monkeypatch.setenv("BEHAVIOR_SUPPRESS_AGE_HOURS", "1")
    monkeypatch.setenv("BEHAVIOR_PROFILE_MIN_KEYS", "30")
    service = BehaviorService(db_session)

    first = service.observe(
        BehaviorObserveRequest(
            device_id="dev_1",
            behavior_kind="process_chain",
            behavior_key="zsh>curl",
            alert_type="shell_spawns_downloader",
        )
    )
    assert first.count == 1
    assert first.action == "emit"
    assert first.suppress is False
    assert first.established is False
    assert first.profile_warm is False

    second = service.observe(
        BehaviorObserveRequest(
            device_id="dev_1",
            behavior_kind="process_chain",
            behavior_key="zsh>curl",
            alert_type="shell_spawns_downloader",
        )
    )
    assert second.count == 2
    assert second.action == "emit"

    listed = service.list_for_device("dev_1")
    assert listed.total == 1
    assert listed.items[0].behavior_key == "zsh>curl"
    assert listed.items[0].count == 2


def test_clear_device_removes_rows(db_session, monkeypatch):
    monkeypatch.setenv("BEHAVIOR_SUPPRESS_COUNT", "20")
    service = BehaviorService(db_session)
    service.observe(
        BehaviorObserveRequest(
            device_id="dev_wipe",
            behavior_kind="process_comm",
            behavior_key="chrome",
        )
    )
    assert service.clear_device("dev_wipe") == 1
    assert service.list_for_device("dev_wipe").total == 0


def test_observe_suppresses_when_count_and_age_met(db_session, monkeypatch):
    monkeypatch.setenv("BEHAVIOR_SUPPRESS_COUNT", "2")
    monkeypatch.setenv("BEHAVIOR_SUPPRESS_AGE_HOURS", "1")
    service = BehaviorService(db_session)

    first = service.observe(
        BehaviorObserveRequest(
            device_id="dev_old",
            behavior_kind="process_chain",
            behavior_key="bash>wget",
            alert_type="shell_spawns_downloader",
        )
    )
    assert first.action == "emit"
    assert first.established is False

    # Age the first_seen timestamp past the suppress window.
    row = service.repo.get(
        device_id="dev_old",
        behavior_kind="process_chain",
        behavior_key="bash>wget",
    )
    assert row is not None
    row.first_seen_at = datetime.now(timezone.utc) - timedelta(hours=2)
    db_session.commit()

    second = service.observe(
        BehaviorObserveRequest(
            device_id="dev_old",
            behavior_kind="process_chain",
            behavior_key="bash>wget",
            alert_type="shell_spawns_downloader",
        )
    )
    assert second.count == 2
    assert second.suppress is True
    assert second.established is True
    assert second.action == "suppress"


def test_profile_cold_until_min_keys(db_session, monkeypatch):
    monkeypatch.setenv("BEHAVIOR_SUPPRESS_COUNT", "20")
    monkeypatch.setenv("BEHAVIOR_SUPPRESS_AGE_HOURS", "72")
    monkeypatch.setenv("BEHAVIOR_PROFILE_MIN_KEYS", "3")
    service = BehaviorService(db_session)

    first = service.observe(
        BehaviorObserveRequest(
            device_id="dev_cold",
            behavior_kind="process_comm",
            behavior_key="chrome",
        )
    )
    assert first.profile_warm is False
    assert first.established is False
    assert first.last_seen_at is not None

    service.observe(
        BehaviorObserveRequest(
            device_id="dev_cold",
            behavior_kind="process_comm",
            behavior_key="zsh",
        )
    )
    third = service.observe(
        BehaviorObserveRequest(
            device_id="dev_cold",
            behavior_kind="process_comm",
            behavior_key="curl",
        )
    )
    assert third.profile_warm is True
    assert third.established is False


def test_profile_warm_by_age(db_session, monkeypatch):
    monkeypatch.setenv("BEHAVIOR_SUPPRESS_COUNT", "20")
    monkeypatch.setenv("BEHAVIOR_SUPPRESS_AGE_HOURS", "1")
    monkeypatch.setenv("BEHAVIOR_PROFILE_MIN_KEYS", "100")
    service = BehaviorService(db_session)

    first = service.observe(
        BehaviorObserveRequest(
            device_id="dev_aged",
            behavior_kind="process_comm",
            behavior_key="chrome",
        )
    )
    assert first.profile_warm is False

    row = service.repo.get(
        device_id="dev_aged",
        behavior_kind="process_comm",
        behavior_key="chrome",
    )
    assert row is not None
    row.first_seen_at = datetime.now(timezone.utc) - timedelta(hours=2)
    db_session.commit()

    novel = service.observe(
        BehaviorObserveRequest(
            device_id="dev_aged",
            behavior_kind="process_comm",
            behavior_key="evil",
        )
    )
    assert novel.profile_warm is True
    assert novel.established is False
    assert novel.action == "emit"


def test_profile_observe_without_alert_type_skips_last_alert_at(db_session, monkeypatch):
    monkeypatch.setenv("BEHAVIOR_SUPPRESS_COUNT", "20")
    monkeypatch.setenv("BEHAVIOR_SUPPRESS_AGE_HOURS", "72")
    service = BehaviorService(db_session)

    result = service.observe(
        BehaviorObserveRequest(
            device_id="dev_learn",
            behavior_kind="process_comm",
            behavior_key="node",
        )
    )
    assert result.action == "emit"
    row = service.repo.get(
        device_id="dev_learn",
        behavior_kind="process_comm",
        behavior_key="node",
    )
    assert row is not None
    assert row.last_alert_at is None
