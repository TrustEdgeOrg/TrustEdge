from datetime import datetime, timezone


def test_ingest_flows_and_map(api_client, dns_ingest_env, monkeypatch):
    monkeypatch.setattr("app.shared.config.settings.NETWORK_FLOWS_ENABLED", True)

    now = datetime.now(timezone.utc).isoformat()

    resolutions = api_client.post(
        "/network-flows/dns-resolutions/bulk",
        json={
            "resolutions": [
                {
                    "timestamp": now,
                    "client_ip": "10.8.0.5",
                    "domain": "github.com",
                    "resolved_ip": "140.82.114.4",
                }
            ]
        },
    )
    assert resolutions.status_code == 200

    flows = api_client.post(
        "/network-flows/bulk",
        json={
            "flows": [
                {
                    "observed_at": now,
                    "client_ip": "10.8.0.5",
                    "protocol": "tcp",
                    "dest_ip": "140.82.114.4",
                    "dest_port": 443,
                    "state": "ESTABLISHED",
                }
            ]
        },
    )
    assert flows.status_code == 200
    assert flows.json()["flows_received"] == 1

    live = api_client.get("/network-flows/live")
    assert live.status_code == 200
    assert len(live.json()["items"]) >= 1

    map_resp = api_client.get("/network-attribution/map", params={"include_flows": True})
    assert map_resp.status_code == 200
    body = map_resp.json()
    assert any(n["type"] == "flow" for n in body["nodes"])
