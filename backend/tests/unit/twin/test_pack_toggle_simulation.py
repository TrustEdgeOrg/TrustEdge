from datetime import datetime, timedelta, timezone

from app.features.policy.services.policy_dns_service import PolicyDnsService
from app.features.twin.domain_match import root_matches_block_set
from app.features.twin.services.pack_toggle_simulation_service import PackToggleSimulationService
from tests.helpers.factories import create_vpn_device, seed_policy_catalog


def test_build_dns_sync_respects_global_pack_overrides(db_session):
    seed_policy_catalog(db_session)
    create_vpn_device(db_session, mac_address="11:22:33:44:55:66")
    svc = PolicyDnsService(db_session)

    baseline = svc.build_dns_sync()
    proposed = svc.build_dns_sync(global_pack_overrides={"social": True})

    assert "facebook.com" not in baseline.global_domains
    assert "facebook.com" in proposed.global_domains


def test_root_matches_block_set():
    blocks = {"facebook.com", "instagram.com"}
    assert root_matches_block_set("facebook.com", blocks)
    assert root_matches_block_set("www.facebook.com", blocks)
    assert not root_matches_block_set("google.com", blocks)


def test_simulate_enabling_social_pack(db_session):
    seed_policy_catalog(db_session)
    device, lease = create_vpn_device(db_session, mac_address="11:22:33:44:55:66")
    now = datetime.now(timezone.utc)
    from app.features.dns_queries.models.domain_first_seen import DomainFirstSeen

    db_session.add(
        DomainFirstSeen(
            client_ip=lease.ip,
            root_domain="facebook.com",
            first_seen_at=now - timedelta(hours=1),
            last_seen_at=now - timedelta(hours=1),
        )
    )
    db_session.commit()

    result = PackToggleSimulationService(db_session).simulate("social", True)

    assert result.pack.slug == "social"
    assert result.current_state.enabled_globally is False
    assert result.proposed_state.enabled_globally is True
    assert result.summary.devices_affected >= 1
    assert result.summary.newly_blocked_domain_count > 0
    assert result.summary.recent_hits_count >= 1
    assert any(hit.root_domain == "facebook.com" for hit in result.summary.recent_hits_sample)


def test_simulate_unknown_pack_raises(db_session):
    seed_policy_catalog(db_session)
    try:
        PackToggleSimulationService(db_session).simulate("missing", True)
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "unknown pack" in str(exc)
