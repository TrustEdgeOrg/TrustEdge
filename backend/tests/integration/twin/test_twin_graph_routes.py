def test_graph_snapshot(api_client, seed_policy, vpn_device):
    response = api_client.get("/twin/graph/snapshot", params={"minutes": 15})
    assert response.status_code == 200
    body = response.json()
    assert "nodes" in body
    assert "edges" in body
    assert body["window_minutes"] == 15
    entity_types = {node["entity_type"] for node in body["nodes"]}
    assert "infra_component" in entity_types


def test_graph_traverse_from_infra(api_client, seed_policy, vpn_device):
    snapshot = api_client.get("/twin/graph/snapshot", params={"minutes": 15}).json()
    wireguard = next(
        node for node in snapshot["nodes"] if node["id"] == "infra:wireguard"
    )
    response = api_client.post(
        "/twin/graph/traverse",
        params={"minutes": 15},
        json={
            "seed_node_ids": [wireguard["id"]],
            "direction": "both",
            "max_depth": 2,
            "layers": ["desired"],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["nodes"]) >= 1
    assert len(body["paths"]) >= 1


def test_graph_neighbors(api_client, seed_policy, vpn_device):
    response = api_client.get(
        "/twin/graph/neighbors",
        params={"node_id": "infra:dns_resolver", "direction": "both", "minutes": 15},
    )
    assert response.status_code == 200
    body = response.json()
    assert any(node["entity_type"] == "infra_component" for node in body["nodes"])
