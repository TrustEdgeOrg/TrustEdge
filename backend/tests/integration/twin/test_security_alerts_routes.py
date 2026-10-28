from datetime import datetime, timedelta, timezone

# Listing only returns the last 90 days, so anchor fixtures to yesterday.
_BASE_DAY = (datetime.now(timezone.utc) - timedelta(days=1)).replace(
    hour=0, minute=0, second=0, microsecond=0
)


def _at(hour: int, minute: int, second: int) -> datetime:
    return _BASE_DAY.replace(hour=hour, minute=minute, second=second)


def test_ingest_and_list_security_alerts(api_client, db_session, ingest_env):
    ts = _at(12, 0, 0).isoformat()
    ingest = api_client.post(
        "/security/alerts/ingest",
        json=[
            {
                "timestamp": ts,
                "device_id": "dev_alert_test",
                "event_id": "evt_1",
                "event_type": "network_summary",
                "alert_type": "new_public_ip",
                "severity": "high",
                "message": "Public IP changed from 1.1.1.1 to 2.2.2.2",
            }
        ],
    )
    assert ingest.status_code == 200
    assert ingest.json()["created"] == 1

    listed = api_client.get("/security/alerts?device_id=dev_alert_test")
    assert listed.status_code == 200
    body = listed.json()
    assert body["total"] >= 1
    assert body["items"][0]["alert_type"] == "new_public_ip"
    assert body["items"][0]["device_id"] == "dev_alert_test"


def test_ingest_keeps_all_severities(api_client, db_session, ingest_env):
    ts = _at(12, 2, 0).isoformat()
    ingest = api_client.post(
        "/security/alerts/ingest",
        json=[
            {
                "timestamp": ts,
                "device_id": "dev_all_sev",
                "event_id": "evt_low",
                "alert_type": "idle_with_network_activity",
                "severity": "low",
                "message": "Idle host with network activity",
            },
            {
                "timestamp": ts,
                "device_id": "dev_all_sev",
                "event_id": "evt_med",
                "alert_type": "novel_process",
                "severity": "medium",
                "message": "Novel process",
            },
            {
                "timestamp": ts,
                "device_id": "dev_all_sev",
                "event_id": "evt_high",
                "alert_type": "temp_path_execution",
                "severity": "high",
                "message": "Temp path execution",
            },
        ],
    )
    assert ingest.status_code == 200
    assert ingest.json()["created"] == 3
    listed = api_client.get("/security/alerts?device_id=dev_all_sev")
    assert listed.json()["total"] == 3


def test_ingest_is_idempotent_by_fingerprint(api_client, db_session, ingest_env):
    ts = _at(12, 5, 0).isoformat()
    payload = [
        {
            "timestamp": ts,
            "device_id": "dev_dupe",
            "event_id": "evt_dupe",
            "alert_type": "shell_spawns_downloader",
            "severity": "high",
            "message": "Shell spawned network downloader (curl)",
        }
    ]

    first = api_client.post("/security/alerts/ingest", json=payload)
    assert first.status_code == 200
    assert first.json()["created"] == 1

    # Same source event re-evaluated / replayed → no new row.
    second = api_client.post("/security/alerts/ingest", json=payload)
    assert second.status_code == 200
    assert second.json()["created"] == 0

    listed = api_client.get("/security/alerts?device_id=dev_dupe")
    assert listed.json()["total"] == 1


def test_ingest_dedupes_within_single_batch(api_client, db_session, ingest_env):
    ts = _at(12, 6, 0).isoformat()
    item = {
        "timestamp": ts,
        "device_id": "dev_batch_dupe",
        "event_id": "evt_batch",
        "alert_type": "temp_path_execution",
        "severity": "high",
        "message": "Process started from /tmp/x",
    }
    resp = api_client.post("/security/alerts/ingest", json=[item, item])
    assert resp.status_code == 200
    assert resp.json()["created"] == 1


def test_ingest_cooldowns_windowed_alert_within_window(api_client, db_session, ingest_env):
    """Windowed rules share one fingerprint per cooldown bucket, not per event_id."""
    base = _at(12, 10, 0)
    first = api_client.post(
        "/security/alerts/ingest",
        json=[
            {
                "timestamp": base.isoformat(),
                "device_id": "dev_burst",
                "event_id": "evt_burst_1",
                "event_type": "network_summary",
                "alert_type": "network_flap_5m",
                "severity": "high",
                "message": "Network flap",
            }
        ],
    )
    assert first.status_code == 200
    assert first.json()["created"] == 1

    # Different event_id, still within the same 5-minute cooldown bucket.
    second = api_client.post(
        "/security/alerts/ingest",
        json=[
            {
                "timestamp": (base.replace(second=30)).isoformat(),
                "device_id": "dev_burst",
                "event_id": "evt_burst_2",
                "event_type": "network_summary",
                "alert_type": "network_flap_5m",
                "severity": "high",
                "message": "Network flap again",
            }
        ],
    )
    assert second.status_code == 200
    assert second.json()["created"] == 0

    listed = api_client.get("/security/alerts?device_id=dev_burst&alert_type=network_flap_5m")
    assert listed.json()["total"] == 1


def test_ingest_accepts_legacy_trusttwin_device_id(api_client, db_session, ingest_env):
    ts = _at(12, 30, 0).isoformat()
    ingest = api_client.post(
        "/security/alerts/ingest",
        json=[
            {
                "timestamp": ts,
                "trusttwin_device_id": "dev_legacy_alias",
                "alert_type": "temp_path_execution",
                "severity": "high",
                "message": "legacy field alias",
            }
        ],
    )
    assert ingest.status_code == 200
    assert ingest.json()["created"] == 1

    listed = api_client.get("/security/alerts?device_id=dev_legacy_alias")
    assert listed.status_code == 200
    assert listed.json()["items"][0]["device_id"] == "dev_legacy_alias"


def test_list_security_alerts_filter_type(api_client, db_session, ingest_env):
    ts = _at(13, 0, 0).isoformat()
    api_client.post(
        "/security/alerts/ingest",
        json=[
            {
                "timestamp": ts,
                "device_id": "dev_filter",
                "alert_type": "new_public_ip",
                "severity": "high",
                "message": "IP changed",
            }
        ],
    )
    response = api_client.get("/security/alerts?alert_type=new_public_ip&device_id=dev_filter")
    assert response.status_code == 200
    items = response.json()["items"]
    assert all(item["alert_type"] == "new_public_ip" for item in items)


def test_list_security_alerts_filter_severity(api_client, db_session, ingest_env):
    ts_high = _at(14, 0, 0).isoformat()
    ts_low = _at(14, 1, 0).isoformat()
    api_client.post(
        "/security/alerts/ingest",
        json=[
            {
                "timestamp": ts_high,
                "device_id": "dev_sev",
                "alert_type": "temp_path_execution",
                "severity": "high",
                "message": "Process started from /tmp/sim_attack",
            },
            {
                "timestamp": ts_low,
                "device_id": "dev_sev",
                "alert_type": "idle_with_network_activity",
                "severity": "low",
                "message": "Idle host with network activity",
            },
        ],
    )
    response = api_client.get("/security/alerts?device_id=dev_sev&severity=high")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert all(item["severity"] == "high" for item in body["items"])
    assert all(item["alert_type"] == "temp_path_execution" for item in body["items"])


def test_ingest_persists_when_detection_engine_configured(
    api_client, db_session, ingest_env, monkeypatch
):
    """Write-through: Postgres stores high alerts even when detection-engine is live."""
    monkeypatch.setattr(
        "app.shared.config.settings.DETECTION_ENGINE_URL",
        "http://detection-engine:9090",
    )
    ts = _at(15, 0, 0).isoformat()
    ingest = api_client.post(
        "/security/alerts/ingest",
        json=[
            {
                "timestamp": ts,
                "device_id": "dev_engine_mode",
                "alert_type": "temp_path_execution",
                "severity": "high",
                "message": "should persist to postgres",
            }
        ],
    )
    assert ingest.status_code == 200
    assert ingest.json()["created"] == 1

    listed = api_client.get("/security/alerts?device_id=dev_engine_mode")
    assert listed.status_code == 200
    body = listed.json()
    assert body["total"] == 1
    assert body["items"][0]["message"] == "should persist to postgres"


def test_list_reads_postgres_even_with_detection_engine_url(
    api_client, db_session, ingest_env, monkeypatch
):
    monkeypatch.setattr(
        "app.shared.config.settings.DETECTION_ENGINE_URL",
        "http://detection-engine:9090",
    )
    ts = _at(16, 0, 0).isoformat()
    api_client.post(
        "/security/alerts/ingest",
        json=[
            {
                "timestamp": ts,
                "device_id": "dev_db_source",
                "alert_type": "shell_spawns_downloader",
                "severity": "high",
                "message": "from postgres",
            }
        ],
    )
    response = api_client.get("/security/alerts?device_id=dev_db_source")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["message"] == "from postgres"


def test_baseline_proxies_detection_engine(api_client, monkeypatch):
    from app.features.twin.schemas.device_baseline import DeviceBaselineResponse, DeviceBaselineItem

    def fake_baseline(*, device_id: str, limit: int = 100):
        return DeviceBaselineResponse(
            device_id=device_id,
            profile_warm=True,
            total=1,
            items=[
                DeviceBaselineItem(
                    behavior_kind="process_comm",
                    behavior_key="chrome",
                    count=12,
                    first_seen_at="2026-08-03T10:00:00Z",
                    last_seen_at="2026-08-03T12:00:00Z",
                    established=False,
                )
            ],
            suppress_count=20,
            suppress_age_hours=0,
            profile_min_keys=5,
        )

    monkeypatch.setattr(
        "app.features.twin.routes.twin_route.fetch_device_baseline",
        fake_baseline,
    )
    monkeypatch.setattr(
        "app.shared.config.settings.DETECTION_ENGINE_URL",
        "http://detection-engine:9090",
    )
    response = api_client.get("/security/agents/dev_proxy/baseline")
    assert response.status_code == 200
    body = response.json()
    assert body["device_id"] == "dev_proxy"
    assert body["profile_warm"] is True
    assert body["items"][0]["behavior_key"] == "chrome"


def test_baseline_requires_detection_engine_url(api_client, monkeypatch):
    monkeypatch.setattr("app.shared.config.settings.DETECTION_ENGINE_URL", "")
    response = api_client.get("/security/agents/dev_x/baseline")
    assert response.status_code == 503


def test_baseline_clear_proxies_detection_engine(api_client, monkeypatch):
    from app.features.twin.schemas.device_baseline import DeviceBaselineClearResponse

    def fake_clear(*, device_id: str):
        return DeviceBaselineClearResponse(device_id=device_id, cleared=7)

    monkeypatch.setattr(
        "app.features.twin.routes.twin_route.clear_device_baseline",
        fake_clear,
    )
    monkeypatch.setattr(
        "app.shared.config.settings.DETECTION_ENGINE_URL",
        "http://detection-engine:9090",
    )
    response = api_client.delete("/security/agents/dev_flush/baseline")
    assert response.status_code == 200
    body = response.json()
    assert body["device_id"] == "dev_flush"
    assert body["cleared"] == 7


def test_baseline_clear_requires_detection_engine_url(api_client, monkeypatch):
    monkeypatch.setattr("app.shared.config.settings.DETECTION_ENGINE_URL", "")
    response = api_client.delete("/security/agents/dev_x/baseline")
    assert response.status_code == 503
