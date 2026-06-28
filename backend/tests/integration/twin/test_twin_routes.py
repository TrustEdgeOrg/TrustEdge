from datetime import datetime, timedelta, timezone

from app.features.dns_queries.models.domain_first_seen import DomainFirstSeen


def test_simulate_pack_toggle_enable_social(api_client, seed_policy, vpn_device):
    response = api_client.post(
        "/twin/simulate/pack-toggle",
        json={"pack_slug": "social", "enabled_globally": True},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["pack"]["slug"] == "social"
    assert body["current_state"]["enabled_globally"] is False
    assert body["proposed_state"]["enabled_globally"] is True
    assert body["lookback_hours"] == 24
    assert body["summary"]["newly_blocked_domain_count"] > 0


def test_simulate_pack_toggle_with_recent_activity(api_client, seed_policy, vpn_device, db_session):
    lease = vpn_device.ip_lease
    now = datetime.now(timezone.utc)
    db_session.add(
        DomainFirstSeen(
            client_ip=lease.ip,
            root_domain="facebook.com",
            first_seen_at=now - timedelta(hours=2),
            last_seen_at=now - timedelta(hours=1),
        )
    )
    db_session.commit()

    response = api_client.post(
        "/twin/simulate/pack-toggle",
        json={"pack_slug": "social", "enabled_globally": True},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["recent_hits_count"] >= 1
    assert any(
        hit["root_domain"] == "facebook.com" for hit in body["summary"]["recent_hits_sample"]
    )


def test_simulate_pack_toggle_invalid_slug(api_client, seed_policy):
    response = api_client.post(
        "/twin/simulate/pack-toggle",
        json={"pack_slug": "not-a-pack", "enabled_globally": True},
    )
    assert response.status_code == 404


def test_simulate_pack_toggle_noop_when_already_enabled(api_client, seed_policy, vpn_device):
    enable = api_client.put("/policy/packs/malware", json={"enabled_globally": True})
    assert enable.status_code == 200

    response = api_client.post(
        "/twin/simulate/pack-toggle",
        json={"pack_slug": "malware", "enabled_globally": True},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["newly_blocked_domain_count"] == 0
    assert body["summary"]["devices_affected"] == 0
