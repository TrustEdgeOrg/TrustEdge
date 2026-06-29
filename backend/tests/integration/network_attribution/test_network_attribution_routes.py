from datetime import datetime, timezone

from tests.helpers.integration import dns_query_payload


def _attribution_payload(device_id: str) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "device_id": device_id,
        "intervals": [
            {
                "started_at": now.isoformat(),
                "duration_sec": 30,
                "bundle_id": "us.zoom.xos",
                "app_name": "zoom.us",
            }
        ],
    }


def test_network_attribution_ingest_and_summary(
    api_client,
    enroll_env,
    seed_policy,
    mock_apply_peer_on_host,
    mock_record_vpn_enroll,
    enroll_device,
):
    enroll = enroll_device(device_id="attr-client", public_key="attrKey=")
    assert enroll.status_code == 200
    body = enroll.json()
    token = body["device_token"]
    client_ip = body["address"].split("/")[0]

    response = api_client.post(
        "/v1/network-attribution",
        json=_attribution_payload("attr-client"),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert response.json()["intervals_received"] == 1

    devices = api_client.get("/devices").json()
    device_id = next(d["id"] for d in devices if d.get("client_ip") == client_ip)

    summary = api_client.get(f"/devices/{device_id}/network-attribution/summary", params={"hours": 24})
    assert summary.status_code == 200
    items = summary.json()["items"]
    assert any(i["app_slug"] == "zoom" for i in items)


def test_dns_query_gets_attributed_app(
    api_client,
    enroll_env,
    seed_policy,
    mock_apply_peer_on_host,
    mock_record_vpn_enroll,
    enroll_device,
    dns_ingest_env,
):
    enroll = enroll_device(device_id="attr-dns", public_key="attrDnsKey=")
    token = enroll.json()["device_token"]
    client_ip = enroll.json()["address"].split("/")[0]

    api_client.post(
        "/v1/network-attribution",
        json=_attribution_payload("attr-dns"),
        headers={"Authorization": f"Bearer {token}"},
    )

    post = api_client.post("/dns-queries", json=dns_query_payload(client_ip=client_ip, domain="zoom.us"))
    assert post.status_code == 200
    created = post.json()
    assert created["attributed_app_slug"] == "zoom"
    assert created["attributed_app_display_name"] == "Zoom"

    listed = api_client.get("/dns-queries", params={"blocked_only": True, "page_size": 5}).json()
    match = next((i for i in listed["items"] if i["domain"] == "zoom.us"), None)
    assert match is not None
    assert match["attributed_app_slug"] == "zoom"


def test_network_attribution_map(
    api_client,
    enroll_env,
    seed_policy,
    mock_apply_peer_on_host,
    mock_record_vpn_enroll,
    enroll_device,
    dns_ingest_env,
):
    enroll = enroll_device(device_id="attr-map", public_key="attrMapKey=")
    token = enroll.json()["device_token"]
    client_ip = enroll.json()["address"].split("/")[0]

    api_client.post(
        "/v1/network-attribution",
        json=_attribution_payload("attr-map"),
        headers={"Authorization": f"Bearer {token}"},
    )
    api_client.post("/dns-queries", json=dns_query_payload(client_ip=client_ip, domain="zoom.us"))

    response = api_client.get("/network-attribution/map", params={"minutes": 15})
    assert response.status_code == 200
    body = response.json()
    node_types = {n["type"] for n in body["nodes"]}
    assert "device" in node_types
    assert "app" in node_types
    assert "domain" in node_types
    assert any(n.get("app_slug") == "zoom" for n in body["nodes"] if n["type"] == "app")
    assert any(e["kind"] == "dns" for e in body["edges"])


def test_network_attribution_map_groups_by_root_domain(
    api_client,
    enroll_env,
    seed_policy,
    mock_apply_peer_on_host,
    mock_record_vpn_enroll,
    enroll_device,
    dns_ingest_env,
):
    enroll = enroll_device(device_id="attr-map-root", public_key="attrMapRootKey=")
    token = enroll.json()["device_token"]
    client_ip = enroll.json()["address"].split("/")[0]

    api_client.post(
        "/v1/network-attribution",
        json=_attribution_payload("attr-map-root"),
        headers={"Authorization": f"Bearer {token}"},
    )
    api_client.post("/dns-queries", json=dns_query_payload(client_ip=client_ip, domain="www.zoom.us"))
    api_client.post("/dns-queries", json=dns_query_payload(client_ip=client_ip, domain="meeting.zoom.us"))

    response = api_client.get("/network-attribution/map", params={"minutes": 15})
    assert response.status_code == 200
    body = response.json()
    domain_nodes = [n for n in body["nodes"] if n["type"] == "domain"]
    assert len(domain_nodes) == 1
    assert domain_nodes[0]["label"] == "zoom.us"

    dns_edges = [e for e in body["edges"] if e["kind"] == "dns"]
    assert len(dns_edges) == 1
    assert dns_edges[0]["query_count"] == 2
