from datetime import datetime, timedelta, timezone

from app.features.policy.models.device_quarantine import DeviceQuarantine
from app.features.policy.services.policy_dns_service import PolicyDnsService
from tests.helpers.factories import create_behavior_block, create_vpn_device, seed_policy_catalog


def test_build_dns_sync_includes_device(db_session):
    seed_policy_catalog(db_session)
    device, _ = create_vpn_device(db_session, mac_address="11:22:33:44:55:66")
    svc = PolicyDnsService(db_session)
    result = svc.build_dns_sync()

    assert isinstance(result.global_domains, list)
    entry = next(e for e in result.entries if e.device_id == device.id)
    assert entry.mac_address == "11:22:33:44:55:66"
    assert entry.client_ip == "10.0.0.10"
    assert entry.allowlist_only is False


def test_build_dns_sync_includes_behavior_blocks(db_session):
    seed_policy_catalog(db_session)
    device, _ = create_vpn_device(db_session, mac_address="aa:bb:cc:dd:ee:01")
    create_behavior_block(db_session, device, domain="blocked.behavior.test")

    svc = PolicyDnsService(db_session)
    result = svc.build_dns_sync()
    entry = next(e for e in result.entries if e.device_id == device.id)
    assert "blocked.behavior.test" in entry.block_domains


def test_admin_quarantine_blocks_all_dns(db_session):
    seed_policy_catalog(db_session)
    device, _ = create_vpn_device(db_session, mac_address="aa:bb:cc:dd:ee:02")
    now = datetime.now(timezone.utc)
    db_session.add(
        DeviceQuarantine(
            device_id=device.id,
            score=None,
            started_at=now,
            expires_at=now + timedelta(hours=4),
        )
    )
    db_session.commit()

    result = PolicyDnsService(db_session).build_dns_sync()
    entry = next(e for e in result.entries if e.device_id == device.id)
    assert entry.allowlist_only is True
    assert entry.allowlist_domains == []


def test_behavior_quarantine_keeps_allowlist(db_session):
    seed_policy_catalog(db_session)
    device, _ = create_vpn_device(db_session, mac_address="aa:bb:cc:dd:ee:03")
    now = datetime.now(timezone.utc)
    db_session.add(
        DeviceQuarantine(
            device_id=device.id,
            score=90,
            started_at=now,
            expires_at=now + timedelta(hours=4),
        )
    )
    db_session.commit()

    result = PolicyDnsService(db_session).build_dns_sync()
    entry = next(e for e in result.entries if e.device_id == device.id)
    assert entry.allowlist_only is True
    assert len(entry.allowlist_domains) > 0


def test_build_dns_sync_respects_global_pack_overrides(db_session):
    seed_policy_catalog(db_session)
    create_vpn_device(db_session, mac_address="11:22:33:44:55:77")
    svc = PolicyDnsService(db_session)

    baseline = svc.build_dns_sync()
    proposed = svc.build_dns_sync(global_pack_overrides={"social": True})

    assert "facebook.com" not in baseline.global_domains
    assert "facebook.com" in proposed.global_domains
