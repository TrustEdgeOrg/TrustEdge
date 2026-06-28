from datetime import datetime, timezone

from app.features.dns_queries.repositories.domain_first_seen_repository import DomainFirstSeenRepository
from app.features.dns_queries.services.dns_anomaly_service import DnsAnomalyService
from app.features.dns_queries.schemas.dns_query import DnsQueryCreate


def test_touch_updates_last_seen_at(db_session):
    repo = DomainFirstSeenRepository(db_session)
    t0 = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    t1 = datetime(2026, 6, 1, 13, 0, tzinfo=timezone.utc)

    assert repo.touch("10.0.0.10", "example.com", t0)
    db_session.commit()

    row = repo.get("10.0.0.10", "example.com")
    assert row is not None
    assert row.first_seen_at.replace(tzinfo=timezone.utc) == t0
    assert row.last_seen_at.replace(tzinfo=timezone.utc) == t0

    assert repo.touch("10.0.0.10", "example.com", t1)
    db_session.commit()
    db_session.refresh(row)
    assert row.last_seen_at.replace(tzinfo=timezone.utc) == t1


def test_anomaly_service_touches_without_alerts(db_session, monkeypatch):
    monkeypatch.setattr("app.shared.config.settings.NEW_DOMAIN_ALERTS", False)
    svc = DnsAnomalyService(db_session)
    query = DnsQueryCreate(
        timestamp=datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc),
        client_ip="10.0.0.99",
        domain="allowed.example.com",
        blocked=False,
    )
    created = svc.process_queries([query])
    assert created == 0

    row = DomainFirstSeenRepository(db_session).get("10.0.0.99", "example.com")
    assert row is not None
    assert row.last_seen_at is not None
